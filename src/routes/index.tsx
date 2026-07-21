import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2,
  ExternalLink, Eye, LoaderCircle, Plus, RefreshCw, Search, ShoppingBag,
  Trash2, Twitter,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ambunctious Tracker — X posts & price alerts" },
      { name: "description", content: "Monitor X accounts and Eldorado listings from one focused dashboard." },
    ],
  }),
  component: Index,
});

type XAccount = {
  id: string; handle: string; last_post_url: string | null; last_post_text: string | null;
  last_checked_at: string | null; last_error: string | null;
};
type Product = {
  id: string; url: string; label: string; last_price: number | null; currency: string | null;
  last_checked_at: string | null; last_error: string | null;
};
type PricePoint = { checked_at: string; price: number };

function relativeTime(iso: string | null) {
  if (!iso) return "Not checked yet";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function currencyPrice(currency: string | null, price: number | null) {
  if (price == null) return "Awaiting first check";
  const code = currency?.length === 3 ? currency : "USD";
  try { return new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(price); }
  catch { return `${currency ?? ""} ${price.toFixed(2)}`.trim(); }
}

function StatusPill({ error, checked }: { error: string | null; checked: string | null }) {
  if (error) return <span className="status-pill status-error"><AlertTriangle size={12} /> Needs attention</span>;
  if (!checked) return <span className="status-pill status-waiting"><Activity size={12} /> Awaiting check</span>;
  return <span className="status-pill status-healthy"><CheckCircle2 size={12} /> Healthy</span>;
}

function Index() {
  const [accounts, setAccounts] = useState<XAccount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [handle, setHandle] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [productLabel, setProductLabel] = useState("");
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Record<string, PricePoint[]>>({});

  async function loadAll(showLoading = false) {
    if (showLoading) setLoading(true);
    const [{ data: xs, error: xError }, { data: ps, error: pError }] = await Promise.all([
      supabase.from("tracked_x_accounts").select("*").order("created_at", { ascending: true }),
      supabase.from("tracked_products").select("*").order("created_at", { ascending: true }),
    ]);
    if (xError || pError) toast.error("Couldn’t load every tracker. Please try again.");
    setAccounts((xs ?? []) as XAccount[]);
    setProducts((ps ?? []) as Product[]);
    if (ps?.length) {
      const entries = await Promise.all(ps.map(async (p) => {
        const { data } = await supabase.from("price_history").select("checked_at, price")
          .eq("product_id", p.id).order("checked_at", { ascending: true }).limit(200);
        return [p.id, (data ?? []).map((r) => ({ checked_at: r.checked_at as string, price: Number(r.price) }))] as const;
      }));
      setHistory(Object.fromEntries(entries));
    } else setHistory({});
    setLoading(false);
  }

  useEffect(() => { void loadAll(); }, []);

  async function addAccount() {
    const clean = handle.replace(/^@/, "").trim();
    if (!clean) return toast.error("Enter an X username first.");
    if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) return toast.error("Enter a valid X username.");
    const { error } = await supabase.from("tracked_x_accounts").insert({ handle: clean });
    if (error) toast.error(error.message);
    else { toast.success(`Now tracking @${clean}`); setHandle(""); await loadAll(); }
  }

  async function addProduct() {
    const url = productUrl.trim();
    const label = productLabel.trim() || "Eldorado listing";
    if (!url) return toast.error("Paste an Eldorado listing URL first.");
    try {
      const parsed = new URL(url);
      if (!parsed.hostname.endsWith("eldorado.gg")) throw new Error();
    } catch { return toast.error("Enter a valid eldorado.gg URL."); }
    const { error } = await supabase.from("tracked_products").insert({ url, label });
    if (error) toast.error(error.message);
    else { toast.success(`Now tracking ${label}`); setProductUrl(""); setProductLabel(""); await loadAll(); }
  }

  async function remove(kind: "account" | "product", id: string, label: string) {
    if (!window.confirm(`Stop tracking ${label}? This cannot be undone.`)) return;
    const table = kind === "account" ? "tracked_x_accounts" : "tracked_products";
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`${label} removed`); await loadAll(); }
  }

  async function runNow() {
    setRunning(true);
    try {
      const res = await fetch("/api/public/run-checks", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "The check could not be completed.");
      toast.success(`Check complete: ${body.x_new_posts} new posts and ${body.price_changes} price changes.`);
      if (body.errors?.length) toast.warning(`${body.errors.length} tracker(s) need attention.`);
      await loadAll();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Check failed. Try again."); }
    finally { setRunning(false); }
  }

  const filteredAccounts = useMemo(() => accounts.filter((a) => a.handle.toLowerCase().includes(query.toLowerCase())), [accounts, query]);
  const filteredProducts = useMemo(() => products.filter((p) => (p.label + p.url).toLowerCase().includes(query.toLowerCase())), [products, query]);
  const all = [...accounts, ...products];
  const issues = all.filter((item) => item.last_error).length;
  const checked = all.map((item) => item.last_checked_at).filter(Boolean).sort().at(-1) ?? null;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-mark"><Eye size={21} /></div>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold tracking-tight sm:text-lg">Ambunctious Tracker</h1>
              <p className="hidden text-xs text-muted-foreground sm:block">X posts and listing prices, watched around the clock</p>
            </div>
          </div>
          <Button onClick={runNow} disabled={running || loading} className="h-10 rounded-xl px-3 sm:px-4">
            {running ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            <span>{running ? "Checking…" : "Check now"}</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6 sm:py-10">
        <section className="mb-7">
          <p className="eyebrow">MONITORING OVERVIEW</p>
          <div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <h2 className="text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">Everything you’re watching.</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">One clean view of new X posts, Eldorado prices and tracker health. Alerts still go straight to Discord.</p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search trackers" className="h-11 rounded-xl pl-9" />
            </div>
          </div>
        </section>

        <section className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Card className="metric-card"><div className="metric-icon"><Activity /></div><p>Active trackers</p><strong>{all.length}</strong><span>{accounts.length} social · {products.length} prices</span></Card>
          <Card className="metric-card"><div className="metric-icon"><Twitter /></div><p>X accounts</p><strong>{accounts.length}</strong><span>Checked hourly</span></Card>
          <Card className="metric-card"><div className="metric-icon"><ShoppingBag /></div><p>Price watches</p><strong>{products.length}</strong><span>{Object.values(history).reduce((n, x) => n + x.length, 0)} data points</span></Card>
          <Card className={`metric-card ${issues ? "metric-warning" : ""}`}><div className="metric-icon">{issues ? <AlertTriangle /> : <CheckCircle2 />}</div><p>Tracker health</p><strong>{issues ? issues : "Good"}</strong><span>{issues ? "Need attention" : `Last check ${relativeTime(checked)}`}</span></Card>
        </section>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-white/8 bg-card/50">
            <LoaderCircle className="mr-2 animate-spin text-primary" /> Loading your trackers…
          </div>
        ) : (
          <Tabs defaultValue="x" className="space-y-5">
            <TabsList className="h-12 w-full justify-start rounded-xl bg-card p-1 sm:w-auto">
              <TabsTrigger value="x" className="h-10 flex-1 rounded-lg px-4 sm:flex-none"><Twitter /> X accounts <span className="count">{accounts.length}</span></TabsTrigger>
              <TabsTrigger value="products" className="h-10 flex-1 rounded-lg px-4 sm:flex-none"><ShoppingBag /> Price watches <span className="count">{products.length}</span></TabsTrigger>
            </TabsList>

            <TabsContent value="x" className="space-y-4">
              <Card className="add-card">
                <div className="add-copy"><div className="add-icon"><Plus /></div><div><h3>Add an X account</h3><p>We’ll watch for the newest original post.</p></div></div>
                <div className="flex w-full gap-2 sm:max-w-md"><Input aria-label="X username" placeholder="@username" value={handle} onChange={(e) => setHandle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addAccount()} className="h-11 rounded-xl" /><Button onClick={addAccount} className="h-11 rounded-xl">Add</Button></div>
              </Card>
              {!filteredAccounts.length ? <Empty icon={<Twitter />} title={query ? "No matching accounts" : "No X accounts yet"} copy={query ? "Try a different search." : "Add an account above to start watching for new posts."} /> :
                <div className="grid gap-3 lg:grid-cols-2">{filteredAccounts.map((a) => (
                  <Card key={a.id} className="tracker-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3"><div className="tracker-avatar"><Twitter /></div><div className="min-w-0"><a className="tracker-title" href={`https://x.com/${a.handle}`} target="_blank" rel="noreferrer">@{a.handle} <ExternalLink /></a><p className="tracker-meta">Checked {relativeTime(a.last_checked_at)}</p></div></div>
                      <StatusPill error={a.last_error} checked={a.last_checked_at} />
                    </div>
                    <div className="content-panel">{a.last_post_url ? <><p className="panel-label">LATEST POST</p><a href={a.last_post_url} target="_blank" rel="noreferrer">{a.last_post_text?.slice(0, 180) || "Open latest post"} <ExternalLink /></a></> : <p className="text-sm text-muted-foreground">The latest post will appear after the first successful check.</p>}</div>
                    {a.last_error && <p className="error-copy"><AlertTriangle /> {a.last_error}</p>}
                    <div className="card-footer"><span>Discord alerts enabled</span><Button variant="ghost" size="sm" onClick={() => void remove("account", a.id, `@${a.handle}`)}><Trash2 /> Remove</Button></div>
                  </Card>
                ))}</div>}
            </TabsContent>

            <TabsContent value="products" className="space-y-4">
              <Card className="add-card items-start">
                <div className="add-copy"><div className="add-icon"><Plus /></div><div><h3>Add a price watch</h3><p>Track an Eldorado listing and its price history.</p></div></div>
                <div className="grid w-full gap-2 sm:max-w-xl sm:grid-cols-[1fr_1fr_auto]"><Input aria-label="Listing URL" placeholder="Eldorado.gg URL" value={productUrl} onChange={(e) => setProductUrl(e.target.value)} className="h-11 rounded-xl" /><Input aria-label="Listing label" placeholder="Short label" value={productLabel} onChange={(e) => setProductLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addProduct()} className="h-11 rounded-xl" /><Button onClick={addProduct} className="h-11 rounded-xl">Add</Button></div>
              </Card>
              {!filteredProducts.length ? <Empty icon={<ShoppingBag />} title={query ? "No matching price watches" : "No price watches yet"} copy={query ? "Try a different search." : "Add an Eldorado listing above to start building price history."} /> :
                <div className="grid gap-3 lg:grid-cols-2">{filteredProducts.map((p) => {
                  const points = history[p.id] ?? [];
                  const delta = points.length > 1 ? points.at(-1)!.price - points.at(-2)!.price : 0;
                  return <Card key={p.id} className="tracker-card">
                    <div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-center gap-3"><div className="tracker-avatar"><ShoppingBag /></div><div className="min-w-0"><a className="tracker-title" href={p.url} target="_blank" rel="noreferrer">{p.label} <ExternalLink /></a><p className="tracker-meta">Checked {relativeTime(p.last_checked_at)}</p></div></div><StatusPill error={p.last_error} checked={p.last_checked_at} /></div>
                    <div className="mt-5 flex items-end justify-between"><div><p className="panel-label">CURRENT PRICE</p><p className="price">{currencyPrice(p.currency, p.last_price)}</p></div>{delta !== 0 && <span className={`delta ${delta < 0 ? "down" : "up"}`}>{delta < 0 ? <ArrowDownRight /> : <ArrowUpRight />}{Math.abs(delta).toFixed(2)}</span>}</div>
                    {points.length > 1 ? <div className="mt-4 h-32"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><XAxis dataKey="checked_at" hide /><YAxis hide domain={["auto", "auto"]} /><Tooltip contentStyle={{ background: "#111827", border: "1px solid #263247", borderRadius: 12 }} labelFormatter={(v) => new Date(v as string).toLocaleString()} formatter={(v) => [currencyPrice(p.currency, Number(v)), "Price"]} /><Line type="monotone" dataKey="price" stroke="#38bdf8" dot={false} strokeWidth={2.5} /></LineChart></ResponsiveContainer></div> : <div className="content-panel"><p className="text-sm text-muted-foreground">Price history will appear after two successful checks.</p></div>}
                    {p.last_error && <p className="error-copy"><AlertTriangle /> {p.last_error}</p>}
                    <div className="card-footer"><span>{points.length} recorded checks</span><Button variant="ghost" size="sm" onClick={() => void remove("product", p.id, p.label)}><Trash2 /> Remove</Button></div>
                  </Card>;
                })}</div>}
            </TabsContent>
          </Tabs>
        )}
        <footer className="mt-10 flex items-center justify-between border-t border-white/8 py-5 text-xs text-muted-foreground"><span>Ambunctious Tracker</span><span>Private dashboard · Discord alerts</span></footer>
      </main>
    </div>
  );
}

function Empty({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <Card className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{copy}</p></Card>;
}
