/**
 * Eval over the 20-mail test set.
 *
 *   npm run eval                    mock mode: a pipeline test (the "model" answers come from fixtures,
 *                                   so sorting and field accuracy are 100 % by construction; what is
 *                                   measured is whether the code routes and checks correctly)
 *   LLM_MODE=claude npm run eval    real mode: calls the Claude API (Haiku sorts, Sonnet reads PDFs and drafts);
 *                                   needs ANTHROPIC_API_KEY in the local .env. These are the real numbers.
 *   APP_LOCALE=en npm run eval      the English test set (fixtures/en/, Irish tenant), same modes.
 *
 * Results are written to eval-results/<timestamp>-<mode>.{json,md}; existing files are never overwritten.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeCompany } from "../src/core/invoice-check";
import { processMail } from "../src/core/pipeline";
import { ClaudeProvider } from "../src/llm/claude";
import { MockProvider } from "../src/llm/mock";
import { DEFAULT_MODELS, type LlmProvider } from "../src/llm/provider";
import { parseEml } from "../src/mail/parse";
import { loadLocalEnv } from "../src/server/bootstrap";
import type { ProcessedMail } from "../src/shared/types";
import { fixtureRoot } from "../src/server/config";
import type { Locale } from "../src/shared/locale";
import { tenantFor } from "../src/tenant";

loadLocalEnv();
const ROOT = process.cwd();
const mode = (process.env.LLM_MODE ?? "mock") as "mock" | "claude";
const NOW = process.env.EVAL_NOW ?? "2026-11-24T10:00:00.000Z";
const locale: Locale = process.env.APP_LOCALE === "en" ? "en" : "de";
const FIXTURES = join(ROOT, fixtureRoot(locale));
const TENANT = tenantFor(locale);

// USD per million tokens (input, output), from the published price list.
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
};

interface Expected {
  id: string;
  file: string;
  group: string;
  title: string;
  category: string;
  status: string;
  codes: string[];
  invoice: null | {
    supplier_name: string;
    invoice_number: string;
    invoice_date: string;
    net_total: number;
    tax_total: number;
    gross_total: number;
    line_count: number;
  };
}

function provider(): LlmProvider {
  const models = { classify: process.env.MODEL_CLASSIFY ?? DEFAULT_MODELS.classify, text: process.env.MODEL_TEXT ?? DEFAULT_MODELS.text };
  if (mode === "claude") {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error("LLM_MODE=claude needs ANTHROPIC_API_KEY in the local .env");
    return new ClaudeProvider(key, models, locale);
  }
  return MockProvider.fromFile(join(FIXTURES, "model", "responses.json"), models, locale);
}

const FIELDS = ["supplier_name", "invoice_number", "invoice_date", "net_total", "tax_total", "gross_total", "line_count"] as const;

function fieldMatches(field: (typeof FIELDS)[number], expected: Expected["invoice"], actual: ProcessedMail): boolean {
  const ex = actual.invoice?.extraction;
  if (!ex || !expected) return false;
  switch (field) {
    case "supplier_name":
      return normalizeCompany(ex.supplier_name ?? "") === normalizeCompany(expected.supplier_name);
    case "invoice_number":
      return (ex.invoice_number ?? "").replace(/\s+/g, "") === expected.invoice_number;
    case "invoice_date":
      return ex.invoice_date === expected.invoice_date;
    case "line_count":
      return ex.line_items.length === expected.line_count;
    default:
      return ex[field] !== null && Math.round(ex[field]! * 100) === Math.round(expected[field] * 100);
  }
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(0)} %`);

async function main() {
  const expected = JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8")) as Expected[];
  const llm = provider();
  const started = Date.now();
  const rows: { exp: Expected; got: ProcessedMail; codesFound: boolean; ms: number }[] = [];

  for (const exp of expected) {
    const t0 = Date.now();
    const parsed = await parseEml(readFileSync(join(FIXTURES, exp.file)), locale);
    const got = await processMail(parsed, { llm, tenant: TENANT, now: NOW, existingInvoices: [] });
    const codes = [...got.ruleFindings, ...got.reviewReasons, ...(got.invoice?.findings ?? []), ...(got.draft?.findings ?? [])].map((f) => f.code);
    rows.push({ exp, got, codesFound: exp.codes.every((c) => codes.includes(c)), ms: Date.now() - t0 });
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  const categoryOk = rows.filter((r) => r.got.category === r.exp.category).length;
  const statusOk = rows.filter((r) => r.got.status === r.exp.status).length;
  const traps = rows.filter((r) => r.exp.group === "trap");
  const trapsCaught = traps.filter((r) => r.got.status === r.exp.status && r.codesFound).length;
  const fieldCases = rows.filter((r) => r.exp.invoice);
  const fieldScores = FIELDS.map((f) => ({ field: f, ok: fieldCases.filter((r) => fieldMatches(f, r.exp.invoice, r.got)).length }));
  const fieldsOk = fieldScores.reduce((s, f) => s + f.ok, 0);
  const fieldsTotal = fieldCases.length * FIELDS.length;
  const sentWithoutApproval = rows.filter((r) => r.got.status === "sent" || r.got.status === "approved").length;

  let inputTokens = 0;
  let outputTokens = 0;
  let cost = 0;
  for (const r of rows) {
    for (const s of r.got.steps) {
      inputTokens += s.inputTokens ?? 0;
      outputTokens += s.outputTokens ?? 0;
      const price = Object.entries(PRICES).find(([k]) => s.model.includes(k))?.[1];
      if (price) cost += ((s.inputTokens ?? 0) * price[0] + (s.outputTokens ?? 0) * price[1]) / 1_000_000;
    }
  }

  const summary = {
    mode,
    locale,
    note:
      mode === "mock"
        ? "Pipeline test: model answers come from fixtures, so category and field accuracy are 100 % by construction. Real accuracy needs LLM_MODE=claude."
        : "Real run against the Claude API.",
    at: new Date().toISOString(),
    durationMs: Date.now() - started,
    mails: rows.length,
    categoryAccuracy: { correct: categoryOk, total: rows.length },
    routingAccuracy: { correct: statusOk, total: rows.length },
    trapsCaught: { caught: trapsCaught, total: traps.length },
    invoiceFields: { correct: fieldsOk, total: fieldsTotal, perField: fieldScores },
    sentWithoutApproval,
    tokens: { input: inputTokens, output: outputTokens, estimatedCostUsd: mode === "claude" ? Number(cost.toFixed(4)) : null },
    cases: rows.map((r) => ({
      id: r.exp.id,
      title: r.exp.title,
      expected: { category: r.exp.category, status: r.exp.status, codes: r.exp.codes },
      actual: { category: r.got.category, status: r.got.status },
      ok: r.got.category === r.exp.category && r.got.status === r.exp.status && r.codesFound,
      ms: r.ms,
    })),
  };

  const lines = [
    `# Eval ${summary.at} (${mode}, ${locale === "en" ? "English test set" : "German test set"})`,
    "",
    summary.note,
    "",
    "| Measure | Result |",
    "| :--- | :--- |",
    `| Sorting (category) | ${categoryOk} / ${rows.length} (${pct(categoryOk, rows.length)}) |`,
    `| Routing (filed, review, quarantine, approval) | ${statusOk} / ${rows.length} (${pct(statusOk, rows.length)}) |`,
    `| Traps caught | ${trapsCaught} / ${traps.length} |`,
    `| Invoice fields read correctly | ${fieldsOk} / ${fieldsTotal} (${pct(fieldsOk, fieldsTotal)}) |`,
    `| Sent without human approval | ${sentWithoutApproval} |`,
    `| Tokens in / out | ${inputTokens} / ${outputTokens} |`,
    `| Estimated API cost | ${summary.tokens.estimatedCostUsd === null ? "n/a (mock)" : `$${summary.tokens.estimatedCostUsd}`} |`,
    "",
    "| Case | Expected | Actual | OK |",
    "| :--- | :--- | :--- | :--- |",
    ...summary.cases.map((c) => `| ${c.id} ${c.title} | ${c.expected.category}, ${c.expected.status} | ${c.actual.category}, ${c.actual.status} | ${c.ok ? "yes" : "NO"} |`),
  ];

  const dir = join(ROOT, "eval-results");
  mkdirSync(dir, { recursive: true });
  const stamp = summary.at.replace(/[:.]/g, "-");
  const tag = locale === "en" ? `${mode}-en` : mode;
  writeFileSync(join(dir, `${stamp}-${tag}.json`), `${JSON.stringify(summary, null, 2)}\n`, { flag: "wx" });
  writeFileSync(join(dir, `${stamp}-${tag}.md`), `${lines.join("\n")}\n`, { flag: "wx" });

  console.log(lines.slice(0, 14).join("\n"));
  console.log(`\nWritten to eval-results/${stamp}-${tag}.{json,md}`);
  const failed = summary.cases.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.log(`\n${failed.length} case(s) differ from the expected outcome: ${failed.map((c) => c.id).join(", ")}`);
    if (mode === "mock") process.exitCode = 1;
  }
}

await main();
