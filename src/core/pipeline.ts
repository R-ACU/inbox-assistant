/**
 * The mail pipeline. Code decides the order of steps and the outcome; the
 * model is called for three narrow jobs (sort, read a document, draft text)
 * and every answer is schema-checked before it is used.
 *
 *   rules scan -> classify -> [invoice: extract -> recompute -> file or review]
 *                           -> [inquiry: draft -> check -> approval queue]
 *                           -> [suspicious: quarantine, no further model calls]
 */
import type { z } from "zod";
import type { DraftInput, LlmProvider, ModelCall } from "../llm/provider";
import type { ParsedMail } from "../mail/parse";
import { mailIdFor } from "../mail/parse";
import {
  ClassificationSchema,
  InvoiceExtractionSchema,
  ReplyDraftSchema,
  type Category,
  type ReplyDraft,
} from "../shared/schemas";
import { pick, type Locale } from "../shared/locale";
import type { Finding, InboundMail, ModelStep, ModelStepName, ProcessedMail } from "../shared/types";
import type { TenantProfile } from "../tenant/profile";
import { checkDraft, type DraftCheckContext } from "./draft-check";
import { checkInvoice } from "./invoice-check";
import { hasBlockingFinding, scanMail } from "./rules";

export interface PipelineDeps {
  llm: LlmProvider;
  tenant: TenantProfile;
  /** ISO timestamp used as receivedAt. */
  now: string;
  existingInvoices: { supplier: string; invoiceNumber: string }[];
  resumeUrl?: string | null;
  /** Record id; defaults to the hash of the Message-ID. Set when that id is already taken by another mail. */
  id?: string;
  /** Findings from intake (for example a Message-ID collision), added to the rule findings. */
  intakeFindings?: Finding[];
}

/** Below this the model's category is not trusted without a human look. */
export const MIN_CONFIDENCE = 0.6;

type Validated<T> = { ok: true; value: T } | { ok: false; finding: Finding };

function validate<S extends z.ZodType>(
  step: ModelStepName,
  call: ModelCall,
  schema: S,
  steps: ModelStep[],
  locale: Locale = "de",
): Validated<z.infer<S>> {
  const record: ModelStep = {
    step,
    model: call.model,
    ok: false,
    error: null,
    inputTokens: call.ok ? call.inputTokens : null,
    outputTokens: call.ok ? call.outputTokens : null,
  };
  steps.push(record);
  if (!call.ok) {
    record.error = call.error;
    return {
      ok: false,
      finding: { code: "model_error", severity: "error", message: pick(locale, `Modellschritt fehlgeschlagen: ${call.error}`, `Model step failed: ${call.error}`) },
    };
  }
  const parsed = schema.safeParse(call.data);
  if (!parsed.success) {
    record.error = "schema";
    return {
      ok: false,
      finding: {
        code: "model_schema",
        severity: "error",
        message: pick(locale, "Modellantwort passt nicht zum erwarteten Format und wurde verworfen.", "The model's answer did not match the expected format and was dropped."),
      },
    };
  }
  record.ok = true;
  return { ok: true, value: parsed.data };
}

/** The checks every reply draft gets, from the intake or asked for by the owner. */
export function draftCheckContext(mail: InboundMail, tenant: TenantProfile, request?: DraftRequest): DraftCheckContext {
  return {
    locale: tenant.locale,
    faq: tenant.faq,
    mailText: mail.text,
    allowedDomains: [tenant.domain],
    signature: tenant.signature,
    notes: request?.notes ?? [],
    // A reply to an invoice or a notice needs no FAQ entry; an inquiry should rest on one.
    requireFaq: !request || request.category === "inquiry",
  };
}

type DraftRequest = NonNullable<DraftInput["request"]>;

/**
 * Asks the model for a reply draft, validates it against the schema and checks every fact in code. Used by the
 * intake for inquiries and by the owner's "Antwort entwerfen" (`request` set). The model step lands in `steps`.
 */
export async function writeDraft(
  mail: InboundMail,
  deps: { llm: LlmProvider; tenant: TenantProfile; steps: ModelStep[]; request?: DraftRequest },
): Promise<{ ok: true; draft: ReplyDraft; findings: Finding[] } | { ok: false; finding: Finding }> {
  const { tenant } = deps;
  const call = await deps.llm.draftReply({ mail, faq: tenant.faq, company: tenant.company, signature: tenant.signature, request: deps.request });
  const dr = validate("draft_reply", call, ReplyDraftSchema, deps.steps, tenant.locale);
  if (!dr.ok) return dr;
  return { ok: true, draft: dr.value, findings: checkDraft(dr.value, draftCheckContext(mail, tenant, deps.request)) };
}

