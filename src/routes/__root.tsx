import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { configureSupabase } from "@/integrations/supabase/client";

const DEFAULT_SUPABASE_CONFIG = {
  url: "https://uikjvsfdcomkamjazjyq.supabase.co",
  publishableKey: "sb_publishable_kibF6dvgyq6Fqh4BJE4s7A_j6_uUrWH",
};

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/menu"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Open main menu
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or open the main menu.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/menu"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Main menu
          </a>
        </div>
      </div>
    </div>
  );
}

const getPublicSupabaseConfig = createServerFn({ method: "GET" }).handler(async () => {
  return {
    url: process.env.SUPABASE_URL || DEFAULT_SUPABASE_CONFIG.url,
    publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_CONFIG.publishableKey,
  };
});

const SOCIAL_IMAGE =
  "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/64ef8a7e-f1f2-4853-82a0-93052d8f91f2/id-preview-df845111--4643c934-856e-487c-b22f-b0ba8a7abd8c.lovable.app-1784590112283.png";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  loader: () => getPublicSupabaseConfig(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Ambunctious Tracker — X posts & price alerts" },
      {
        name: "description",
        content:
          "Monitor X accounts, Roblox activity and Eldorado listing prices with automatic one-minute scans and Discord alerts.",
      },
      { property: "og:title", content: "Ambunctious Tracker — X posts & price alerts" },
      {
        property: "og:description",
        content:
          "Monitor X accounts, Roblox activity and Eldorado listing prices with automatic one-minute scans and Discord alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Ambunctious Tracker — X posts & price alerts" },
      {
        name: "twitter:description",
        content: "Automatic one-minute monitoring with Discord alerts.",
      },
      { property: "og:image", content: SOCIAL_IMAGE },
      { name: "twitter:image", content: SOCIAL_IMAGE },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function OneMinuteScanUiSync() {
  useEffect(() => {
    const update = () => {
      const remaining = 60 - (Math.floor(Date.now() / 1000) % 60);
      const value = `00:${remaining.toString().padStart(2, "0")}`;
      const progress = `${(remaining / 60) * 100}%`;
      document
        .querySelectorAll<HTMLElement>(".countdown-node strong, .top-countdown strong")
        .forEach((element) => {
          element.textContent = value;
        });
      document
        .querySelectorAll<HTMLElement>(".countdown-node i b, .top-countdown i b")
        .forEach((element) => {
          element.style.width = progress;
        });
      document.querySelectorAll<HTMLElement>("p, span, small").forEach((element) => {
        if (element.children.length) return;
        const text = element.textContent ?? "";
        const next = text
          .replace(/Five-minute scans\.?/gi, "One-minute scans.")
          .replace(/Checked every 5 minutes/gi, "Checked every 60 seconds")
          .replace(/SECURE FIVE-MINUTE CYCLE/gi, "SECURE 60-SECOND CYCLE")
          .replace(/05 MIN/g, "60 SEC");
        if (next !== text) element.textContent = next;
      });
    };
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, []);
  return null;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const publicSupabaseConfig = Route.useLoaderData();
  configureSupabase(publicSupabaseConfig);
  const tabClass =
    "inline-flex h-11 min-w-24 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold text-muted-foreground transition hover:bg-white/5 hover:text-foreground";
  const activeTabClass =
    "bg-primary text-primary-foreground shadow-lg hover:bg-primary hover:text-primary-foreground";

  return (
    <QueryClientProvider client={queryClient}>
      <OneMinuteScanUiSync />
      <nav
        aria-label="Primary navigation"
        className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/15 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl"
      >
        <Link
          to="/"
          className={tabClass}
          activeProps={{ className: `${tabClass} ${activeTabClass}` }}
        >
          ⌂ Dashboard
        </Link>
        <Link
          to="/menu"
          className={tabClass}
          activeProps={{ className: `${tabClass} ${activeTabClass}` }}
        >
          ☰ Menu
        </Link>
        <Link
          to="/supabase-settings"
          className={tabClass}
          activeProps={{ className: `${tabClass} ${activeTabClass}` }}
        >
          ⚙ Supabase
        </Link>
      </nav>
      <div className="pb-24">
        <Outlet />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}
