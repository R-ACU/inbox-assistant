/**
 * Schemas for everything the language model is allowed to return.
 *
 * Every model answer (real API or mock fixture) is parsed with these schemas
 * before the pipeline looks at it. Anything that does not fit goes to the
 * review list, never further down the pipeline.
 *
 * Amounts are plain decimal numbers in the model's answer. The code converts
 * them to integer cents and does all arithmetic itself; the model never sums.
 */
import { z } from "zod";

export const CATEGORIES = ["invoice", "inquiry", "other", "suspicious"] as const;
export type Category = (typeof CATEGORIES)[number];

const shortText = z.string().max(300);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

export const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  confidence: z.number().min(0).max(1),
  reasons: z.array(shortText).max(5),
  /** True when the mail text tries to give the assistant orders (prompt injection). */
  contains_instructions: z.boolean(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const InvoiceLineSchema = z.object({
  description: z.string().max(200),
  quantity: z.number(),
  unit_price: z.number(),
  line_total: z.number(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const InvoiceExtractionSchema = z.object({
  /** False when the document cannot be read reliably (bad scan, cut off, wrong file). */
  readable: z.boolean(),
  unreadable_reason: shortText.nullable(),
  supplier_name: z.string().max(200).nullable(),
  invoice_number: z.string().max(80).nullable(),
  invoice_date: isoDate.nullable(),
  iban: z.string().max(42).nullable(),
  currency: z.string().max(3).nullable(),
  line_items: z.array(InvoiceLineSchema).max(100),
  net_total: z.number().nullable(),
  tax_rate_percent: z.number().nullable(),
  tax_total: z.number().nullable(),
  gross_total: z.number().nullable(),
});
export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>;

export const ReplyDraftSchema = z.object({
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
  /** Ids of the FAQ entries the draft is based on. Checked against the real FAQ in code. */
  used_faq_ids: z.array(z.string().max(40)).max(10),
  /** Things the business owner has to fill in or decide before sending. */
  open_questions: z.array(shortText).max(5),
});
export type ReplyDraft = z.infer<typeof ReplyDraftSchema>;

export const CONTRACT_DOC_TYPES = ["quote", "order_form", "unknown"] as const;
export const BILLING_FREQUENCIES = ["monthly", "quarterly", "annual"] as const;

export const ContractLineSchema = z.object({
  sku: z.string().max(40),
  description: z.string().max(200),
  quantity: z.number(),
  /** Price per unit and month, before discount. */
  unit_price: z.number(),
  discount_percent: z.number(),
});
export type ContractLine = z.infer<typeof ContractLineSchema>;

export const ContractExtractionSchema = z.object({
  readable: z.boolean(),
  document_type: z.enum(CONTRACT_DOC_TYPES),
  document_number: z.string().max(60).nullable(),
  quote_reference: z.string().max(60).nullable(),
  customer_name: z.string().max(200).nullable(),
  currency: z.string().max(3).nullable(),
  start_date: isoDate.nullable(),
  term_months: z.number().int().nullable(),
  billing_frequency: z.enum(BILLING_FREQUENCIES).nullable(),
  payment_terms_days: z.number().int().nullable(),
  auto_renewal: z.boolean().nullable(),
  line_items: z.array(ContractLineSchema).max(50),
  total_contract_value: z.number().nullable(),
});
export type ContractExtraction = z.infer<typeof ContractExtractionSchema>;
