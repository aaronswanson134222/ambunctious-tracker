import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, Gamepad2, LoaderCircle, Send, TestTube2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/embed-test" as any)({ component: EmbedTestPage });

type ProductItem = {
  id: number;
  kind: "game_pass" | "developer_product";
  name: string;
};

type Experience = {
  id: string;
  label: string;
  place_id: number;
  universe_id: number;
  items: ProductItem[] | null;
};

type Preview = {
  name: string;
  thumbnailUrl: string | null;
  priceInRobux: number | null;
  description: string | null;
  experienceName: string | null;
};

function EmbedTestPage() {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [experienceId, setExperienceId] = useState("");
  const [kind, setKind] = useState<"game_pass" | "developer_product">("developer_product");
  const [productId, setProductId] = useState("");
  const [fallbackName, setFallbackName] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase
        .from("tracked_roblox_experiences")
        .select("id,label,place_id,universe_id,items")
        .order("created_at", { ascending: true });
      if (error) toast.error(error.message);
      const rows = (data ?? []) as unknown as Experience[];
      setExperiences(rows);
      if (rows[0]) setExperienceId(rows[0].id);
      setLoading(false);
    })();
  }, []);

  const selected = experiences.find((item) => item.id === experienceId) ?? null;
  const matchingItems = useMemo(
    () => (Array.isArray(selected?.items) ? selected!.items : []).filter((item) => item.kind === kind),
    [selected, kind],
  );

  function useLatest() {
    const latest = matchingItems[0];
    if (!latest) return toast.info(`No saved ${kind === "game_pass" ? "game passes" : "developer products"} are available.`);
    setProductId(String(latest.id));
    setFallbackName(latest.name);
  }

  async function sendTest() {
    if (!selected) return toast.error("Choose a tracked experience.");
    const id = Number(productId);
    if (!Number.isSafeInteger(id) || id <= 0) return toast.error("Enter a valid Roblox product ID.");

    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return toast.error("Your secure session expired. Sign in again.");

    setSending(true);
    try {
      const response = await fetch("/api/roblox/test-embed", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          kind,
          productId: id,
          universeId: selected.universe_id,
          placeId: selected.place_id,
          experienceLabel: selected.label,
          fallbackName: fallbackName.trim() || undefined,
        }),
      });
      const body = await response.json() as { sent?: boolean; preview?: Preview; error?: string };
      if (!response.ok || !body.sent) throw new Error(body.error ?? "Discord test failed");
      setPreview(body.preview ?? null);
      toast.success("Test embed sent to Discord.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Discord test failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <Link to="/menu" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft size={16} /> Back to menu
        </Link>

        <Card className="tracker-card p-6 sm:p-8">
          <p className="eyebrow"><span /> DISCORD UPLINK</p>
          <div className="mt-3 flex items-start gap-4">
            <div className="tracker-avatar"><TestTube2 /></div>
            <div>
              <h1 className="text-3xl font-semibold">Embed test console</h1>
              <p className="mt-2 text-sm text-muted-foreground">Send a clearly labelled test through the exact same Roblox embed builder used by live alerts.</p>
            </div>
          </div>
        </Card>

        <Card className="tracker-card space-y-5 p-5 sm:p-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="animate-spin" /> Loading tracked experiences…</div>
          ) : !experiences.length ? (
            <p className="text-sm text-muted-foreground">Add a Roblox experience on the tracker dashboard first.</p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-2 text-sm"><span className="panel-label">EXPERIENCE</span>
                  <select className="command-input h-11 w-full rounded-xl px-3" value={experienceId} onChange={(e) => setExperienceId(e.target.value)}>
                    {experiences.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
                <label className="space-y-2 text-sm"><span className="panel-label">EMBED TYPE</span>
                  <select className="command-input h-11 w-full rounded-xl px-3" value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setProductId(""); setFallbackName(""); }}>
                    <option value="developer_product">Developer product</option>
                    <option value="game_pass">Game pass</option>
                  </select>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Input value={productId} onChange={(e) => setProductId(e.target.value.replace(/\D/g, ""))} placeholder="Product ID" className="h-11 rounded-xl" />
                <Input value={fallbackName} onChange={(e) => setFallbackName(e.target.value)} placeholder="Fallback name (optional)" className="h-11 rounded-xl" />
                <Button variant="outline" onClick={useLatest} className="h-11 rounded-xl"><Gamepad2 /> Use latest saved</Button>
              </div>

              <div className="content-panel space-y-2">
                <p className="panel-label">TEST SAFETY</p>
                <p className="text-sm text-muted-foreground">The Discord message begins with “TEST MESSAGE” and does not change baselines, known product IDs, scan history or notification reservations.</p>
              </div>

              <Button onClick={sendTest} disabled={sending || !productId} className="metal-button h-12 w-full rounded-none sm:w-auto">
                {sending ? <LoaderCircle className="animate-spin" /> : <Send />}
                {sending ? "Sending test…" : "Send test embed to Discord"}
              </Button>
            </>
          )}
        </Card>

        {preview && (
          <Card className="tracker-card p-5">
            <div className="flex items-start gap-4">
              {preview.thumbnailUrl ? <img src={preview.thumbnailUrl} alt="" className="h-20 w-20 rounded-xl object-cover" /> : <div className="tracker-avatar"><Gamepad2 /></div>}
              <div className="min-w-0"><p className="flex items-center gap-2 text-sm text-emerald-400"><CheckCircle2 size={16} /> Last test sent</p><h2 className="mt-1 truncate text-xl font-semibold">{preview.name}</h2><p className="mt-1 text-sm text-muted-foreground">{preview.priceInRobux == null ? "Price unavailable" : `${preview.priceInRobux.toLocaleString("en-GB")} Robux`} · {preview.experienceName ?? selected?.label}</p>{preview.description && <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{preview.description}</p>}</div>
            </div>
          </Card>
        )}
      </div>
    </main>
  );
}
