/**
 * HTTP layer (Fastify).
 *
 *   /api/auth/*    login with password, session cookie, CSRF token
 *   /api/*         owner API: session cookie + CSRF header + Origin check on writes
 *   /api/hooks/*   n8n API: HMAC signature over timestamp, method, path and body
 *   everything else: the built web UI (dist/), served with a strict CSP
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppConfig } from "./config";
import {
  ReplayGuard,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  precheckSignatureHeaders,
  randomToken,
  safeEqual,
  sha256Hex,
  verifyPassword,
  verifySignature,
} from "./crypto";
import { InboxService, ServiceError } from "./service";
import type { Store } from "./store";

export const SESSION_COOKIE = "ia_session";
export const CSRF_HEADER = "x-csrf-token";

declare module "fastify" {
  interface FastifyRequest {
    session: { idHash: string; csrf: string } | null;
    rawBody?: string;
  }
}

export interface AppDeps {
  config: AppConfig;
  store: Store;
  service: InboxService;
  now?: () => Date;
  logger?: boolean;
  webRoot?: string;
}

const LoginBody = z.object({ password: z.string().min(1).max(200) });
const DraftBody = z.object({ subject: z.string().trim().min(1).max(200), body: z.string().trim().min(1).max(5000) });
const DiscardBody = z.object({ reason: z.string().max(500).default("") });
const ReviewBody = z.object({ action: z.enum(["file", "close"]), note: z.string().max(500).default("") });
const IngestBody = z.object({
  eml_base64: z.string().min(1).max(21_000_000),
  resume_url: z.string().max(500).nullish(),
});
/** Base64 of a mail up to 15 MB plus JSON overhead. Only the ingest route accepts this much. */
const INGEST_BODY_LIMIT = 21 * 1024 * 1024;
const HOOK_RATE_LIMIT = { max: 120, timeWindow: "1 minute" };
/** Requested reply drafts: each one is a model call that costs money. */
export const REPLY_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

const IdParam = z.object({ id: z.string().regex(/^[0-9a-f]{20}$/) });

