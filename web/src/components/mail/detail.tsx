/**
 * Reading pane and action column for every kind of mail, in one place: a reply draft is edited and sent here,
 * an invoice is checked and filed here, a suspicious mail is closed here. The middle shows what the mail is
 * about (draft, read-out invoice, mail text); the right column shows the state with its one decision, a few
 * facts as short label and value rows (details open on click) and the history as a picture timeline.
 */
import {
  BookOpenText,
  Check,
  CheckCheck,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Download,
  FileWarning,
  FolderCheck,
  Info,
  Paperclip,
  Reply,
  RotateCw,
  Save,
  Send,
  ShieldAlert,
  ShieldCheck,
  ShieldQuestion,
  Sparkles,
  SquareCheck,
  Trash2,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatIban } from "../../../../src/core/iban";
import { replyBlocked } from "../../../../src/core/reply";
import type { AuditEvent, Finding, InvoiceResult, ProcessedMail } from "../../../../src/shared/types";
import { FAQ } from "../../../../src/tenant/profile";
import { CATEGORY_LABEL, api, formatCents, formatDate, formatDateTime, formatEuro, navigate, useApi } from "../../lib";
import { cn } from "../../utils";
import { BrandGlyph, BrandLogo } from "../brand";
import { Avatar, CATEGORY_COLOR, EmptyState, ErrorNote, Findings, MailAvatar } from "../common";
import { useRefreshCounts, useShortcuts } from "../shell/AppShell";
import { Badge, Dot } from "../ui/badge";
import { Button } from "../ui/button";
import { Input, Label, Textarea } from "../ui/input";
import { useToast } from "../ui/toast";
import { Tooltip } from "../ui/tooltip";
import { ReaderSkeleton, useWide } from "./parts";
import { BackButton, Panel } from "./workspace";

const ease = [0.23, 1, 0.32, 1] as const;

// ---------------------------------------------------------------- vocabulary

/** One to three words per event; the server's detail sentence opens on hover. */
const EVENT_LABEL: Record<string, string> = {
  eingang: "Eingegangen",
  freigegeben: "Freigegeben",
  versendet: "Versendet",
  verworfen: "Verworfen",
  entwurf_geaendert: "Entwurf bearbeitet",
  erledigt: "Erledigt",
  nach_pruefung_abgelegt: "Nach Prüfung abgelegt",
  n8n_fortgesetzt: "n8n übernimmt",
  n8n_nicht_erreichbar: "n8n nicht erreichbar",
  erneut_senden: "Erneut gesendet",
  versand_fehlgeschlagen: "Versand fehlgeschlagen",
  versand_abgebrochen: "Versand abgebrochen",
  antwort_angefordert: "Antwort entworfen",
  entwurf_fehlgeschlagen: "Entwurf fehlgeschlagen",
};
const STEP_LABEL: Record<string, string> = { classify: "Einordnen", extract_invoice: "Beleg lesen", draft_reply: "Antwort entwerfen" };
const sentence = (detail: string) => (/[.!?)]$/.test(detail) ? detail : `${detail}.`);

/** The strongest reasons first, at most a few hints. */
export function topReasons(findings: Finding[], max = 4): Finding[] {
  const strong = findings.filter((f) => f.severity !== "info");
  const info = findings.filter((f) => f.severity === "info");
  return [...strong, ...info.slice(0, Math.max(0, Math.min(2, max - strong.length)))].slice(0, max);
}

// ---------------------------------------------------------------- draft editor

export interface EditorState {
  subject: string;
  body: string;
  setSubject: (s: string) => void;
  setBody: (s: string) => void;
  findings: Finding[];
  dirty: boolean;
  busy: "send" | "save" | "discard" | null;
  error: string | null;
  run: (kind: "send" | "save" | "discard") => void;
  /** The owner asked for this reply himself ("Antwort entwerfen"); the intake did not draft it. */
  requested: boolean;
}

