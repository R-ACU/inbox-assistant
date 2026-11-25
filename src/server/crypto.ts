/**
 * Password hashing (scrypt), random tokens and the webhook signature that
 * n8n and the assistant use for every machine-to-machine call.
 */
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 16_384, r: 8, p: 1, keyLen: 32 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT.keyLen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = scryptSync(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ---------------------------------------------------------------- webhook signature

export const SIGNATURE_HEADER = "x-inbox-signature";
export const TIMESTAMP_HEADER = "x-inbox-timestamp";
export const MAX_CLOCK_SKEW_SECONDS = 300;

/**
 * Canonical string: `<unix seconds>.<METHOD>.<path with query>.<raw body>`.
 * Signing method and path stops a valid signature for one endpoint from
 * being replayed against another.
 */
export function signatureBase(timestamp: string, method: string, path: string, rawBody: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${rawBody}`;
}

export function signRequest(secret: string, timestamp: string, method: string, path: string, rawBody: string): string {
  return createHmac("sha256", secret).update(signatureBase(timestamp, method, path, rawBody)).digest("hex");
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "invalid" | "replayed" };

/** Remembers recently seen signatures so a captured request cannot be replayed inside the time window. */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();
  constructor(private readonly ttlMs = MAX_CLOCK_SKEW_SECONDS * 2 * 1000) {}

  checkAndRemember(signature: string, nowMs: number): boolean {
    for (const [sig, at] of this.seen) if (nowMs - at > this.ttlMs) this.seen.delete(sig);
    if (this.seen.has(signature)) return false;
    this.seen.set(signature, nowMs);
    return true;
  }
}

/**
 * Header-only check: format of timestamp and signature and the time window. Runs before
 * the body is read, so an unsigned request never costs a body upload or a JSON parse.
 */
export function precheckSignatureHeaders(input: {
  timestamp: string | undefined;
  signature: string | undefined;
  nowMs: number;
}): SignatureCheck {
  const { timestamp, signature } = input;
  if (!timestamp || !signature || !/^\d{9,11}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) {
    return { ok: false, reason: "missing" };
  }
  if (Math.abs(input.nowMs / 1000 - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return { ok: false, reason: "stale" };
  return { ok: true };
}

export function verifySignature(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  method: string;
  path: string;
  rawBody: string;
  nowMs: number;
  replay: ReplayGuard;
}): SignatureCheck {
  const pre = precheckSignatureHeaders(input);
  if (!pre.ok) return pre;
  const { timestamp, signature } = input as { timestamp: string; signature: string };
  const expected = signRequest(input.secret, timestamp, input.method, input.path, input.rawBody);
  if (!safeEqual(expected, signature)) return { ok: false, reason: "invalid" };
  if (!input.replay.checkAndRemember(signature, input.nowMs)) return { ok: false, reason: "replayed" };
  return { ok: true };
}
