/**
 * Local n8n helper.
 *
 *   npm run n8n -- start   start n8n on 127.0.0.1:5690 (data folder from N8N_USER_FOLDER)
 *   npm run n8n -- setup   import the three credentials from .env and the workflow, then publish it
 *                          (run while n8n is stopped; start it again afterwards)
 *   npm run n8n -- demo    send one test mail through n8n, approve it in the assistant and check
 *                          that n8n delivered it to the test SMTP server (npm run smtp-sink)
 *
 * Secrets never go into the workflow JSON. `setup` writes a temporary credentials file into
 * DATA_DIR, imports it (n8n encrypts it in its own store) and deletes the file again.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fixtureShift, shiftedEml } from "./demo-clock";
import { join, resolve } from "node:path";
import { loadLocalEnv } from "../src/server/bootstrap";
import { buildN8nEnv } from "./n8n-env";

loadLocalEnv();
const ROOT = process.cwd();
const N8N_PORT = Number(process.env.N8N_PORT ?? 5690);
const N8N_URL = `http://127.0.0.1:${N8N_PORT}`;
const ASSISTANT_URL = process.env.ASSISTANT_URL ?? `http://127.0.0.1:${process.env.PORT ?? 3220}`;
const USER_FOLDER = resolve(process.env.N8N_USER_FOLDER ?? "./.n8n");
const DATA_DIR = resolve(process.env.DATA_DIR ?? "./data");
const WORKFLOW_ID = "inboxAssistantFlow1";

function n8nEnv(): NodeJS.ProcessEnv {
  return buildN8nEnv(process.env, { userFolder: USER_FOLDER, port: N8N_PORT });
}

function run(args: string[]): Promise<number> {
  return new Promise((done) => {
    const child = spawn("npx", ["-y", "n8n", ...args], { env: n8nEnv(), stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => done(code ?? 1));
  });
}

function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing in .env`);
  return v;
}

async function setup() {
  mkdirSync(DATA_DIR, { recursive: true });
  const tmp = join(DATA_DIR, `n8n-credentials-${Date.now()}.tmp.json`);
  const credentials = [
    {
      id: "inboxIngressToken1",
      name: "Posteingang: Einlieferungs-Token",
      type: "httpHeaderAuth",
      data: { name: "x-ingress-token", value: need("N8N_INGRESS_TOKEN") },
    },
    {
      id: "inboxWebhookHmac1",
      name: "Posteingang: Webhook-Geheimnis",
      type: "crypto",
      data: { hmacSecret: need("INBOX_WEBHOOK_SECRET") },
    },
    {
      id: "inboxTestSmtp00001",
      name: "Posteingang: Test-SMTP",
      type: "smtp",
      data: { user: "", password: "", host: "127.0.0.1", port: Number(process.env.SMTP_SINK_PORT ?? 2525), secure: false, disableStartTls: true },
    },
  ];
  try {
    writeFileSync(tmp, JSON.stringify(credentials), { mode: 0o600 });
    if ((await run(["import:credentials", `--input=${tmp}`])) !== 0) throw new Error("import:credentials failed");
  } finally {
    rmSync(tmp, { force: true });
  }
  if ((await run(["import:workflow", `--input=${join(ROOT, "n8n", "inbox-assistant.workflow.json")}`])) !== 0) {
    throw new Error("import:workflow failed");
  }
  if ((await run(["publish:workflow", `--id=${WORKFLOW_ID}`])) !== 0) throw new Error("publish:workflow failed");
  console.log("\nCredentials and workflow imported and published. Start n8n with: npm run n8n -- start");
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function demo() {
  const file = process.argv[3] ?? "fixtures/mails/m10.eml";
  const password = need("DEMO_PASSWORD");
  const sinkDir = join(ROOT, "data", "smtp-sink");
  const before = existsSync(sinkDir) ? readdirSync(sinkDir).length : 0;

  // 1. Deliver the raw mail to n8n, like a mail relay would (Date moved like in the seed).
  const raw = shiftedEml(readFileSync(file), fixtureShift(new Date()));
  const hook = await fetch(`${N8N_URL}/webhook/inbox-assistant/new-mail`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ingress-token": need("N8N_INGRESS_TOKEN") },
    body: JSON.stringify({ eml_base64: raw.toString("base64") }),
  });
  console.log(`1. n8n webhook: HTTP ${hook.status}`);
  if (!hook.ok) throw new Error(await hook.text());

  // 2. Log in to the assistant as the owner.
  const origin = ASSISTANT_URL;
  const login = await fetch(`${ASSISTANT_URL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify({ password }),
  });
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]!;
  const { csrfToken } = (await login.json()) as { csrfToken: string };
  const headers = { cookie, origin, "x-csrf-token": csrfToken, "content-type": "application/json" };

  // 3. Wait until n8n has handed the mail over and the draft waits for approval.
  const subject = (await import("mailparser")).simpleParser;
  const parsedSubject = (await subject(raw)).subject ?? "";
  type Detail = { record: { id: string; status: string; resumeUrl: string | null; draft: { draft: { subject: string; body: string } } | null } };
  let detail: Detail | null = null;
  for (let i = 0; i < 40 && !detail; i++) {
    const list = (await (await fetch(`${ASSISTANT_URL}/api/mails`, { headers: { cookie } })).json()) as { id: string; subject: string }[];
    const hit = list.find((m) => m.subject === parsedSubject);
    if (hit) {
      const d = (await (await fetch(`${ASSISTANT_URL}/api/mails/${hit.id}`, { headers: { cookie } })).json()) as Detail;
      if (d?.record.resumeUrl) detail = d;
    }
    if (!detail) await sleep(500);
  }
  if (!detail) throw new Error("The assistant never received the mail from n8n.");
  console.log(`2. Assistant: ${detail.record.status}, resume URL ${detail.record.resumeUrl}`);

  // 4. Approve, exactly as the owner would in the UI. n8n answers the resume with 409
  // until its run has actually reached the Wait node, so give it the moment a person
  // would need to read the draft anyway.
  await sleep(3_000);
  const approve = await fetch(`${ASSISTANT_URL}/api/mails/${detail.record.id}/approve`, {
    method: "POST",
    headers,
    body: JSON.stringify(detail.record.draft!.draft),
  });
  console.log(`3. Approved: HTTP ${approve.status}, status ${((await approve.json()) as { status: string }).status}`);

  // 5. n8n fetches the approved reply, sends it via SMTP and reports delivery.
  let status = "";
  for (let i = 0; i < 40 && status !== "sent"; i++) {
    await sleep(500);
    status = ((await (await fetch(`${ASSISTANT_URL}/api/mails/${detail.record.id}`, { headers: { cookie } })).json()) as { record: { status: string } }).record.status;
  }
  const after = existsSync(sinkDir) ? readdirSync(sinkDir).length : 0;
  console.log(`4. Assistant status after n8n: ${status}`);
  console.log(`5. Test SMTP received ${after - before} new mail(s) in data/smtp-sink/`);
  if (status !== "sent" || after - before < 1) process.exitCode = 1;
}

const command = process.argv[2];
if (command === "start") process.exitCode = await run(["start"]);
else if (command === "setup") await setup();
else if (command === "demo") await demo();
else {
  console.log("Usage: npm run n8n -- start | setup | demo [file.eml]");
  process.exitCode = 1;
}
