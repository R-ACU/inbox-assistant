# Decisions

Why the assistant is built the way it is, what the model may and may not do, and what happens when something fails.

## What the model does, and nothing more

| Job | Model | Why this model |
| :--- | :--- | :--- |
| Sort a mail into invoice, inquiry, other, suspicious | Claude Haiku 5.5, effort low | Short input, a fixed set of labels, runs on every mail: the cheap, fast model is enough. |
| Read an invoice or contract PDF | Claude Sonnet 5.5, effort medium | Layout, tables and poor scans need the stronger model. |
| Draft a reply from the FAQ | Claude Sonnet 5.5, effort medium | German (or, in the English deployment, Irish English) business tone, and it must stay inside the FAQ. |
| Draft a reply the owner asks for ("Antwort entwerfen") | Claude Sonnet 5.5, effort medium | Same job on any kind of mail; it may only use the mail, the FAQ and the notes of the code's own checks. |

The model **may not**: send anything, pay anything, change a record, compute a total, pick the recipient, decide that an invoice is correct, or release a mail from quarantine. None of this is a prompt rule only: there are no tools on any request, the model's answer is parsed against a schema, and every decision after that is code.

## Decisions

**1. Code orchestrates, the model answers three narrow questions.** The pipeline in `src/core/pipeline.ts` decides the order of steps and the outcome. A general agent with tools would be shorter to write and much harder to test, and its failure modes (a tool call nobody expected) are exactly the ones a business owner cannot afford here.

**2. The model never does arithmetic.** It copies printed values; `src/core/invoice-check.ts` recomputes line totals, net, VAT and gross in integer cents with commercial rounding and one cent of tolerance for VAT rounding. The prompt even says "if the totals do not add up, return them as printed", so a model that "helpfully" corrects a number cannot hide an error.

**3. Rules can only make an outcome stricter.** A deterministic scan runs before the model. A hit with severity error (instruction to an AI, spoofed display name) quarantines the mail even if the model calls it a harmless invoice. Warnings (payment pressure, new bank details, mixed scripts) send an invoice to review instead of filing it. The same holds for the invoice check: only an invoice without any error or warning is filed automatically. An unknown supplier, a name that looks like a known one ("Nordlichtt" for "Nordlicht") or a known supplier writing from a foreign domain always goes to review, because that is exactly what "new bank details, please pay" fraud looks like. There is no path where a rule makes a mail look safer.

**4. Structured output, validated twice.** Requests use structured outputs from Zod schemas, and the pipeline parses the answer again with the same schemas before using it. A malformed answer, a refusal, a cut-off answer or an API error becomes a review item with the reason, never a guess.

**5. Low confidence is not trusted.** Below 60 % the category goes to review. Choosing a threshold is a business decision; 60 % is a starting point that the real eval should tune.

**6. Draft replies are checked for facts.** Every amount (also "2400,-"), percentage, duration, time, distance and area in a draft must appear in a FAQ entry the draft claims to use, or in the customer's own mail. As a second net, every other number (dates like "03.12.", times like "7:30") must appear somewhere in those sources; the company signature is exempt. Links count as the company's own only if their host is the company domain or a subdomain of it. Unknown FAQ ids, foreign links and bank details are flagged. The owner sees these flags next to the draft. This catches the most common real failure (a plausible invented price or surcharge) without a second model call.

**7. Approval is the only way out, and n8n fetches what was approved.** When the owner clicks "Senden", the assistant resumes the waiting n8n run with an empty call. n8n then fetches recipient, subject and text from the assistant with a signed request and sends exactly that. The resume call itself carries no data, so a forged resume can at most trigger a fetch that returns 409.

**8. Replies go to the sender address.** A Reply-To on another domain is a classic phishing trick; it is flagged and ignored for the reply.

**9. n8n for the flow, TypeScript for the logic.** n8n makes the flow visible and changeable for someone who does not read code (intake, wait, send), and it is what the target teams use. Everything that must be right (checks, signatures, state machine) is in TypeScript with tests. The workflow has no code nodes and no secrets; three credentials are referenced by name.

**10. HMAC with timestamp, method and path, plus replay protection.** A shared header token would work, but a captured request could be replayed forever and against any endpoint. Signing `timestamp.METHOD.path.body` and rejecting anything older than five minutes or seen before closes both. n8n computes it with its built-in Crypto node, the secret lives in n8n's encrypted credential store.

**11. SQLite from Node itself.** `node:sqlite` needs no native add-on and no database server, which keeps the demo installable everywhere. One business, a few hundred mails a month: SQLite is not the bottleneck. Mail records are JSON with indexed status columns because the shape is owned by the pipeline and changes with it.

**12. A mock provider that is honest.** Mock answers are keyed by Message-ID and file hash. An unknown file gets "no mock answer", never invented data. The eval states in its output that mock numbers are a pipeline test.

