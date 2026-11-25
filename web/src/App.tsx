import { MailQuestion } from "lucide-react";
import { MotionConfig } from "motion/react";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "./components/common";
import { AppShell, PageScroll, usePageTitle } from "./components/shell/AppShell";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/misc";
import { ToastProvider } from "./components/ui/toast";
import { TooltipProvider } from "./components/ui/tooltip";
import { ROUTES, t } from "./i18n";
import { api, navigate, onUnauthorized, setCsrfToken, usePath } from "./lib";
import { LoginPage, type Session } from "./pages/Login";

// Each view is its own chunk, so the first page only loads what it shows.
const OverviewPage = lazy(() => import("./pages/Overview").then((m) => ({ default: m.OverviewPage })));
const MailboxPage = lazy(() => import("./pages/Mailbox").then((m) => ({ default: m.MailboxPage })));
const InvoicesPage = lazy(() => import("./pages/Invoices").then((m) => ({ default: m.InvoicesPage })));
const ReconcilePage = lazy(() => import("./pages/Reconcile").then((m) => ({ default: m.ReconcilePage })));
const WeeklyPage = lazy(() => import("./pages/Weekly").then((m) => ({ default: m.WeeklyPage })));

function ViewSkeleton() {
  return (
    <PageScroll>
      <div aria-busy="true" aria-label={t("Wird geladen", "Loading")} className="flex flex-col gap-4">
        <Skeleton className="h-9 w-56 rounded-full" />
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-[360px] rounded-[28px] lg:col-span-7" />
          <Skeleton className="h-[360px] rounded-[28px] lg:col-span-5" />
        </div>
      </div>
    </PageScroll>
  );
}

/** Keeps a rendering error inside one view instead of blanking the whole app. */
class PageBoundary extends Component<{ path: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidUpdate(prev: { path: string }) {
    if (prev.path !== this.props.path && this.state.failed) this.setState({ failed: false });
  }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <PageScroll>
        <EmptyState icon={MailQuestion} title={t("Diese Ansicht konnte nicht angezeigt werden.", "This view could not be shown.")}>
          {t("Die Daten sind nicht betroffen. Bitte neu laden.", "Your data is safe. Please reload.")}
        </EmptyState>
      </PageScroll>
    );
  }
}

function NotFoundPage() {
  usePageTitle(t("Seite nicht gefunden", "Page not found"));
  return (
    <PageScroll className="grid min-h-full place-items-center">
      <EmptyState
        icon={MailQuestion}
        title={t("Diese Seite gibt es nicht.", "This page does not exist.")}
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => navigate(ROUTES.overview)}>
              {t("Zur Übersicht", "To overview")}
            </Button>
            <Button onClick={() => navigate(ROUTES.approval)}>{t("Zum Posteingang", "To inbox")}</Button>
          </div>
        }
      >
        {t("Der Link ist veraltet.", "The link is out of date.")}
      </EmptyState>
    </PageScroll>
  );
}

function RouteSwitch({ path }: { path: string }) {
  const id = path.split("/")[2];
  if (path === ROUTES.overview) return <OverviewPage />;
  if (path === ROUTES.approval || path.startsWith(`${ROUTES.approval}/`)) return <MailboxPage tab="freigabe" selectedId={id} />;
  if (path === ROUTES.review || path.startsWith(`${ROUTES.review}/`)) return <MailboxPage tab="pruefen" selectedId={id} />;
  if (path === ROUTES.inbox) return <MailboxPage tab="alle" />;
  if (path.startsWith(`${ROUTES.mail}/`)) return <MailboxPage tab="alle" selectedId={id ?? ""} />;
  if (path === ROUTES.invoices) return <InvoicesPage />;
  if (path === ROUTES.reconcile) return <ReconcilePage />;
  if (path === ROUTES.week) return <WeeklyPage />;
  return <NotFoundPage />;
}

function Routes() {
  const path = usePath();
  return (
    <PageBoundary path={path}>
      <Suspense fallback={<ViewSkeleton />}>
        <RouteSwitch path={path} />
      </Suspense>
    </PageBoundary>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  // Only a public demo deployment sends this (PUBLIC_DEMO_PASSWORD); kept for the login page after a logout.
  const [demoPassword, setDemoPassword] = useState<string | null>(null);

  useEffect(() => {
    api<Session>("/api/auth/session").then((s) => {
      setCsrfToken(s.csrfToken);
      setDemoPassword(s.demoPassword ?? null);
      setSession(s);
    });
    return onUnauthorized(() => {
      setSession((s) => (s ? { ...s, authenticated: false, csrfToken: null } : s));
      loadDemoPassword();
    });
  }, []);

  // A page opened while signed in has no demo password yet (the server only sends it to visitors who are
  // signed out), so it is fetched once the visitor is signed out again.
  const loadDemoPassword = () => {
    api<Session>("/api/auth/session")
      .then((s) => {
        if (!s.authenticated) setDemoPassword(s.demoPassword ?? null);
      })
      .catch(() => {});
  };

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setCsrfToken(null);
    setSession((s) => (s ? { ...s, authenticated: false, csrfToken: null } : s));
    loadDemoPassword();
  };

  return (
    <MotionConfig reducedMotion="user">
      <TooltipProvider>
        {!session ? (
          <div className="mx-auto flex max-w-md flex-col gap-3 px-6 py-24" aria-busy="true">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : !session.authenticated ? (
          <LoginPage
            demoPassword={demoPassword}
            onDone={(s) => {
              setCsrfToken(s.csrfToken);
              setSession(s);
            }}
          />
        ) : (
          <ToastProvider>
            <AppShell mode={session.mode} onLogout={logout}>
              <Routes />
            </AppShell>
          </ToastProvider>
        )}
      </TooltipProvider>
    </MotionConfig>
  );
}
