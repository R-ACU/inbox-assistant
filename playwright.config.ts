import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";
import { hashPassword, randomToken } from "./src/server/crypto";

// The e2e run gets its own port, database and password; it never touches data/ or .env.
export const E2E_PORT = 3225;
export const E2E_PASSWORD = "e2e-passwort-nur-fuer-tests";
export const AUTH_FILE = join("test-results", ".auth", "owner.json");
const dataDir = process.env.E2E_DATA_DIR ?? mkdtempSync(join(tmpdir(), "inbox-assistant-e2e-"));
process.env.E2E_DATA_DIR = dataDir;

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_PORT}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    locale: "de-DE",
  },
  // Log in once and reuse the session: the login route allows only 5 attempts per minute.
  projects: [
    { name: "login", testMatch: /auth\.setup\.ts$/ },
    { name: "app", dependencies: ["login"], use: { storageState: AUTH_FILE } },
  ],
  webServer: {
    command: "npx tsx scripts/seed.ts --reset && node --import tsx src/server/main.ts",
    url: `http://127.0.0.1:${E2E_PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(E2E_PORT),
      DATA_DIR: dataDir,
      LLM_MODE: "mock",
      APP_PASSWORD_HASH: hashPassword(E2E_PASSWORD),
      INBOX_WEBHOOK_SECRET: randomToken(32),
      APP_ORIGINS: `http://127.0.0.1:${E2E_PORT}`,
      ANTHROPIC_API_KEY: "",
      // Shows the demo-access card on the login page, as on the public demo.
      PUBLIC_DEMO_PASSWORD: E2E_PASSWORD,
    },
  },
});
