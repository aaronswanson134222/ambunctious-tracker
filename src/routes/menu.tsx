import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BellRing,
  Bot,
  Brain,
  CheckCircle2,
  Eye,
  Gamepad2,
  Home,
  Link2,
  LoaderCircle,
  Save,
  Send,
  ShieldCheck,
  TestTube2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/menu")({ component: MainMenu });

const items = [
  {
    to: "/",
    title: "Tracker dashboard",
    copy: "Manage X, Roblox, price and website monitoring.",
    icon: Home,
  },
  {
    to: "/bot-connections",
    title: "Bot connections",
    copy: "View Discord, Roblox, X and database health.",
    icon: Bot,
  },
  {
    to: "/private-alerts",
    title: "Discord DM setup",
    copy: "Configure your bot token, user ID and test private DMs.",
    icon: BellRing,
  },
  {
    to: "/puzzle-solver",
    title: "Puzzle lab",
    copy: "Solve image grids, compare candidates, correct tiles and train the matcher.",
    icon: Brain,
  },
];

type Experience = {
  id: string;
  label: string;
  place_id: number;
  universe_id: number;
  items: Array<{ id: number; kind: "game_pass" | "developer_product"; name: string }> | null;
};

type EmbedResult = {
  sent?: boolean;
  messageId?: string | null;
  error?: string;
  embed?: Record<string, unknown>;
  details?: {
    name: string;
    description: string | null;
    priceInRobux: number | null;
    thumbnailUrl: string | null;
    experienceName: string | null;
    creatorName: string | null;
    warnings: string[];
  };
};

