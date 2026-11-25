/**
 * Application service: everything the HTTP routes may do, in one place.
 * Each state change checks the current status first (a draft can only be
 * approved while it waits for approval) and writes an audit event.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import MailComposer from "nodemailer/lib/mail-composer";
import { checkDraft } from "../core/draft-check";
import { draftCheckContext, processMail, writeDraft } from "../core/pipeline";
import { replyBlocked, replyNotes, settledStatus, statusAfterReply } from "../core/reply";
import { reconcile } from "../core/reconcile";
import { buildDashboard } from "../core/dashboard";
import { buildWeeklySummary, localDate, weekStartOf } from "../core/weekly";
import { toCents } from "../core/money";
import { inspectAttachment, safeFilename } from "../core/attachments";
import type { DocumentMediaType, LlmProvider } from "../llm/provider";
import { mailIdFor, parseEml, sha256 } from "../mail/parse";
import { ContractExtractionSchema, type ContractExtraction } from "../shared/schemas";
import type { AuditEvent, DashboardData, Finding, InvoiceRow, MailListItem, ModelStep, ProcessedMail, ReconcileResult, WeeklySummary } from "../shared/types";
import type { TenantProfile } from "../tenant/profile";
import type { AppConfig } from "./config";
import type { Store } from "./store";

export class ServiceError extends Error {
  constructor(
    readonly status: 400 | 404 | 409 | 413 | 422 | 502,
    message: string,
  ) {
    super(message);
  }
}

export interface ServiceDeps {
  config: AppConfig;
  store: Store;
  llm: LlmProvider;
  tenant: TenantProfile;
  now?: () => Date;
  fetch?: typeof fetch;
}

export interface ContractSample {
  id: string;
  title: string;
  quote: string;
  order: string;
  expectedDiscrepancies: number;
}

const MEDIA: Record<string, DocumentMediaType> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" };

// German wording for the audit trail, which the owner reads in the UI.
const CATEGORY_DE = { invoice: "Rechnung", inquiry: "Anfrage", other: "Sonstiges", suspicious: "Verdächtig" } as const;
const STATUS_DE: Record<ProcessedMail["status"], string> = {
  awaiting_approval: "Entwurf wartet auf Freigabe",
  needs_review: "in die Prüfliste gelegt",
  quarantined: "in Quarantäne gestellt",
  filed: "abgelegt",
  approved: "freigegeben",
  delivery_failed: "Versand fehlgeschlagen",
  sent: "gesendet",
  discarded: "verworfen",
  resolved: "erledigt",
};
const STEP_DE = { classify: "Einordnen", extract_invoice: "Beleg auslesen", draft_reply: "Entwurf" } as const;

/** One sentence for the audit trail, readable for the owner. */
function intakeSummary(record: ProcessedMail): string {
  const steps = record.steps.map((s) => {
    const readFailed = s.step === "extract_invoice" && s.ok && record.invoice && !record.invoice.extraction.readable;
    const outcome = !s.ok ? "fehlgeschlagen" : readFailed ? "Beleg nicht lesbar" : "erledigt";
    return `${STEP_DE[s.step]}: ${outcome}`;
  });
  return `Als ${CATEGORY_DE[record.category]} eingeordnet, ${STATUS_DE[record.status]}.${steps.length ? ` ${steps.join("; ")}.` : ""}`;
}

/** Only resume URLs that point at the configured n8n instance are accepted (no SSRF through ingest). */
export function validateResumeUrl(url: string, n8nBaseUrl: string | null): string {
  if (!n8nBaseUrl) throw new ServiceError(400, "resume_url given, but N8N_BASE_URL is not configured");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ServiceError(400, "resume_url is not a valid URL");
  }
  const base = new URL(n8nBaseUrl);
  if (parsed.origin !== base.origin || !parsed.pathname.startsWith("/webhook-waiting/") || parsed.username || parsed.password) {
    throw new ServiceError(400, "resume_url must point to the configured n8n instance");
  }
  return parsed.toString();
}

export class InboxService {
  private readonly now: () => Date;
  private readonly fetchFn: typeof fetch;
  /** Mails whose requested reply the model is writing right now: a second click must not pay for a second call. */
  private readonly drafting = new Set<string>();

