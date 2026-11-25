/**
 * Fills the local database with the 20 test mails plus 2 demo extras, using
 * the mock model answers (never the real API). Mails are processed in the
 * order they arrived, so duplicate checks see the same state as in real use.
 * Usage: npm run seed                       add missing mails
 *        npm run seed -- --reset            start from an empty database
 *        npm run seed -- --skip m10,m11     leave out these test mails (e.g. to send them through n8n)
 *
 * The fixtures keep their fixed dates. The seed moves every mail by the same number of
 * business days so the newest one arrives on the latest business day up to now (see
 * scripts/demo-clock.ts); the overview and the week then show data whenever the demo
 * is opened. Run it with --reset again to bring an older demo database to today.
 */
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { simpleParser } from "mailparser";
import { fixtureShift, shiftedEml } from "./demo-clock";
import { MockProvider } from "../src/llm/mock";
import { loadLocalEnv } from "../src/server/bootstrap";
import { loadConfig } from "../src/server/config";
import { InboxService } from "../src/server/service";
import { Store } from "../src/server/store";
import { TENANT } from "../src/tenant/profile";

loadLocalEnv();
const config = loadConfig();
const dbPath = join(config.dataDir, "app.db");
if (process.argv.includes("--reset")) {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(dbPath + suffix, { force: true });
  for (const dir of ["raw", "outbox"]) rmSync(join(config.dataDir, dir), { recursive: true, force: true });
  console.log("Database reset.");
}

const skipArg = process.argv.indexOf("--skip");
const skip = new Set(skipArg > -1 ? (process.argv[skipArg + 1] ?? "").split(",").map((x) => `${x.trim()}.eml`) : []);
const mailDir = join(process.cwd(), "fixtures", "mails");
const files = [
  ...readdirSync(mailDir).filter((f) => f.endsWith(".eml") && !skip.has(f)).map((f) => join(mailDir, f)),
  ...(existsSync(join(mailDir, "extra")) ? readdirSync(join(mailDir, "extra")).map((f) => join(mailDir, "extra", f)) : []),
];

// Move the whole fixture set to the present (also the skipped mails, so a mail sent
// later through n8n lands on the same day), then process in order of the Date header
// and stamp each record a minute after it arrived, never later than now.
const startedAt = new Date();
const shift = fixtureShift(startedAt);
const mails = await Promise.all(
  files.map(async (file) => {
    const raw = shiftedEml(readFileSync(file), shift);
    return { file, raw, date: (await simpleParser(raw)).date ?? startedAt };
  }),
);
mails.sort((a, b) => a.date.getTime() - b.date.getTime());

let clock = new Date();
const store = new Store(dbPath);
const service = new InboxService({
  config,
  store,
  llm: MockProvider.fromFile(config.mockResponses, config.models),
  tenant: TENANT,
  now: () => clock,
});

let created = 0;
for (const m of mails) {
  clock = new Date(Math.min(m.date.getTime() + 60_000, startedAt.getTime()));
  const { record, created: isNew } = await service.ingest(m.raw, { actor: "system" });
  if (isNew) created += 1;
  console.log(`${isNew ? "+" : "="} ${record.category.padEnd(10)} ${record.status.padEnd(18)} ${record.mail.subject}`);
}
store.close();
console.log(`\nTest mails moved by ${shift.businessDays} business days, newest on ${mails.at(-1)?.date.toISOString() ?? "-"}.`);
console.log(`${created} new, ${mails.length - created} already present. Database: ${dbPath}`);
