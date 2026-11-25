/**
 * Parses a raw RFC 822 message (.eml) into an InboundMail.
 * HTML bodies are converted to plain text here; HTML is never stored for display.
 */
import { createHash } from "node:crypto";
import { simpleParser, type AddressObject } from "mailparser";
import { ATTACHMENT_LIMITS, inspectAttachment, safeFilename } from "../core/attachments";
import { countHiddenCharacters, htmlToText, limitText, normalizeText } from "../core/text";
import type { DocumentMediaType } from "../llm/provider";
import type { Address, AttachmentInfo, InboundMail, MailAuth } from "../shared/types";

export const MAX_EML_BYTES = 15 * 1024 * 1024;

export interface ParsedMail {
  mail: InboundMail;
  /** Content of accepted attachments only, by attachment index. */
  files: Map<number, { content: Buffer; mediaType: DocumentMediaType }>;
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Stable record id: the same Message-ID always maps to the same record (idempotent ingest). */
export function mailIdFor(messageId: string): string {
  return sha256(messageId).slice(0, 20);
}

function firstAddress(obj: AddressObject | AddressObject[] | undefined): Address | null {
  const list = Array.isArray(obj) ? obj : obj ? [obj] : [];
  const first = list.flatMap((o) => o.value)[0];
  if (!first?.address) return null;
  return { name: normalizeText(first.name ?? ""), address: first.address.toLowerCase() };
}

function allAddresses(obj: AddressObject | AddressObject[] | undefined): string {
  const list = Array.isArray(obj) ? obj : obj ? [obj] : [];
  return list
    .flatMap((o) => o.value)
    .map((v) => v.address ?? "")
    .filter(Boolean)
    .join(", ");
}

/**
 * Reads the topmost Authentication-Results header (RFC 8601). The receiving server adds
 * it above all others; headers further down may come from the sender and are ignored.
 */
export function parseAuthResults(headerLines: readonly { key: string; line: string }[]): MailAuth | undefined {
  const line = headerLines.find((h) => h.key.toLowerCase() === "authentication-results")?.line;
  if (!line) return undefined;
  const value = line.replace(/^[^:]*:/, "").replace(/\s+/g, " ");
  const verdict = (method: string) => value.match(new RegExp(String.raw`(?:^|[;\s])${method}\s*=\s*([a-z]+)`, "i"))?.[1]?.toLowerCase() ?? null;
  return { spf: verdict("spf"), dkim: verdict("dkim"), dmarc: verdict("dmarc") };
}

const MEDIA: Record<string, DocumentMediaType> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" };

export async function parseEml(raw: Buffer): Promise<ParsedMail> {
  if (raw.byteLength > MAX_EML_BYTES) throw new Error("Mail ist größer als 15 MB.");
  const parsed = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });

  const hadHtml = typeof parsed.html === "string" && parsed.html.length > 0;
  const plainPart = parsed.text?.trim() ? parsed.text : "";
  const body = plainPart || (hadHtml ? htmlToText(parsed.html as string) : "");
  const { text, truncated } = limitText(normalizeText(body));
  const fromName = (Array.isArray(parsed.from) ? parsed.from : parsed.from ? [parsed.from] : []).flatMap((o) => o.value)[0]?.name ?? "";
  const hiddenCharacters = countHiddenCharacters([parsed.subject ?? "", fromName, body].join(" "));

  const files: ParsedMail["files"] = new Map();
  const attachments: AttachmentInfo[] = [];
  let totalBytes = 0;
  parsed.attachments.forEach((att, index) => {
    const filename = safeFilename(att.filename);
    const content = att.content;
    totalBytes += content.byteLength;
    let verdict = inspectAttachment({ filename, contentType: att.contentType, content });
    if (verdict.accepted && index >= ATTACHMENT_LIMITS.maxCount) {
      verdict = { accepted: false, kind: verdict.kind, reason: "Zu viele Anhänge." };
    } else if (verdict.accepted && totalBytes > ATTACHMENT_LIMITS.maxTotalBytes) {
      verdict = { accepted: false, kind: verdict.kind, reason: "Anhänge zusammen größer als 10 MB." };
    }
    attachments.push({
      index,
      filename,
      contentType: att.contentType,
      size: content.byteLength,
      sha256: sha256(content),
      accepted: verdict.accepted,
      rejectReason: verdict.reason,
    });
    if (verdict.accepted && verdict.kind) files.set(index, { content, mediaType: MEDIA[verdict.kind]! });
  });

  const from = firstAddress(parsed.from) ?? { name: "", address: "unbekannt@invalid" };
  const messageId = parsed.messageId ?? `<${sha256(raw)}@generated.invalid>`;

  return {
    mail: {
      messageId,
      from,
      replyTo: firstAddress(parsed.replyTo),
      to: allAddresses(parsed.to),
      subject: normalizeText(parsed.subject ?? "(ohne Betreff)").slice(0, 300),
      date: (parsed.date ?? new Date(0)).toISOString(),
      text,
      hadHtml,
      hiddenCharacters,
      auth: parseAuthResults(parsed.headerLines),
      rawSha256: sha256(raw),
      textTruncated: truncated,
      attachments,
    },
    files,
  };
}
