/**
 * The German demo business. Everything here is invented: company, people, suppliers,
 * bank accounts. Domains use the reserved `.example` TLD (RFC 2606).
 * The English deployment runs an Irish business instead: ./profile-en.ts.
 */
import type { FaqEntry } from "../core/draft-check";
import { germanIban } from "../core/iban";
import type { KnownSupplier } from "../core/invoice-check";
import type { Locale } from "../shared/locale";

export interface TenantProfile {
  /** Language of everything the owner reads: UI, check results, audit trail, model drafts. */
  locale: Locale;
  /** Wall clock of the business, for days and hours on the overview and the week. */
  timeZone: string;
  /** VAT rates that may appear on a supplier invoice; any other rate goes to review. */
  taxRates: number[];
  company: string;
  owner: string;
  mailbox: string;
  domain: string;
  signature: string;
  faq: FaqEntry[];
  suppliers: KnownSupplier[];
}

export const SUPPLIERS = {
  nordlicht: { name: "Farbenhaus Nordlicht GmbH", aliases: ["Farbenhaus Nordlicht"], iban: germanIban("37040044", "532013000"), domains: ["farbenhaus-nordlicht.example"] },
  albers: { name: "Gerüstbau Albers KG", aliases: ["Gerüstbau Albers"], iban: germanIban("37040044", "532013118"), domains: ["geruestbau-albers.example"] },
  kranz: { name: "Werkzeughandel Kranz e.K.", aliases: ["Werkzeughandel Kranz"], iban: germanIban("37040044", "532013226"), domains: ["werkzeug-kranz.example"] },
  lenz: { name: "Baustoffe Lenz GmbH & Co. KG", aliases: ["Baustoffe Lenz"], iban: germanIban("37040044", "532013334"), domains: ["baustoffe-lenz.example"] },
  ostring: { name: "Kfz-Service Ostring GmbH", aliases: ["Kfz-Service Ostring"], iban: germanIban("37040044", "532013442"), domains: ["kfz-ostring.example"] },
  meyer: { name: "Entsorgung Meyer GmbH", aliases: ["Entsorgung Meyer"], iban: germanIban("37040044", "532013550"), domains: ["entsorgung-meyer.example"] },
  sommer: { name: "Malerbedarf Sommer GmbH", aliases: ["Malerbedarf Sommer"], iban: germanIban("37040044", "532013668"), domains: ["malerbedarf-sommer.example"] },
} satisfies Record<string, KnownSupplier>;

export const FAQ: FaqEntry[] = [
  {
    id: "leistungen",
    question: "Welche Arbeiten übernehmen Sie?",
    answer:
      "Innenanstrich, Fassadenanstrich, Lackierarbeiten an Türen, Fenstern und Heizkörpern, Tapezieren, Spachtelarbeiten bis Qualitätsstufe Q4 und Bodenbeschichtungen in Garagen und Kellern.",
  },
  {
    id: "besichtigung",
    question: "Wie kommt ein Angebot zustande?",
    answer:
      "Wir sehen uns die Räume vor Ort an. Die Besichtigung ist im Umkreis von 30 km kostenlos. Das schriftliche Angebot kommt innerhalb von 5 Werktagen nach der Besichtigung.",
  },
  {
    id: "preise",
    question: "Was kostet das ungefähr?",
    answer:
      "Richtwerte inklusive Material: Innenanstrich ab 9 € pro m² Wandfläche, Fassadenanstrich ab 28 € pro m², Lackieren einer Zimmertür ab 120 € pro Türblatt. Verbindlich ist erst das Angebot nach der Besichtigung.",
  },
  {
    id: "termine",
    question: "Wann können Sie anfangen?",
    answer:
      "Der Vorlauf liegt derzeit bei 3 bis 4 Wochen. Kleine Aufträge von einem Tag schieben wir oft früher ein. Wir arbeiten montags bis freitags von 7 bis 16 Uhr.",
  },
  {
    id: "einzugsgebiet",
    question: "Kommen Sie auch zu uns?",
    answer:
      "Wir arbeiten in Lindenfeld und im Umkreis von 30 km. Darüber hinaus berechnen wir eine Anfahrtspauschale von 45 € pro Tag.",
  },
  {
    id: "material",
    question: "Welche Farben verwenden Sie?",
    answer:
      "Standardmäßig emissionsarme Dispersionsfarben mit Blauem Engel. Auf Wunsch Silikat- oder Kalkfarben. Eigene Farbtöne mischen wir nach Farbfächer oder Muster.",
  },
  {
    id: "schimmel",
    question: "Streichen Sie auch über Schimmel?",
    answer:
      "Nein. Wir prüfen vor Ort die Ursache. Gestrichen wird erst, wenn die Ursache beseitigt ist. Bei Feuchteschäden empfehlen wir einen Sachverständigen.",
  },
  {
    id: "zahlung",
    question: "Wie wird bezahlt?",
    answer:
      "Die Rechnung kommt nach der Abnahme, zahlbar innerhalb von 14 Tagen. Bei Aufträgen über 5.000 € vereinbaren wir eine Abschlagszahlung von 30 %.",
  },
  {
    id: "tapete",
    question: "Entfernen Sie alte Tapeten?",
    answer:
      "Ja. Alte Tapeten entfernen wir ab 6 € pro m². Danach spachteln und grundieren wir die Wände, damit der neue Anstrich hält.",
  },
];

export const TENANT: TenantProfile = {
  locale: "de",
  timeZone: "Europe/Berlin",
  taxRates: [0, 7, 19],
  company: "Malerbetrieb Hofmann & Kraft GmbH",
  owner: "Jonas Hofmann",
  mailbox: "info@hofmann-kraft.example",
  domain: "hofmann-kraft.example",
  signature: "Viele Grüße\nJonas Hofmann\nMalerbetrieb Hofmann & Kraft GmbH\nAm Lindenhof 12, 31999 Lindenfeld\nTelefon 05999 41 27 30",
  faq: FAQ,
  suppliers: Object.values(SUPPLIERS),
};
