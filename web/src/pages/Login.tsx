import { Calculator, KeyRound, Send, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { BrandMark, DemoNote, ModeToggle, usePageTitle } from "../components/shell/AppShell";
import { Button } from "../components/ui/button";
import { Label } from "../components/ui/input";
import { PasswordInput } from "../components/ui/password-input";
import { ApiError, api } from "../lib";

export interface Session {
  authenticated: boolean;
  csrfToken: string | null;
  mode: "mock" | "claude";
}

const PROMISES = [
  { icon: Calculator, text: "Rechnungen auf den Cent geprüft" },
  { icon: Send, text: "Antworten erst nach Ihrem Klick" },
  { icon: ShieldCheck, text: "Betrugsversuche in Quarantäne" },
];

const ease = [0.23, 1, 0.32, 1] as const;

export function LoginPage({ onDone }: { onDone: (s: Session) => void }) {
  usePageTitle("Anmelden");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await api<Session>("/api/auth/login", { method: "POST", body: { password } }));
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Das Passwort stimmt nicht." : (err as Error).message);
      setShake((s) => s + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,1.2fr)_minmax(460px,1fr)]">
      {/* Photo with a frosted panel. The background colour is close to the photo, so nothing flashes while it loads. */}
      <aside className="relative h-[300px] overflow-hidden bg-[#a9b6c2] lg:m-3 lg:h-auto lg:rounded-[32px]">
        <motion.img
          src="/img/login-malerraum.webp"
          alt=""
          decoding="async"
          className="absolute inset-0 size-full object-cover"
          initial={{ scale: 1.04, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.9, ease }}
        />
        <motion.div
          className="glass absolute inset-x-4 bottom-4 rounded-[28px] p-5 shadow-pop sm:inset-x-8 sm:bottom-8 sm:p-8 lg:right-auto lg:bottom-10 lg:left-10 lg:w-[min(580px,calc(100%-80px))]"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease, delay: 0.25 }}
        >
          <p className="text-[13px] font-medium text-glass-ink-2">Malerbetrieb Hofmann &amp; Kraft</p>
          <p className="mt-1.5 text-[26px] leading-tight font-semibold tracking-[-0.02em] sm:text-[30px]">Weniger Büro. Mehr Baustelle.</p>
          <ul className="mt-6 hidden flex-wrap gap-2 sm:flex">
            {PROMISES.map(({ icon: Icon, text }, i) => (
              <motion.li
                key={text}
                className="flex items-center gap-2 rounded-full bg-surface-2 py-1.5 pr-3.5 pl-1.5 text-[13.5px] font-medium text-glass-ink"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease, delay: 0.4 + i * 0.07 }}
              >
                <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent-soft">
                  <Icon className="size-[15px] text-accent-text" aria-hidden />
                </span>
                {text}
              </motion.li>
            ))}
          </ul>
        </motion.div>
      </aside>

      <main className="flex flex-col">
        <header className="flex h-[72px] items-center justify-between px-6 sm:px-10">
          <div className="flex items-center gap-3">
            <BrandMark size={36} />
            <span className="leading-tight">
              <span className="block text-[14px] font-semibold text-ink">Hofmann &amp; Kraft</span>
              <span className="block text-[12.5px] text-ink-3">Posteingang-Assistent</span>
            </span>
          </div>
          <div className="flex items-center gap-3">
            <DemoNote className="hidden sm:block" />
            <ModeToggle />
          </div>
        </header>
        <div className="grid flex-1 place-items-center px-6 py-10 sm:px-10">
          <motion.form
            onSubmit={submit}
            className="w-full max-w-[380px]"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease, delay: 0.1 }}
          >
            <h1 className="text-[30px] leading-tight font-medium tracking-[-0.03em] text-ink">Willkommen zurück</h1>
            <p className="mt-2 mb-8 text-[14px] text-ink-2">Ihr Posteingang ist sortiert.</p>
            <Label htmlFor="password">Passwort</Label>
            <motion.div key={shake} animate={shake ? { x: [0, -6, 6, -4, 4, 0] } : undefined} transition={{ duration: 0.32 }}>
              <PasswordInput
                id="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-12 text-[15px]"
                aria-invalid={error ? true : undefined}
              />
            </motion.div>
            {error && (
              <motion.p role="alert" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 text-[13px] text-bad">
                {error}
              </motion.p>
            )}
            <Button type="submit" variant="primary" busy={busy} disabled={!password} size="lg" className="mt-5 h-12 w-full" icon={<KeyRound aria-hidden />}>
              Anmelden
            </Button>
            <p className="mt-6 text-[12.5px] text-ink-3">Testsystem mit erfundenen Daten.</p>
            <DemoNote className="mt-3 sm:hidden" />
          </motion.form>
        </div>
        <p className="px-6 pb-5 text-[12px] text-ink-3 sm:px-10">Bild: für diese Demo erzeugt, siehe Credits</p>
      </main>
    </div>
  );
}
