import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, CSRF_HEADER, SESSION_COOKIE } from "../src/server/app";
import { loadConfig, type AppConfig } from "../src/server/config";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, hashPassword, signRequest } from "../src/server/crypto";
import { InboxService } from "../src/server/service";
import { Store } from "../src/server/store";
import { TENANT } from "../src/tenant/profile";
import { FIXTURES, mockProvider, readFixture } from "./helpers";

const PASSWORD = "korrekt-pferd-batterie-heftklammer";
const SECRET = "test-secret-0123456789-abcdefghijklmnopqrstuvwxyz";
const ORIGIN = "http://127.0.0.1:3220";
const N8N = "http://127.0.0.1:5690";
const NOW = new Date("2026-11-24T10:00:00Z");
const passwordHash = hashPassword(PASSWORD);

interface Ctx {
  app: FastifyInstance;
  store: Store;
  config: AppConfig;
  dir: string;
  service: InboxService;
  fetchMock: ReturnType<typeof vi.fn>;
}

let ctx: Ctx;

beforeEach(async () => {
  const dir = mkdtempSync(join(tmpdir(), "inbox-assistant-test-"));
  const config = loadConfig({
    APP_PASSWORD_HASH: passwordHash,
    INBOX_WEBHOOK_SECRET: SECRET,
    DATA_DIR: dir,
    N8N_BASE_URL: N8N,
    MOCK_RESPONSES: join(FIXTURES, "model", "responses.json"),
    CONTRACT_SAMPLES_DIR: join(FIXTURES, "contracts"),
  });
  const store = new Store(":memory:");
  const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  const service = new InboxService({ config, store, llm: mockProvider(), tenant: TENANT, now: () => NOW, fetch: fetchMock as unknown as typeof fetch });
  const app = await buildApp({ config, store, service, now: () => NOW, webRoot: join(dir, "no-web") });
  ctx = { app, store, config, dir, service, fetchMock };
});

afterEach(async () => {
  await ctx.app.close();
  ctx.store.close();
  rmSync(ctx.dir, { recursive: true, force: true });
});

async function login(): Promise<{ cookie: string; csrf: string }> {
  const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: ORIGIN }, payload: { password: PASSWORD } });
  expect(res.statusCode).toBe(200);
  const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
  return { cookie: `${SESSION_COOKIE}=${cookie.value}`, csrf: res.json().csrfToken };
}

