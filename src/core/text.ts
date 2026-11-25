import { convert } from "html-to-text";

export const MAX_TEXT_CHARS = 20_000;

// Invisible code points are a classic way to hide instructions from a human
// reader: zero-width and bidi characters, Unicode tag characters (U+E0000 to
// U+E007F, "ASCII smuggling"), variation selectors, private-use and unassigned
// code points. Whole categories are removed, not single ranges, so new tricks
// in the same category are covered too. \p{Cf} includes the soft hyphen, the
// zero-width characters, the bidi controls and the tag characters.
const INVISIBLE = /[\p{Cf}\p{Co}\p{Cn}\u{FE00}-\u{FE0F}\u{E0100}-\u{E01EF}]/gu;
// Two of these invisible characters are part of ordinary emoji: the zero-width joiner
// (U+200D) glues a family emoji together and VS16 (U+FE0F) turns a text heart into an
// emoji heart. They are kept only inside an emoji sequence, so they can never split or
// hide a word.
const ZWJ = "‍";
const VS16 = "️";
const EMOJI_BEFORE_ZWJ = /[\p{Extended_Pictographic}\p{Emoji_Modifier}]\u{FE0F}?$/u;
const EMOJI_AFTER_ZWJ = /^\p{Extended_Pictographic}/u;
const EMOJI_BEFORE_VS16 = /\p{Extended_Pictographic}$/u;
const KEYCAP_BASE = /[0-9#*]$/;

function keepInEmoji(ch: string, offset: number, text: string): boolean {
  const before = text.slice(Math.max(0, offset - 3), offset);
  const after = text.slice(offset + ch.length, offset + ch.length + 2);
  if (ch === ZWJ) return EMOJI_BEFORE_ZWJ.test(before) && EMOJI_AFTER_ZWJ.test(after);
  if (ch === VS16) return EMOJI_BEFORE_VS16.test(before) || (KEYCAP_BASE.test(before) && after.startsWith("⃣"));
  return false;
}

// Characters that have no business in a German business mail at all. Their
// presence is reported as a rule finding (see rules.ts), not just removed.
const SMUGGLING = /[\u{E0000}-\u{E007F}‪-‮⁦-⁩]/gu;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Counts tag characters and bidi overrides in raw text, before normalizeText removes them. */
export function countHiddenCharacters(input: string): number {
  return input.match(SMUGGLING)?.length ?? 0;
}

export function normalizeText(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(INVISIBLE, (ch: string, offset: number, text: string) => (keepInEmoji(ch, offset, text) ? ch : ""))
    .replace(CONTROL, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Turns an HTML mail body into plain text. Scripts, styles and images are
 * dropped, links keep their visible text plus the target in brackets so a
 * reviewer can see where a link really points.
 */
export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "script", format: "skip" },
      { selector: "style", format: "skip" },
      { selector: "a", options: { hideLinkHrefIfSameAsText: true, linkBrackets: ["[", "]"] } },
    ],
  });
}

export function limitText(text: string, max = MAX_TEXT_CHARS): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}
