/** Server entry point: npm start (or npm run dev). */
import { join } from "node:path";
import { tenantFor } from "../tenant";
import { buildApp } from "./app";
import { createProvider, loadLocalEnv } from "./bootstrap";
import { loadConfig } from "./config";
import { InboxService } from "./service";
import { Store } from "./store";

loadLocalEnv();
const config = loadConfig();
const store = new Store(join(config.dataDir, "app.db"));
const service = new InboxService({ config, store, llm: createProvider(config), tenant: tenantFor(config.locale) });
const app = await buildApp({ config, store, service, logger: true });

const shutdown = async () => {
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
app.log.info(`Inbox assistant on http://${config.host}:${config.port} (model mode: ${config.llmMode}, language: ${config.locale})`);