function signed(method: "GET" | "POST", url: string, body?: unknown, opts: { ts?: number; secret?: string; signPath?: string } = {}) {
  const raw = body === undefined ? "" : JSON.stringify(body);
  const ts = String(opts.ts ?? Math.floor(NOW.getTime() / 1000));
  const sig = signRequest(opts.secret ?? SECRET, ts, method, opts.signPath ?? url, raw);
  return ctx.app.inject({
    method,
    url,
    headers: { [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: sig, ...(raw ? { "content-type": "application/json" } : {}) },
    payload: raw || undefined,
  });
}

const ingestBody = (file: string, resumeUrl?: string) => ({
  eml_base64: readFixture(file).toString("base64"),
  ...(resumeUrl ? { resume_url: resumeUrl } : {}),
});

async function ingest(file: string, resumeUrl?: string) {
  const res = await signed("POST", "/api/hooks/ingest", ingestBody(file, resumeUrl));
  expect(res.statusCode).toBe(200);
  return res.json() as { mail_id: string; status: string; created: boolean; needs_approval: boolean };
}

describe("configuration", () => {
  it("refuses to start without password hash or with a short webhook secret", () => {
    expect(() => loadConfig({ INBOX_WEBHOOK_SECRET: SECRET })).toThrow(/APP_PASSWORD_HASH/);
    expect(() => loadConfig({ APP_PASSWORD_HASH: passwordHash, INBOX_WEBHOOK_SECRET: "short" })).toThrow(/INBOX_WEBHOOK_SECRET/);
    expect(() => loadConfig({ APP_PASSWORD_HASH: passwordHash, INBOX_WEBHOOK_SECRET: SECRET, LLM_MODE: "claude" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("trusts no proxy unless TRUST_PROXY names one", () => {
    const base = { APP_PASSWORD_HASH: passwordHash, INBOX_WEBHOOK_SECRET: SECRET };
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: "" }).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: "127.0.0.1, ::1" }).trustProxy).toEqual(["127.0.0.1", "::1"]);
    expect(() => loadConfig({ ...base, TRUST_PROXY: "true" })).toThrow(/TRUST_PROXY/);
    expect(() => loadConfig({ ...base, TRUST_PROXY: "*" })).toThrow(/TRUST_PROXY/);
  });
});

describe("login and session", () => {
  it("blocks the owner API without a session", async () => {
    for (const url of ["/api/mails", "/api/overview", "/api/invoices", "/api/weekly", "/api/reconcile/samples"]) {
      expect((await ctx.app.inject({ method: "GET", url })).statusCode, url).toBe(401);
    }
  });

  it("rejects a wrong password and a login from a foreign origin", async () => {
    const wrong = await ctx.app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: ORIGIN }, payload: { password: "falsch" } });
    expect(wrong.statusCode).toBe(401);
    const foreign = await ctx.app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "https://evil.example" }, payload: { password: PASSWORD } });
    expect(foreign.statusCode).toBe(403);
  });

  it("sets an httpOnly, SameSite=Strict session cookie and stores only its hash", async () => {
    const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: ORIGIN }, payload: { password: PASSWORD } });
    const cookie = res.cookies.find((c) => c.name === SESSION_COOKIE)!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe("Strict");
    expect(JSON.stringify(res.json())).not.toContain(cookie.value);
  });

  it("rate-limits login attempts", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await ctx.app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: ORIGIN }, payload: { password: "falsch" } });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(codes.slice(5)).toEqual([429, 429]);
  });

  it("ignores a forged X-Forwarded-For when no proxy is trusted", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const headers = { origin: ORIGIN, "x-forwarded-for": `203.0.113.${i + 1}` };
      codes.push((await ctx.app.inject({ method: "POST", url: "/api/auth/login", headers, payload: { password: "falsch" } })).statusCode);
    }
    expect(codes.at(-1)).toBe(429);
  });

  it("behind a trusted proxy, rate-limits each client on its own", async () => {
    const config = { ...ctx.config, trustProxy: ["127.0.0.1"] };
    const service = new InboxService({ config, store: ctx.store, llm: mockProvider(), tenant: TENANT, now: () => NOW, fetch: ctx.fetchMock as unknown as typeof fetch });
    const app = await buildApp({ config, store: ctx.store, service, now: () => NOW, webRoot: join(ctx.dir, "no-web") });
    try {
      const attempt = (ip: string) =>
        app.inject({ method: "POST", url: "/api/auth/login", remoteAddress: "127.0.0.1", headers: { origin: ORIGIN, "x-forwarded-for": ip }, payload: { password: "falsch" } });
      for (let i = 0; i < 5; i++) expect((await attempt("203.0.113.7")).statusCode).toBe(401);
      expect((await attempt("203.0.113.7")).statusCode).toBe(429);
      expect((await attempt("198.51.100.20")).statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it("logs out and invalidates the session", async () => {
    const { cookie, csrf } = await login();
    const out = await ctx.app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf } });
    expect(out.statusCode).toBe(200);
    expect((await ctx.app.inject({ method: "GET", url: "/api/mails", headers: { cookie } })).statusCode).toBe(401);
  });

  it("sends a strict Content-Security-Policy and no-sniff headers", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.headers["content-security-policy"]).toContain("script-src 'self'");
    expect(res.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });
});