function useDraftEditor(record: ProcessedMail, onDone: () => void): EditorState | null {
  const draft = record.status === "awaiting_approval" ? record.draft : null;
  const [subject, setSubject] = useState(draft?.draft.subject ?? "");
  const [body, setBody] = useState(draft?.draft.body ?? "");
  const [saved, setSaved] = useState({ subject: draft?.draft.subject ?? "", body: draft?.draft.body ?? "" });
  const [findings, setFindings] = useState(draft?.findings ?? []);
  const [busy, setBusy] = useState<EditorState["busy"]>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const refreshCounts = useRefreshCounts();

  useEffect(() => {
    setSubject(draft?.draft.subject ?? "");
    setBody(draft?.draft.body ?? "");
    setSaved({ subject: draft?.draft.subject ?? "", body: draft?.draft.body ?? "" });
    setFindings(draft?.findings ?? []);
    setError(null);
  }, [record.id, draft]);

  if (!draft) return null;

  const run = async (kind: "send" | "save" | "discard") => {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "save") {
        const updated = await api<ProcessedMail>(`/api/mails/${record.id}/draft`, { method: "PUT", body: { subject, body } });
        setFindings(updated.draft!.findings);
        setSaved({ subject, body });
        toast("Änderungen gespeichert");
      } else if (kind === "send") {
        const updated = await api<ProcessedMail>(`/api/mails/${record.id}/approve`, { method: "POST", body: { subject, body } });
        toast(updated.status === "sent" || updated.draft?.requested?.sentAt ? "Antwort gesendet" : "Freigegeben, n8n versendet die Antwort");
        refreshCounts();
        onDone();
      } else {
        await api(`/api/mails/${record.id}/discard`, { method: "POST", body: { reason: "In der Freigabe verworfen" } });
        toast("Entwurf verworfen", "info");
        refreshCounts();
        onDone();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return { subject, body, setSubject, setBody, findings, dirty: subject !== saved.subject || body !== saved.body, busy, error, run, requested: !!draft.requested };
}

// ---------------------------------------------------------------- reading pane

function Header({ record }: { record: ProcessedMail }) {
  const sender = record.mail.from.name || record.mail.from.address;
  return (
    <header>
      <h2 className="text-[24px] leading-tight font-medium tracking-[-0.02em] text-ink">{record.mail.subject}</h2>
      <div className="mt-4 flex items-center gap-3">
        <MailAvatar name={sender} category={record.category} status={record.status} size="lg" />
        <p className="min-w-0 flex-1 text-[13.5px] leading-tight">
          <span className="block truncate font-medium text-ink">{sender}</span>
          <span className="mt-0.5 block truncate text-ink-3">{record.mail.from.address}</span>
        </p>
        <span className="tnum shrink-0 text-[12.5px] text-ink-3">{formatDateTime(record.mail.date)}</span>
      </div>
    </header>
  );
}

function SectionLabel({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <h3 className="text-[13px] font-medium text-ink-3">{children}</h3>
      {aside}
    </div>
  );
}

function MailText({ record, label = "Nachricht" }: { record: ProcessedMail; label?: string }) {
  return (
    <section aria-label={label}>
      <SectionLabel aside={record.mail.hadHtml ? <Badge tone="neutral">HTML als Text</Badge> : undefined}>{label}</SectionLabel>
      <div className="rounded-[22px] bg-surface-2 px-6 py-5">
        <p className="text-[14px] leading-[1.7] break-words whitespace-pre-wrap text-ink-2">{record.mail.text || "Kein Text."}</p>
      </div>
    </section>
  );
}

function DraftEditor({ record, editor }: { record: ProcessedMail; editor: EditorState }) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  // Grow the text field with its content so the whole draft is visible without an inner scrollbar.
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [editor.body]);
  const edited = !!record.draft?.editedAt || editor.dirty;
  return (
    <section aria-labelledby="draft-title" className="rounded-[24px] bg-surface-2 p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-accent text-accent-ink">
          <Sparkles className="size-[18px]" aria-hidden />
        </span>
        <h3 id="draft-title" className="text-[16px] font-medium text-ink">
          Antwortentwurf
        </h3>
        <Badge tone={edited ? "neutral" : "accent"} className="ml-auto bg-surface">
          {edited ? "bearbeitet" : editor.requested ? "auf Wunsch" : "aus Ihrer FAQ"}
        </Badge>
      </div>
      <AnimatePresence initial={false}>
        {editor.findings.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease }}
            className="overflow-hidden"
          >
            <div role="note" aria-label="Hinweis zum Entwurf" className="mb-5 rounded-[18px] bg-bad-soft px-4 py-3.5">
              <Findings findings={editor.findings} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <Label htmlFor="draft-subject">Betreff</Label>
      <Input id="draft-subject" value={editor.subject} onChange={(e) => editor.setSubject(e.target.value)} maxLength={200} className="mb-4" />
      <Label htmlFor="draft-body">Text</Label>
      <Textarea id="draft-body" ref={bodyRef} value={editor.body} onChange={(e) => editor.setBody(e.target.value)} maxLength={5000} rows={10} className="resize-none overflow-hidden" />
    </section>
  );
}

