/** Shared setup for the server and the CLI scripts. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ClaudeProvider } from "../llm/claude";
import { MockProvider } from "../llm/mock";
import type { LlmProvider } from "../llm/provider";
import type { AppConfig } from "./config";

export function createProvider(config: AppConfig): LlmProvider {
  return config.llmMode === "claude"
    ? new ClaudeProvider(config.anthropicApiKey!, config.models)
    : MockProvider.fromFile(config.mockResponses, config.models);
}

/** Loads .env from the project folder only. The key is never read from the global environment file of the machine. */
export function loadLocalEnv(): void {
  const file = join(process.cwd(), ".env");
  if (existsSync(file)) process.loadEnvFile(file);
}
