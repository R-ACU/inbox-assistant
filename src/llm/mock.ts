/**
 * Mock provider: answers from fixed JSON fixtures instead of calling the API.
 * Used for tests, the local preview and the pipeline run of the eval.
 *
 * Mail-level answers are keyed by Message-ID, document answers by the SHA-256
 * of the file, so a re-uploaded sample PDF still finds its answer and an
 * unknown file gets an honest "no fixture" error instead of made-up data.
 */
import { readFileSync } from "node:fs";
import { pick, type Locale } from "../shared/locale";
import type { InboundMail } from "../shared/types";
import type { DocumentInput, DraftInput, LlmProvider, ModelCall, ModelConfig } from "./provider";
import { DEFAULT_MODELS } from "./provider";

export interface MockResponses {
  classify: Record<string, unknown>;
  draft: Record<string, unknown>;
  /** Replies the owner asks for on mails without an intake draft; an inquiry falls back to its draft. */
  reply?: Record<string, unknown>;
  invoice: Record<string, unknown>;
  contract: Record<string, unknown>;
}

export class MockProvider implements LlmProvider {
  readonly mode = "mock" as const;

  constructor(
    private readonly responses: MockResponses,
    private readonly models: ModelConfig = DEFAULT_MODELS,
    private readonly locale: Locale = "de",
  ) {}

  static fromFile(path: string, models?: ModelConfig, locale?: Locale): MockProvider {
    return new MockProvider(JSON.parse(readFileSync(path, "utf8")) as MockResponses, models, locale);
  }

  private answer(table: Record<string, unknown>, key: string, model: string): ModelCall {
    const data = table[key];
    const name = `mock:${model}`;
    if (data === undefined) return { ok: false, error: pick(this.locale, "Keine Mock-Antwort für diese Eingabe", "No mock answer for this input"), model: name };
    return { ok: true, data: structuredClone(data), model: name, inputTokens: null, outputTokens: null };
  }

  async classify(mail: InboundMail): Promise<ModelCall> {
    return this.answer(this.responses.classify, mail.messageId, this.models.classify);
  }

  async extractInvoice(doc: DocumentInput): Promise<ModelCall> {
    return this.answer(this.responses.invoice, doc.sha256, this.models.text);
  }

  async draftReply(input: DraftInput): Promise<ModelCall> {
    const id = input.mail.messageId;
    if (input.request && this.responses.reply?.[id] !== undefined) return this.answer(this.responses.reply, id, this.models.text);
    return this.answer(this.responses.draft, id, this.models.text);
  }

  async extractContract(doc: DocumentInput): Promise<ModelCall> {
    return this.answer(this.responses.contract, doc.sha256, this.models.text);
  }
}
