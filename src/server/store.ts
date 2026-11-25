/**
 * Persistence on SQLite (node:sqlite, built into Node 22.13+; no native
 * add-on). Mail records are stored as JSON with a few indexed columns.
 * Every state change writes an audit event.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AuditEvent, MailStatus, ProcessedMail } from "../shared/types";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS mails (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  mail_date TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS mails_status ON mails(status);
CREATE INDEX IF NOT EXISTS mails_date ON mails(mail_date);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_id TEXT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_mail ON events(mail_id);

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS outbox (
  mail_id TEXT PRIMARY KEY,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  in_reply_to TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  delivered_at TEXT,
  delivery TEXT NOT NULL
);
`;

export interface OutboxEntry {
  mailId: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo: string;
  approvedAt: string;
  deliveredAt: string | null;
  delivery: "outbox-folder" | "n8n";
}

interface MailRow {
  data: string;
}

export class Store {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // ---------------------------------------------------------------- mails

  /** Inserts a new record. Returns false if a record with this id exists (idempotent ingest). */
  insertMail(record: ProcessedMail): boolean {
    const res = this.db
      .prepare(
        "INSERT OR IGNORE INTO mails (id, received_at, mail_date, category, status, data, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(record.id, record.receivedAt, record.mail.date, record.category, record.status, JSON.stringify(record), record.receivedAt);
    return Number(res.changes) === 1;
  }

  updateMail(record: ProcessedMail, at: string): void {
    this.db
      .prepare("UPDATE mails SET category = ?, status = ?, data = ?, updated_at = ? WHERE id = ?")
      .run(record.category, record.status, JSON.stringify(record), at, record.id);
  }

  /**
   * Atomic status change: only succeeds while the mail is in one of the `from` states.
   * Used before any await, so two clicks on "Senden" cannot both pass the check.
   */
  transition(id: string, from: MailStatus[], to: MailStatus, at: string): boolean {
    const res = this.db
      .prepare(
        `UPDATE mails SET status = ?, data = json_set(data, '$.status', ?), updated_at = ?
         WHERE id = ? AND status IN (${from.map(() => "?").join(",")})`,
      )
      .run(to, to, at, id, ...from);
    return Number(res.changes) === 1;
  }

  getMail(id: string): ProcessedMail | null {
    const row = this.db.prepare("SELECT data FROM mails WHERE id = ?").get(id) as MailRow | undefined;
    return row ? (JSON.parse(row.data) as ProcessedMail) : null;
  }

  listMails(filter: { statuses?: MailStatus[] } = {}): ProcessedMail[] {
    const rows = (
      filter.statuses && filter.statuses.length > 0
        ? this.db
            .prepare(`SELECT data FROM mails WHERE status IN (${filter.statuses.map(() => "?").join(",")}) ORDER BY mail_date DESC`)
            .all(...filter.statuses)
        : this.db.prepare("SELECT data FROM mails ORDER BY mail_date DESC").all()
    ) as unknown as MailRow[];
    return rows.map((r) => JSON.parse(r.data) as ProcessedMail);
  }

  countByStatus(): Record<string, number> {
    const rows = this.db.prepare("SELECT status, COUNT(*) AS n FROM mails GROUP BY status").all() as unknown as {
      status: string;
      n: number;
    }[];
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  }

  /**
   * Invoices already received, used for duplicate detection on new invoices. Includes
   * invoices still on the review list or closed after review, not only filed ones.
   */
  invoicesOnFile(): { supplier: string; invoiceNumber: string }[] {
    return this.listMails()
      .filter((r) => r.invoice?.extraction.supplier_name && r.invoice.extraction.invoice_number)
      .map((r) => ({ supplier: r.invoice!.extraction.supplier_name!, invoiceNumber: r.invoice!.extraction.invoice_number! }));
  }

  // ---------------------------------------------------------------- events

  addEvent(e: Omit<AuditEvent, "id">): void {
    this.db
      .prepare("INSERT INTO events (mail_id, at, actor, action, detail) VALUES (?, ?, ?, ?, ?)")
      .run(e.mailId, e.at, e.actor, e.action, e.detail);
  }

  listEvents(mailId: string): AuditEvent[] {
    const rows = this.db
      .prepare("SELECT id, mail_id AS mailId, at, actor, action, detail FROM events WHERE mail_id = ? ORDER BY id")
      .all(mailId) as unknown as AuditEvent[];
    return rows.map((r) => ({ ...r, id: Number(r.id) }));
  }

  // ---------------------------------------------------------------- sessions

  createSession(idHash: string, csrf: string, createdAt: string, expiresAt: number): void {
    this.db.prepare("INSERT INTO sessions (id_hash, csrf, created_at, expires_at) VALUES (?, ?, ?, ?)").run(idHash, csrf, createdAt, expiresAt);
  }

  getSession(idHash: string, nowMs: number): { csrf: string } | null {
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(nowMs);
    const row = this.db.prepare("SELECT csrf FROM sessions WHERE id_hash = ?").get(idHash) as { csrf: string } | undefined;
    return row ?? null;
  }

  deleteSession(idHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
  }

  // ---------------------------------------------------------------- outbox

  putOutbox(entry: OutboxEntry): void {
    this.db
      .prepare(
        `INSERT INTO outbox (mail_id, to_addr, subject, body, in_reply_to, approved_at, delivered_at, delivery)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(mail_id) DO UPDATE SET to_addr = excluded.to_addr, subject = excluded.subject, body = excluded.body,
           approved_at = excluded.approved_at, delivered_at = excluded.delivered_at, delivery = excluded.delivery`,
      )
      .run(entry.mailId, entry.to, entry.subject, entry.body, entry.inReplyTo, entry.approvedAt, entry.deliveredAt, entry.delivery);
  }

  getOutbox(mailId: string): OutboxEntry | null {
    const row = this.db
      .prepare(
        `SELECT mail_id AS mailId, to_addr AS "to", subject, body, in_reply_to AS inReplyTo, approved_at AS approvedAt,
                delivered_at AS deliveredAt, delivery FROM outbox WHERE mail_id = ?`,
      )
      .get(mailId) as OutboxEntry | undefined;
    return row ?? null;
  }

  markDelivered(mailId: string, at: string): void {
    this.db.prepare("UPDATE outbox SET delivered_at = ? WHERE mail_id = ?").run(at, mailId);
  }
}
