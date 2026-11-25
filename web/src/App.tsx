import { MailQuestion } from "lucide-react";
import { MotionConfig } from "motion/react";
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { EmptyState } from "./components/common";
import { AppShell, PageScroll, usePageTitle } from "./components/shell/AppShell";
import { Button } from "./components/ui/button";
import { Skeleton } from "./components/ui/misc";
import { ToastProvider } from "./components/ui/toast";
import { TooltipProvider } from "./components/ui/tooltip";
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
      <div aria-busy="true" aria-label="Wird geladen" className="flex flex-col gap-4">
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
        <EmptyState icon={MailQuestion} title="Diese Ansicht konnte nicht angezeigt werden.">
          Die Daten sind nicht betroffen. Bitte neu laden.
        </EmptyState>
      </PageScroll>
    );
  }
}

function NotFoundPage() {
  usePageTitle("Seite nicht gefunden");
  return (
    <PageScroll className="grid min-h-full place-items-center">
      <EmptyState
        icon={MailQuestion}
        title="Diese Seite gibt es nicht."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="primary" onClick={() => navigate("/")}>
              Zur Übersicht
            </Button>
            <Button onClick={() => navigate("/freigabe")}>Zum Posteingang</Button>
          </div>
        }
      >
        Der Link ist veraltet.
      </EmptyState>
    </PageScroll>
  );
}

function RouteSwitch({ path }: { path: string }) {
  const id = path.split("/")[2];
  if (path === "/") return <OverviewPage />;
  if (path === "/freigabe" || path.startsWith("/freigabe/")) return <MailboxPage tab="freigabe" selectedId={id} />;
  if (path === "/pruefliste" || path.startsWith("/pruefliste/")) return <MailboxPage tab="pruefen" selectedId={id} />;
  if (path === "/posteingang") return <MailboxPage tab="alle" />;
  if (path.startsWith("/mail/")) return <MailboxPage tab="alle" selectedId={id ?? ""} />;
  if (path === "/rechnungen") return <InvoicesPage />;
  if (path === "/abgleich") return <ReconcilePage />;
  if (path === "/woche") return <WeeklyPage />;
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

  useEffect(() => {
    api<Session>("/api/auth/session").then((s) => {
      setCsrfToken(s.csrfToken);
      setSession(s);
    });
    return onUnauthorized(() => setSession((s) => (s ? { ...s, authenticated: false, csrfToken: null } : s)));
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" }).catch(() => {});
    setCsrfToken(null);
    setSession((s) => (s ? { ...s, authenticated: false, csrfToken: null } : s));
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