export async function processMail(parsed: ParsedMail, deps: PipelineDeps): Promise<ProcessedMail> {
  const { mail, files } = parsed;
  const steps: ModelStep[] = [];
  const today = deps.now.slice(0, 10);
  const locale = deps.tenant.locale;
  const say = (de: string, en: string) => pick(locale, de, en);

  const ruleFindings: Finding[] = [...scanMail(mail, locale), ...(deps.intakeFindings ?? [])];
  for (const a of mail.attachments) {
    if (!a.accepted) {
      ruleFindings.push({
        code: "attachment_rejected",
        severity: "warning",
        message: say(`Anhang ${a.filename} nicht verarbeitet: ${a.rejectReason}`, `Attachment ${a.filename} not processed: ${a.rejectReason}`),
      });
    }
  }
  if (mail.textTruncated) {
    ruleFindings.push({
      code: "text_truncated",
      severity: "warning",
      message: say("Mailtext war sehr lang und wurde gekürzt an das Modell gegeben.", "The mail text was very long and was shortened for the model."),
    });
  }

  const result: ProcessedMail = {
    id: deps.id ?? mailIdFor(mail.messageId),
    receivedAt: deps.now,
    mail,
    classification: null,
    category: "other",
    ruleFindings,
    invoice: null,
    draft: null,
    status: "filed",
    reviewReasons: [],
    steps,
    resumeUrl: deps.resumeUrl ?? null,
  };

  // 1. Sort. Rules can only make the outcome stricter than the model's answer.
  const cls = validate("classify", await deps.llm.classify(mail), ClassificationSchema, steps, locale);
  let category: Category = "other";
  if (cls.ok) {
    result.classification = cls.value;
    category = cls.value.category;
    if (cls.value.contains_instructions) category = "suspicious";
  } else {
    result.reviewReasons.push(cls.finding);
  }
  if (hasBlockingFinding(ruleFindings)) category = "suspicious";
  result.category = category;

  if (category === "suspicious") {
    result.status = "quarantined";
    result.reviewReasons.push(...ruleFindings.filter((f) => f.severity !== "info"));
    if (cls.ok && cls.value.category === "suspicious") {
      for (const reason of cls.value.reasons) result.reviewReasons.push({ code: "model_reason", severity: "info", message: reason });
    }
    if (result.reviewReasons.length === 0) {
      result.reviewReasons.push({ code: "model_flagged", severity: "error", message: say("Vom Modell als verdächtig eingeordnet.", "Sorted as suspicious by the model.") });
    }
    return result;
  }

  if (!cls.ok) {
    result.status = "needs_review";
    return result;
  }
  if (cls.value.confidence < MIN_CONFIDENCE) {
    result.reviewReasons.push({
      code: "low_confidence",
      severity: "error",
      message: say(
        `Einordnung unsicher (${Math.round(cls.value.confidence * 100)} %). Bitte selbst zuordnen.`,
        `Sorting uncertain (${Math.round(cls.value.confidence * 100)}%). Please sort it yourself.`,
      ),
    });
    result.status = "needs_review";
    return result;
  }

  // 2a. Invoice: read the document, then recompute everything in code.
  if (category === "invoice") {
    const doc = mail.attachments.find((a) => a.accepted && files.has(a.index));
    if (!doc) {
      result.reviewReasons.push({ code: "no_document", severity: "error", message: say("Kein verwertbarer Beleg im Anhang.", "No usable document attached.") });
      result.status = "needs_review";
      return result;
    }
    const file = files.get(doc.index)!;
    const ex = validate(
      "extract_invoice",
      await deps.llm.extractInvoice({ content: file.content, sha256: doc.sha256, filename: doc.filename, mediaType: file.mediaType }),
      InvoiceExtractionSchema,
      steps,
      locale,
    );
    if (!ex.ok) {
      result.reviewReasons.push(ex.finding);
      result.status = "needs_review";
      return result;
    }
    const check = checkInvoice(ex.value, {
      today,
      suppliers: deps.tenant.suppliers,
      existing: deps.existingInvoices,
      senderAddress: mail.from.address,
      locale,
      taxRates: deps.tenant.taxRates,
    });
    // Only a spotless invoice is filed without a human look: any error or warning,
    // from the invoice check or the rule scan, sends it to the review list.
    const ruleWarnings = ruleFindings.filter((f) => f.severity === "warning");
    const checkProblems = check.findings.filter((f) => f.severity !== "info");
    result.invoice = {
      attachmentIndex: doc.index,
      extraction: ex.value,
      findings: check.findings,
      computed: check.computed,
      ok: checkProblems.length === 0 && ruleWarnings.length === 0,
    };
    if (result.invoice.ok) {
      result.status = "filed";
    } else {
      result.reviewReasons.push(...checkProblems, ...ruleWarnings);
      result.status = "needs_review";
    }
    return result;
  }

  // 2b. Inquiry: draft a reply from the FAQ. It always waits for a human.
  if (category === "inquiry") {
    const dr = await writeDraft(mail, { llm: deps.llm, tenant: deps.tenant, steps });
    if (!dr.ok) {
      result.reviewReasons.push(dr.finding);
      result.status = "needs_review";
      return result;
    }
    result.draft = { draft: dr.draft, findings: dr.findings, editedAt: null };
    result.status = "awaiting_approval";
    return result;
  }

  // 2c. Other: nothing to do.
  result.status = "filed";
  return result;
}
