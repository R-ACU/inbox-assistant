/**
 * Builds the test set from fixtures/dataset.ts and fixtures/contracts.ts:
 *   fixtures/mails/*.eml            20 eval mails (+ extra/ for the demo inbox)
 *   fixtures/contracts/*.pdf        quote and order form pairs
 *   fixtures/model/responses.json   mock model answers
 *   fixtures/expected.json          expected outcomes for the eval
 *
 * Usage: npm run fixtures
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import MailComposer from "nodemailer/lib/mail-composer";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { chromium } from "@playwright/test";
import { CASES, REPLIES, type CaseSpec, type InvoiceSpec } from "../fixtures/dataset";
import { CONTRACT_PAIRS, VENDOR, type ContractPairSpec } from "../fixtures/contracts";
import { computeTcv } from "../src/core/reconcile";
import { formatIban } from "../src/core/iban";
import { sha256 } from "../src/mail/parse";
import type { ContractExtraction, InvoiceExtraction } from "../src/shared/schemas";
import { TENANT } from "../src/tenant/profile";

const ROOT = join(import.meta.dirname, "..", "fixtures");
const FIXED_DATE = new Date("2026-11-01T00:00:00Z");

const de = new Intl.NumberFormat("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const en = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur = (n: number) => `${de.format(n)} €`;
const usd = (n: number) => `$${en.format(n)}`;
const round2 = (n: number) => Math.round(n * 100) / 100;
const deDate = (iso: string) => iso.split("-").reverse().join(".");

const INK = rgb(0.13, 0.14, 0.16);
const MUTED = rgb(0.42, 0.44, 0.48);
const RULE = rgb(0.82, 0.83, 0.85);

function invoiceTotals(spec: InvoiceSpec) {
  const lines = spec.lines.map((l) => ({ ...l, total: round2(l.quantity * l.unitPrice) }));
  const net = round2(lines.reduce((s, l) => s + l.total, 0));
  const tax = round2(Math.round(net * spec.taxRate) / 100);
  const correct = { net, tax, gross: round2(net + tax) };
  return { lines, printed: spec.printedOverride ?? correct };
}

// ---------------------------------------------------------------- PDF helpers

interface Ctx {
  page: PDFPage;
  regular: PDFFont;
  bold: PDFFont;
}

function text(ctx: Ctx, value: string, x: number, y: number, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) {
  const font = opts.bold ? ctx.bold : ctx.regular;
  const size = opts.size ?? 9.5;
  const width = font.widthOfTextAtSize(value, size);
  ctx.page.drawText(value, { x: opts.align === "right" ? x - width : x, y, size, font, color: opts.color ?? INK });
}

function hr(ctx: Ctx, y: number, x1 = 56, x2 = 539) {
  ctx.page.drawLine({ start: { x: x1, y }, end: { x: x2, y }, thickness: 0.6, color: RULE });
}

async function newDoc(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setProducer("inbox-assistant test fixtures");
  doc.setCreator("inbox-assistant test fixtures");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const page = doc.addPage([595.28, 841.89]);
  const ctx: Ctx = { page, regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  return { doc, ctx };
}

async function invoicePdf(spec: InvoiceSpec): Promise<Uint8Array> {
  const { doc, ctx } = await newDoc(`Rechnung ${spec.number}`);
  const { lines, printed } = invoiceTotals(spec);
  const s = spec.supplier;

  text(ctx, s.name, 56, 780, { size: 15, bold: true });
  text(ctx, `${s.street} · ${s.city}`, 56, 764, { size: 8.5, color: MUTED });

  text(ctx, `${s.name} · ${s.street} · ${s.city}`, 56, 700, { size: 6.5, color: MUTED });
  ["Malerbetrieb Hofmann & Kraft GmbH", "Am Lindenhof 12", "31999 Lindenfeld"].forEach((l, i) => text(ctx, l, 56, 684 - i * 13));

  const meta: [string, string][] = [
    ["Rechnungsnummer", spec.number],
    ["Rechnungsdatum", deDate(spec.date)],
    ["Kundennummer", "K-10482"],
    ["Leistungsdatum", deDate(spec.date)],
  ];
  meta.forEach(([k, v], i) => {
    text(ctx, k, 360, 700 - i * 14, { size: 8.5, color: MUTED });
    text(ctx, v, 539, 700 - i * 14, { size: 8.5, align: "right" });
  });

  text(ctx, "Rechnung", 56, 600, { size: 18, bold: true });

  const cols = { pos: 56, desc: 82, qty: 360, unit: 368, price: 470, total: 539 };
  let y = 566;
  text(ctx, "Pos.", cols.pos, y, { size: 8, color: MUTED });
  text(ctx, "Beschreibung", cols.desc, y, { size: 8, color: MUTED });
  text(ctx, "Menge", cols.qty, y, { size: 8, color: MUTED, align: "right" });
  text(ctx, "Einheit", cols.unit, y, { size: 8, color: MUTED });
  text(ctx, "Einzelpreis", cols.price, y, { size: 8, color: MUTED, align: "right" });
  text(ctx, "Gesamt", cols.total, y, { size: 8, color: MUTED, align: "right" });
  hr(ctx, y - 7);
  y -= 24;
  lines.forEach((l, i) => {
    text(ctx, String(i + 1), cols.pos, y);
    text(ctx, l.description, cols.desc, y);
    text(ctx, de.format(l.quantity).replace(",00", ""), cols.qty, y, { align: "right" });
    text(ctx, l.unit, cols.unit, y);
    text(ctx, eur(l.unitPrice), cols.price, y, { align: "right" });
    text(ctx, eur(l.total), cols.total, y, { align: "right" });
    y -= 20;
  });
  hr(ctx, y + 8);

  y -= 14;
  const totals: [string, string, boolean][] = [
    ["Nettobetrag", eur(printed.net), false],
    [`Umsatzsteuer ${spec.taxRate} %`, eur(printed.tax), false],
    ["Gesamtbetrag", eur(printed.gross), true],
  ];
  totals.forEach(([k, v, strong]) => {
    text(ctx, k, 360, y, { bold: strong, size: strong ? 10.5 : 9.5 });
    text(ctx, v, cols.total, y, { align: "right", bold: strong, size: strong ? 10.5 : 9.5 });
    y -= 18;
  });

  text(ctx, "Zahlbar innerhalb von 14 Tagen ohne Abzug.", 56, y - 24, { size: 9 });

  hr(ctx, 96);
  text(ctx, `Bankverbindung: IBAN ${formatIban(s.iban)}`, 56, 80, { size: 7.5, color: MUTED });
  text(ctx, `USt-IdNr. ${s.vatId} · Amtsgericht Lindenfeld (fiktiv)`, 56, 68, { size: 7.5, color: MUTED });
  text(ctx, "Testdokument, alle Angaben erfunden.", 539, 68, { size: 7.5, color: MUTED, align: "right" });
  return doc.save({ useObjectStreams: false });
}

/** Renders the invoice as a bad scan: image only, blurred, skewed, low contrast. */
async function scanPdf(spec: InvoiceSpec): Promise<Uint8Array> {
  const { lines, printed } = invoiceTotals(spec);
  const rows = lines
    .map((l, i) => `<tr><td>${i + 1}</td><td>${l.description}</td><td>${l.quantity}</td><td>${eur(l.unitPrice)}</td><td>${eur(l.total)}</td></tr>`)
    .join("");
  const html = `<!doctype html><html><body style="margin:0;background:#d9d6cf">
    <div style="width:794px;height:1123px;padding:70px;box-sizing:border-box;background:#e9e6df;font:15px Arial;color:#55524c;
      transform:rotate(-4.5deg) translate(150px,18px);filter:blur(3.4px) contrast(.4) brightness(1.08)">
      <div style="font-size:24px;font-weight:bold">${spec.supplier.name}</div>
      <div>${spec.supplier.street}, ${spec.supplier.city}</div>
      <div style="margin-top:80px;font-size:26px;font-weight:bold">Rechnung ${spec.number}</div>
      <div>Datum ${deDate(spec.date)}</div>
      <table style="margin-top:40px;width:100%;font-size:15px">${rows}</table>
      <div style="margin-top:30px;text-align:right">Netto ${eur(printed.net)}<br>USt ${eur(printed.tax)}<br><b>Gesamt ${eur(printed.gross)}</b></div>
    </div></body></html>`;
  // The browser draws fonts differently on every OS, so the scan is rendered
  // once and kept as a binary fixture; delete the PNG to render it again.
  const pngPath = join(ROOT, "scans", spec.filename.replace(/\.pdf$/i, ".png"));
  let png: Uint8Array;
  if (existsSync(pngPath)) {
    png = readFileSync(pngPath);
  } else {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
      await page.setContent(html);
      png = await page.screenshot({ type: "png" });
    } finally {
      await browser.close();
    }
    mkdirSync(join(ROOT, "scans"), { recursive: true });
    writeFileSync(pngPath, png);
  }
  const doc = await PDFDocument.create();
  doc.setProducer("inbox-assistant test fixtures (scan)");
  doc.setCreationDate(FIXED_DATE);
  doc.setModificationDate(FIXED_DATE);
  const image = await doc.embedPng(png);
  const pdfPage = doc.addPage([595.28, 841.89]);
  pdfPage.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return doc.save({ useObjectStreams: false });
}

