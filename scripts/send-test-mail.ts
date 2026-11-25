/**
 * Sends an .eml to the running assistant exactly like n8n does: signed with
 * INBOX_WEBHOOK_SECRET over timestamp, method, path and body.
 * Usage: npm run send-test-mail -- fixtures/mails/m09.eml
 * The Date header is moved like in the seed (scripts/demo-clock.ts), so the mail
 * lands on the same day as the rest of the demo data.
 */
import { readFileSync } from "node:fs";
import { SIGNATURE_HEADER, TIMESTAMP_HEADER, signRequest } from "../src/server/crypto";
import { loadLocalEnv } from "../src/server/bootstrap";
import { fixtureShift, shiftedEml } from "./demo-clock";

loadLocalEnv();
const file = process.argv[2];
const secret = process.env.INBOX_WEBHOOK_SECRET;
const base = process.env.ASSISTANT_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3220}`;
if (!file || !secret) {
  console.error("Usage: npm run send-test-mail -- <file.eml>   (INBOX_WEBHOOK_SECRET must be set in .env)");
  process.exit(1);
}
const path = "/api/hooks/ingest";
const body = JSON.stringify({ eml_base64: shiftedEml(readFileSync(file), fixtureShift(new Date())).toString("base64") });
const ts = String(Math.floor(Date.now() / 1000));
const res = await fetch(base + path, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    [TIMESTAMP_HEADER]: ts,
    [SIGNATURE_HEADER]: signRequest(secret, ts, "POST", path, body),
  },
  body,
});
console.log(res.status, await res.text());
