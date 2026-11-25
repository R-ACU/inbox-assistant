/**
 * Reconciliation samples (English): three quote / order form pairs for an
 * invented health software vendor. Pair 1 matches, pairs 2 and 3 contain the
 * routine errors a contract operations team checks for.
 */
import type { ContractExtraction } from "../src/shared/schemas";

export const VENDOR = {
  name: "Calyx Health Cloud, Inc.",
  address: "400 Harbor Lane, Suite 12, Portland, OR 97201 (fictional)",
};

type Doc = Omit<ContractExtraction, "readable" | "total_contract_value"> & {
  /** Printed total that deliberately disagrees with the line items. */
  printedTcvOverride?: number;
  signer?: string;
};

export interface ContractPairSpec {
  id: string;
  title: string;
  expectedDiscrepancies: number;
  quote: Doc;
  order: Doc;
}

const PRV = { sku: "PRV-SEAT", description: "Provider seat, EHR platform" };
const STF = { sku: "STF-SEAT", description: "Staff seat, scheduling and billing" };
const SUP = { sku: "SUP-PREM", description: "Premium support, 24/7" };
const RCM = { sku: "RCM-ADDON", description: "Revenue cycle add-on" };

const base = {
  currency: "USD",
  billing_frequency: "annual" as const,
  auto_renewal: true,
};

export const CONTRACT_PAIRS: ContractPairSpec[] = [
  {
    id: "riverside",
    title: "Riverside Family Practice",
    expectedDiscrepancies: 0,
    quote: {
      ...base,
      document_type: "quote",
      document_number: "Q-2026-0412",
      quote_reference: null,
      customer_name: "Riverside Family Practice",
      start_date: "2027-01-01",
      term_months: 24,
      payment_terms_days: 30,
      line_items: [
        { ...PRV, quantity: 8, unit_price: 349, discount_percent: 10 },
        { ...STF, quantity: 15, unit_price: 49, discount_percent: 0 },
        { ...SUP, quantity: 1, unit_price: 450, discount_percent: 0 },
      ],
    },
    order: {
      ...base,
      document_type: "order_form",
      document_number: "OF-2026-1187",
      quote_reference: "Q-2026-0412",
      customer_name: "Riverside Family Practice",
      start_date: "2027-01-01",
      term_months: 24,
      payment_terms_days: 30,
      signer: "Dr. Maya Ellison, Managing Partner",
      line_items: [
        { ...PRV, quantity: 8, unit_price: 349, discount_percent: 10 },
        { ...STF, quantity: 15, unit_price: 49, discount_percent: 0 },
        { ...SUP, quantity: 1, unit_price: 450, discount_percent: 0 },
      ],
    },
  },
  {
    id: "northgate",
    title: "Northgate Pediatrics Group",
    expectedDiscrepancies: 6,
    quote: {
      ...base,
      document_type: "quote",
      document_number: "Q-2026-0438",
      quote_reference: null,
      customer_name: "Northgate Pediatrics Group",
      start_date: "2027-01-15",
      term_months: 36,
      payment_terms_days: 30,
      line_items: [
        { ...PRV, quantity: 12, unit_price: 349, discount_percent: 15 },
        { ...STF, quantity: 30, unit_price: 49, discount_percent: 5 },
        { ...SUP, quantity: 1, unit_price: 450, discount_percent: 0 },
      ],
    },
    order: {
      ...base,
      document_type: "order_form",
      document_number: "OF-2026-1203",
      quote_reference: "Q-2026-0438",
      customer_name: "Northgate Pediatrics Group, LLC",
      start_date: "2027-01-15",
      term_months: 36,
      payment_terms_days: 45,
      signer: "Owen Hartley, Practice Administrator",
      printedTcvOverride: 268_920,
      line_items: [
        { ...PRV, quantity: 14, unit_price: 349, discount_percent: 15 },
        { ...STF, quantity: 30, unit_price: 49, discount_percent: 5 },
        { ...SUP, quantity: 1, unit_price: 450, discount_percent: 10 },
      ],
    },
  },
  {
    id: "lakeside",
    title: "Lakeside Women's Health",
    expectedDiscrepancies: 5,
    quote: {
      ...base,
      document_type: "quote",
      document_number: "Q-2026-0451",
      quote_reference: null,
      customer_name: "Lakeside Women's Health",
      start_date: "2027-02-01",
      term_months: 12,
      payment_terms_days: 30,
      line_items: [
        { ...PRV, quantity: 5, unit_price: 349, discount_percent: 0 },
        { ...STF, quantity: 10, unit_price: 49, discount_percent: 0 },
        { ...RCM, quantity: 1, unit_price: 900, discount_percent: 5 },
      ],
    },
    order: {
      ...base,
      document_type: "order_form",
      document_number: "OF-2026-1219",
      quote_reference: "Q-2026-0415",
      customer_name: "Lakeside Women's Health",
      start_date: "2027-03-01",
      term_months: 12,
      payment_terms_days: 30,
      auto_renewal: false,
      signer: "Priya Natarajan, COO",
      line_items: [
        { ...PRV, quantity: 5, unit_price: 349, discount_percent: 0 },
        { ...STF, quantity: 10, unit_price: 49, discount_percent: 0 },
      ],
    },
  },
];
