/**
 * Attachment policy. Only what passes here is ever handed to the model.
 * The declared MIME type is not trusted; the file's first bytes decide.
 */
import { pick, type Locale } from "../shared/locale";
export const ATTACHMENT_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxCount: 5,
  maxTotalBytes: 10 * 1024 * 1024,
} as const;

type Kind = "pdf" | "png" | "jpeg";

const MAGIC: Record<Kind, number[]> = {
  pdf: [0x25, 0x50, 0x44, 0x46, 0x2d], // %PDF-
  png: [0x89, 0x50, 0x4e, 0x47],
  jpeg: [0xff, 0xd8, 0xff],
};

const MIME: Record<Kind, string> = { pdf: "application/pdf", png: "image/png", jpeg: "image/jpeg" };
const EXT: Record<Kind, RegExp> = { pdf: /\.pdf$/i, png: /\.png$/i, jpeg: /\.jpe?g$/i };

function sniff(content: Uint8Array): Kind | null {
  for (const kind of Object.keys(MAGIC) as Kind[]) {
    const sig = MAGIC[kind];
    if (sig.every((b, i) => content[i] === b)) return kind;
  }
  return null;
}

/** Removes path parts and odd characters so a file name is safe to display and store. */
export function safeFilename(name: string | undefined | null): string {
  const base = (name ?? "anhang").split(/[\\/]/).pop() ?? "anhang";
  const cleaned = base.replace(/[^\p{L}\p{N}._ -]/gu, "_").replace(/^\.+/, "").slice(0, 120);
  return cleaned.length > 0 ? cleaned : "anhang";
}

export interface AttachmentVerdict {
  accepted: boolean;
  kind: Kind | null;
  reason: string | null;
}

export function inspectAttachment(input: {
  filename: string;
  contentType: string;
  content: Uint8Array;
}, locale: Locale = "de"): AttachmentVerdict {
  const { filename, contentType, content } = input;
  if (content.byteLength === 0) return { accepted: false, kind: null, reason: pick(locale, "Leere Datei.", "Empty file.") };
  if (content.byteLength > ATTACHMENT_LIMITS.maxBytes) {
    return { accepted: false, kind: null, reason: pick(locale, "Größer als 5 MB.", "Larger than 5 MB.") };
  }
  // Double extensions like rechnung.pdf.exe are rejected outright.
  if (/\.(exe|js|vbs|bat|cmd|scr|ps1|msi|jar|html?|svg|zip|docm|xlsm)$/i.test(filename)) {
    return { accepted: false, kind: null, reason: pick(locale, "Dateityp nicht erlaubt.", "File type not allowed.") };
  }
  const kind = sniff(content);
  if (!kind) return { accepted: false, kind: null, reason: pick(locale, "Kein PDF, PNG oder JPEG.", "Not a PDF, PNG or JPEG.") };
  if (!EXT[kind].test(filename)) {
    return { accepted: false, kind, reason: pick(locale, "Dateiendung passt nicht zum Inhalt.", "File extension does not match the content.") };
  }
  const declared = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  if (declared !== MIME[kind] && declared !== "application/octet-stream") {
    return { accepted: false, kind, reason: pick(locale, "Angegebener Typ passt nicht zum Inhalt.", "Declared type does not match the content.") };
  }
  return { accepted: true, kind, reason: null };
}