  constructor(private readonly deps: ServiceDeps) {
    this.now = deps.now ?? (() => new Date());
    this.fetchFn = deps.fetch ?? fetch;
  }

  get mode(): "mock" | "claude" {
    return this.deps.llm.mode;
  }

  private event(mailId: string | null, actor: AuditEvent["actor"], action: string, detail = ""): void {
    this.deps.store.addEvent({ mailId, at: this.now().toISOString(), actor, action, detail });
  }

  private rawPath(id: string): string {
    return join(this.deps.config.dataDir, "raw", `${id}.eml`);
  }

  private require(id: string): ProcessedMail {
    if (!/^[0-9a-f]{20}$/.test(id)) throw new ServiceError(404, "Mail nicht gefunden");
    const record = this.deps.store.getMail(id);
    if (!record) throw new ServiceError(404, "Mail nicht gefunden");
    return record;
  }

  private save(record: ProcessedMail): void {
    this.deps.store.updateMail(record, this.now().toISOString());
  }

  // ---------------------------------------------------------------- ingest

  async ingest(raw: Buffer, opts: { resumeUrl?: string | null; actor: AuditEvent["actor"] }): Promise<{ record: ProcessedMail; created: boolean }> {
    const resumeUrl = opts.resumeUrl ? validateResumeUrl(opts.resumeUrl, this.deps.config.n8nBaseUrl) : null;
    let parsed;
    try {
      parsed = await parseEml(raw);
    } catch (error) {
      throw new ServiceError(error instanceof Error && error.message.includes("15 MB") ? 413 : 422, "Mail konnte nicht gelesen werden");
    }
    // The Message-ID is chosen by the sender. The same Message-ID with the same bytes is a
    // re-delivery (idempotent); with other bytes it is a different mail that must not be dropped.
    const rawHash = sha256(raw);
    let id = mailIdFor(parsed.mail.messageId);
    const intakeFindings: Finding[] = [];
    const existing = this.deps.store.getMail(id);
    if (existing) {
      if (!existing.mail.rawSha256 || existing.mail.rawSha256 === rawHash) return { record: existing, created: false };
      id = mailIdFor(`${parsed.mail.messageId}\n${rawHash}`);
      const again = this.deps.store.getMail(id);
      if (again) return { record: again, created: false };
      intakeFindings.push({
        code: "message_id_collision",
        severity: "warning",
        message: "Eine andere Mail mit derselben Message-ID ist schon eingegangen. Beide Mails vergleichen, eine davon ist vermutlich gefälscht.",
      });
    }
    const record = await processMail(parsed, {
      llm: this.deps.llm,
      tenant: this.deps.tenant,
      now: this.now().toISOString(),
      existingInvoices: this.deps.store.invoicesOnFile(),
      resumeUrl,
      id,
      intakeFindings,
    });
    const created = this.deps.store.insertMail(record);
    if (!created) return { record: this.deps.store.getMail(record.id)!, created: false };

    mkdirSync(join(this.deps.config.dataDir, "raw"), { recursive: true });
    writeFileSync(this.rawPath(record.id), raw);
    this.event(record.id, opts.actor, "eingang", intakeSummary(record));
    return { record, created: true };
  }

  // ---------------------------------------------------------------- read models

  list(): MailListItem[] {
    return this.deps.store.listMails().map((r) => ({
      id: r.id,
      receivedAt: r.receivedAt,
      date: r.mail.date,
      from: r.mail.from,
      subject: r.mail.subject,
      category: r.category,
      status: r.status,
      preview: r.mail.text.slice(0, 160),
      attachmentCount: r.mail.attachments.length,
      // While a draft waits, the count is about the draft (the Freigabe list shows it as "Hinweis im Entwurf").
      findingCount: (r.status === "awaiting_approval" && r.draft ? r.draft.findings : r.reviewReasons).filter((f) => f.severity !== "info").length,
      grossCents: toCents(r.invoice?.extraction.gross_total ?? null),
      reason: (r.reviewReasons.find((f) => f.severity === "error") ?? r.reviewReasons.find((f) => f.severity === "warning"))?.message ?? null,
    }));
  }

  detail(id: string): { record: ProcessedMail; events: AuditEvent[] } {
    const record = this.require(id);
    return { record, events: this.deps.store.listEvents(id) };
  }

