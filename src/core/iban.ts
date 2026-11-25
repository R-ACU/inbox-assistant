/** IBAN helpers. Validation uses the ISO 13616 mod-97 check. */

export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, "").toUpperCase();
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    remainder = Number(String(remainder) + numeric.slice(i, i + 7)) % 97;
  }
  return remainder;
}

function toNumeric(rearranged: string): string {
  let out = "";
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    out += code >= 65 && code <= 90 ? String(code - 55) : ch;
  }
  return out;
}

export function isValidIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if ((iban.startsWith("DE") || iban.startsWith("IE")) && iban.length !== 22) return false;
  return mod97(toNumeric(iban.slice(4) + iban.slice(0, 4))) === 1;
}

/** Builds a valid German IBAN from bank code and account number (used for test data). */
export function germanIban(bankCode: string, account: string): string {
  const bban = bankCode.padStart(8, "0") + account.padStart(10, "0");
  const check = 98 - mod97(toNumeric(bban + "DE00"));
  return `DE${String(check).padStart(2, "0")}${bban}`;
}

/** Builds a valid Irish IBAN from bank code (4 letters), sort code and account number (used for test data). */
export function irishIban(bankCode: string, sortCode: string, account: string): string {
  const bban = bankCode.toUpperCase() + sortCode.padStart(6, "0") + account.padStart(8, "0");
  const check = 98 - mod97(toNumeric(bban + "IE00"));
  return `IE${String(check).padStart(2, "0")}${bban}`;
}

export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})/g, "$1 ").trim();
}