describe("CSRF protection", () => {
  it("requires the CSRF header and an allowed Origin on every write", async () => {
    const { mail_id } = await ingest("mails/m09.eml");
    const { cookie, csrf } = await login();
    const url = `/api/mails/${mail_id}/discard`;
    const send = (headers: Record<string, string>) => ctx.app.inject({ method: "POST", url, headers: { cookie, ...headers }, payload: {} });

    expect((await send({ origin: ORIGIN })).statusCode).toBe(403);
    expect((await send({ origin: ORIGIN, [CSRF_HEADER]: "falsch" })).statusCode).toBe(403);
    expect((await send({ origin: "https://evil.example", [CSRF_HEADER]: csrf })).statusCode).toBe(403);
    expect((await send({ [CSRF_HEADER]: csrf })).statusCode).toBe(403);
    expect((await send({ origin: ORIGIN, [CSRF_HEADER]: csrf })).statusCode).toBe(200);
  });
});

describe("webhook signature (n8n -> assistant)", () => {
  it("accepts a correctly signed ingest and is idempotent", async () => {
    const first = await ingest("mails/m01.eml");
    expect(first).toMatchObject({ status: "filed", created: true, needs_approval: false });
    const again = await signed("POST", "/api/hooks/ingest", ingestBody("mails/m01.eml"), { ts: Math.floor(NOW.getTime() / 1000) + 1 });
    expect(again.json()).toMatchObject({ mail_id: first.mail_id, created: false });
  });

  it("rejects missing, wrong, stale, replayed and cross-endpoint signatures", async () => {
    const body = ingestBody("mails/m09.eml");
    const missing = await ctx.app.inject({ method: "POST", url: "/api/hooks/ingest", payload: body });
    expect(missing.statusCode).toBe(401);
    expect((await signed("POST", "/api/hooks/ingest", body, { secret: "x".repeat(40) })).statusCode).toBe(401);
    expect((await signed("POST", "/api/hooks/ingest", body, { ts: Math.floor(NOW.getTime() / 1000) - 600 })).statusCode).toBe(401);
    expect((await signed("POST", "/api/hooks/ingest", body, { signPath: "/api/hooks/outbox/x" })).statusCode).toBe(401);

    const raw = JSON.stringify(body);
    const ts = String(Math.floor(NOW.getTime() / 1000));
    const headers = {
      [TIMESTAMP_HEADER]: ts,
      [SIGNATURE_HEADER]: signRequest(SECRET, ts, "POST", "/api/hooks/ingest", raw),
      "content-type": "application/json",
    };
    const once = await ctx.app.inject({ method: "POST", url: "/api/hooks/ingest", headers, payload: raw });
    expect(once.statusCode).toBe(200);
    const replay = await ctx.app.inject({ method: "POST", url: "/api/hooks/ingest", headers, payload: raw });
    expect(replay.statusCode).toBe(401);
  });

  it("rejects a body changed after signing", async () => {
    const raw = JSON.stringify(ingestBody("mails/m09.eml"));
    const ts = String(Math.floor(NOW.getTime() / 1000));
    const sig = signRequest(SECRET, ts, "POST", "/api/hooks/ingest", raw);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/hooks/ingest",
      headers: { [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: sig, "content-type": "application/json" },
      payload: raw.replace("eml_base64", "eml_base64 "),
    });
    expect(res.statusCode).toBe(401);
  });

  // Regression (security review S-A6): the body was read and parsed before the signature
  // was looked at; invalid JSON without a signature got 400 instead of 401.
  it("rejects unsigned calls before reading the body", async () => {
    const garbage = await ctx.app.inject({ method: "POST", url: "/api/hooks/ingest", headers: { "content-type": "application/json" }, payload: "{nicht json" });
    expect(garbage.statusCode).toBe(401);
    const stale = await ctx.app.inject({
      method: "POST",
      url: "/api/hooks/ingest",
      headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: "1000000000", [SIGNATURE_HEADER]: "a".repeat(64) },
      payload: "{nicht json",
    });
    expect(stale.statusCode).toBe(401);
    const big = await ctx.app.inject({
      method: "POST",
      url: "/api/hooks/outbox/0123456789abcdef0123/delivered",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ x: "y".repeat(2 * 1024 * 1024) }),
    });
    expect(big.statusCode).toBe(401);
  });

  it("limits the body of the delivery confirmation to 1 KB, even with valid-looking headers", async () => {
    const ts = String(Math.floor(NOW.getTime() / 1000));
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/hooks/outbox/0123456789abcdef0123/delivered",
      headers: { "content-type": "application/json", [TIMESTAMP_HEADER]: ts, [SIGNATURE_HEADER]: "b".repeat(64) },
      payload: JSON.stringify({ x: "y".repeat(4096) }),
    });
    expect(res.statusCode).toBe(413);
  });

  // Regression (security review S-A9): a second, different mail with a known Message-ID was dropped silently.
  it("accepts a different mail with an already used Message-ID and flags it", async () => {
    const first = await ingest("mails/m10.eml");
    const forged = readFixture("mails/m10.eml").toString("utf8").replace(/^Subject: .*$/m, "Subject: Neue Bankverbindung");
    const res = await signed("POST", "/api/hooks/ingest", { eml_base64: Buffer.from(forged).toString("base64") }, { ts: Math.floor(NOW.getTime() / 1000) + 1 });
    const second = res.json();
    expect(second.created).toBe(true);
    expect(second.mail_id).not.toBe(first.mail_id);
    const { cookie } = await login();
    const detail = (await ctx.app.inject({ method: "GET", url: `/api/mails/${second.mail_id}`, headers: { cookie } })).json();
    expect(detail.record.ruleFindings.map((f: { code: string }) => f.code)).toContain("message_id_collision");
  });

  it("does not let a webhook signature open the owner API", async () => {
    const res = await signed("GET", "/api/mails");
    expect(res.statusCode).toBe(401);
  });

  it("only accepts resume URLs on the configured n8n instance (no SSRF)", async () => {
    for (const url of ["http://169.254.169.254/latest/meta-data", "http://127.0.0.1:5690/rest/workflows", `${N8N.replace("5690", "5691")}/webhook-waiting/1`, "http://user:pw@127.0.0.1:5690/webhook-waiting/1"]) {
      const res = await signed("POST", "/api/hooks/ingest", ingestBody("mails/m10.eml", url));
      expect(res.statusCode, url).toBe(400);
    }
  });
});

