/**
 * The English demo business: a small painting company in Ireland. Everything here is invented: company,
 * people, suppliers, bank accounts. Domains use the reserved `.example` TLD (RFC 2606). Irish VAT: 23 %
 * standard, 13.5 % for services such as vehicle repair and waste collection, 9 % and 0 % for a few goods.
 */
import type { FaqEntry } from "../core/draft-check";
import { irishIban } from "../core/iban";
import type { KnownSupplier } from "../core/invoice-check";
import type { TenantProfile } from "./profile";

export const SUPPLIERS_EN = {
  harbour: { name: "Harbour Paints Ltd", aliases: ["Harbour Paints"], iban: irishIban("AIBK", "931152", "10482001"), domains: ["harbour-paints.example"] },
  kelly: { name: "Kelly Scaffolding Ltd", aliases: ["Kelly Scaffolding"], iban: irishIban("AIBK", "931152", "10482118"), domains: ["kelly-scaffolding.example"] },
  moran: { name: "Moran Tool Supplies Ltd", aliases: ["Moran Tool Supplies", "Moran Tools"], iban: irishIban("AIBK", "931152", "10482226"), domains: ["moran-tools.example"] },
  liffey: { name: "Liffey Building Supplies Ltd", aliases: ["Liffey Building Supplies"], iban: irishIban("AIBK", "931152", "10482334"), domains: ["liffey-building.example"] },
  eastway: { name: "Eastway Motors Ltd", aliases: ["Eastway Motors"], iban: irishIban("AIBK", "931152", "10482442"), domains: ["eastway-motors.example"] },
  greenbin: { name: "Greenbin Waste Services Ltd", aliases: ["Greenbin Waste Services", "Greenbin Waste"], iban: irishIban("AIBK", "931152", "10482550"), domains: ["greenbin-waste.example"] },
  summit: { name: "Summit Decorating Supplies Ltd", aliases: ["Summit Decorating Supplies"], iban: irishIban("AIBK", "931152", "10482668"), domains: ["summit-decorating.example"] },
} satisfies Record<string, KnownSupplier>;

export const FAQ_EN: FaqEntry[] = [
  {
    id: "services",
    question: "Which jobs do you take on?",
    answer:
      "Interior and exterior painting, doors, windows and radiators, wallpapering, filling and plastering repairs, and floor coatings for garages and basements.",
  },
  {
    id: "viewing",
    question: "How do we get a quote?",
    answer: "We look at the rooms on site. The visit is free within 30 km. The written quote follows within 5 working days of the visit.",
  },
  {
    id: "prices",
    question: "Roughly what does it cost?",
    answer:
      "Guide prices including materials: interior walls from €9 per m² of wall area, exterior walls from €28 per m², painting an interior door from €120 per door. Only the quote after the visit is binding.",
  },
  {
    id: "scheduling",
    question: "When can you start?",
    answer:
      "Our lead time is currently 3 to 4 weeks. Small one-day jobs can often be fitted in sooner. We work Monday to Friday, 7am to 4pm.",
  },
  {
    id: "area",
    question: "Do you come to us?",
    answer: "We work in Kilcarra and within 30 km of it. Beyond that we charge a travel fee of €45 per day.",
  },
  {
    id: "materials",
    question: "Which paints do you use?",
    answer:
      "Low-emission water-based paints with the EU Ecolabel as standard. Silicate or lime paints on request. We mix custom colours from a colour chart or a sample.",
  },
  {
    id: "mould",
    question: "Do you paint over mould?",
    answer: "No. We check the cause on site first and only paint once it has been fixed. For damp damage we recommend a surveyor.",
  },
  {
    id: "payment",
    question: "How do we pay?",
    answer: "The invoice follows the final walk-through, payable within 14 days. For jobs over €5,000 we agree a deposit of 30%.",
  },
  {
    id: "wallpaper",
    question: "Do you strip old wallpaper?",
    answer: "Yes. We strip old wallpaper from €6 per m². Then we fill and prime the walls so the new paint lasts.",
  },
];

export const TENANT_EN: TenantProfile = {
  locale: "en",
  timeZone: "Europe/Dublin",
  taxRates: [0, 9, 13.5, 23],
  company: "Brennan & Doyle Painting Ltd",
  owner: "Conor Brennan",
  mailbox: "info@brennan-doyle.example",
  domain: "brennan-doyle.example",
  signature: "Kind regards\nConor Brennan\nBrennan & Doyle Painting Ltd\nUnit 4, Millbrook Business Park, Kilcarra, Co. Wicklow\nPhone 0404 55 127",
  faq: FAQ_EN,
  suppliers: Object.values(SUPPLIERS_EN),
};