**13. HTML is never rendered.** Mail HTML is converted to text before storage. Hidden text (`display:none`) becomes visible to the owner and to the rule scan, which is how the injection test mail is caught.

**14. The weekly view and the review list are views, not reports.** They are computed from the stored records on request, so they can never disagree with the inbox.

**15. One calm look, the company only picks the accent.** The demo is shown to different companies (`?firma=<slug>`), but copying their websites made the tool look like a theme kit, not a product. So layout, type (Allo, self-hosted) and surfaces stay the same, and each company gets one cool accent colour in a light and a dark variant. All colours come from CSS variables; components only use the tokens. The URL value is a lookup key into a fixed list and never reaches HTML or CSS itself, anything unknown falls back to the neutral blue. The light or dark choice is kept in local storage and only ever read as `dark` or not. Contrast is a test, not a promise: token pairs (and the hue of every accent) are checked in Vitest, every visible text of the rendered pages in Playwright, for each accent in both modes.

**16. One mailbox, one decision per mail, pictures before words.** Approval queue, review list and all mail used to be three separate areas, and a draft's classification and history lived on yet another page, so the owner had to click around. Now they are three tabs of one list (`/freigabe`, `/pruefliste`, `/posteingang`, each with its own URL), and every mail opens in the same reading pane: the draft is edited there, the invoice is checked there, the suspicious mail is closed there. The action column starts with the one decision the mail needs; classification, origin check, rules, sources and model steps follow as short label and value rows that open on click. Senders appear as faces (initials) or trade icons, Claude and n8n as their official logos, the week as a calendar, shares as rings and continuous bars; labels have one to three words. The owner should understand a screen at a glance, like a banking app.

**17. Replies on request reuse the approval step and leave the mail's own status alone.** The owner can ask for a reply to any mail that is not suspicious. While it waits, the mail is "awaiting_approval" like an intake draft, so the Freigabe tab, the double-click protection, discard and the audit trail work unchanged. The draft remembers where the mail came from (`requested.from`), and after sending or discarding the mail goes back there: a filed invoice stays filed and keeps counting in the invoice totals, a review item stays on the review list until the owner decides it. Only an inquiry whose first draft was discarded counts as answered afterwards. Views that do bookkeeping read the settled status (`src/core/reply.ts`), and the automation numbers on the overview ignore these drafts: they are the owner's work, not the assistant's. The model gets short notes from the code's own checks (what was read from the invoice, the recomputed difference), so a reply to a supplier can name the exact numbers, and the fact check accepts them as sources. The n8n run of such a mail ended long ago, so the approved reply goes to the outbox folder; sending it by SMTP needs a second entry point in the workflow.

**18. One deployment, one language, one tenant.** The English demo is the same app with `APP_LOCALE=en`, not a language switch in the UI: an English visitor should meet an English business, not a German one with translated buttons. So the locale picks a whole tenant (`src/tenant/`): company, FAQ, suppliers with Irish IBANs, the allowed VAT rates (23, 13.5, 9 and 0 % instead of 19, 7 and 0 %), the time zone, and its own test set with the same four traps. Everything the owner reads follows it: check results, review reasons, audit trail, error messages, the prompts' output language, the app shell's `lang` (set by the server before the first byte, so the UI never renders in the wrong language first) and the URL paths. The draft check knows both ways of writing amounts ("9 €" and "€9"). Identifiers stay as they are in both languages (audit action slugs, finding codes), so stored data and tests do not depend on the language.

## What happens when something fails

| Failure | Outcome |
| :--- | :--- |
| API down, rate limit, refusal, cut-off answer | Mail goes to the review list with the reason. Retry is a new ingest. |
| Answer does not match the schema | Discarded, mail goes to review. |
| Unreadable scan | Model sets `readable: false`, code sends it to review, no digits are guessed. |
| Totals do not add up, IBAN changed, duplicate number | Review list with the exact difference. The owner can file it after checking. |
| n8n not reachable or answers with an error on approval (for example 404 after the Wait node expired) | The mail is marked "Versand fehlgeschlagen" with the HTTP status in the log. The owner can retry the hand-over or discard the reply and send it by hand. Nothing is reported as sent that was not. |
| n8n run never resumed | The Wait node gives up after 7 days. |
| "Senden" clicked twice (double click, second tab) | The status changes atomically before anything is written or resumed; the second click gets 409. |
| The model fails or answers out of schema while drafting a requested reply | Nothing changes on the mail; the owner sees "Bitte noch einmal versuchen" (in mock mode: no fixed answer for this mail). |
| The mail changed while the model wrote a requested reply (filed or closed in a second tab) | The draft is dropped with 409; the mail keeps its new state. |
| Same mail delivered twice | Same Message-ID and same bytes: same record, the second delivery is a no-op. Same Message-ID with other bytes: accepted as a separate mail and flagged, so a sender cannot block a later mail by reusing its Message-ID. |