function EmbedTester() {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [experienceId, setExperienceId] = useState("");
  const [kind, setKind] = useState<"game_pass" | "developer_product">("developer_product");
  const [productId, setProductId] = useState("");
  const [fallbackName, setFallbackName] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [webhook, setWebhook] = useState("");
  const [webhookConfigured, setWebhookConfigured] = useState(false);
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"preview" | "send" | null>(null);
  const [result, setResult] = useState<EmbedResult | null>(null);

  useEffect(() => {
    void (async () => {
      const [{ data: rowsData, error }, sessionResult] = await Promise.all([
        supabase
          .from("tracked_roblox_experiences")
          .select("id,label,place_id,universe_id,items")
          .order("created_at", { ascending: true }),
        supabase.auth.getSession(),
      ]);
      if (error) toast.error(error.message);
      const rows = (rowsData ?? []) as unknown as Experience[];
      setExperiences(rows);
      if (rows[0]) setExperienceId(rows[0].id);

      const token = sessionResult.data.session?.access_token;
      if (token) {
        try {
          const response = await fetch("/api/roblox/product-details", {
            Authorization: Bearer $trailing
          });
          const body = (await response.json()) as { webhookConfigured?: boolean };
          if (response.ok) setWebhookConfigured(body.webhookConfigured === true);
        } catch {
          // The tester still loads if the status lookup temporarily fails.
        }
      }
      setLoading(false);
    })();
  }, []);

  const selected = experiences.find((item) => item.id === experienceId) ?? null;
  const savedItems = useMemo(
    () =>
      (Array.isArray(selected?.items) ? selected!.items : []).filter((item) => item.kind === kind),
    [selected, kind],
  );

  function useLatestSaved() {
    const latest = savedItems[0];
    if (!latest) {
      toast.info(
        `No saved ${kind === "game_pass" ? "game passes" : "developer products"} were found.`,
      );
      return;
    }
    setProductId(String(latest.id));
    setFallbackName(latest.name);
  }

  async function saveWebhook() {
    const value = webhook.trim();
    if (!value) return toast.error("Paste the new Discord webhook URL first.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return toast.error("Your secure session expired. Sign in again.");

    setWebhookSaving(true);
    try {
      const response = await fetch("/api/roblox/product-details", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}``,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "save_embed_webhook", webhook: value }),
      });
      const body = (await response.json()) as { webhookConfigured?: boolean; error?: string };
      if (!response.ok || !body.webhookConfigured)
        throw new Error(body.error || "Could not save the webhook.");
      setWebhookConfigured(true);
      setWebhook("");
      toast.success("Dedicated embed webhook saved securely.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the webhook.");
    } finally {
      setWebhookSaving(false);
    }
  }

  async function run(action: "preview" | "send") {
    if (!selected) return toast.error("Add or choose a tracked Roblox experience first.");
    if (action === "send" && !webhookConfigured)
      return toast.error("Add the dedicated embed webhook first.");
    const id = Number(productId);
    if (!Number.isSafeInteger(id) || id <= 0)
      return toast.error("Enter a valid Roblox product ID.");

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return toast.error("Your secure session expired. Sign in again.");

    setWorking(action);
    try {
      const response = await fetch("/api/roblox/product-details", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}``,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "preview",
          kind,
          productId: id,
          universeId: selected.universe_id,
          placeId: selected.place_id,
          fallbackName: fallbackName.trim() || undefined,
          customTitle: customTitle.trim() || undefined,
          customMessage: customMessage.trim() || undefined,
        }),
      });
      const preview = (await response.json()) as EmbedResult;
      if (!response.ok || !preview.embed)
        throw new Error(preview.error || "The embed preview failed.");

      if (action === "preview") {
        setResult(preview);
        toast.success("Embed preview loaded.");
        return;
      }

      const { data: edgeData, error: edgeError } = await supabase.functions.invoke(
        "send-embed-test",
        {
          body: { embed: preview.embed },
        },
      );
      const edgeBody = (edgeData ?? {}) as {
        sent?: boolean;
        messageId?: string | null;
        error?: string;
      };
      if (edgeError || !edgeBody.sent) {
        throw new Error(
          edgeBody.error || edgeError?.message || "The Edge Function could not send the embed.",
        );
      }
      setResult({ ...preview, sent: true, messageId: edgeBody.messageId ?? null });
      toast.success("Test embed sent through Supabase.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The embed request failed.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <Card className="tracker-card space-y-5 p-5 sm:p-6">
      <div className="flex items-start gap-4">
        <div className="tracker-avatar">
          <TestTube2 />
        </div>
        <div>
          <p className="eyebrow">
            <span /> DISCORD EMBED LAB
          </p>
          <h2 className="mt-2 text-2xl font-semibold">Roblox product embed tester</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Preview the exact data first, then send a clearly labelled test message through Supabase
            without changing scan history or product baselines.
          </p>
        </div>
      </div>

      <div className="content-panel space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Link2 size={18} />
          <div>
            <p className="font-medium">Dedicated embed webhook</p>
            <p className="text-xs text-muted-foreground">
              This is separate from the tracker alert webhook and is stored securely in Supabase
              Vault.
            </p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            type="password"
            value={webhook}
            onChange={(event) => setWebhook(event.target.value)}
            placeholder={
              webhookConfigured
                ? "Webhook configured — paste a new one to replace it"
                : "Paste the Discord webhook URL"
            }
            autoComplete="off"
            className="h-11 rounded-xl"
          />
          <Button
            onClick={() => void saveWebhook()}
            disabled={webhookSaving || !webhook.trim()}
            className="h-11 rounded-xl"
          >
            {webhookSaving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {webhookConfigured ? "Replace webhook" : "Save webhook"}
          </Button>
        </div>
        <p className={webhookConfigured ? "text-xs text-emerald-400" : "text-xs text-amber-300"}>
          {webhookConfigured
            ? "Dedicated embed webhook is configured."
            : "A dedicated webhook is required before test embeds can be sent."}
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="animate-spin" size={18} /> Loading tracked experiences…
        </div>
      ) : !experiences.length ? (
        <p className="text-sm text-muted-foreground">
          Add a Roblox experience on the tracker dashboard before using the embed tester.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm">
              <span className="panel-label">EXPERIENCE</span>
              <select
                className="command-input h-11 w-full rounded-xl px-3"
                value={experienceId}
                onChange={(event) => {
                  setExperienceId(event.target.value);
                  setResult(null);
                }}
              >
                {experiences.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-2 text-sm">
              <span className="panel-label">PRODUCT TYPE</span>
              <select
                className="command-input h-11 w-full rounded-xl px-3"
                value={kind}
                onChange={(event) => {
                  setKind(event.target.value as typeof kind);
                  setProductId("");
                  setFallbackName("");
                  setResult(null);
                }}
              >
                <option value="developer_product">Developer product</option>
                <option value="game_pass">Game pass</option>
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              value={productId}
              onChange={(event) => setProductId(event.target.value.replace(/\D/g, ""))}
              placeholder="Product ID"
              className="h-11 rounded-xl"
            />
            <Input
              value={fallbackName}
              onChange={(event) => setFallbackName(event.target.value)}
              placeholder="Fallback product name"
              className="h-11 rounded-xl"
            />
            <Button variant="outline" onClick={useLatestSaved} className="h-11 rounded-xl">
              <Gamepad2 size={17} /> Use latest saved
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              value={customTitle}
              onChange={(event) => setCustomTitle(event.target.value)}
              maxLength={256}
              placeholder="Custom embed title (optional)"
              className="h-11 rounded-xl"
            />
            <Textarea
              value={customMessage}
              onChange={(event) => setCustomMessage(event.target.value)}
              maxLength={3500}
              placeholder="Custom message (optional)"
              className="min-h-11 rounded-xl"
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              onClick={() => void run("preview")}
              disabled={working !== null || !productId}
              className="h-11 rounded-xl"
            >
              {working === "preview" ? <LoaderCircle className="animate-spin" /> : <Eye />} Preview
              embed
            </Button>
            <Button
              onClick={() => void run("send")}
              disabled={working !== null || !productId || !webhookConfigured}
              className="metal-button h-11 rounded-none"
            >
              {working === "send" ? <LoaderCircle className="animate-spin" /> : <Send />} Send
              labelled test
            </Button>
          </div>
        </>
      )}

      {result?.details && (
        <div className="content-panel space-y-4 p-4">
          <div className="flex items-start gap-4">
            {result.details.thumbnailUrl ? (
              <img
                src={result.details.thumbnailUrl}
                alt=""
                className="h-24 w-24 rounded-xl object-cover"
              />
            ) : (
              <div className="tracker-avatar">
                <Gamepad2 />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm text-emerald-400">
                <CheckCircle2 size={16} /> {result.sent ? "Test sent" : "Preview ready"}
              </p>
              <h3 className="mt-1 truncate text-xl font-semibold">{result.details.name}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {result.details.priceInRobux == null
                  ? "Price unavailable"
                  : `${result.details.priceInRobux.toLocaleString("en-GB")} Robux`}
                {result.details.experienceName ? ` · ${result.details.experienceName}` : ""}
              </p>
              {result.details.creatorName && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Creator: {result.details.creatorName}
                </p>
              )}
              {result.details.description && (
                <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">
                  {result.details.description}
                </p>
              )}
            </div>
          </div>
          {result.details.warnings.length > 0 && (
            <p className="text-xs text-amber-300">{result.details.warnings.join(" • ")}</p>
          )}
        </div>
      )}
    </Card>
  );
}

function MainMenu() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <Card className="tracker-card p-6 sm:p-8">
          <p className="eyebrow">
            <span /> AMBUNCTIOUS CONTROL CENTRE
          </p>
          <div className="mt-3 flex items-start gap-4">
            <div className="tracker-avatar">
              <ShieldCheck />
            </div>
            <div>
              <h1 className="text-3xl font-semibold">Main menu</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Everything for monitoring, Discord alerts, connection health and puzzle solving in
                one place.
              </p>
            </div>
          </div>
        </Card>
        <section className="grid gap-4 sm:grid-cols-2">
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} className="block">
                <Card className="tracker-card h-full p-5 transition hover:-translate-y-0.5 hover:border-primary/50">
                  <div className="flex items-start gap-4">
                    <div className="tracker-avatar">
                      <Icon />
                    </div>
                    <div>
                      <h2 className="text-lg font-semibold">{item.title}</h2>
                      <p className="mt-2 text-sm text-muted-foreground">{item.copy}</p>
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </section>
        <EmbedTester />
        <Card className="content-panel flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Gamepad2 size={18} /> The tracker continues running in the background while you use any
          page.
        </Card>
      </div>
    </main>
  );
}

