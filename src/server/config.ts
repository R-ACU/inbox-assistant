/**
 * Runtime configuration from environment variables, validated at startup.
 * The server refuses to start without a password hash and a webhook secret:
 * there is no "open" mode.
 */
import { resolve } from "node:path";
import { z } from "zod";
import { DEFAULT_MODELS } from "../llm/provider";

const EnvSchema = z
  .object({
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
    MOCK_RESPONSES: z.string().default("./fixtures/model/responses.json"),
    CONTRACT_SAMPLES_DIR: z.string().default("./fixtures/contracts"),
    N8N_BASE_URL: z.string().url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_MODE === "claude" && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "required when LLM_MODE=claude" });
    }
  });

export interface AppConfig {
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
  contractSamplesDir: string;
  n8nBaseUrl: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}\nSee .env.example.`);
  }
  const e = parsed.data;
  return {
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
    mockResponses: resolve(e.MOCK_RESPONSES),
    contractSamplesDir: resolve(e.CONTRACT_SAMPLES_DIR),
    n8nBaseUrl: e.N8N_BASE_URL ?? null,
  };
}
