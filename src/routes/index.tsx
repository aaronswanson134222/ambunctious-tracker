import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Tracker Bot — X posts + Eldorado.gg prices" },
      {
        name: "description",
        content:
          "Personal watcher that pings a Discord webhook when tracked X accounts post or Eldorado.gg listing prices change.",
      },
    ],
  }),
  component: Index,
});

type XAccount = {
  id: string;
  handle: string;
  last_post_url: string | null;
  last_post_text: string | null;
  last_checked_at: string | null;
  last_error: string | null;
};

type Product = {
  id: string;
  url: string;
  label: string;
  last_price: number | null;
  currency: string | null;
  last_checked_at: string | null;
  last_error: string | null;
};

type PricePoint = { checked_at: string; price: number };

function formatWhen(iso: string | null) {
  if (!iso) return "never";
  const d = new Date(iso);
  return d.toLocaleString();
}

function Index() {
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [handle, setHandle] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [productLabel, setProductLabel] = useState("");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<Record<string, PricePoint[]>>({});

  async function loadAll() {
    const [{ data: xs }, { data: ps }] = await Promise.all([
      supabase
        .from("tracked_x_accounts")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("tracked_products")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);
    setAccounts((xs ?? []) as XAccount[]);
    setProducts((ps ?? []) as Product[]);

    // load history for each product
    if (ps && ps.length) {
      const map: Record<string, PricePoint[]> = {};
      await Promise.all(
        ps.map(async (p) => {
          const { data } = await supabase
            .from("price_history")
            .select("checked_at, price")
            .eq("product_id", p.id)
            .order("checked_at", { ascending: true })
            .limit(200);
          map[p.id] = (data ?? []).map((r) => ({
            checked_at: r.checked_at as string,
            price: Number(r.price),
          }));
        }),
      );
      setHistory(map);
    }
  }

  useEffect(() => {
    loadAll();
  }, []);

  async function addAccount() {
    const clean = handle.replace(/^@/, "").trim();
    if (!clean) return;
    const { error } = await supabase
      .from("tracked_x_accounts")
      .insert({ handle: clean });
    if (error) toast.error(error.message);
    else {
      toast.success(`Tracking @${clean}`);
      setHandle("");
      loadAll();
    }
  }

  async function removeAccount(id: string) {
    await supabase.from("tracked_x_accounts").delete().eq("id", id);
    loadAll();
  }

  async function addProduct() {
    const url = productUrl.trim();
    const label = productLabel.trim() || url;
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast.error("URL must start with http:// or https://");
      return;
    }
    const { error } = await supabase
      .from("tracked_products")
      .insert({ url, label });
    if (error) toast.error(error.message);
    else {
      toast.success(`Tracking ${label}`);
      setProductUrl("");
      setProductLabel("");
      loadAll();
    }
  }

  async function removeProduct(id: string) {
    await supabase.from("tracked_products").delete().eq("id", id);
    loadAll();
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/public/run-checks", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body));
      toast.success(
        `Checked ${body.x_checked} accounts, ${body.products_checked} products. ${body.x_new_posts} new posts, ${body.price_changes} price changes.`,
      );
      if (body.errors?.length)
        toast.warning(`${body.errors.length} check(s) had errors`);
      await loadAll();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-xl font-semibold">Tracker Bot</h1>
            <p className="text-sm text-muted-foreground">
              Hourly checks · alerts to your Discord webhook
            </p>
          </div>
          <Button onClick={runNow} disabled={running}>
            {running ? "Checking..." : "Check now"}
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <Tabs defaultValue="x">
          <TabsList>
            <TabsTrigger value="x">X accounts ({accounts.length})</TabsTrigger>
            <TabsTrigger value="products">
              Eldorado listings ({products.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="x" className="space-y-4">
            <Card className="p-4">
              <div className="flex gap-2">
                <Input
                  placeholder="@handle"
                  value={handle}
                  onChange={(e) => setHandle(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addAccount()}
                />
                <Button onClick={addAccount}>Add</Button>
              </div>
            </Card>
            {accounts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No accounts tracked yet.
              </p>
            )}
            {accounts.map((a) => (
              <Card key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <a
                        href={`https://x.com/${a.handle}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                      >
                        @{a.handle}
                      </a>
                      <span className="text-xs text-muted-foreground">
                        checked {formatWhen(a.last_checked_at)}
                      </span>
                    </div>
                    {a.last_post_url ? (
                      <a
                        href={a.last_post_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block text-sm text-muted-foreground hover:text-foreground"
                      >
                        {a.last_post_text?.slice(0, 140) ?? a.last_post_url}
                      </a>
                    ) : (
                      <p className="mt-1 text-sm text-muted-foreground">
                        No post seen yet.
                      </p>
                    )}
                    {a.last_error && (
                      <p className="mt-1 text-xs text-destructive">
                        {a.last_error}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeAccount(a.id)}
                  >
                    Remove
                  </Button>
                </div>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="products" className="space-y-4">
            <Card className="p-4 space-y-2">
              <Input
                placeholder="Eldorado.gg listing URL"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  placeholder="Label (e.g. WoW Gold — Kazzak)"
                  value={productLabel}
                  onChange={(e) => setProductLabel(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addProduct()}
                />
                <Button onClick={addProduct}>Add</Button>
              </div>
            </Card>
            {products.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No listings tracked yet.
              </p>
            )}
            {products.map((p) => {
              const points = history[p.id] ?? [];
              return (
                <Card key={p.id} className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <a
                        href={p.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium hover:underline"
                      >
                        {p.label}
                      </a>
                      <p className="text-xs text-muted-foreground break-all">
                        {p.url}
                      </p>
                      <p className="mt-2 text-lg font-semibold">
                        {p.last_price != null
                          ? `${p.currency ?? ""} ${Number(p.last_price).toFixed(2)}`
                          : "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        checked {formatWhen(p.last_checked_at)}
                      </p>
                      {p.last_error && (
                        <p className="mt-1 text-xs text-destructive">
                          {p.last_error}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeProduct(p.id)}
                    >
                      Remove
                    </Button>
                  </div>
                  {points.length > 1 && (
                    <div className="mt-4 h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={points}>
                          <XAxis
                            dataKey="checked_at"
                            tickFormatter={(v) =>
                              new Date(v).toLocaleDateString()
                            }
                            fontSize={10}
                          />
                          <YAxis fontSize={10} domain={["auto", "auto"]} />
                          <Tooltip
                            labelFormatter={(v) =>
                              new Date(v as string).toLocaleString()
                            }
                            formatter={(v) => [
                              `${p.currency ?? ""} ${Number(v).toFixed(2)}`,
                              "Price",
                            ]}
                          />
                          <Line
                            type="monotone"
                            dataKey="price"
                            stroke="hsl(var(--primary))"
                            dot={false}
                            strokeWidth={2}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </Card>
              );
            })}
          </TabsContent>
        </Tabs>

        <p className="mt-8 text-xs text-muted-foreground">
          Tip: this app is public to anyone with the URL. Keep it private.
        </p>
      </main>
    </div>
  );
}
