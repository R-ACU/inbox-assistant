/**
 * The only door to a language model. The interface has four read-only
 * operations and nothing else: no tool to send mail, move money or touch the
 * database exists on this side, so no prompt can ask the model to use one.
 *
 * Providers return `unknown` on purpose. The pipeline validates every answer
 * against the schemas in src/shared/schemas.ts before using it.
 */
import type { FaqEntry } from "../core/draft-check";
import type { Category } from "../shared/schemas";
import type { InboundMail } from "../shared/types";

export type DocumentMediaType = "application/pdf" | "image/png" | "image/jpeg";

export interface DocumentInput {
  content: Uint8Array;
  sha256: string;
  filename: string;
  mediaType: DocumentMediaType;
}

export interface DraftInput {
  mail: InboundMail;
  faq: FaqEntry[];
  company: string;
  signature: string;
  /**
   * Set when the owner asked for this reply himself ("Antwort entwerfen") instead of the intake drafting it
   * for an inquiry: the category of the mail and the notes of the business's own checks (src/core/reply.ts).
   */
  request?: { category: Category; notes: string[] };
}

export type ModelCall =
  | { ok: true; data: unknown; model: string; inputTokens: number | null; outputTokens: number | null }
  | { ok: false; error: string; model: string };

export interface LlmProvider {
  readonly mode: "mock" | "claude";
  classify(mail: InboundMail): Promise<ModelCall>;
  extractInvoice(doc: DocumentInput): Promise<ModelCall>;
  draftReply(input: DraftInput): Promise<ModelCall>;
  extractContract(doc: DocumentInput): Promise<ModelCall>;
}

export interface ModelConfig {
  /** Small, fast model for sorting mail. */
  classify: string;
  /** Stronger model for reading documents and writing drafts. */
  text: string;
}

export const DEFAULT_MODELS: ModelConfig = {
  classify: "claude-haiku-5-5",
  text: "claude-sonnet-5-5",
};
