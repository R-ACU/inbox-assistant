/**
 * Real provider on the Anthropic Messages API.
 *
 * - Structured outputs: every call sends a JSON schema (from Zod) and the SDK
 *   parses the answer. The pipeline validates it a second time anyway.
 * - No tools are declared on any request.
 * - The API key comes from the local .env only (see src/server/config.ts).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import {
  ClassificationSchema,
  ContractExtractionSchema,
  InvoiceExtractionSchema,
  ReplyDraftSchema,
} from "../shared/schemas";
import { pick, type Locale } from "../shared/locale";
import type { InboundMail } from "../shared/types";
import {
  escapeUntrusted,
  faqBlock,
  mailBlock,
  notesBlock,
  promptsFor,
  type PromptSet,
} from "./prompts";
import type { DocumentInput, DraftInput, LlmProvider, ModelCall, ModelConfig } from "./provider";
import { DEFAULT_MODELS } from "./provider";

type Effort = "low" | "medium" | "high";
type Content = Anthropic.Beta.BetaContentBlockParam[];

interface CallSpec<S extends z.ZodType> {
  model: string;
  schema: S;
  system: string;
  content: Content;
  effort: Effort;
  maxTokens: number;
}

function documentBlock(doc: DocumentInput): Anthropic.Beta.BetaContentBlockParam {
  const data = Buffer.from(doc.content).toString("base64");
  if (doc.mediaType === "application/pdf") {
    return { type: "document", source: { type: "base64", media_type: "application/pdf", data } };
  }
  return { type: "image", source: { type: "base64", media_type: doc.mediaType, data } };
}

/**
 * Fixed, short messages for the UI and the mail record. API details (request ids,
 * parameter names, model names in error texts) go to the server log only.
 */
export function describeError(error: unknown, log: (message: string) => void = (m) => console.error(m), locale: Locale = "de"): string {
  if (error instanceof Anthropic.AuthenticationError) return pick(locale, "API-Schlüssel ungültig", "API key not valid");
  if (error instanceof Anthropic.RateLimitError) return pick(locale, "Rate limit erreicht", "Rate limit reached");
  if (error instanceof Anthropic.BadRequestError) {
    log(`[claude] bad request: ${error.message}`);
    return pick(locale, "Anfrage an das Modell ungültig", "Request to the model not valid");
  }
  if (error instanceof Anthropic.APIConnectionError) return pick(locale, "Keine Verbindung zur API", "No connection to the API");
  if (error instanceof Anthropic.APIError) {
    log(`[claude] API error ${error.status ?? ""}: ${error.message}`);
    return pick(locale, `API-Fehler ${error.status ?? ""}`, `API error ${error.status ?? ""}`).trim();
  }
  log(`[claude] unexpected error: ${error instanceof Error ? error.message : String(error)}`);
  return pick(locale, "Unerwarteter Fehler beim Modellaufruf", "Unexpected error calling the model");
}

export class ClaudeProvider implements LlmProvider {
  readonly mode = "claude" as const;
  private readonly client: Anthropic;
  private readonly prompts: PromptSet;

  constructor(
    apiKey: string,
    private readonly models: ModelConfig = DEFAULT_MODELS,
    private readonly locale: Locale = "de",
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 90_000 });
    this.prompts = promptsFor(locale);
  }

  private async call<S extends z.ZodType>(spec: CallSpec<S>): Promise<ModelCall> {
    const params = {
      model: spec.model,
      max_tokens: spec.maxTokens,
      system: spec.system,
      messages: [{ role: "user" as const, content: spec.content }],
      output_config: { effort: spec.effort, format: betaZodOutputFormat(spec.schema) },
    };
    try {
      // Server-side refusal fallback is offered for the Sonnet line, not for Haiku.
      const res = spec.model.startsWith("claude-sonnet-")
        ? await this.client.beta.messages.parse({
            ...params,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
          })
        : await this.client.beta.messages.parse(params);

      if (res.stop_reason === "refusal") {
        const category = res.stop_details?.category ?? pick(this.locale, "ohne Kategorie", "no category");
        return { ok: false, error: pick(this.locale, `Modell hat abgelehnt (${category})`, `Model refused (${category})`), model: res.model };
      }
      if (res.stop_reason === "max_tokens") {
        return { ok: false, error: pick(this.locale, "Antwort abgeschnitten (max_tokens)", "Answer cut off (max_tokens)"), model: res.model };
      }
      if (res.parsed_output === null || res.parsed_output === undefined) {
        return { ok: false, error: pick(this.locale, "Antwort passt nicht zum Schema", "Answer does not match the schema"), model: res.model };
      }
      return {
        ok: true,
        data: res.parsed_output,
        model: res.model,
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      };
    } catch (error) {
      return { ok: false, error: describeError(error, undefined, this.locale), model: spec.model };
    }
  }

  classify(mail: InboundMail): Promise<ModelCall> {
    return this.call({
      model: this.models.classify,
      schema: ClassificationSchema,
      system: this.prompts.classify,
      content: [{ type: "text", text: mailBlock(mail) }],
      effort: "low",
      maxTokens: 4_000,
    });
  }

  extractInvoice(doc: DocumentInput): Promise<ModelCall> {
    return this.call({
      model: this.models.text,
      schema: InvoiceExtractionSchema,
      system: this.prompts.invoice,
      content: [
        documentBlock(doc),
        {
          type: "text",
          text: `<document name="${escapeUntrusted(doc.filename)}">See the attached file.</document>\nExtract the invoice fields.`,
        },
      ],
      effort: "medium",
      maxTokens: 16_000,
    });
  }

  draftReply(input: DraftInput): Promise<ModelCall> {
    const request = input.request;
    return this.call({
      model: this.models.text,
      schema: ReplyDraftSchema,
      system: request ? this.prompts.replyOnRequest : this.prompts.draft,
      content: [
        {
          type: "text",
          text: [
            `Company: ${input.company}`,
            ...(request ? [`Kind of mail: ${request.category}`] : []),
            faqBlock(input.faq),
            ...(request ? [notesBlock(request.notes)] : []),
            mailBlock(input.mail),
            `<signature>\n${input.signature}\n</signature>`,
            "Write the reply draft.",
          ].join("\n\n"),
        },
      ],
      effort: "medium",
      maxTokens: 16_000,
    });
  }

  extractContract(doc: DocumentInput): Promise<ModelCall> {
    return this.call({
      model: this.models.text,
      schema: ContractExtractionSchema,
      system: this.prompts.contract,
      content: [
        documentBlock(doc),
        {
          type: "text",
          text: `<document name="${escapeUntrusted(doc.filename)}">See the attached file.</document>\nExtract the fields.`,
        },
      ],
      effort: "medium",
      maxTokens: 16_000,
    });
  }
}
