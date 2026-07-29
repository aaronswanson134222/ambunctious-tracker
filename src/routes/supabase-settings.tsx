import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, Database, ExternalLink, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/supabase-settings")({ component: SupabaseSettings });

const STORAGE_KEY = "ambunctious.supabase.public-config";

type PublicConfig = {
  url: string;
  publishableKey: string;
};

function readSavedConfig(): PublicConfig {
  if (typeof window === "undefined") return { url: "", publishableKey: "" };
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) || "null",
    ) as Partial<PublicConfig> | null;
    return {
      url: typeof parsed?.url === "string" ? parsed.url : "",
      publishableKey: typeof parsed?.publishableKey === "string" ? parsed.publishableKey : "",
    };
  } catch {
    return { url: "", publishableKey: "" };
  }
}

function normaliseUrl(value: string) {
  return value.trim().replace(/\/$/, "");
}

function SupabaseSettings() {
  const navigate = useNavigate();
  const initial = useMemo(readSavedConfig, []);
  const [url, setUrl] = useState(initial.url || "https://uikjvsfdcomkamjazjyq.supabase.co");
  const [publishableKey, setPublishableKey] = useState(
    initial.publishableKey || "sb_publishable_kibF6dvgyq6Fqh4BJE4s7A_j6_uUrWH",
  );
  const [testing, setTesting] = useState(false);

  function validate(): PublicConfig | null {
    const cleanUrl = normaliseUrl(url);
    const cleanKey = publishableKey.trim();
    try {
      const parsed = new URL(cleanUrl);
      if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
        toast.error("Enter a valid Supabase project URL.");
        return null;
      }
    } catch {
      toast.error("Enter a valid Supabase project URL.");
      return null;
    }
    if (!cleanKey.startsWith("sb_publishable_") && !cleanKey.startsWith("eyJ")) {
      toast.error("Enter a valid publishable/anon key.");
      return null;
    }
    return { url: cleanUrl, publishableKey: cleanKey };
  }

  async function testConnection() {
    const config = validate();
    if (!config) return;
    setTesting(true);
    try {
      const response = await fetch(`${config.url}/rest/v1/`, {
        method: "GET",
        headers: { apikey: config.publishableKey },
      });
      if (!response.ok && response.status !== 404)
        throw new Error(`Supabase returned HTTP ${response.status}`);
      toast.success("Supabase connection looks valid.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not connect to Supabase.");
    } finally {
      setTesting(false);
    }
  }

  async function save() {
    const config = validate();
    if (!config) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    toast.success("Supabase settings saved.");
    await navigate({ to: "/" });
    window.location.reload();
  }

  function clear() {
    window.localStorage.removeItem(STORAGE_KEY);
    setUrl("");
    setPublishableKey("");
    toast.success("Saved public Supabase settings cleared.");
  }

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="eyebrow">
            <span /> DATABASE SETUP
          </p>
          <h1 className="mt-3 text-3xl font-semibold">Supabase configuration</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Change the public Supabase project used by this browser without spending Lovable
            credits.
          </p>
        </div>

        <Card className="tracker-card space-y-5 p-5 sm:p-6">
          <div className="flex items-start gap-4">
            <div className="tracker-avatar">
              <Database />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Public project connection</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                These two values are designed to be used by the website.
              </p>
            </div>
          </div>

          <label className="block space-y-2 text-sm">
            <span className="panel-label">PROJECT URL</span>
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://your-project.supabase.co"
              autoComplete="off"
              className="h-11 rounded-xl"
            />
          </label>

          <label className="block space-y-2 text-sm">
            <span className="panel-label">PUBLISHABLE KEY (ANON/PUBLIC)</span>
            <Input
              type="password"
              value={publishableKey}
              onChange={(event) => setPublishableKey(event.target.value)}
              placeholder="sb_publishable_..."
              autoComplete="off"
              className="h-11 rounded-xl"
            />
          </label>

          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void testConnection()}
              disabled={testing}
            >
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button type="button" onClick={() => void save()}>
              <Save size={17} /> Save and reload
            </Button>
            <Button type="button" variant="ghost" onClick={clear}>
              Clear saved settings
            </Button>
          </div>
        </Card>

        <Card className="border-amber-400/25 bg-amber-400/5 p-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <h2 className="font-semibold">
                The service-role key is deliberately not stored here
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A service-role key bypasses database security. Putting it in a webpage or browser
                storage would expose full database access to anyone who can inspect the site. Keep
                it only in server-side hosting secrets.
              </p>
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link
            to="/menu"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            ← Back to menu
          </Link>
          <a
            href="https://supabase.com/dashboard/project/uikjvsfdcomkamjazjyq/settings/api"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground"
          >
            Open Supabase API settings <ExternalLink size={15} />
          </a>
        </div>
      </div>
    </main>
  );
}
