/**
 * Structure test for the n8n workflow in n8n/. It was imported and run against a
 * local n8n 2.49 (see README); this test keeps later edits of the JSON honest.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildN8nEnv } from "../scripts/n8n-env";
import { signRequest, signatureBase } from "../src/server/crypto";

interface Node {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, { id: string; name: string }>;
}
interface Workflow {
  nodes: Node[];
  connections: Record<string, { main: { node: string }[][] }>;
}

const wf = JSON.parse(readFileSync(join(import.meta.dirname, "..", "n8n", "inbox-assistant.workflow.json"), "utf8")) as Workflow;
const raw = readFileSync(join(import.meta.dirname, "..", "n8n", "inbox-assistant.workflow.json"), "utf8");
const byName = new Map(wf.nodes.map((n) => [n.name, n]));
const next = (name: string, branch = 0) => wf.connections[name]?.main[branch]?.map((c) => c.node) ?? [];

describe("n8n workflow", () => {
  it("contains no secrets, only references to n8n credentials", () => {
    for (const n of wf.nodes) {
      for (const ref of Object.values(n.credentials ?? {})) {
        expect(Object.keys(ref).sort()).toEqual(["id", "name"]);
      }
    }
    expect(raw).not.toMatch(/hmacSecret|password"\s*:\s*"[^"]|sk-ant-|x-ingress-token"\s*,\s*"value"/i);
  });

  it("uses no code-execution or shell nodes", () => {
    const types = wf.nodes.map((n) => n.type);
    expect(types).not.toContain("n8n-nodes-base.code");
    expect(types).not.toContain("n8n-nodes-base.executeCommand");
    expect(types).not.toContain("n8n-nodes-base.function");
  });

  it("only references nodes that exist", () => {
    for (const [from, conn] of Object.entries(wf.connections)) {
      expect(byName.has(from), from).toBe(true);
      for (const branch of conn.main) for (const c of branch) expect(byName.has(c.node), c.node).toBe(true);
    }
  });

  it("protects the intake webhook with a header credential", () => {
    const hook = byName.get("Neue Mail")!;
    expect(hook.type).toBe("n8n-nodes-base.webhook");
    expect(hook.parameters.authentication).toBe("headerAuth");
    expect(hook.credentials?.httpHeaderAuth).toBeDefined();
  });

  it("signs every call to the assistant right before sending it", () => {
    const calls = wf.nodes.filter((n) => n.type === "n8n-nodes-base.httpRequest");
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      const signer = wf.nodes.find((n) => next(n.name).includes(call.name))!;
      expect(signer.type, call.name).toBe("n8n-nodes-base.crypto");
      expect(signer.parameters).toMatchObject({ action: "hmac", type: "SHA256", encoding: "hex", dataPropertyName: "signature" });
      expect(signer.credentials?.crypto?.id).toBe("inboxWebhookHmac1");
      const headers = (call.parameters.headerParameters as { parameters: { name: string }[] }).parameters.map((h) => h.name);
      expect(headers).toEqual(["x-inbox-timestamp", "x-inbox-signature"]);
    }
  });

  it("builds the same canonical string the server verifies", () => {
    const value = byName.get("Eingang signieren")!.parameters.value as string;
    // Render the n8n expression with sample values and compare with the server's canonical form.
    const rendered = value.replace("={{ $json.ts }}", "1795550000").replace("{{ $json.body }}", '{"a":1}');
    expect(rendered).toBe(signatureBase("1795550000", "POST", "/api/hooks/ingest", '{"a":1}'));
    expect(signRequest("s".repeat(32), "1795550000", "POST", "/api/hooks/ingest", '{"a":1}')).toMatch(/^[0-9a-f]{64}$/);
    expect(byName.get("Abruf signieren")!.parameters.value).toBe("={{ $json.ts }}.GET.{{ $json.path }}.");
  });

  it("waits for a human before anything is sent", () => {
    expect(next("Antwort nötig?", 0)).toEqual(["Auf Freigabe warten"]);
    expect(byName.get("Auf Freigabe warten")!.parameters).toMatchObject({ resume: "webhook", limitWaitTime: true });
    // The only path to the mail node goes through the wait node and the approval check.
    expect(next("Freigegeben?", 0)).toEqual(["Antwort senden"]);
    const intoSend = Object.entries(wf.connections).filter(([, c]) => c.main.flat().some((x) => x.node === "Antwort senden"));
    expect(intoSend.map(([from]) => from)).toEqual(["Freigegeben?"]);
    expect(next("Freigabe abholen")).toEqual(["Freigegeben?"]);
  });

  it("sends the approved text from the assistant, not from the incoming mail", () => {
    const send = byName.get("Antwort senden")!.parameters;
    expect(send.toEmail).toBe("={{ $json.body.to }}");
    expect(send.text).toBe("={{ $json.body.body }}");
    expect(send.emailFormat).toBe("text");
  });
});

// Regression (security review S-A10): every successful run stored the whole mail and reply.
describe("n8n data protection", () => {
  it("does not keep successful executions (they contain whole mails)", () => {
    const settings = (JSON.parse(raw) as { settings: Record<string, unknown> }).settings;
    expect(settings.saveDataSuccessExecution).toBe("none");
    expect(settings.saveManualExecutions).toBe(false);
  });
});

// Regression (security review S-A8): the n8n process inherited DEMO_PASSWORD and N8N_INGRESS_TOKEN.
describe("n8n process environment", () => {
  it("passes an allowlist, never the assistant's secrets", () => {
    const env = buildN8nEnv(
      {
        PATH: "/usr/bin",
        ANTHROPIC_API_KEY: "sk-ant-test",
        APP_PASSWORD_HASH: "scrypt$x",
        INBOX_WEBHOOK_SECRET: "secret-secret-secret-secret-secret",
        DEMO_PASSWORD: "klartext",
        N8N_INGRESS_TOKEN: "intake-token",
        N8N_ENCRYPTION_KEY: "n8n-own-key",
        SOME_OTHER_TOKEN: "x",
      },
      { userFolder: "/tmp/n8n", port: 5690 },
    );
    for (const name of ["ANTHROPIC_API_KEY", "APP_PASSWORD_HASH", "INBOX_WEBHOOK_SECRET", "DEMO_PASSWORD", "N8N_INGRESS_TOKEN", "SOME_OTHER_TOKEN"]) {
      expect(env, name).not.toHaveProperty(name);
    }
    expect(env.PATH).toBe("/usr/bin");
    expect(env.N8N_ENCRYPTION_KEY).toBe("n8n-own-key");
    expect(env.N8N_BLOCK_ENV_ACCESS_IN_NODE).toBe("true");
    expect(env.EXECUTIONS_DATA_PRUNE).toBe("true");
  });
});