describe("approval flow", () => {
  it("standalone: approve writes the reply to the outbox folder and nothing else is sent", async () => {
    const { mail_id, needs_approval } = await ingest("mails/m09.eml");
    expect(needs_approval).toBe(true);
    const { cookie, csrf } = await login();
    const headers = { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf };

    const detail = (await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}`, headers: { cookie } })).json();
    const draft = detail.record.draft.draft;
    const res = await ctx.app.inject({ method: "POST", url: `/api/mails/${mail_id}/approve`, headers, payload: { subject: draft.subject, body: draft.body } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("sent");

    const out = readFileSync(join(ctx.dir, "outbox", `${mail_id}.eml`), "utf8");
    expect(out).toContain("To: k.albrecht@posteo-mail.example");
    expect(out).toContain("In-Reply-To: <m09.2026-11-16@posteo-mail.example>");
    expect(ctx.fetchMock).not.toHaveBeenCalled();

    const twice = await ctx.app.inject({ method: "POST", url: `/api/mails/${mail_id}/approve`, headers, payload: { subject: "x", body: "y" } });
    expect(twice.statusCode).toBe(409);
    const events = (await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}`, headers: { cookie } })).json().events;
    expect(events.map((e: { action: string }) => e.action)).toEqual(["eingang", "freigegeben", "versendet"]);
  });

  it("re-checks an edited draft before it is approved", async () => {
    const { mail_id } = await ingest("mails/m16.eml");
    const { cookie, csrf } = await login();
    const headers = { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf };
    const before = (await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}`, headers: { cookie } })).json().record;
    expect(before.draft.findings.map((f: { code: string }) => f.code)).toContain("unsupported_fact");

    const fixed = before.draft.draft.body.replace("Samstags ist ein Einsatz mit 25 % Zuschlag möglich.", "Samstage sprechen wir gern individuell ab.");
    const saved = await ctx.app.inject({ method: "PUT", url: `/api/mails/${mail_id}/draft`, headers, payload: { subject: before.draft.draft.subject, body: fixed } });
    expect(saved.json().draft.findings.map((f: { code: string }) => f.code)).not.toContain("unsupported_fact");
    expect(saved.json().draft.editedAt).toBe(NOW.toISOString());
  });

  it("replies to the sender, never to a Reply-To on another domain", async () => {
    // Take inquiry m10 and add a Reply-To header that points to another domain.
    const raw = readFixture("mails/m10.eml").toString("utf8").replace(/^Subject:/m, "Reply-To: zahlung@other-domain.example\r\nSubject:");
    const res = await signed("POST", "/api/hooks/ingest", { eml_base64: Buffer.from(raw).toString("base64") });
    const { mail_id, status } = res.json();
    expect(status).toBe("awaiting_approval");
    const { cookie, csrf } = await login();
    const headers = { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf };
    const detail = (await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}`, headers: { cookie } })).json();
    expect(detail.record.ruleFindings.map((f: { code: string }) => f.code)).toContain("reply_to_mismatch");
    await ctx.app.inject({ method: "POST", url: `/api/mails/${mail_id}/approve`, headers, payload: { subject: "Re: Fassade", body: "Guten Tag Herr Brenner, danke." } });
    const out = readFileSync(join(ctx.dir, "outbox", `${mail_id}.eml`), "utf8");
    expect(out).toContain("To: thomas.brenner@webpost.example");
    expect(out).not.toContain("other-domain.example");
  });

  it("n8n: approval resumes the waiting workflow, which fetches and confirms delivery", async () => {
    const resumeUrl = `${N8N}/webhook-waiting/42`;
    const { mail_id } = await ingest("mails/m12.eml", resumeUrl);
    expect((await signed("GET", `/api/hooks/outbox/${mail_id}`)).statusCode).toBe(409); // not approved yet

    const { cookie, csrf } = await login();
    const headers = { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf };
    const approved = await ctx.app.inject({ method: "POST", url: `/api/mails/${mail_id}/approve`, headers, payload: { subject: "Re: Schimmel", body: "Guten Tag Herr Kowalczyk, danke für Ihre Anfrage." } });
    expect(approved.json().status).toBe("approved");
    expect(ctx.fetchMock).toHaveBeenCalledWith(resumeUrl, expect.objectContaining({ method: "POST", redirect: "error" }));
    expect(existsSync(join(ctx.dir, "outbox", `${mail_id}.eml`))).toBe(false);

    // A new request needs a new timestamp: the identical signed GET from above would count as a replay.
    const outbox = await signed("GET", `/api/hooks/outbox/${mail_id}`, undefined, { ts: Math.floor(NOW.getTime() / 1000) + 1 });
    expect(outbox.json()).toMatchObject({ to: "m.kowalczyk@mailbox.example", subject: "Re: Schimmel" });
    const delivered = await signed("POST", `/api/hooks/outbox/${mail_id}/delivered`, {});
    expect(delivered.json().status).toBe("sent");
    expect((await signed("GET", `/api/hooks/outbox/${mail_id}`, undefined, { ts: Math.floor(NOW.getTime() / 1000) + 2 })).statusCode).toBe(409);
  });

  it("n8n: discarding also resumes the waiting workflow, which then finds nothing to send", async () => {
    const resumeUrl = `${N8N}/webhook-waiting/77`;
    const { mail_id } = await ingest("mails/m13.eml", resumeUrl);
    const { cookie, csrf } = await login();
    const res = await ctx.app.inject({ method: "POST", url: `/api/mails/${mail_id}/discard`, headers: { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf }, payload: { reason: "Doppelt" } });
    expect(res.json().status).toBe("discarded");
    expect(ctx.fetchMock).toHaveBeenCalledWith(resumeUrl, expect.objectContaining({ method: "POST" }));
    expect((await signed("GET", `/api/hooks/outbox/${mail_id}`)).statusCode).toBe(409);
  });

  // Regression (security review S-A4): two approves at once both returned 200 and the
  // outbox file was written twice.
  it("two simultaneous approves send once: 200 and 409", async () => {
    const { mail_id } = await ingest("mails/m09.eml");
    const { cookie, csrf } = await login();
    const headers = { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf };
    const approve = (body: string) =>
      ctx.app.inject({ method: "POST", url: `/api/mails/${mail_id}/approve`, headers, payload: { subject: "Re: Anfrage", body } });
    const results = await Promise.all([approve("Erste Fassung, danke für Ihre Anfrage."), approve("Zweite Fassung, danke für Ihre Anfrage.")]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const events = (await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}`, headers: { cookie } })).json().events;
    expect(events.filter((e: { action: string }) => e.action === "versendet")).toHaveLength(1);
    expect(events.filter((e: { action: string }) => e.action === "freigegeben")).toHaveLength(1);
    const out = readFileSync(join(ctx.dir, "outbox", `${mail_id}.eml`), "utf8");
    expect(out).toContain("Erste Fassung");
  });

  // Regression (acceptance N-2): a discard while the outbox file was being written was
  // overwritten by "sent"; the log showed both "verworfen" and "versendet".
  it("standalone: a discard during the outbox write wins, nothing stays in the outbox", async () => {
    const { mail_id } = await ingest("mails/m09.eml");
    const approving = ctx.service.approve(mail_id, { subject: "Re: Anfrage", body: "Guten Tag, danke für Ihre Anfrage." });
    // approve() has claimed the mail and now awaits the file write; the owner discards.
    const discarded = await ctx.service.discard(mail_id, "Doch nicht senden");
    expect(discarded.status).toBe("discarded");
    await expect(approving).rejects.toMatchObject({ status: 409 });
    expect(ctx.store.getMail(mail_id)!.status).toBe("discarded");
    expect(existsSync(join(ctx.dir, "outbox", `${mail_id}.eml`))).toBe(false);
    expect(ctx.store.getOutbox(mail_id)!.deliveredAt).toBeNull();
    const actions = ctx.store.listEvents(mail_id).map((e) => e.action);
    expect(actions).toContain("verworfen");
    expect(actions).toContain("versand_abgebrochen");
    expect(actions).not.toContain("versendet");
  });

  // Regression (security review S-A5): a 404 from n8n (Wait node expired) was logged as
  // "n8n_fortgesetzt", the mail stayed "approved" forever and could not be discarded.
  it("n8n: a failed resume marks the mail delivery_failed; retry and discard work", async () => {
    const resumeUrl = `${N8N}/webhook-waiting/99`;
    const { mail_id } = await ingest("mails/m12.eml", resumeUrl);
    const { cookie, csrf } = await login();
    const headers = { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf };
    const post = (url: string, payload: object = {}) => ctx.app.inject({ method: "POST", url, headers, payload });

    ctx.fetchMock.mockResolvedValue(new Response("not found", { status: 404 }));
    const approved = await post(`/api/mails/${mail_id}/approve`, { subject: "Re: Schimmel", body: "Guten Tag, danke für Ihre Anfrage." });
    expect(approved.json().status).toBe("delivery_failed");
    let events = (await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}`, headers: { cookie } })).json().events;
    expect(events.map((e: { action: string }) => e.action)).not.toContain("n8n_fortgesetzt");
    expect(events.at(-1)).toMatchObject({ action: "n8n_nicht_erreichbar" });
    expect(events.at(-1).detail).toContain("404");
    // n8n cannot fetch anything for a mail that was not handed over.
    expect((await signed("GET", `/api/hooks/outbox/${mail_id}`)).statusCode).toBe(409);

    ctx.fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    expect((await post(`/api/mails/${mail_id}/retry`)).json().status).toBe("approved");
    expect((await post(`/api/mails/${mail_id}/retry`)).statusCode).toBe(409);

    // Approved but not delivered yet: the owner may still discard.
    expect((await post(`/api/mails/${mail_id}/discard`, { reason: "Telefonisch geklärt" })).json().status).toBe("discarded");
    events = (await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}`, headers: { cookie } })).json().events;
    expect(events.map((e: { action: string }) => e.action)).toContain("verworfen");
  });

  it("discard and review decisions follow the status rules", async () => {
    const inquiry = await ingest("mails/m11.eml");
    const wrongSum = await ingest("mails/m17.eml");
    const injection = await ingest("mails/m20.eml");
    const { cookie, csrf } = await login();
    const headers = { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf };
    const post = (url: string, payload: object) => ctx.app.inject({ method: "POST", url, headers, payload });

    expect((await post(`/api/mails/${inquiry.mail_id}/discard`, { reason: "Kunde hat abgesagt" })).json().status).toBe("discarded");
    expect((await post(`/api/mails/${inquiry.mail_id}/approve`, { subject: "x", body: "y" })).statusCode).toBe(409);
    expect((await post(`/api/mails/${injection.mail_id}/review`, { action: "file" })).statusCode).toBe(409);
    expect((await post(`/api/mails/${injection.mail_id}/review`, { action: "close", note: "Betrugsversuch" })).json().status).toBe("resolved");
    expect((await post(`/api/mails/${wrongSum.mail_id}/review`, { action: "file", note: "Lieferant hat korrigiert" })).json().status).toBe("filed");
    expect((await post(`/api/mails/${inquiry.mail_id}/review`, { action: "close" })).statusCode).toBe(409);
  });

  it("validates ids and bodies", async () => {
    const { cookie, csrf } = await login();
    const headers = { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf };
    expect((await ctx.app.inject({ method: "GET", url: "/api/mails/..%2f..%2fetc", headers: { cookie } })).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "GET", url: "/api/mails/0123456789abcdef0123", headers: { cookie } })).statusCode).toBe(404);
    const { mail_id } = await ingest("mails/m13.eml");
    const tooLong = await ctx.app.inject({ method: "POST", url: `/api/mails/${mail_id}/approve`, headers, payload: { subject: "x", body: "y".repeat(5001) } });
    expect(tooLong.statusCode).toBe(400);
  });
});

describe("attachments and read models", () => {
  it("serves accepted attachments only as downloads in a sandbox", async () => {
    const { mail_id } = await ingest("mails/m02.eml");
    const { cookie } = await login();
    const res = await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}/attachments/0`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/^attachment;/);
    expect(res.headers["content-security-policy"]).toContain("sandbox");
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await ctx.app.inject({ method: "GET", url: `/api/mails/${mail_id}/attachments/3`, headers: { cookie } })).statusCode).toBe(404);
  });

  // Regression (security review S-A9): only filed invoices counted for the duplicate check.
  it("counts invoices on the review list for the duplicate check", async () => {
    await ingest("mails/m17.eml");
    expect(ctx.store.invoicesOnFile().map((i) => i.invoiceNumber)).toContain("L-88297");
  });

  it("lists invoices and a weekly summary", async () => {
    for (const id of ["m01", "m02", "m17", "m09", "m20"]) await ingest(`mails/${id}.eml`);
    const { cookie } = await login();
    const invoices = (await ctx.app.inject({ method: "GET", url: "/api/invoices", headers: { cookie } })).json();
    expect(invoices).toHaveLength(3);
    expect(invoices.find((i: { invoiceNumber: string }) => i.invoiceNumber === "L-88297").ok).toBe(false);
    const week = (await ctx.app.inject({ method: "GET", url: "/api/weekly?week=2026-11-18", headers: { cookie } })).json();
    expect(week.weekStart).toBe("2026-11-16");
    expect(week.totals.mails).toBe(4);
    expect(week.weeks).toEqual(["2026-11-16", "2026-11-23"]);
    const overview = (await ctx.app.inject({ method: "GET", url: "/api/overview", headers: { cookie } })).json();
    expect(overview).toEqual({ awaitingApproval: 1, openReview: 1, quarantined: 1, total: 5 });
  });

  it("serves the dashboard for 7 or 14 days and rejects anything else", async () => {
    for (const id of ["m01", "m02", "m17", "m09", "m20"]) await ingest(`mails/${id}.eml`);
    const { cookie } = await login();
    const get = (q: string) => ctx.app.inject({ method: "GET", url: `/api/dashboard${q}`, headers: { cookie } });
    const week = (await get("")).json();
    expect(week.range.days).toBe(7);
    expect(week.days).toHaveLength(7);
    expect(Object.values(week.outcomes as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(week.current.mails);
    expect((await get("?days=14")).json().days).toHaveLength(14);
    for (const bad of ["?days=30", "?days=7%3Bdrop", "?days=-1"]) expect((await get(bad)).statusCode).toBe(400);
    expect((await ctx.app.inject({ method: "GET", url: "/api/dashboard" })).statusCode).toBe(401);
  });
});