function contractTcv(d: ContractPairSpec["quote"]): number {
  const cents = computeTcv({ ...d, readable: true, total_contract_value: null });
  return d.printedTcvOverride ?? (cents ?? 0) / 100;
}

async function contractPdf(d: ContractPairSpec["quote"]): Promise<Uint8Array> {
  const isQuote = d.document_type === "quote";
  const { doc, ctx } = await newDoc(`${isQuote ? "Quote" : "Order Form"} ${d.document_number}`);

  text(ctx, VENDOR.name, 56, 780, { size: 15, bold: true });
  text(ctx, VENDOR.address, 56, 764, { size: 8.5, color: MUTED });
  text(ctx, isQuote ? "Quote" : "Order Form", 56, 712, { size: 20, bold: true });
  text(ctx, d.document_number ?? "", 539, 716, { size: 11, align: "right", bold: true });

  const rows: [string, string][] = [
    ["Customer", d.customer_name ?? ""],
    ...(isQuote ? [] : ([["Quote reference", d.quote_reference ?? ""]] as [string, string][])),
    ["Subscription start date", d.start_date ?? ""],
    ["Initial term", `${d.term_months} months`],
    ["Billing frequency", d.billing_frequency ? d.billing_frequency[0]!.toUpperCase() + d.billing_frequency.slice(1) : ""],
    ["Payment terms", `Net ${d.payment_terms_days}`],
    ["Auto-renewal", d.auto_renewal ? "Yes, for successive 12-month terms" : "No"],
    ["Currency", d.currency ?? ""],
  ];
  let y = 676;
  for (const [k, v] of rows) {
    text(ctx, k, 56, y, { size: 9, color: MUTED });
    text(ctx, v, 200, y, { size: 9.5 });
    y -= 17;
  }

  y -= 16;
  const c = { sku: 56, desc: 130, qty: 360, price: 430, disc: 480, total: 539 };
  text(ctx, "SKU", c.sku, y, { size: 8, color: MUTED });
  text(ctx, "Description", c.desc, y, { size: 8, color: MUTED });
  text(ctx, "Qty", c.qty, y, { size: 8, color: MUTED, align: "right" });
  text(ctx, "Unit / month", c.price, y, { size: 8, color: MUTED, align: "right" });
  text(ctx, "Discount", c.disc, y, { size: 8, color: MUTED, align: "right" });
  text(ctx, "Monthly", c.total, y, { size: 8, color: MUTED, align: "right" });
  hr(ctx, y - 7);
  y -= 24;
  for (const l of d.line_items) {
    const monthly = round2(l.quantity * l.unit_price * (1 - l.discount_percent / 100));
    text(ctx, l.sku, c.sku, y, { size: 9 });
    text(ctx, l.description, c.desc, y, { size: 9 });
    text(ctx, String(l.quantity), c.qty, y, { size: 9, align: "right" });
    text(ctx, usd(l.unit_price), c.price, y, { size: 9, align: "right" });
    text(ctx, `${l.discount_percent}%`, c.disc, y, { size: 9, align: "right" });
    text(ctx, usd(monthly), c.total, y, { size: 9, align: "right" });
    y -= 19;
  }
  hr(ctx, y + 8);
  y -= 16;
  text(ctx, "Total contract value", 330, y, { bold: true, size: 10.5 });
  text(ctx, usd(contractTcv(d)), c.total, y, { bold: true, size: 10.5, align: "right" });

  if (!isQuote) {
    text(ctx, "Accepted and agreed", 56, 200, { size: 9, color: MUTED });
    ctx.page.drawLine({ start: { x: 56, y: 160 }, end: { x: 260, y: 160 }, thickness: 0.6, color: INK });
    text(ctx, d.signer ?? "", 56, 146, { size: 9 });
    text(ctx, "Signed electronically 2026-11-20", 56, 133, { size: 8, color: MUTED });
  } else {
    text(ctx, "This quote is valid for 30 days. Prices exclude applicable taxes.", 56, 200, { size: 8.5, color: MUTED });
  }
  hr(ctx, 96);
  text(ctx, "Test document. Company, customer and all figures are fictional.", 56, 80, { size: 7.5, color: MUTED });
  return doc.save({ useObjectStreams: false });
}