function Verdict({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="text-ink-3">offen</span>;
  return ok ? (
    <span className="inline-flex items-center gap-1.5 font-medium text-good">
      <Check className="size-4" aria-hidden /> stimmt
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 font-medium text-bad">
      <X className="size-4" aria-hidden /> weicht ab
    </span>
  );
}

function Tile({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[16px] bg-surface-2 px-4 py-3">
      <p className="text-[12px] text-ink-3">{label}</p>
      <p className="tnum mt-0.5 truncate text-[13.5px] font-medium text-ink">{children}</p>
    </div>
  );
}

function InvoiceCard({ invoice }: { invoice: InvoiceResult }) {
  const ex = invoice.extraction;
  const c = invoice.computed;
  const errors = invoice.findings.filter((f) => f.severity === "error");
  const rest = invoice.findings.filter((f) => f.severity !== "error");
  const cents = (v: number | null) => (v === null ? null : Math.round(v * 100));
  // Tolerance in cents: tax may differ by one cent through rounding per line.
  const totals = [
    { label: "Netto", printed: cents(ex.net_total), computed: c?.lineSum ?? null, tolerance: 0 },
    { label: `USt. ${ex.tax_rate_percent ?? "?"} %`, printed: cents(ex.tax_total), computed: c?.expectedTax ?? null, tolerance: 1 },
    { label: "Brutto", printed: cents(ex.gross_total), computed: c?.expectedGross ?? null, tolerance: 1 },
  ];
  const verdict = (t: (typeof totals)[number]) => (t.printed === null || t.computed === null ? null : Math.abs(t.printed - t.computed) <= t.tolerance);
  const supplier = ex.supplier_name ?? "Lieferant nicht erkannt";

  if (!ex.readable) {
    return (
      <section aria-label="Ausgelesener Beleg" className="flex items-center gap-4 rounded-[24px] bg-surface-2 p-5">
        <span className="grid size-12 shrink-0 place-items-center rounded-full bg-surface text-accent-text">
          <FileWarning className="size-[22px]" strokeWidth={1.8} aria-hidden />
        </span>
        <div className="min-w-0 text-[13.5px] leading-snug">
          <p className="text-[15px] font-medium text-ink">Beleg unlesbar</p>
          <p className="mt-0.5 text-ink-2">{ex.unreadable_reason ?? "Bitte das Original ansehen."}</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Ausgelesener Beleg" className="rounded-[24px] bg-surface-2 p-2">
      <div className="flex items-center gap-3.5 px-4 pt-3 pb-4">
        <Avatar name={supplier} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-ink-2">{supplier}</p>
          <p className="tnum text-[28px] leading-tight font-medium tracking-[-0.02em] text-ink">{ex.gross_total === null ? "Betrag fehlt" : formatEuro(ex.gross_total)}</p>
        </div>
        {invoice.ok && (
          <Badge tone="good" size="md">
            <Check aria-hidden />
            Summen stimmen
          </Badge>
        )}
      </div>
      <div className="rounded-[20px] bg-surface p-5">
        {errors.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.26 }}
            className="mb-5 rounded-[18px] bg-bad-soft px-4 py-3.5"
            role="note"
            aria-label="Prüfhinweis"
          >
            <Findings findings={errors} />
          </motion.div>
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
          <Tile label="Nummer">{ex.invoice_number ?? "fehlt"}</Tile>
          <Tile label="Datum">{ex.invoice_date ? formatDate(ex.invoice_date) : "fehlt"}</Tile>
          <div className="col-span-2 sm:col-span-1">
            <Tile label="IBAN">{ex.iban ? formatIban(ex.iban) : "keine"}</Tile>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[440px] text-[13.5px]">
            <caption className="sr-only">Positionen</caption>
            <thead>
              <tr className="text-left text-[12.5px] text-ink-3">
                <th className="py-2 pr-3 font-normal">Position</th>
                <th className="py-2 pr-3 text-right font-normal">Menge</th>
                <th className="py-2 pr-3 text-right font-normal">Preis</th>
                <th className="py-2 text-right font-normal">Gesamt</th>
              </tr>
            </thead>
            <tbody>
              {ex.line_items.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-2.5 pr-3 text-ink">{l.description}</td>
                  <td className="tnum py-2.5 pr-3 text-right text-ink-2">{l.quantity.toLocaleString("de-DE")}</td>
                  <td className="tnum py-2.5 pr-3 text-right text-ink-2">{formatEuro(l.unit_price)}</td>
                  <td className="tnum py-2.5 text-right text-ink">{formatEuro(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 mb-2 flex items-center gap-2">
          <h4 className="text-[13px] font-medium text-ink-3">Nachgerechnet</h4>
          <Tooltip content="Im Code in Cent, Steuer mit 1 Cent Toleranz">
            <button type="button" aria-label="Wie nachgerechnet wird" className="grid size-6 place-items-center rounded-full text-ink-3 hover:bg-surface-2 hover:text-ink">
              <Info className="size-3.5" aria-hidden />
            </button>
          </Tooltip>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[440px] border-separate border-spacing-y-1 text-[13.5px]">
            <caption className="sr-only">Summenprüfung</caption>
            <thead>
              <tr className="text-left text-[12.5px] text-ink-3">
                <th className="px-3 py-1 font-normal">Summe</th>
                <th className="px-3 py-1 text-right font-normal whitespace-nowrap">laut Beleg</th>
                <th className="px-3 py-1 text-right font-normal">berechnet</th>
                <th className="px-3 py-1 text-right font-normal">
                  <span className="sr-only">Ergebnis</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {totals.map((t, i) => {
                const ok = verdict(t);
                return (
                  <motion.tr
                    key={t.label}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.24, delay: 0.08 + i * 0.06 }}
                    className={cn("[&>td]:py-2.5 [&>td:first-child]:rounded-l-full [&>td:last-child]:rounded-r-full", ok === false ? "[&>td]:bg-bad-soft" : "[&>td]:bg-surface-2")}
                  >
                    <td className="px-3 whitespace-nowrap text-ink">{t.label}</td>
                    <td className="tnum px-3 text-right text-ink">{t.printed === null ? "fehlt" : formatCents(t.printed)}</td>
                    <td className="tnum px-3 text-right text-ink">{t.computed === null ? "fehlt" : formatCents(t.computed)}</td>
                    <td className="px-3 text-right text-[13px] whitespace-nowrap">
                      <Verdict ok={ok} />
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rest.length > 0 && (
          <div className="mt-4 rounded-[16px] bg-surface-2 p-4">
            <Findings findings={rest} />
          </div>
        )}
      </div>
    </section>
  );
}

function SentReply({ record }: { record: ProcessedMail }) {
  if (!record.draft || record.status === "awaiting_approval") return null;
  // A reply the owner asked for keeps the mail's own status (an invoice stays filed), so "sent" is its own flag.
  const sent = record.status === "sent" || !!record.draft.requested?.sentAt;
  const label = sent ? "Gesendete Antwort" : record.status === "delivery_failed" || record.status === "approved" ? "Freigegebene Antwort" : "Verworfener Entwurf";
  return (
    <section aria-label={label}>
      <SectionLabel>{label}</SectionLabel>
      <div className={cn("rounded-[22px] px-6 py-5", label === "Verworfener Entwurf" ? "bg-surface-2" : "bg-accent-soft")}>
        <p className="mb-2 text-[13.5px] font-medium text-ink">{record.draft.draft.subject}</p>
        <p className="text-[14px] leading-[1.7] whitespace-pre-wrap text-ink-2">{record.draft.draft.body}</p>
      </div>
    </section>
  );
}

function Reading({ record, editor }: { record: ProcessedMail; editor: EditorState | null }) {
  return (
    <>
      <Header record={record} />
      <div className="mt-7 flex flex-col gap-6">
        {record.invoice && <InvoiceCard invoice={record.invoice} />}
        <MailText record={record} label={editor && record.category === "inquiry" ? "Anfrage" : "Nachricht"} />
        {editor && <DraftEditor record={record} editor={editor} />}
        <SentReply record={record} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- status card

type Tone = "accent" | "bad" | "good" | "neutral";
const TONE_BG: Record<Tone, string> = { accent: "bg-accent-soft", bad: "bg-bad-soft", good: "bg-good-soft", neutral: "bg-surface-2" };
const TONE_ICON: Record<Tone, string> = { accent: "text-accent-text", bad: "text-bad", good: "text-good", neutral: "text-ink-2" };

function StatusFrame({ tone, icon: Icon, eyebrow, title, children }: { tone: Tone; icon: LucideIcon; eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <section aria-label="Status" className={cn("rounded-[24px] p-5", TONE_BG[tone])}>
      <div className="flex items-center gap-3.5">
        <motion.span
          initial={{ scale: 0.6, rotate: -20 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ type: "spring", duration: 0.45, bounce: 0.35 }}
          className={cn("grid size-12 shrink-0 place-items-center rounded-full bg-surface", TONE_ICON[tone])}
        >
          <Icon className="size-[22px]" strokeWidth={1.9} aria-hidden />
        </motion.span>
        <div className="min-w-0">
          <p className="text-[12.5px] text-ink-2">{eyebrow}</p>
          <p className="text-[19px] leading-tight font-medium tracking-[-0.01em] text-ink">{title}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

/** At most two reasons in view, the rest one click away. */
function Reasons({ findings }: { findings: Finding[] }) {
  const [all, setAll] = useState(false);
  if (findings.length === 0) return null;
  const shown = all ? findings : findings.slice(0, 2);
  return (
    <div className="mt-4">
      <Findings findings={shown} />
      {findings.length > 2 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="press mt-2.5 ml-6 rounded-full text-[12.5px] font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          {all ? "weniger" : `+${findings.length - 2} weitere`}
        </button>
      )}
    </div>
  );
}

function DraftDecision({ editor, sendRef }: { editor: EditorState; sendRef: React.RefObject<HTMLButtonElement | null> }) {
  const [confirm, setConfirm] = useState(false);
  const hints = editor.findings.filter((f) => f.severity !== "info").length;
  return (
    <StatusFrame tone="accent" icon={Send} eyebrow="Freigabe" title="Antwort bereit">
      {hints > 0 && (
        <p className="mt-4 flex items-center gap-2 text-[13.5px] font-medium text-bad">
          <TriangleAlert className="size-4" aria-hidden />
          {hints === 1 ? "1 Hinweis im Entwurf" : `${hints} Hinweise im Entwurf`}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-2">
        {editor.error && <ErrorNote message={editor.error} />}
        <Button ref={sendRef} variant="primary" size="lg" className="w-full" icon={<Send aria-hidden />} busy={editor.busy === "send"} disabled={editor.busy !== null} onClick={() => editor.run("send")}>
          {editor.dirty ? "Geändert senden" : "Senden"}
        </Button>
        <AnimatePresence initial={false} mode="wait">
          {confirm ? (
            <motion.div key="confirm" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="flex flex-col gap-2.5 rounded-[18px] bg-surface p-3.5">
              <p className="text-[13px] text-ink">{editor.requested ? "Es geht keine Antwort raus." : "Kunde bekommt keine Antwort."}</p>
              <div className="flex gap-2">
                <Button variant="danger" size="sm" busy={editor.busy === "discard"} onClick={() => editor.run("discard")}>
                  Verwerfen
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>
                  Behalten
                </Button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="actions" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="grid grid-cols-2 gap-2">
              <Button variant="outline" className="border-transparent" icon={<Save aria-hidden />} busy={editor.busy === "save"} disabled={!editor.dirty || editor.busy !== null} onClick={() => editor.run("save")}>
                Speichern
              </Button>
              <Button variant="danger-ghost" className="bg-surface hover:bg-bad-soft" icon={<Trash2 aria-hidden />} disabled={editor.busy !== null} onClick={() => setConfirm(true)}>
                Verwerfen
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
        <p className="mt-2 flex items-center justify-center gap-2 text-[12.5px] text-ink-2">
          <BrandGlyph brand="n8n" className="size-5" />
          Versand über n8n, erst nach Ihrem Klick
        </p>
      </div>
    </StatusFrame>
  );
}

function useAction(record: ProcessedMail, onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const refreshCounts = useRefreshCounts();
  const run = async (key: string, call: () => Promise<ProcessedMail | unknown>, message: (r: unknown) => string) => {
    setBusy(key);
    setError(null);
    try {
      const result = await call();
      toast(message(result));
      refreshCounts();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return { busy, error, run, id: record.id };
}

/**
 * "Antwort entwerfen" on a mail without a draft: the assistant writes one with the same checks as an intake
 * draft, and it waits in Freigabe until the owner sends it. Not shown where nothing may ever leave
 * (quarantine, suspicious mail) or where a reply already exists.
 */
function ReplyButton({ record, onReady, className }: { record: ProcessedMail; onReady: (id: string) => void; className?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const refreshCounts = useRefreshCounts();
  if (replyBlocked(record)) return null;
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api<ProcessedMail>(`/api/mails/${record.id}/reply`, { method: "POST" });
      const hints = updated.draft?.findings.filter((f) => f.severity !== "info").length ?? 0;
      toast(hints === 0 ? "Entwurf bereit" : `Entwurf bereit, ${hints === 1 ? "1 Hinweis" : `${hints} Hinweise`}`);
      refreshCounts();
      onReady(updated.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {error && <ErrorNote message={error} />}
      <Button variant="outline" className="w-full border-transparent" icon={<Reply aria-hidden />} busy={busy} disabled={busy} onClick={run}>
        {busy ? "Wird entworfen" : "Antwort entwerfen"}
      </Button>
    </div>
  );
}

function ReviewDecision({ record, onDone, onReplyReady }: { record: ProcessedMail; onDone: () => void; onReplyReady: (id: string) => void }) {
  const action = useAction(record, onDone);
  const quarantined = record.status === "quarantined";
  const shown = new Set(record.invoice?.findings.filter((f) => f.severity === "error").map((f) => f.message));
  const reasons = topReasons(
    record.reviewReasons.filter((f) => !shown.has(f.message)),
    6,
  );
  const canFile = record.status === "needs_review" && record.category === "invoice" && !!record.invoice?.extraction.readable;
  const title = quarantined
    ? "Quarantäne"
    : record.invoice && !record.invoice.extraction.readable
      ? "Beleg unlesbar"
      : record.invoice && !record.invoice.ok
        ? "Summen weichen ab"
        : "Bitte prüfen";
  const review = (kind: "file" | "close") =>
    action.run(
      kind,
      () => api(`/api/mails/${record.id}/review`, { method: "POST", body: { action: kind, note: kind === "file" ? "Nach Prüfung von Hand abgelegt" : "Geprüft und erledigt" } }),
      () => (kind === "file" ? "Rechnung abgelegt" : "Als erledigt markiert"),
    );
  return (
    <StatusFrame tone={quarantined ? "bad" : "accent"} icon={quarantined ? ShieldAlert : CircleAlert} eyebrow={quarantined ? "Gestoppt" : "Prüfen"} title={title}>
      <Reasons findings={reasons} />
      <ReplySentNote record={record} />
      <div className="mt-5 flex flex-col gap-2">
        {action.error && <ErrorNote message={action.error} />}
        {canFile && (
          <Button variant="primary" size="lg" className="w-full" icon={<FolderCheck aria-hidden />} busy={action.busy === "file"} disabled={action.busy !== null} onClick={() => review("file")}>
            Geprüft, ablegen
          </Button>
        )}
        <Button variant={canFile ? "outline" : "primary"} size={canFile ? "md" : "lg"} className={cn("w-full", canFile && "border-transparent")} icon={<SquareCheck aria-hidden />} busy={action.busy === "close"} disabled={action.busy !== null} onClick={() => review("close")}>
          {quarantined ? "Erledigt, nicht antworten" : "Erledigt"}
        </Button>
        <ReplyButton record={record} onReady={onReplyReady} />
      </div>
    </StatusFrame>
  );
}

function DeliveryFailed({ record, onDone }: { record: ProcessedMail; onDone: () => void }) {
  const action = useAction(record, onDone);
  return (
    <StatusFrame tone="bad" icon={CircleSlash} eyebrow="Versand" title="Nicht versendet">
      <p className="mt-4 text-[13px] leading-relaxed text-ink-2">n8n hat die Antwort nicht übernommen.</p>
      {action.error && <div className="mt-3"><ErrorNote message={action.error} /></div>}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          icon={<RotateCw aria-hidden />}
          busy={action.busy === "retry"}
          disabled={action.busy !== null}
          onClick={() =>
            action.run("retry", () => api<ProcessedMail>(`/api/mails/${record.id}/retry`, { method: "POST" }), (r) => ((r as ProcessedMail).status === "approved" ? "n8n hat den Versand übernommen" : "Versand weiter nicht möglich"))
          }
        >
          Erneut senden
        </Button>
        <Button
          variant="danger-ghost"
          className="bg-surface"
          icon={<Trash2 aria-hidden />}
          busy={action.busy === "discard"}
          disabled={action.busy !== null}
          onClick={() => action.run("discard", () => api(`/api/mails/${record.id}/discard`, { method: "POST", body: { reason: "Versand fehlgeschlagen, verworfen" } }), () => "Antwort verworfen")}
        >
          Verwerfen
        </Button>
      </div>
    </StatusFrame>
  );
}

/** Under a filed or closed mail: the reply the owner asked for went out (the mail kept its own status). */
function ReplySentNote({ record }: { record: ProcessedMail }) {
  if (!record.draft?.requested?.sentAt) return null;
  return (
    <p className="mt-4 flex items-center gap-2 text-[13.5px] font-medium text-good">
      <CheckCheck className="size-4" aria-hidden />
      Antwort gesendet
    </p>
  );
}

function StatusCard({
  record,
  editor,
  sendRef,
  onDone,
  onReplyReady,
}: {
  record: ProcessedMail;
  editor: EditorState | null;
  sendRef: React.RefObject<HTMLButtonElement | null>;
  onDone: () => void;
  onReplyReady: (id: string) => void;
}) {
  if (editor) return <DraftDecision editor={editor} sendRef={sendRef} />;
  if (record.status === "needs_review" || record.status === "quarantined") return <ReviewDecision record={record} onDone={onDone} onReplyReady={onReplyReady} />;
  if (record.status === "delivery_failed") return <DeliveryFailed record={record} onDone={onDone} />;
  const eyebrow = CATEGORY_LABEL[record.category];
  const after = (
    <>
      <ReplySentNote record={record} />
      <ReplyButton record={record} onReady={onReplyReady} className="mt-5" />
    </>
  );
  switch (record.status) {
    case "sent":
      return <StatusFrame tone="good" icon={CheckCheck} eyebrow={eyebrow} title="Gesendet" />;
    case "approved":
      return <StatusFrame tone="accent" icon={Send} eyebrow={eyebrow} title="Versand läuft" />;
    case "filed":
      return (
        <StatusFrame tone="neutral" icon={record.invoice ? FolderCheck : CircleCheck} eyebrow={eyebrow} title="Abgelegt">
          {after}
        </StatusFrame>
      );
    case "discarded":
      return (
        <StatusFrame tone="neutral" icon={Trash2} eyebrow={eyebrow} title="Verworfen">
          {after}
        </StatusFrame>
      );
    default:
      return (
        <StatusFrame tone="neutral" icon={SquareCheck} eyebrow={eyebrow} title="Erledigt">
          {after}
        </StatusFrame>
      );
  }
}

// ---------------------------------------------------------------- facts

function Fact({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const row = (
    <>
      <span className="shrink-0 text-ink-3">{label}</span>
      <span className="flex min-w-0 items-center justify-end gap-2 text-right text-ink">
        {value}
        {children && <ChevronDown className={cn("size-4 shrink-0 text-ink-3 transition-transform duration-200", open && "rotate-180")} aria-hidden />}
      </span>
    </>
  );
  if (!children) return <div className="flex h-11 items-center justify-between gap-4 px-3 text-[13.5px]">{row}</div>;
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="press flex h-11 w-full items-center justify-between gap-4 rounded-[14px] px-3 text-[13.5px] hover:bg-surface-2">
        {row}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease }} className="overflow-hidden">
            <div className="px-3 pt-1 pb-3">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniBar({ value }: { value: number }) {
  return (
    <span aria-hidden className="h-1.5 w-14 overflow-hidden rounded-full bg-track">
      <motion.span className="block h-full rounded-full bg-accent" initial={{ width: 0 }} animate={{ width: `${Math.round(value * 100)}%` }} transition={{ duration: 0.7, ease, delay: 0.1 }} />
    </span>
  );
}

const authOk = (v: string | null | undefined) => v === "pass";

function Facts({ record, editor }: { record: ProcessedMail; editor: EditorState | null }) {
  const cls = record.classification;
  const mock = record.steps.some((s) => s.model.startsWith("mock:"));
  const auth = record.mail.auth;
  const authPassed = !!auth && authOk(auth.spf) && authOk(auth.dkim) && authOk(auth.dmarc);
  const faqUsed = editor && record.draft ? FAQ.filter((f) => record.draft!.draft.used_faq_ids.includes(f.id)) : [];
  const replyTo = (record.mail.replyTo ?? record.mail.from).address;
  const rules = record.ruleFindings;
  return (
    <section aria-label="Einordnung" className="flex flex-col gap-1">
      <Fact
        label="Art"
        value={
          <span className="inline-flex items-center gap-2">
            <Dot className={cn("size-2.5", CATEGORY_COLOR[record.category].bg)} />
            {CATEGORY_LABEL[record.category]}
          </span>
        }
      >
        {cls && cls.reasons.length > 0 ? (
          <ul className="flex flex-col gap-1.5">
            {cls.reasons.map((r) => (
              <li key={r} className="text-[13px] leading-snug text-ink-2">
                {r}
              </li>
            ))}
            {cls.contains_instructions && <li className="text-[13px] text-bad">Modell meldet Anweisungen im Text.</li>}
          </ul>
        ) : (
          <p className="text-[13px] text-ink-2">Keine gültige Einordnung vom Modell.</p>
        )}
      </Fact>
      {cls && (
        <Fact
          label="Sicherheit"
          value={
            <span className="inline-flex items-center gap-2.5">
              <MiniBar value={cls.confidence} />
              <span className="tnum">{Math.round(cls.confidence * 100)} %</span>
            </span>
          }
        />
      )}
      <Fact
        label="Herkunft"
        value={
          auth ? (
            <span className={cn("inline-flex items-center gap-1.5", authPassed ? "text-good" : "text-bad")}>
              {authPassed ? <ShieldCheck className="size-4" aria-hidden /> : <ShieldAlert className="size-4" aria-hidden />}
              {authPassed ? "bestätigt" : "nicht bestätigt"}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ink-2">
              <ShieldQuestion className="size-4" aria-hidden />
              ohne Prüfkopf
            </span>
          )
        }
      >
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
          <dt className="text-ink-3">Antwort an</dt>
          <dd className="min-w-0 truncate text-right text-ink">{replyTo}</dd>
          {auth && (
            <>
              <dt className="text-ink-3">SPF, DKIM, DMARC</dt>
              <dd className="text-right text-ink">
                {auth.spf ?? "?"}, {auth.dkim ?? "?"}, {auth.dmarc ?? "?"}
              </dd>
            </>
          )}
        </dl>
      </Fact>
      <Fact
        label="Regeln"
        value={rules.length === 0 ? <span className="text-ink-2">keine Treffer</span> : <span className="font-medium text-bad">{rules.length === 1 ? "1 Treffer" : `${rules.length} Treffer`}</span>}
      >
        {rules.length > 0 ? <Findings findings={rules} /> : undefined}
      </Fact>
      {faqUsed.length > 0 && (
        <Fact
          label="Quellen"
          value={
            <span className="inline-flex items-center gap-1.5">
              <BookOpenText className="size-4 text-ink-3" aria-hidden />
              {faqUsed.length} FAQ
            </span>
          }
        >
          <ul className="flex flex-col gap-1.5">
            {faqUsed.map((f) => (
              <li key={f.id}>
                <Tooltip content={<span className="max-w-[260px] leading-snug font-normal">{f.answer}</span>} side="left">
                  <span tabIndex={0} className="block cursor-default rounded-[12px] bg-surface-2 px-3 py-2 text-[13px] text-ink-2 hover:text-ink">
                    {f.question}
                  </span>
                </Tooltip>
              </li>
            ))}
          </ul>
        </Fact>
      )}
      <Fact
        label="Modell"
        value={
          <span className="inline-flex items-center gap-2">
            <BrandGlyph brand="claude" />
            {mock ? "Testdaten" : record.steps.length === 1 ? "1 Schritt" : `${record.steps.length} Schritte`}
          </span>
        }
      >
        <ul className="flex flex-col gap-1.5 text-[13px]">
          {record.steps.map((s) => (
            <li key={s.step} className="flex items-center justify-between gap-3">
              <span className="text-ink-2">{STEP_LABEL[s.step] ?? s.step}</span>
              <span className={cn("truncate", s.ok ? "text-ink" : "text-bad")}>{s.ok ? s.model.replace(/^mock:/, "") : (s.error ?? "Fehler")}</span>
            </li>
          ))}
          {record.status === "quarantined" && <li className="text-ink-2">Danach kein weiterer Modellaufruf.</li>}
        </ul>
      </Fact>
    </section>
  );
}

function Attachments({ record }: { record: ProcessedMail }) {
  if (record.mail.attachments.length === 0) return null;
  return (
    <section aria-label="Anhänge">
      <ul className="flex flex-col gap-1">
        {record.mail.attachments.map((a) => (
          <li key={a.index} className="flex items-center gap-3 rounded-[16px] bg-surface-2 py-2 pr-2 pl-3 text-[13px]">
            <Paperclip className="size-4 shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-ink">{a.filename}</span>
            <span className="tnum shrink-0 text-[12px] text-ink-3">{a.accepted ? `${Math.max(1, Math.round(a.size / 1024))} KB` : "abgelehnt"}</span>
            {a.accepted && (
              <a
                href={`/api/mails/${record.id}/attachments/${a.index}`}
                className="press grid size-8 shrink-0 place-items-center rounded-full bg-surface text-ink-2 hover:text-ink"
                aria-label={`${a.filename} herunterladen`}
              >
                <Download className="size-4" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------- history

function ActorMark({ actor }: { actor: AuditEvent["actor"] }) {
  if (actor === "n8n") return <BrandLogo brand="n8n" size={32} />;
  if (actor === "system") return <BrandLogo brand="claude" size={32} />;
  return <Avatar name="Jonas Hofmann" size="sm" />;
}

const ACTOR_LABEL: Record<string, string> = { owner: "Jonas Hofmann", n8n: "n8n", system: "Assistent" };
const timeShort = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" });

function Timeline({ events }: { events: AuditEvent[] }) {
  if (events.length === 0) return null;
  return (
    <section aria-label="Verlauf">
      <h3 className="mb-2 px-3 text-[13px] font-medium text-ink-3">Verlauf</h3>
      <ol className="relative flex flex-col gap-1 before:absolute before:top-5 before:bottom-5 before:left-[27px] before:w-px before:bg-line">
        {events.map((e, i) => (
          <motion.li key={e.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: i * 0.05 }}>
            <Tooltip content={<span className="max-w-[280px] leading-snug font-normal">{e.detail ? sentence(e.detail) : ACTOR_LABEL[e.actor]}</span>} side="left">
              <div tabIndex={0} className="relative flex items-center gap-3 rounded-[14px] px-3 py-1.5 outline-none hover:bg-surface-2 focus-visible:bg-surface-2">
                <span className="relative rounded-full ring-4 ring-surface">
                  <ActorMark actor={e.actor} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{EVENT_LABEL[e.action] ?? e.action}</span>
                <span className="tnum shrink-0 text-[12px] text-ink-3">{timeShort.format(new Date(e.at))}</span>
              </div>
            </Tooltip>
          </motion.li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------- pane

function ActionColumn({
  record,
  events,
  editor,
  sendRef,
  onDone,
  onReplyReady,
}: {
  record: ProcessedMail;
  events: AuditEvent[];
  editor: EditorState | null;
  sendRef: React.RefObject<HTMLButtonElement | null>;
  onDone: () => void;
  onReplyReady: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-5 p-3">
      <StatusCard record={record} editor={editor} sendRef={sendRef} onDone={onDone} onReplyReady={onReplyReady} />
      <Facts record={record} editor={editor} />
      <Attachments record={record} />
      <Timeline events={events} />
    </div>
  );
}

/**
 * One mail's content in the cross-fade. While it fades out it is still visible but takes no clicks or focus:
 * its buttons belong to the previous mail, and a click there would act on that mail.
 */
function FadeSwap({ children }: { children: ReactNode }) {
  const present = useIsPresent();
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }} inert={!present}>
      {children}
    </motion.div>
  );
}

function Loaded({
  record,
  events,
  back,
  onDone,
  onReplyReady,
  stale,
}: {
  record: ProcessedMail;
  events: AuditEvent[];
  back: { to: string; label: string };
  onDone: () => void;
  onReplyReady: (id: string) => void;
  /** The previous mail, still shown while the next one loads: visible for the cross-fade, but not clickable. */
  stale: boolean;
}) {
  const editor = useDraftEditor(record, onDone);
  const wide = useWide();
  const sendRef = useRef<HTMLButtonElement>(null);
  // "e" only moves the focus to the send button; sending stays an explicit Enter or click.
  useShortcuts(editor ? { e: () => sendRef.current?.focus() } : {});
  const fade = (key: string, children: ReactNode) => (
    <AnimatePresence mode="wait" initial={false}>
      <FadeSwap key={key}>{children}</FadeSwap>
    </AnimatePresence>
  );
  return (
    <div className="flex h-full gap-3" inert={stale} aria-busy={stale || undefined}>
      <Panel as="article" className="min-w-0 flex-1" aria-label="Mail">
        <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">
          {fade(
            record.id,
            <div className="px-5 py-6 sm:px-9 sm:py-8">
              <BackButton to={back.to} label={back.label} />
              <Reading record={record} editor={editor} />
              {!wide && (
                <div className="-mx-3 mt-6">
                  <ActionColumn record={record} events={events} editor={editor} sendRef={sendRef} onDone={onDone} onReplyReady={onReplyReady} />
                </div>
              )}
            </div>,
          )}
        </div>
      </Panel>
      {wide && (
        <Panel as="aside" className="w-[340px] shrink-0" aria-label="Aktionen">
          <div className="scroll-quiet min-h-0 flex-1 overflow-y-auto">{fade(`${record.id}-aside`, <ActionColumn record={record} events={events} editor={editor} sendRef={sendRef} onDone={onDone} onReplyReady={onReplyReady} />)}</div>
        </Panel>
      )}
    </div>
  );
}

/**
 * Loads one mail and shows it; keeps the previous one while the next loads, so the pane cross-fades instead of flashing.
 * `onReplyReady` runs when the owner's "Antwort entwerfen" produced a draft (the mailbox then opens it in Freigabe).
 */
export function MailDetail({ id, back, onDone, onReplyReady }: { id: string; back: { to: string; label: string }; onDone: () => void; onReplyReady?: (id: string) => void }) {
  const { data, error, errorStatus, reload } = useApi<{ record: ProcessedMail; events: AuditEvent[] }>(`/api/mails/${id}`);
  const last = useRef(data);
  if (data) last.current = data;
  const shown = data ?? last.current;

  if (error) {
    return (
      <Panel>
        <div className="p-6">
          <BackButton to={back.to} label={back.label} />
          {errorStatus === 404 || errorStatus === 400 ? (
            <EmptyState icon={X} title="Diese Mail gibt es nicht (mehr)." action={<Button onClick={() => navigate("/posteingang")}>Zum Posteingang</Button>} />
          ) : (
            <ErrorNote message={error} onRetry={reload} />
          )}
        </div>
      </Panel>
    );
  }
  if (!shown) return <ReaderSkeleton />;
  return (
    <Loaded
      record={shown.record}
      events={shown.events}
      back={back}
      onDone={() => {
        reload();
        onDone();
      }}
      onReplyReady={(drafted) => {
        reload();
        onReplyReady?.(drafted);
      }}
      stale={shown.record.id !== id}
    />
  );
}
