/** Shared helpers for tests. Loads the generated fixtures. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MockProvider, type MockResponses } from "../src/llm/mock";
import { parseEml } from "../src/mail/parse";

export const FIXTURES = join(import.meta.dirname, "..", "fixtures");

export interface ExpectedCase {
  id: string;
  file: string;
  group: string;
  title: string;
  messageId: string;
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

export function loadExpected(): ExpectedCase[] {
  return JSON.parse(readFileSync(join(FIXTURES, "expected.json"), "utf8")) as ExpectedCase[];
}

export function loadResponses(): MockResponses {
  return JSON.parse(readFileSync(join(FIXTURES, "model", "responses.json"), "utf8")) as MockResponses;
}

export function mockProvider(): MockProvider {
  return new MockProvider(loadResponses());
}

export function readFixture(rel: string): Buffer {
  return readFileSync(join(FIXTURES, rel));
}

export async function parseFixture(rel: string) {
  return parseEml(readFixture(rel));
}

export const NOW = "2026-11-24T10:00:00.000Z";
