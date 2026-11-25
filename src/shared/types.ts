/**
 * Domain types shared by the server, the pipeline and the web UI.
 * All money values are integer cents.
 */
import type {
  Category,
  Classification,
  ContractExtraction,
  InvoiceExtraction,
  ReplyDraft,
} from "./schemas";

export type Cents = number;

export interface Address {
  name: string;
  address: string;
}

export interface AttachmentInfo {
  index: number;
  filename: string;
  contentType: string;
  size: number;
  sha256: string;
  accepted: boolean;
  rejectReason: string | null;
}

/** A parsed inbound mail. `text` is always plain text; HTML is never rendered. */
export interface InboundMail {
  messageId: string;
  from: Address;
  replyTo: Address | null;
  to: string;
  subject: string;
  date: string;
  text: string;
  hadHtml: boolean;
  /** Tag characters and bidi overrides found (and removed) in subject, sender name and body. */
  hiddenCharacters?: number;
  /**
   * SPF, DKIM and DMARC verdicts from the topmost Authentication-Results header (added by
   * the receiving server), lower case ("pass", "fail", ...). Absent if there is no such header.
   */
  auth?: MailAuth;
  /** SHA-256 of the raw message, to tell a re-delivery from a different mail with the same Message-ID. */
  rawSha256?: string;
  textTruncated: boolean;
  attachments: AttachmentInfo[];
}

export interface MailAuth {
  spf: string | null;
  dkim: string | null;
  dmarc: string | null;
}

export type Severity = "error" | "warning" | "info";

export interface Finding {
  code: string;
  severity: Severity;
  /** German, shown in the UI. */
  message: string;
}

export interface InvoiceComputed {
  lineSum: Cents;
  expectedTax: Cents;
  expectedGross: Cents;
}

export interface InvoiceResult {
  attachmentIndex: number;
  extraction: InvoiceExtraction;
  findings: Finding[];
  computed: InvoiceComputed | null;
  ok: boolean;
}

export interface DraftResult {
  draft: ReplyDraft;
  findings: Finding[];
  /** Set when a human edited the draft. */
  editedAt: string | null;
  /** Set when the owner asked for this reply himself ("Antwort entwerfen"); the intake did not draft it. */
  requested?: ReplyRequest;
}

/** A reply the owner asked for on a mail that had no draft. See src/core/reply.ts. */
export interface ReplyRequest {
  at: string;
  /** Status of the mail before the request. It goes back there when the reply is sent or discarded. */
  from: MailStatus;
  /** Facts from the business's own checks the reply may use (also sources for the draft check). */
  notes: string[];
  sentAt: string | null;
}

export type MailStatus =
  | "awaiting_approval" // reply draft waits in the approval queue
  | "needs_review" // something is off, a human must look at it
  | "quarantined" // suspicious, nothing is drafted
  | "filed" // nothing to do (valid invoice booked, or "other")
  | "approved" // human approved, delivery pending (n8n)
  | "delivery_failed" // approved, but n8n could not be resumed; retry or discard
  | "sent" // delivered to outbox or SMTP
  | "discarded" // human discarded the draft
  | "resolved"; // review item closed by a human

export type ModelStepName = "classify" | "extract_invoice" | "draft_reply";

export interface ModelStep {
  step: ModelStepName;
  model: string;
  ok: boolean;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}

export interface ProcessedMail {
  id: string;
  receivedAt: string;
  mail: InboundMail;
  classification: Classification | null;
  /** Final category after rules were applied. Rules can only make it stricter. */
  category: Category;
  ruleFindings: Finding[];
  invoice: InvoiceResult | null;
  draft: DraftResult | null;
  status: MailStatus;
  /** Why the mail is in the review list or quarantine. */
  reviewReasons: Finding[];
  steps: ModelStep[];
  /** n8n "Wait" resume URL, set when the mail came in through n8n. */
  resumeUrl: string | null;
}

export interface AuditEvent {
  id: number;
  mailId: string | null;
  at: string;
  actor: "system" | "owner" | "n8n";
  action: string;
  detail: string;
}

export interface MailListItem {
  id: string;
  receivedAt: string;
  /** Date header of the mail. */
  date: string;
  from: Address;
  subject: string;
  category: Category;
  status: MailStatus;
  preview: string;
  attachmentCount: number;
  /** Hints in the draft while it waits for approval, otherwise the reasons for review (errors and warnings). */
  findingCount: number;
  grossCents: Cents | null;
  /** The strongest reason the assistant stopped this mail, if it did. */
  reason: string | null;
}

export interface InvoiceRow {
  mailId: string;
  supplier: string;
  invoiceNumber: string;
  invoiceDate: string;
  netCents: Cents;
  taxCents: Cents;
  grossCents: Cents;
  status: MailStatus;
  ok: boolean;
}

export interface WeeklySummary {
  weekStart: string;
  weekEnd: string;
  isoWeek: string;
  totals: {
    mails: number;
    byCategory: Record<Category, number>;
    invoicesFiled: number;
    invoicesGrossCents: Cents;
    awaitingApproval: number;
    openReview: number;
    quarantined: number;
    sent: number;
    discarded: number;
  };
  byDay: { date: string; count: number; byCategory: Record<Category, number> }[];
  topSuppliers: { supplier: string; grossCents: Cents; count: number }[];
  attention: { mailId: string; subject: string; reason: string; status: MailStatus }[];
}

/** How a mail ended up: filed without help, reply prepared for approval, stopped for review, quarantined. */
export type DashboardOutcome = "auto" | "prepared" | "review" | "quarantine";

export interface DashboardTotals {
  mails: number;
  drafts: number;
  invoiceGrossCents: Cents;
  invoices: number;
  stopped: number;
}

export interface DashboardData {
  range: { from: string; to: string; days: 7 | 14; previousFrom: string; previousTo: string };
  current: DashboardTotals;
  previous: DashboardTotals;
  awaitingApproval: number;
  oldestAwaiting: string | null;
  days: {
    date: string;
    total: number;
    byCategory: Record<Category, number>;
    drafts: number;
    invoiceGrossCents: Cents;
    stopped: number;
  }[];
  outcomes: Record<DashboardOutcome, number>;
  /** One row per day of the range, 24 columns (hour of the day, local time). */
  heatmap: number[][];
  tasks: { mailId: string; subject: string; from: string; date: string; category: Category; status: MailStatus; reason: string }[];
  recent: { mailId: string; date: string; subject: string; outcome: DashboardOutcome }[];
  totalMails: number;
}

export type ReconcileStatus = "match" | "mismatch" | "missing";

export interface ReconcileField {
  key: string;
  label: string;
  quote: string;
  order: string;
  status: ReconcileStatus;
}

export interface ReconcileLine {
  sku: string;
  description: string;
  status: "match" | "mismatch" | "only_in_quote" | "only_in_order";
  differences: string[];
  quote: { quantity: number; unitPrice: string; discount: string } | null;
  order: { quantity: number; unitPrice: string; discount: string } | null;
}

export interface ReconcileResult {
  quote: ContractExtraction;
  order: ContractExtraction;
  fields: ReconcileField[];
  lines: ReconcileLine[];
  computed: { quoteTcvCents: Cents | null; orderTcvCents: Cents | null };
  discrepancyCount: number;
  /** English note for the account owner. Generated in code, not by the model. */
  note: string;
}
