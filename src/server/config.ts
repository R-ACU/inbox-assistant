/**
 * Runtime configuration from environment variables, validated at startup.
 * The server refuses to start without a password hash and a webhook secret:
 * there is no "open" mode.
 */
import { resolve } from "node:path";
import { z } from "zod";
import type { Locale } from "../shared/locale";
import { DEFAULT_MODELS } from "../llm/provider";
import { verifyPassword } from "./crypto";

const EnvSchema = z
  .object({
    // Language and tenant of this deployment: the German painting business or the Irish one (English UI).
    APP_LOCALE: z.enum(["de", "en"]).default("de"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3220),
    HOST: z.string().default("127.0.0.1"),
    LLM_MODE: z.enum(["mock", "claude"]).default("mock"),
    ANTHROPIC_API_KEY: z.string().optional(),
    MODEL_CLASSIFY: z.string().default(DEFAULT_MODELS.classify),
    MODEL_TEXT: z.string().default(DEFAULT_MODELS.text),
    APP_PASSWORD_HASH: z.string().regex(/^scrypt\$\d+\$\d+\$\d+\$[\w+/=-]+\$[\w+/=-]+$/, "use npm run hash-password"),
    INBOX_WEBHOOK_SECRET: z.string().min(32, "at least 32 characters"),
    APP_ORIGINS: z.string().default("http://127.0.0.1:3220,http://localhost:3220,http://127.0.0.1:3221,http://localhost:3221"),
    COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
    SESSION_TTL_HOURS: z.coerce.number().positive().max(72).default(12),
    DATA_DIR: z.string().default("./data"),
    // Default per language: fixtures/ (German) or fixtures/en/ (English).
    MOCK_RESPONSES: z.string().optional(),
    CONTRACT_SAMPLES_DIR: z.string().default("./fixtures/contracts"),
    N8N_BASE_URL: z.string().url().optional(),
    // Only behind a reverse proxy on the same machine: the proxy addresses whose
    // X-Forwarded-For is believed, e.g. "127.0.0.1". Unset = trust nobody.
    TRUST_PROXY: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z
        .string()
        .regex(/^\s*[\d.:a-fA-F]+(\/\d{1,3})?\s*(,\s*[\d.:a-fA-F]+(\/\d{1,3})?\s*)*$/, "comma-separated IP addresses or CIDR ranges")
        .optional(),
    ),
    // Only for a public demo with invented data: the login page shows this password
    // with a one-click button. It must match APP_PASSWORD_HASH. Unset = no hint.
    PUBLIC_DEMO_PASSWORD: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().optional()),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_MODE === "claude" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "required when LLM_MODE=claude" });
    }
    if (env.PUBLIC_DEMO_PASSWORD !== undefined) {
      let matches = false;
      try {
        matches = verifyPassword(env.PUBLIC_DEMO_PASSWORD, env.APP_PASSWORD_HASH);
      } catch {
        matches = false;
      }
      if (!matches) ctx.addIssue({ code: "custom", path: ["PUBLIC_DEMO_PASSWORD"], message: "does not match APP_PASSWORD_HASH" });
    }
  });

/** Test set of a language: mails, mock answers and expected outcomes. */
export function fixtureRoot(locale: Locale): string {
  return locale === "en" ? "./fixtures/en" : "./fixtures";
}

export interface AppConfig {
  locale: Locale;
  port: number;
  host: string;
  llmMode: "mock" | "claude";
  anthropicApiKey: string | null;
  models: { classify: string; text: string };
  passwordHash: string;
  webhookSecret: string;
  allowedOrigins: string[];
  cookieSecure: boolean;
  sessionTtlMs: number;
  dataDir: string;
  mockResponses: string;
  /** Folder with the test mails the seed loads (mails/ and mails/extra/ inside). */
  fixturesDir: string;
  contractSamplesDir: string;
  n8nBaseUrl: string | null;
  /** Proxy addresses allowed to set the client IP (rate limits key on it); false = none. */
  trustProxy: string[] | false;
  /** Public demo password shown on the login page; null = not shown. */
  publicDemoPassword: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}\nSee .env.example.`);
  }
  const e = parsed.data;
  return {
    locale: e.APP_LOCALE,
    port: e.PORT,
    host: e.HOST,
    llmMode: e.LLM_MODE,
    anthropicApiKey: e.ANTHROPIC_API_KEY ?? null,
    models: { classify: e.MODEL_CLASSIFY, text: e.MODEL_TEXT },
    passwordHash: e.APP_PASSWORD_HASH,
    webhookSecret: e.INBOX_WEBHOOK_SECRET,
    allowedOrigins: e.APP_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    cookieSecure: e.COOKIE_SECURE === "true",
    sessionTtlMs: e.SESSION_TTL_HOURS * 3_600_000,
    dataDir: resolve(e.DATA_DIR),
    mockResponses: resolve(e.MOCK_RESPONSES ?? `${fixtureRoot(e.APP_LOCALE)}/model/responses.json`),
    fixturesDir: resolve(fixtureRoot(e.APP_LOCALE)),
    contractSamplesDir: resolve(e.CONTRACT_SAMPLES_DIR),
    n8nBaseUrl: e.N8N_BASE_URL ?? null,
    trustProxy: e.TRUST_PROXY ? e.TRUST_PROXY.split(",").map((p) => p.trim()) : false,
    publicDemoPassword: e.PUBLIC_DEMO_PASSWORD ?? null,
  };
}