describe("reconciliation API", () => {
  it("reconciles a sample pair", async () => {
    const { cookie, csrf } = await login();
    const res = await ctx.app.inject({ method: "POST", url: "/api/reconcile/samples/northgate", headers: { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf } });
    expect(res.statusCode).toBe(200);
    expect(res.json().discrepancyCount).toBe(6);
  });

  it("checks uploaded files and is honest about unknown documents in mock mode", async () => {
    const { cookie, csrf } = await login();
    const upload = async (quote: Buffer, order: Buffer) => {
      const boundary = "----testboundary";
      const part = (name: string, file: string, data: Buffer) =>
        Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${file}"\r\nContent-Type: application/pdf\r\n\r\n`),
          data,
          Buffer.from("\r\n"),
        ]);
      const payload = Buffer.concat([part("quote", "q.pdf", quote), part("order", "o.pdf", order), Buffer.from(`--${boundary}--\r\n`)]);
      return ctx.app.inject({
        method: "POST",
        url: "/api/reconcile",
        headers: { cookie, origin: ORIGIN, [CSRF_HEADER]: csrf, "content-type": `multipart/form-data; boundary=${boundary}` },
        payload,
      });
    };
    const quote = readFileSync(join(FIXTURES, "contracts", "lakeside-quote.pdf"));
    const order = readFileSync(join(FIXTURES, "contracts", "lakeside-order-form.pdf"));
    expect((await upload(quote, order)).json().discrepancyCount).toBe(5);
    expect((await upload(Buffer.from("MZ not a pdf"), order)).statusCode).toBe(422);
    const unknown = await upload(Buffer.from("%PDF-1.7 unknown"), order);
    expect(unknown.statusCode).toBe(502);
    expect(unknown.json().error).toContain("Keine Mock-Antwort");
  });
});

describe("web UI fallback", () => {
  it("serves the app shell for client routes and a real 404 for missing files", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const webRoot = join(ctx.dir, "web");
    mkdirSync(webRoot, { recursive: true });
    writeFileSync(join(webRoot, "index.html"), "<!doctype html><title>shell</title>");
    const service = new InboxService({ config: ctx.config, store: ctx.store, llm: mockProvider(), tenant: TENANT, now: () => NOW });
    const app = await buildApp({ config: ctx.config, store: ctx.store, service, now: () => NOW, webRoot });
    try {
      const route = await app.inject({ method: "GET", url: "/pruefliste" });
      expect(route.statusCode).toBe(200);
      expect(route.headers["content-type"]).toContain("text/html");
      expect((await app.inject({ method: "GET", url: "/assets/missing.js" })).statusCode).toBe(404);
      expect((await app.inject({ method: "GET", url: "/api/nope" })).statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