// ---------------------------------------------------------------- mails

function messageIdFor(c: CaseSpec): string {
  return `<${c.id}.${c.date.slice(0, 10)}@${c.from.address.split("@")[1]}>`;
}

async function buildEml(c: CaseSpec, attachment: { filename: string; content: Uint8Array } | null): Promise<Buffer> {
  const composer = new MailComposer({
    from: { name: c.from.name, address: c.from.address },
    to: { name: TENANT.company, address: TENANT.mailbox },
    replyTo: c.replyTo,
    subject: c.subject,
    date: new Date(c.date),
    messageId: messageIdFor(c),
    // A fixed multipart boundary instead of a random one, so the .eml files come out byte for byte the same.
    baseBoundary: `fixture-${c.id}`,
    text: c.text,
    html: c.html,
    attachments: attachment ? [{ filename: attachment.filename, content: Buffer.from(attachment.content), contentType: "application/pdf" }] : [],
  });
  return composer.compile().build();
}

function invoiceExtraction(c: CaseSpec): InvoiceExtraction {
  const spec = c.invoice!;
  if (c.mock.invoiceUnreadable) {
    return {
      readable: false,
      unreadable_reason: c.mock.invoiceUnreadable,
      supplier_name: spec.supplier.name,
      invoice_number: null,
      invoice_date: null,
      iban: null,
      currency: null,
      line_items: [],
      net_total: null,
      tax_rate_percent: null,
      tax_total: null,
      gross_total: null,
    };
  }
  const { lines, printed } = invoiceTotals(spec);
  return {
    readable: true,
    unreadable_reason: null,
    supplier_name: spec.supplier.name,
    invoice_number: spec.number,
    invoice_date: spec.date,
    iban: spec.supplier.iban,
    currency: "EUR",
    line_items: lines.map((l) => ({ description: l.description, quantity: l.quantity, unit_price: l.unitPrice, line_total: l.total })),
    net_total: printed.net,
    tax_rate_percent: spec.taxRate,
    tax_total: printed.tax,
    gross_total: printed.gross,
  };
}

