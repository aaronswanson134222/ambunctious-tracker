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
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
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
          Something went wrong on our end. You can try refreshing or head back home.
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
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

const getPublicSupabaseConfig = createServerFn({ method: "GET" }).handler(async () => {
  const url = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) throw new Error("Supabase is not configured");
  return { url, publishableKey };
});

const SOCIAL_IMAGE = "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/64ef8a7e-f1f2-4853-82a0-93052d8f91f2/id-preview-df845111--4643c934-856e-487c-b22f-b0ba8a7abd8c.lovable.app-1784590112283.png";

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
        content: "Monitor X accounts, Roblox activity and Eldorado listing prices with automatic one-minute scans and Discord alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Ambunctious Tracker — X posts & price alerts" },
      { name: "twitter:description", content: "Automatic one-minute monitoring with Discord alerts." },
      { property: "og:image", content: SOCIAL_IMAGE },
      { name: "twitter:image", content: SOCIAL_IMAGE },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
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

      document.querySelectorAll<HTMLElement>(
        ".countdown-node strong, .top-countdown strong",
      ).forEach((element) => {
        element.textContent = value;
      });

      document.querySelectorAll<HTMLElement>(
        ".countdown-node i b, .top-countdown i b",
      ).forEach((element) => {
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

  return (
    <QueryClientProvider client={queryClient}>
      <OneMinuteScanUiSync />
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
      <Toaster />
    </QueryClientProvider>
  );
}