  counts(): { awaitingApproval: number; openReview: number; quarantined: number; total: number } {
    const c = this.deps.store.countByStatus();
    return {
      awaitingApproval: c.awaiting_approval ?? 0,
      openReview: c.needs_review ?? 0,
      quarantined: c.quarantined ?? 0,
      total: Object.values(c).reduce((a, b) => a + b, 0),
    };
  }

  invoices(): InvoiceRow[] {
    return this.deps.store
      .listMails()
      .filter((r) => r.category === "invoice" && r.invoice && r.invoice.extraction.readable)
      .map((r) => {
        const ex = r.invoice!.extraction;
        return {
          mailId: r.id,
          supplier: ex.supplier_name ?? "",
          invoiceNumber: ex.invoice_number ?? "",
          invoiceDate: ex.invoice_date ?? "",
          netCents: toCents(ex.net_total) ?? 0,
          taxCents: toCents(ex.tax_total) ?? 0,
          grossCents: toCents(ex.gross_total) ?? 0,
          // The invoice's own status: it stays filed while a reply to the supplier waits for approval.
          status: settledStatus(r),
          ok: r.invoice!.ok,
        };
      })
      .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate));
  }

  dashboard(days: 7 | 14): DashboardData {
    return buildDashboard(this.deps.store.listMails(), days, localDate(this.now().toISOString()));
  }

  weekly(weekStart?: string): WeeklySummary & { weeks: string[] } {
    const records = this.deps.store.listMails();
    const weeks = [...new Set(records.map((r) => weekStartOf(localDate(r.mail.date))))].sort();
    const start = weekStart ? weekStartOf(weekStart) : (weeks.at(-1) ?? weekStartOf(localDate(this.now().toISOString())));
    return { ...buildWeeklySummary(records, start, this.deps.tenant.suppliers), weeks };
  }

  /** Returns an accepted attachment. Rejected attachments are never served. */
  async attachment(id: string, index: number): Promise<{ filename: string; content: Buffer; mediaType: DocumentMediaType }> {
    const record = this.require(id);
    const info = record.mail.attachments.find((a) => a.index === index);
    if (!info || !info.accepted || !existsSync(this.rawPath(id))) throw new ServiceError(404, "Anhang nicht verfügbar");
    const parsed = await parseEml(readFileSync(this.rawPath(id)));
    const file = parsed.files.get(index);
    if (!file) throw new ServiceError(404, "Anhang nicht verfügbar");
    return { filename: info.filename, content: file.content, mediaType: file.mediaType };
  }

  // ---------------------------------------------------------------- human decisions

  /**
   * "Antwort entwerfen": the owner asks for a reply to a mail the intake did not draft for (an invoice, a
   * notice, a mail on the review list, an inquiry whose draft he discarded). The draft gets the same schema
   * and fact checks as an intake draft and then waits in the same approval step; nothing is sent here.
   * Never for quarantined or suspicious mail.
   */
  async requestReply(id: string): Promise<ProcessedMail> {
    const record = this.require(id);
    const blocked = replyBlocked(record);
    if (blocked) throw new ServiceError(409, blocked);
    if (this.drafting.has(id)) throw new ServiceError(409, "Der Entwurf wird gerade geschrieben.");
    this.drafting.add(id);
    try {
      const from = record.status;
      const notes = replyNotes(record);
      const steps: ModelStep[] = [];
      const result = await writeDraft(record.mail, { llm: this.deps.llm, tenant: this.deps.tenant, steps, request: { category: record.category, notes } });
      if (!result.ok) {
        this.event(id, "system", "entwurf_fehlgeschlagen", result.finding.message);
        throw new ServiceError(
          502,
          this.deps.llm.mode === "mock" ? "Im Testmodus gibt es für diese Mail keine feste Antwort." : "Der Entwurf konnte nicht geschrieben werden. Bitte noch einmal versuchen.",
        );
      }
      // The mail may have changed while the model was writing (filed or closed in a second tab).
      // Claim it atomically; if it moved on, the draft is dropped and nothing changes.
      const now = this.now().toISOString();
      if (!this.deps.store.transition(id, [from], "awaiting_approval", now)) {
        throw new ServiceError(409, "Die Mail hat sich inzwischen geändert. Bitte neu laden.");
      }
      const fresh = this.require(id);
      fresh.status = "awaiting_approval";
      fresh.draft = { draft: result.draft, findings: result.findings, editedAt: null, requested: { at: now, from, notes, sentAt: null } };
      fresh.steps = [...fresh.steps.filter((s) => s.step !== "draft_reply"), ...steps];
      this.save(fresh);
      const hints = result.findings.filter((f) => f.severity !== "info").length;
      this.event(id, "owner", "antwort_angefordert", hints === 0 ? "Entwurf geschrieben, ohne Hinweis" : `Entwurf geschrieben, ${hints === 1 ? "1 Hinweis" : `${hints} Hinweise`}`);
      return fresh;
    } finally {
      this.drafting.delete(id);
    }
  }

  saveDraft(id: string, edit: { subject: string; body: string }): ProcessedMail {
    const record = this.require(id);
    if (record.status !== "awaiting_approval" || !record.draft) throw new ServiceError(409, "Kein offener Entwurf");
    record.draft.draft = { ...record.draft.draft, subject: edit.subject, body: edit.body };
    record.draft.editedAt = this.now().toISOString();
    // Re-run the fact check on the edited text so the owner sees what is still unsupported.
    const request = record.draft.requested ? { category: record.category, notes: record.draft.requested.notes } : undefined;
    record.draft.findings = checkDraft(record.draft.draft, draftCheckContext(record.mail, this.deps.tenant, request)).filter(
      (f) => f.code !== "open_question",
    );
    this.save(record);
    this.event(id, "owner", "entwurf_geaendert");
    return record;
  }

  async approve(id: string, edit: { subject: string; body: string }): Promise<ProcessedMail> {
    let record = this.require(id);
    if (record.status !== "awaiting_approval" || !record.draft) throw new ServiceError(409, "Kein offener Entwurf");
    const changed = edit.subject !== record.draft.draft.subject || edit.body !== record.draft.draft.body;
    if (changed) record = this.saveDraft(id, edit);

    // Claim the mail atomically before the first await. A second "Senden" (double click,
    // second tab) finds it no longer awaiting approval and gets 409: nothing is sent twice.
    const now = this.now().toISOString();
    if (!this.deps.store.transition(id, ["awaiting_approval"], "approved", now)) {
      throw new ServiceError(409, "Kein offener Entwurf");
    }
    record.status = "approved";
    // A requested reply has no n8n run waiting for it (that run ended when the mail was filed or put on the
    // review list), so it always takes the outbox path. See DECISIONS.md.
    const requested = !!record.draft?.requested;
    const entry = {
      mailId: id,
      // Replies go to the sender address, never to a Reply-To on a foreign domain.
      to: record.mail.from.address,
      subject: edit.subject,
      body: edit.body,
      inReplyTo: record.mail.messageId,
      approvedAt: now,
      deliveredAt: null as string | null,
      delivery: (record.resumeUrl && !requested ? "n8n" : "outbox-folder") as "n8n" | "outbox-folder",
    };
    this.deps.store.putOutbox(entry);
    this.event(id, "owner", "freigegeben", changed ? "mit Änderungen" : "unverändert");

    if (entry.delivery === "outbox-folder") {
      try {
        await this.writeOutboxFile(entry);
      } catch (error) {
        this.deps.store.transition(id, ["approved"], "delivery_failed", this.now().toISOString());
        this.event(id, "system", "versand_fehlgeschlagen", "Ausgangsordner nicht beschreibbar");
        throw error;
      }
      // The owner may have discarded while the file was being written. Only an atomic
      // approved -> sent counts; otherwise the discard wins and the file is taken back out.
      // A requested reply sends the mail back to where it was (an invoice stays filed).
      const after = statusAfterReply(record, "sent");
      if (!this.deps.store.transition(id, ["approved"], after, this.now().toISOString())) {
        rmSync(this.outboxPath(id), { force: true });
        this.event(id, "system", "versand_abgebrochen", "Während des Schreibens verworfen, Antwort aus dem Ausgangsordner entfernt");
        throw new ServiceError(409, "Inzwischen verworfen, nichts versendet");
      }
      this.deps.store.markDelivered(id, now);
      if (requested) {
        const sent = this.require(id);
        sent.draft!.requested!.sentAt = now;
        this.save(sent);
      }
      this.event(id, "system", "versendet", "in den Ausgangsordner geschrieben");
      return this.require(id);
    }

    return this.handOverToN8n(record);
  }

  /** Resumes the waiting n8n run. If n8n does not take it, the mail is marked delivery_failed. */
  private async handOverToN8n(record: ProcessedMail): Promise<ProcessedMail> {
    if (await this.resumeN8n(record)) return this.require(record.id);
    this.deps.store.transition(record.id, ["approved"], "delivery_failed", this.now().toISOString());
    return this.require(record.id);
  }

  /** True only if n8n answered 2xx. A 404 means the Wait node is gone (for example after its 7-day timeout). */
  private async resumeN8n(record: ProcessedMail): Promise<boolean> {
    try {
      const res = await this.fetchFn(record.resumeUrl!, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mail_id: record.id }),
        signal: AbortSignal.timeout(5_000),
        redirect: "error",
      });
      if (!res.ok) {
        this.event(
          record.id,
          "system",
          "n8n_nicht_erreichbar",
          res.status === 404
            ? "n8n kennt den wartenden Ablauf nicht mehr (HTTP 404, vermutlich abgelaufen)."
            : `n8n hat die Fortsetzung abgelehnt (HTTP ${res.status}).`,
        );
        return false;
      }
      this.event(record.id, "system", "n8n_fortgesetzt", `HTTP ${res.status}`);
      return true;
    } catch {
      this.event(record.id, "system", "n8n_nicht_erreichbar", "Keine Verbindung zu n8n.");
      return false;
    }
  }

  /** Tries the n8n hand-over again for a reply whose first hand-over failed. */
  async retryDelivery(id: string): Promise<ProcessedMail> {
    const record = this.require(id);
    if (!record.resumeUrl || !this.deps.store.transition(id, ["delivery_failed"], "approved", this.now().toISOString())) {
      throw new ServiceError(409, "Kein fehlgeschlagener Versand");
    }
    record.status = "approved";
    this.event(id, "owner", "erneut_senden");
    return this.handOverToN8n(record);
  }

  private async writeOutboxFile(entry: { mailId: string; to: string; subject: string; body: string; inReplyTo: string }): Promise<void> {
    const raw = await new MailComposer({
      from: { name: this.deps.tenant.company, address: this.deps.tenant.mailbox },
      to: entry.to,
      subject: entry.subject,
      text: entry.body,
      inReplyTo: entry.inReplyTo,
      references: entry.inReplyTo,
      date: this.now(),
    })
      .compile()
      .build();
    mkdirSync(join(this.deps.config.dataDir, "outbox"), { recursive: true });
    writeFileSync(this.outboxPath(entry.mailId), raw);
  }

  private outboxPath(id: string): string {
    return join(this.deps.config.dataDir, "outbox", `${id}.eml`);
  }

  /**
   * Discards a draft. Also allowed after approval as long as nothing was delivered
   * (n8n did not confirm) and after a failed hand-over.
   */
  async discard(id: string, reason: string): Promise<ProcessedMail> {
    const record = this.require(id);
    const before = record.status;
    const delivered = Boolean(this.deps.store.getOutbox(id)?.deliveredAt);
    const allowed: ProcessedMail["status"][] = delivered ? ["awaiting_approval"] : ["awaiting_approval", "approved", "delivery_failed"];
    // A requested reply that is discarded leaves the mail as it was before the request.
    const after = statusAfterReply(record, "discarded");
    if (!this.deps.store.transition(id, allowed, after, this.now().toISOString())) {
      throw new ServiceError(409, "Kein offener Entwurf");
    }
    if (record.draft?.requested) {
      const back = this.require(id);
      back.draft = null;
      this.save(back);
      this.event(id, "owner", "verworfen", after === "discarded" ? reason : `${reason}. Mail wieder ${STATUS_DE[after]}`);
      return back;
    }
    record.status = "discarded";
    this.event(id, "owner", "verworfen", reason);
    // Let a waiting n8n run finish: it fetches the outbox, gets 409 and ends without sending.
    if (record.resumeUrl && before === "awaiting_approval") await this.resumeN8n(record);
    return this.require(id);
  }

  resolveReview(id: string, action: "file" | "close", note: string): ProcessedMail {
    const record = this.require(id);
    if (record.status !== "needs_review" && record.status !== "quarantined") throw new ServiceError(409, "Nicht in der Prüfliste");
    if (action === "file") {
      if (record.status === "quarantined" || record.category !== "invoice" || !record.invoice?.extraction.readable) {
        throw new ServiceError(409, "Nur lesbare Rechnungen können nach Prüfung abgelegt werden");
      }
      record.status = "filed";
    } else {
      record.status = "resolved";
    }
    this.save(record);
    this.event(id, "owner", action === "file" ? "nach_pruefung_abgelegt" : "erledigt", note);
    return record;
  }

  // ---------------------------------------------------------------- n8n side

  outboxFor(id: string) {
    const record = this.require(id);
    const entry = this.deps.store.getOutbox(id);
    if (record.status !== "approved" || !entry || entry.deliveredAt) {
      throw new ServiceError(409, `Nichts zu versenden (Status ${record.status})`);
    }
    return {
      mail_id: id,
      from: this.deps.tenant.mailbox,
      to: entry.to,
      subject: entry.subject,
      body: entry.body,
      in_reply_to: entry.inReplyTo,
    };
  }

  markDelivered(id: string, actor: AuditEvent["actor"]): ProcessedMail {
    const record = this.require(id);
    const entry = this.deps.store.getOutbox(id);
    // "discarded" with an undelivered outbox entry: the owner discarded while n8n was already
    // sending. The confirmation is recorded anyway, the log has to tell the truth.
    const late = record.status === "discarded" && entry !== null && !entry.deliveredAt;
    if (record.status !== "approved" && !late) throw new ServiceError(409, `Nicht freigegeben (Status ${record.status})`);
    this.deps.store.markDelivered(id, this.now().toISOString());
    record.status = "sent";
    this.save(record);
    this.event(id, actor, "versendet", late ? "Zustellung über n8n bestätigt, obwohl inzwischen verworfen" : "Zustellung über n8n bestätigt");
    return record;
  }

  // ---------------------------------------------------------------- reconciliation

  contractSamples(): ContractSample[] {
    const file = join(this.deps.config.contractSamplesDir, "pairs.json");
    if (!existsSync(file)) return [];
    return JSON.parse(readFileSync(file, "utf8")) as ContractSample[];
  }

  private async extractContract(content: Buffer, filename: string): Promise<ContractExtraction> {
    const verdict = inspectAttachment({ filename, contentType: "application/octet-stream", content });
    if (!verdict.accepted || !verdict.kind) throw new ServiceError(422, `${filename}: ${verdict.reason ?? "nicht lesbar"}`);
    const call = await this.deps.llm.extractContract({
      content,
      sha256: sha256(content),
      filename,
      mediaType: MEDIA[verdict.kind]!,
    });
    if (!call.ok) throw new ServiceError(502, `${filename}: ${call.error}`);
    const parsed = ContractExtractionSchema.safeParse(call.data);
    if (!parsed.success) throw new ServiceError(502, `${filename}: Modellantwort passt nicht zum Schema`);
    return parsed.data;
  }

  async reconcileSample(id: string): Promise<ReconcileResult> {
    const sample = this.contractSamples().find((s) => s.id === id);
    if (!sample) throw new ServiceError(404, "Beispiel nicht gefunden");
    const dir = this.deps.config.contractSamplesDir;
    return this.reconcileFiles(
      { filename: sample.quote, content: readFileSync(join(dir, sample.quote)) },
      { filename: sample.order, content: readFileSync(join(dir, sample.order)) },
    );
  }

  async reconcileFiles(
    quote: { filename: string; content: Buffer },
    order: { filename: string; content: Buffer },
  ): Promise<ReconcileResult> {
    const [q, o] = await Promise.all([
      this.extractContract(quote.content, safeFilename(quote.filename)),
      this.extractContract(order.content, safeFilename(order.filename)),
    ]);
    const result = reconcile(q, o);
    this.event(null, "owner", "abgleich", `${q.document_number ?? "?"} gegen ${o.document_number ?? "?"}: ${result.discrepancyCount} Abweichungen`);
    return result;
  }
}