async function main() {
  for (const dir of ["mails", "contracts", "model"]) rmSync(join(ROOT, dir), { recursive: true, force: true });
  mkdirSync(join(ROOT, "mails", "extra"), { recursive: true });
  mkdirSync(join(ROOT, "contracts"), { recursive: true });
  mkdirSync(join(ROOT, "model"), { recursive: true });

  const responses = {
    classify: {} as Record<string, unknown>,
    draft: {} as Record<string, unknown>,
    reply: {} as Record<string, unknown>,
    invoice: {} as Record<string, unknown>,
    contract: {} as Record<string, unknown>,
  };
  const expected: unknown[] = [];

  for (const c of CASES) {
    const messageId = messageIdFor(c);
    let attachment: { filename: string; content: Uint8Array } | null = null;
    if (c.invoice) {
      const content = c.invoice.scan ? await scanPdf(c.invoice) : await invoicePdf(c.invoice);
      attachment = { filename: c.invoice.filename, content };
      responses.invoice[sha256(content)] = invoiceExtraction(c);
    }
    const eml = await buildEml(c, attachment);
    const file = c.group === "extra" ? join("extra", `${c.id}.eml`) : `${c.id}.eml`;
    writeFileSync(join(ROOT, "mails", file), eml);

    responses.classify[messageId] = c.mock.classify;
    if (c.mock.draft) responses.draft[messageId] = c.mock.draft;
    if (REPLIES[c.id]) responses.reply[messageId] = REPLIES[c.id];

    if (c.group !== "extra") {
      const fields = c.invoice && !c.invoice.scan ? invoiceExtraction(c) : null;
      expected.push({
        id: c.id,
        file: `mails/${file}`.replace(/\\/g, "/"),
        group: c.group,
        title: c.title,
        messageId,
        category: c.expected.category,
        status: c.expected.status,
        codes: c.expected.codes,
        invoice: fields && {
          supplier_name: fields.supplier_name,
          invoice_number: fields.invoice_number,
          invoice_date: fields.invoice_date,
          net_total: fields.net_total,
          tax_total: fields.tax_total,
          gross_total: fields.gross_total,
          line_count: fields.line_items.length,
        },
      });
    }
  }

  const pairs: unknown[] = [];
  for (const pair of CONTRACT_PAIRS) {
    const files: Record<string, string> = {};
    for (const side of ["quote", "order"] as const) {
      const d = pair[side];
      const content = await contractPdf(d);
      const filename = `${pair.id}-${side === "quote" ? "quote" : "order-form"}.pdf`;
      writeFileSync(join(ROOT, "contracts", filename), content);
      files[side] = filename;
      const { printedTcvOverride: _o, signer: _s, ...fields } = d;
      const extraction: ContractExtraction = { ...fields, readable: true, total_contract_value: contractTcv(d) };
      responses.contract[sha256(content)] = extraction;
    }
    pairs.push({ id: pair.id, title: pair.title, quote: files.quote, order: files.order, expectedDiscrepancies: pair.expectedDiscrepancies });
  }

  writeFileSync(join(ROOT, "model", "responses.json"), `${JSON.stringify(responses, null, 2)}\n`);
  writeFileSync(join(ROOT, "expected.json"), `${JSON.stringify(expected, null, 2)}\n`);
  writeFileSync(join(ROOT, "contracts", "pairs.json"), `${JSON.stringify(pairs, null, 2)}\n`);
  console.log(`Wrote ${CASES.length} mails (${expected.length} in the eval set), ${pairs.length} contract pairs.`);
}

await main();