function parse<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const res = schema.safeParse(value ?? {});
  if (!res.success) throw new ServiceError(400, "Ungültige Eingabe");
  return res.data;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, store, service } = deps;
  const now = deps.now ?? (() => new Date());
  const replay = new ReplayGuard();

  const app = Fastify({
    logger: deps.logger ? { level: "info", redact: ["req.headers.cookie", `req.headers["${SIGNATURE_HEADER}"]`] } : false,
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });

  app.decorateRequest("session", null);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", "data:"],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 0, parts: 2 } });

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof ServiceError) return reply.status(error.status).send({ error: error.message });
    if (error.statusCode === 429) return reply.status(429).send({ error: "Zu viele Versuche. Bitte kurz warten." });
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: "Ungültige Anfrage" });
    }
    request.log.error(error);
    return reply.status(500).send({ error: "Interner Fehler" });
  });

  // ---------------------------------------------------------------- session handling

  app.addHook("onRequest", async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token || token.length > 100) return;
    const idHash = sha256Hex(token);
    const session = store.getSession(idHash, now().getTime());
    if (session) request.session = { idHash, csrf: session.csrf };
  });

  const requireSession = async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.session) return reply.status(401).send({ error: "Nicht angemeldet" });
    if (request.method === "GET" || request.method === "HEAD") return;
    const origin = request.headers.origin;
    if (!origin || !config.allowedOrigins.includes(origin)) {
      return reply.status(403).send({ error: "Ungültiger Ursprung" });
    }
    const csrf = request.headers[CSRF_HEADER];
    if (typeof csrf !== "string" || !safeEqual(csrf, request.session.csrf)) {
      return reply.status(403).send({ error: "CSRF-Token fehlt oder ist ungültig" });
    }
  };

  app.get("/api/health", async () => ({ ok: true, mode: service.mode }));

  app.get("/api/auth/session", async (request) =>
    request.session
      ? { authenticated: true, csrfToken: request.session.csrf, mode: service.mode }
      : { authenticated: false, csrfToken: null, mode: service.mode },
  );

  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const origin = request.headers.origin;
      if (!origin || !config.allowedOrigins.includes(origin)) return reply.status(403).send({ error: "Ungültiger Ursprung" });
      const { password } = parse(LoginBody, request.body);
      if (!verifyPassword(password, config.passwordHash)) {
        return reply.status(401).send({ error: "Passwort falsch" });
      }
      if (request.session) store.deleteSession(request.session.idHash);
      const token = randomToken();
      const csrf = randomToken();
      const expires = now().getTime() + config.sessionTtlMs;
      store.createSession(sha256Hex(token), csrf, now().toISOString(), expires);
      store.addEvent({ mailId: null, at: now().toISOString(), actor: "owner", action: "anmeldung", detail: "" });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: "strict",
        secure: config.cookieSecure,
        path: "/",
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
      return { authenticated: true, csrfToken: csrf, mode: service.mode };
    },
  );

  // ---------------------------------------------------------------- owner API

  await app.register(async (owner) => {
    owner.addHook("preHandler", requireSession);

    owner.post("/api/auth/logout", async (request, reply) => {
      store.deleteSession(request.session!.idHash);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    });

    owner.get("/api/overview", async () => service.counts());
    owner.get("/api/mails", async () => service.list());
    owner.get("/api/mails/:id", async (request) => service.detail(parse(IdParam, request.params).id));

    owner.get("/api/mails/:id/attachments/:index", async (request, reply) => {
      const { id } = parse(IdParam, request.params);
      const index = Number((request.params as { index: string }).index);
      if (!Number.isInteger(index) || index < 0 || index > 20) throw new ServiceError(404, "Anhang nicht verfügbar");
      const file = await service.attachment(id, index);
      return reply
        .header("content-type", file.mediaType)
        .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
        .header("content-security-policy", "sandbox; default-src 'none'")
        .header("cache-control", "no-store")
        .send(file.content);
    });

    // "Antwort entwerfen": costs a model call, so it is throttled harder than the other owner routes.
    owner.post("/api/mails/:id/reply", { config: { rateLimit: REPLY_RATE_LIMIT } }, async (request) => {
      const { id } = parse(IdParam, request.params);
      return service.requestReply(id);
    });
    owner.put("/api/mails/:id/draft", async (request) => {
      const { id } = parse(IdParam, request.params);
      return service.saveDraft(id, parse(DraftBody, request.body));
    });
    owner.post("/api/mails/:id/approve", async (request) => {
      const { id } = parse(IdParam, request.params);
      return service.approve(id, parse(DraftBody, request.body));
    });
    owner.post("/api/mails/:id/discard", async (request) => {
      const { id } = parse(IdParam, request.params);
      return service.discard(id, parse(DiscardBody, request.body).reason);
    });
    owner.post("/api/mails/:id/retry", async (request) => {
      const { id } = parse(IdParam, request.params);
      return service.retryDelivery(id);
    });
    owner.post("/api/mails/:id/review", async (request) => {
      const { id } = parse(IdParam, request.params);
      const body = parse(ReviewBody, request.body);
      return service.resolveReview(id, body.action, body.note);
    });

    owner.get("/api/invoices", async () => service.invoices());
    owner.get("/api/dashboard", async (request) => {
      const days = (request.query as { days?: string }).days ?? "7";
      if (days !== "7" && days !== "14") throw new ServiceError(400, "Ungültiger Zeitraum");
      return service.dashboard(days === "7" ? 7 : 14);
    });
    owner.get("/api/weekly", async (request) => {
      const week = (request.query as { week?: string }).week;
      if (week !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(week)) throw new ServiceError(400, "Ungültige Woche");
      return service.weekly(week);
    });

    owner.get("/api/reconcile/samples", async () => service.contractSamples());
    owner.post("/api/reconcile/samples/:sample", async (request) => {
      const sample = (request.params as { sample: string }).sample;
      if (!/^[a-z0-9-]{1,40}$/.test(sample)) throw new ServiceError(404, "Beispiel nicht gefunden");
      return service.reconcileSample(sample);
    });
    owner.post("/api/reconcile", async (request) => {
      const files: { field: string; filename: string; content: Buffer }[] = [];
      for await (const part of request.files()) {
        files.push({ field: part.fieldname, filename: part.filename, content: await part.toBuffer() });
      }
      const quote = files.find((f) => f.field === "quote");
      const order = files.find((f) => f.field === "order");
      if (!quote || !order) throw new ServiceError(400, "Bitte Angebot und Bestellformular hochladen");
      return service.reconcileFiles(quote, order);
    });
  });

  // ---------------------------------------------------------------- n8n API (HMAC)

  await app.register(async (hooks) => {
    // 1. Before the body is read: headers present, well-formed and inside the time window.
    //    Unsigned or stale calls are rejected here, without uploading or parsing a body.
    hooks.addHook("onRequest", async (request, reply) => {
      const pre = precheckSignatureHeaders({
        timestamp: request.headers[TIMESTAMP_HEADER] as string | undefined,
        signature: request.headers[SIGNATURE_HEADER] as string | undefined,
        nowMs: now().getTime(),
      });
      if (!pre.ok) {
        request.log.warn({ reason: pre.reason }, "rejected webhook before body");
        return reply.status(401).send({ error: "Signatur ungültig" });
      }
    });

    // Body limits per route (see below); the parser itself allows the largest one.
    hooks.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: INGEST_BODY_LIMIT }, (request, body, done) => {
      request.rawBody = body as string;
      try {
        done(null, body ? JSON.parse(body as string) : {});
      } catch {
        done(new ServiceError(400, "Ungültiges JSON"), undefined);
      }
    });

    // 2. After the body is read: HMAC over timestamp, method, path and raw body, replay cache.
    hooks.addHook("preHandler", async (request, reply) => {
      const check = verifySignature({
        secret: config.webhookSecret,
        timestamp: request.headers[TIMESTAMP_HEADER] as string | undefined,
        signature: request.headers[SIGNATURE_HEADER] as string | undefined,
        method: request.method,
        path: request.url,
        rawBody: request.rawBody ?? "",
        nowMs: now().getTime(),
        replay,
      });
      if (!check.ok) {
        request.log.warn({ reason: check.reason }, "rejected webhook");
        return reply.status(401).send({ error: "Signatur ungültig" });
      }
    });

    hooks.post(
      "/api/hooks/ingest",
      { bodyLimit: INGEST_BODY_LIMIT, config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
      async (request) => {
        const body = parse(IngestBody, request.body);
        const raw = Buffer.from(body.eml_base64, "base64");
        const { record, created } = await service.ingest(raw, { resumeUrl: body.resume_url ?? null, actor: "n8n" });
        return {
          mail_id: record.id,
          created,
          category: record.category,
          status: record.status,
          needs_approval: record.status === "awaiting_approval",
        };
      },
    );
    hooks.get("/api/hooks/outbox/:id", { config: { rateLimit: HOOK_RATE_LIMIT } }, async (request) =>
      service.outboxFor(parse(IdParam, request.params).id),
    );
    hooks.post("/api/hooks/outbox/:id/delivered", { bodyLimit: 1024, config: { rateLimit: HOOK_RATE_LIMIT } }, async (request) => {
      const record = service.markDelivered(parse(IdParam, request.params).id, "n8n");
      return { mail_id: record.id, status: record.status };
    });
  });

  // ---------------------------------------------------------------- web UI

  const webRoot = deps.webRoot ?? join(import.meta.dirname, "..", "..", "dist");
  const hasWeb = existsSync(join(webRoot, "index.html"));
  if (hasWeb) await app.register(fastifyStatic, { root: webRoot, wildcard: true, index: ["index.html"] });

  app.setNotFoundHandler((request, reply) => {
    // Client-side routes get the app shell; anything that looks like a file (has an extension) gets a real 404.
    const looksLikeFile = /\.[a-z0-9]+$/i.test(request.url.split("?")[0] ?? "");
    if (request.url.startsWith("/api/") || !hasWeb || request.method !== "GET" || looksLikeFile) {
      return reply.status(404).send({ error: "Nicht gefunden" });
    }
    return reply.sendFile("index.html");
  });

  return app;
}
