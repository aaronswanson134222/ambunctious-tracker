import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2,
  ExternalLink, Eye, ImageOff, LoaderCircle, LockKeyhole, LogOut, Plus,
  Gamepad2, Package, RefreshCw, Search, ShoppingBag, Trash2, Twitter,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { User } from "@supabase/supabase-js";
import { AB_BANNER, AB_MARK } from "@/lib/brand-assets";

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
  last_price_gbp: number | null; last_checked_at: string | null; last_error: string | null;
};
type RobloxTracker = {
  id: string; entity_type: "user" | "group"; entity_id: number; label: string;
  scan_types: string[]; lookback_days: number;
  last_checked_at: string | null; last_error: string | null;
};
type ExperienceProductItem = {
  key: string; id: number; kind: "game_pass" | "developer_product";
  name: string; url: string; createdAt: string | null;
};
type ExperienceTracker = {
  id: string; place_id: number; universe_id: number; label: string;
  lookback_days: number; items: ExperienceProductItem[];
  last_checked_at: string | null; last_error: string | null;
};
type PricePoint = { checked_at: string; price: number; price_gbp: number | null };
type ForcedRobloxItem = {
  name: string;
  url: string;
  kind: "game_pass" | "developer_product";
  createdAt: string | null;
  id?: number;
};


function relativeTime(iso: string | null) {
  if (!iso) return "Not checked yet";
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

const SCAN_INTERVAL_SECONDS = 60;

function secondsUntilNextScan() {
  const elapsed = Math.floor(Date.now() / 1000) % SCAN_INTERVAL_SECONDS;
  return elapsed === 0 ? SCAN_INTERVAL_SECONDS : SCAN_INTERVAL_SECONDS - elapsed;
}

function formatScanCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, "0");
  const seconds = (totalSeconds % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
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
  const [robloxTrackers, setRobloxTrackers] = useState<RobloxTracker[]>([]);
  const [experienceTrackers, setExperienceTrackers] = useState<ExperienceTracker[]>([]);
  const [handle, setHandle] = useState("");
  const [productUrl, setProductUrl] = useState("");
  const [productLabel, setProductLabel] = useState("");
  const [robloxType, setRobloxType] = useState<"user" | "group">("user");
  const [robloxTarget, setRobloxTarget] = useState("");
  const [robloxLabel, setRobloxLabel] = useState("");
  const [robloxScanTypes, setRobloxScanTypes] = useState<string[]>(["catalog", "experience"]);
  const [robloxLookback, setRobloxLookback] = useState(30);
  const [robloxApiKey, setRobloxApiKey] = useState("");
  const [experienceTarget, setExperienceTarget] = useState("");
  const [experienceLabel, setExperienceLabel] = useState("");
  const [experienceLookback, setExperienceLookback] = useState(30);
  const [addingExperience, setAddingExperience] = useState(false);
  const [robloxKeyConfigured, setRobloxKeyConfigured] = useState(false);
  const [savingRobloxKey, setSavingRobloxKey] = useState(false);
  const [forcingRoblox, setForcingRoblox] = useState<string | null>(null);
  const [forcedRobloxItems, setForcedRobloxItems] = useState<Record<string, ForcedRobloxItem>>({});
  const [running, setRunning] = useState(false);
  const [scanSeconds, setScanSeconds] = useState(SCAN_INTERVAL_SECONDS);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<Record<string, PricePoint[]>>({});
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginPin, setLoginPin] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  async function loadAll(showLoading = false) {
    if (showLoading) setLoading(true);
    const [
      { data: xs, error: xError },
      { data: ps, error: pError },
      { data: rs, error: rError },
      { data: es, error: eError },
    ] = await Promise.all([
      supabase.from("tracked_x_accounts").select("*").order("created_at", { ascending: true }),
      supabase.from("tracked_products").select("*").order("created_at", { ascending: true }),
      supabase.from("tracked_roblox_entities").select("*").order("created_at", { ascending: true }),
      supabase.from("tracked_roblox_experiences").select("*").order("created_at", { ascending: true }),
    ]);
    if (xError || pError || rError || eError) toast.error("Couldn’t load every tracker. Please try again.");
    setAccounts((xs ?? []) as XAccount[]);
    setProducts((ps ?? []) as Product[]);
    setRobloxTrackers((rs ?? []) as RobloxTracker[]);
    setExperienceTrackers((es ?? []) as unknown as ExperienceTracker[]);
    if (ps?.length) {
      const entries = await Promise.all(ps.map(async (p) => {
        const { data } = await supabase.from("price_history").select("checked_at, price, price_gbp")
          .eq("product_id", p.id).order("checked_at", { ascending: true }).limit(200);
        return [p.id, (data ?? []).map((r) => ({ checked_at: r.checked_at as string, price: Number(r.price), price_gbp: r.price_gbp == null ? null : Number(r.price_gbp) }))] as const;
      }));
      setHistory(Object.fromEntries(entries));
    } else setHistory({});
    setLoading(false);
  }

  async function loadRobloxKeyStatus() {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/roblox/key", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const body = await response.json() as { configured?: boolean };
      setRobloxKeyConfigured(body.configured === true);
    }
  }

  async function saveRobloxKey() {
    const key = robloxApiKey.trim();
    if (key.length < 20 || /\s/.test(key)) {
      return toast.error("Paste a valid Roblox Open Cloud API key.");
    }
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return toast.error("Your session expired. Sign in again.");
    setSavingRobloxKey(true);
    try {
      const response = await fetch("/api/roblox/key", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ key }),
      });
      const body = await response.json() as { configured?: boolean; error?: string };
      if (!response.ok || !body.configured) throw new Error(body.error ?? "Could not save key");
      setRobloxApiKey("");
      setRobloxKeyConfigured(true);
      toast.success("Roblox Open Cloud connected securely.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save Roblox key.");
    } finally {
      setSavingRobloxKey(false);
    }
  }

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (user) {
      void loadAll(true);
      void loadRobloxKeyStatus();
    }
    else {
      setAccounts([]);
      setProducts([]);
      setRobloxTrackers([]);
      setExperienceTrackers([]);
      setHistory({});
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    const updateCountdown = () => setScanSeconds(secondsUntilNextScan());
    updateCountdown();
    const timer = window.setInterval(updateCountdown, 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function signInWithPin() {
    const pin = loginPin.trim();
    if (!/^\d{6}$/.test(pin)) return toast.error("Enter your six-digit owner PIN.");
    setSigningIn(true);
    try {
      const response = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body = await response.json() as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
      };
      if (!response.ok || !body.access_token || !body.refresh_token) {
        throw new Error(body.error ?? "Invalid PIN");
      }
      const { error } = await supabase.auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });
      if (error) throw error;
      setLoginPin("");
      toast.success("Owner access granted.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Sign-in failed.");
    } finally {
      setSigningIn(false);
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    toast.success("Signed out securely.");
  }

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

  async function addRobloxTracker() {
    const value = robloxTarget.trim();
    const idMatch = value.match(/(?:users|groups)\/(\d+)/i) ?? value.match(/^(\d+)$/);
    const entityId = Number(idMatch?.[1]);
    const label = robloxLabel.trim();
    if (!Number.isSafeInteger(entityId) || entityId <= 0) {
      return toast.error("Enter a Roblox profile/group URL or numeric ID.");
    }
    if (!label || label.length > 120) return toast.error("Enter a short tracker label.");
    if (!robloxScanTypes.length) return toast.error("Select at least one Roblox scan type.");
    const { error } = await supabase.from("tracked_roblox_entities").insert({
      entity_type: robloxType,
      entity_id: entityId,
      label,
      scan_types: robloxScanTypes,
      lookback_days: robloxLookback,
      baselined_scan_types: [],
    });
    if (error) toast.error(error.message);
    else {
      toast.success(`Now tracking Roblox ${robloxType}: ${label}`);
      setRobloxTarget("");
      setRobloxLabel("");
      await loadAll();
    }
  }

  function toggleNewRobloxScanType(scanType: string) {
    setRobloxScanTypes((current) =>
      current.includes(scanType)
        ? current.filter((value) => value !== scanType)
        : [...current, scanType],
    );
  }

  async function updateRobloxSettings(
    tracker: RobloxTracker,
    scanTypes: string[],
    lookbackDays: number,
  ) {
    if (!scanTypes.length) return toast.error("Keep at least one scan type enabled.");
    const { error } = await supabase
      .from("tracked_roblox_entities")
      .update({ scan_types: scanTypes, lookback_days: lookbackDays })
      .eq("id", tracker.id);
    if (error) toast.error(error.message);
    else {
      toast.success("Roblox scan settings updated.");
      await loadAll();
    }
  }

  async function forceRobloxProductCheck(
    tracker: RobloxTracker,
    kind: "game_pass" | "developer_product",
  ) {
    const requestKey = `${tracker.id}:${kind}`;
    setForcingRoblox(requestKey);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Your secure session expired. Sign in again.");
      const response = await fetch("/api/roblox/force-check", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ trackerId: tracker.id, kind }),
      });
      const body = await response.json() as {
        found?: boolean;
        item?: ForcedRobloxItem;
        discord_sent?: boolean;
        message?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(body.error ?? "The targeted Roblox check failed.");
      if (body.found && body.item) {
        setForcedRobloxItems((current) => ({ ...current, [tracker.id]: body.item! }));
        toast.success(`${body.item.name} found and sent to Discord.`);
      } else {
        toast.info(body.message ?? "No matching Roblox product was found.");
      }
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The targeted Roblox check failed.");
    } finally {
      setForcingRoblox(null);
    }
  }

  async function addExperienceTracker() {
    const value = experienceTarget.trim();
    const idMatch = value.match(/(?:games\/)(\d+)/i) ?? value.match(/^(\d+)$/);
    const placeId = Number(idMatch?.[1]);
    const label = experienceLabel.trim();
    if (!Number.isSafeInteger(placeId) || placeId <= 0) {
      return toast.error("Enter a Roblox game URL or numeric place ID.");
    }
    if (!label || label.length > 120) return toast.error("Enter a short experience label.");
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return toast.error("Your secure session expired. Sign in again.");
    setAddingExperience(true);
    try {
      const response = await fetch("/api/roblox/experiences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          placeId,
          label,
          lookbackDays: experienceLookback,
        }),
      });
      const body = await response.json() as { baseline_count?: number; error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not add experience.");
      toast.success(`${label} added with ${body.baseline_count ?? 0} existing products.`);
      setExperienceTarget("");
      setExperienceLabel("");
      await loadAll();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add experience.");
    } finally {
      setAddingExperience(false);
    }
  }

  async function remove(kind: "account" | "product" | "roblox" | "experience", id: string, label: string) {
    if (!window.confirm(`Stop tracking ${label}? This cannot be undone.`)) return;
    const table = kind === "account" ? "tracked_x_accounts" : kind === "product" ? "tracked_products" : kind === "roblox" ? "tracked_roblox_entities" : "tracked_roblox_experiences";
    const { error } = await supabase.from(table).delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success(`${label} removed`); await loadAll(); }
  }

  async function runNow() {
    setRunning(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Your secure session expired. Sign in again.");
      const res = await fetch("/api/public/run-checks", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "The check could not be completed.");
      toast.success(`Check complete: ${body.x_new_posts} new X posts, ${body.price_drops} price drops and ${body.roblox_new_items} Roblox uploads.`);
      if (body.errors?.length) toast.warning(`${body.errors.length} tracker(s) need attention.`);
      await loadAll();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Check failed. Try again."); }
    finally { setRunning(false); }
  }

  const filteredAccounts = useMemo(() => accounts.filter((a) => a.handle.toLowerCase().includes(query.toLowerCase())), [accounts, query]);
  const filteredProducts = useMemo(() => products.filter((p) => (p.label + p.url).toLowerCase().includes(query.toLowerCase())), [products, query]);
  const filteredExperiences = useMemo(() => experienceTrackers.filter((r) => (r.label + r.place_id + r.universe_id).toLowerCase().includes(query.toLowerCase())), [experienceTrackers, query]);
  const filteredRoblox = useMemo(() => robloxTrackers.filter((r) => (r.label + r.entity_type + r.entity_id).toLowerCase().includes(query.toLowerCase())), [robloxTrackers, query]);
  const all = [...accounts, ...products, ...robloxTrackers, ...experienceTrackers];
  const issues = all.filter((item) => item.last_error).length;
  const checked = all.map((item) => item.last_checked_at).filter(Boolean).sort().at(-1) ?? null;

  if (authLoading) {
    return <div className="auth-screen"><LoaderCircle className="animate-spin" /><span>VERIFYING SECURE SESSION</span></div>;
  }

  if (!user) {
    return (
      <main className="auth-screen">
        <div className="auth-panel">
          <div className="auth-lock"><LockKeyhole /></div>
          <p className="eyebrow"><span /> RESTRICTED SYSTEM</p>
          <h1>OWNER<br /><strong>ACCESS.</strong></h1>
          <p>Ambunctious Tracker is private. Enter the six-digit owner PIN. Access is rate-limited and securely verified by the server.</p>
          <div className="auth-form">
            <div className="relative">
              <LockKeyhole className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                autoComplete="current-password"
                aria-label="Owner PIN"
                placeholder="6-DIGIT PIN"
                value={loginPin}
                onChange={(event) => setLoginPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(event) => event.key === "Enter" && void signInWithPin()}
                className="command-input h-12 rounded-none pl-10 tracking-[0.4em]"
              />
            </div>
            <Button onClick={signInWithPin} disabled={signingIn} className="metal-button h-12 rounded-none">
              {signingIn ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}
              {signingIn ? "Verifying…" : "Unlock tracker"}
            </Button>
          </div>
          <small>SERVER-VERIFIED // FIVE ATTEMPTS PER 15 MINUTES</small>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="site-header sticky top-0 z-30">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="brand-mark"><img src={AB_MARK} alt="AB" /></div>
            <div className="min-w-0">
              <h1 className="brand-title truncate">AMBUNCTIOUS</h1>
              <p className="brand-subtitle hidden sm:block">TRACKER COMMAND SYSTEM</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="live-chip hidden sm:flex"><span /> NETWORK ONLINE</div>
            <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut />
            </Button>
            <Button onClick={runNow} disabled={running || loading} className="metal-button h-10 rounded-none px-3 sm:px-4">
            {running ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
            <span>{running ? "Checking…" : "Check now"}</span>
            </Button>
          </div>
        </div>
      </header>

      <section className="top-countdown" aria-label="Next scheduled network scan">
        <div className="top-countdown-inner">
          <div>
            <p><span /> NEXT NETWORK SCAN</p>
            <small>SECURE ONE-MINUTE CYCLE</small>
          </div>
          <strong aria-live="off">{formatScanCountdown(scanSeconds)}</strong>
          <i aria-hidden="true"><b style={{ width: `${(scanSeconds / SCAN_INTERVAL_SECONDS) * 100}%` }} /></i>
        </div>
      </section>

      <main className="mx-auto max-w-6xl px-4 pb-7 sm:px-6 sm:pb-10">
        <section className="command-hero">
          <img className="hero-banner" src={AB_BANNER} alt="" aria-hidden="true" />
          <div className="hero-grid" />
          <div className="hero-content">
            <p className="eyebrow"><span /> AB // LIVE INTELLIGENCE</p>
            <h2>CONTROL<br /><span>THE SIGNAL.</span></h2>
            <p>Precision monitoring for X activity and market movement. One-minute scans. Instant Discord transmission.</p>
            <div className="hero-status">
              <div><span>SCAN FREQUENCY</span><strong>60 SEC</strong></div>
              <div><span>DATA NODES</span><strong>{all.length.toString().padStart(2, "0")}</strong></div>
              <div><span>ANOMALIES</span><strong>{issues.toString().padStart(2, "0")}</strong></div>
            </div>
          </div>
        </section>

        <section className="control-bar">
          <div><p className="eyebrow">MONITORING MATRIX</p><h3>Active intelligence</h3></div>
          <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" size={16} />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="SEARCH NETWORK" className="command-input h-11 rounded-none pl-9" />
          </div>
        </section>

        <section className="metrics-grid mb-8 grid grid-cols-2 gap-px lg:grid-cols-4">
          <Card className="metric-card"><div className="metric-icon"><Activity /></div><p>Active trackers</p><strong>{all.length}</strong><span>{accounts.length} social · {products.length} prices · {robloxTrackers.length} Roblox</span></Card>
          <Card className="metric-card"><div className="metric-icon"><Twitter /></div><p>X accounts</p><strong>{accounts.length}</strong><span>Checked every 60 seconds</span></Card>
          <Card className="metric-card"><div className="metric-icon"><ShoppingBag /></div><p>Price watches</p><strong>{products.length}</strong><span>{Object.values(history).reduce((n, x) => n + x.length, 0)} data points</span></Card>
          <Card className={`metric-card ${issues ? "metric-warning" : ""}`}><div className="metric-icon">{issues ? <AlertTriangle /> : <CheckCircle2 />}</div><p>Tracker health</p><strong>{issues ? issues : "Good"}</strong><span>{issues ? "Need attention" : `Last check ${relativeTime(checked)}`}</span></Card>
        </section>

        {loading ? (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-white/8 bg-card/50">
            <LoaderCircle className="mr-2 animate-spin text-primary" /> Loading your trackers…
          </div>
        ) : (
          <Tabs defaultValue="x" className="space-y-5">
            <TabsList className="command-tabs h-12 w-full justify-start rounded-none p-1 sm:w-auto">
              <TabsTrigger value="x" className="h-10 flex-1 rounded-none px-4 sm:flex-none"><Twitter /> X SIGNALS <span className="count">{accounts.length}</span></TabsTrigger>
              <TabsTrigger value="products" className="h-10 flex-1 rounded-none px-4 sm:flex-none"><ShoppingBag /> PRICES <span className="count">{products.length}</span></TabsTrigger>
              <TabsTrigger value="roblox" className="h-10 flex-1 rounded-none px-4 sm:flex-none"><Gamepad2 /> ROBLOX <span className="count">{robloxTrackers.length}</span></TabsTrigger>
              <TabsTrigger value="experiences" className="h-10 flex-1 rounded-none px-4 sm:flex-none"><Gamepad2 /> EXPERIENCES <span className="count">{experienceTrackers.length}</span></TabsTrigger>
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
                    <div className="mt-5 flex items-end justify-between"><div><p className="panel-label">CURRENT PRICE</p><p className="price">{currencyPrice(p.currency, p.last_price)}</p>{p.last_price_gbp != null && p.currency !== "GBP" && <p className="gbp-price">≈ £{Number(p.last_price_gbp).toFixed(2)} GBP</p>}</div>{delta !== 0 && <span className={`delta ${delta < 0 ? "down" : "up"}`}>{delta < 0 ? <ArrowDownRight /> : <ArrowUpRight />}{Math.abs(delta).toFixed(2)}</span>}</div>
                    {points.length > 1 ? <div className="mt-4 h-32"><ResponsiveContainer width="100%" height="100%"><LineChart data={points}><XAxis dataKey="checked_at" hide /><YAxis hide domain={["auto", "auto"]} /><Tooltip contentStyle={{ background: "#111827", border: "1px solid #263247", borderRadius: 12 }} labelFormatter={(v) => new Date(v as string).toLocaleString()} formatter={(v) => [currencyPrice(p.currency, Number(v)), "Price"]} /><Line type="monotone" dataKey="price" stroke="#38bdf8" dot={false} strokeWidth={2.5} /></LineChart></ResponsiveContainer></div> : <div className="content-panel"><p className="text-sm text-muted-foreground">Price history will appear after two successful checks.</p></div>}
                    {p.last_error && <p className="error-copy"><AlertTriangle /> {p.last_error}</p>}
                    <div className="card-footer"><span>{points.length} recorded checks</span><Button variant="ghost" size="sm" onClick={() => void remove("product", p.id, p.label)}><Trash2 /> Remove</Button></div>
                  </Card>;
                })}</div>}
            </TabsContent>

            <TabsContent value="roblox" className="space-y-4">
              <Card className="add-card items-start">
                <div className="add-copy"><div className="add-icon"><LockKeyhole /></div><div><h3>Roblox Open Cloud</h3><p>{robloxKeyConfigured ? "Connected securely — monetization scans enabled." : "Connect a free read-only key for game passes and developer products."}</p></div></div>
                <div className="flex w-full gap-2 sm:max-w-xl">
                  <Input type="password" autoComplete="off" aria-label="Roblox Open Cloud API key" placeholder={robloxKeyConfigured ? "REPLACE SAVED KEY" : "PASTE OPEN CLOUD API KEY"} value={robloxApiKey} onChange={(e) => setRobloxApiKey(e.target.value)} className="h-11 rounded-xl" />
                  <Button onClick={saveRobloxKey} disabled={savingRobloxKey || !robloxApiKey.trim()} className="h-11 rounded-xl">{savingRobloxKey ? "Saving…" : robloxKeyConfigured ? "Replace" : "Connect"}</Button>
                </div>
              </Card>
              <Card className="add-card items-start">
                <div className="add-copy"><div className="add-icon"><Gamepad2 /></div><div><h3>Add a Roblox creator</h3><p>Watch public catalog uploads and experiences.</p></div></div>
                <div className="w-full space-y-3 sm:max-w-3xl">
                  <div className="grid gap-2 sm:grid-cols-[130px_1fr_1fr_150px_auto]">
                    <select aria-label="Roblox creator type" value={robloxType} onChange={(e) => setRobloxType(e.target.value as "user" | "group")} className="command-input h-11 rounded-xl px-3">
                      <option value="user">Profile</option><option value="group">Group</option>
                    </select>
                    <Input aria-label="Roblox URL or ID" placeholder="Profile/group URL or ID" value={robloxTarget} onChange={(e) => setRobloxTarget(e.target.value)} className="h-11 rounded-xl" />
                    <Input aria-label="Roblox tracker label" placeholder="Short label" value={robloxLabel} onChange={(e) => setRobloxLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addRobloxTracker()} className="h-11 rounded-xl" />
                    <select aria-label="Roblox lookback timeframe" value={robloxLookback} onChange={(e) => setRobloxLookback(Number(e.target.value))} className="command-input h-11 rounded-xl px-3">
                      <option value={7}>Past week</option><option value={30}>Past month</option><option value={90}>Past 3 months</option><option value={365}>Past year</option>
                    </select>
                    <Button onClick={addRobloxTracker} className="h-11 rounded-xl">Add</Button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {[
                      ["catalog", "Catalog uploads"],
                      ["experience", "Experiences"],
                      ["game_pass", "Game passes"],
                      ["developer_product", "Developer products"],
                    ].map(([value, label]) => (
                      <label key={value} className="status-pill status-waiting cursor-pointer">
                        <input type="checkbox" checked={robloxScanTypes.includes(value)} onChange={() => toggleNewRobloxScanType(value)} />
                        {label}
                      </label>
                    ))}
                  </div>
                  {(robloxScanTypes.includes("game_pass") || robloxScanTypes.includes("developer_product")) && <p className="text-xs text-muted-foreground">Monetization scans use a free server-side Roblox Open Cloud key; existing items establish a silent baseline.</p>}
                </div>
              </Card>
              {!filteredRoblox.length ? <Empty icon={<Gamepad2 />} title={query ? "No matching Roblox trackers" : "No Roblox creators yet"} copy={query ? "Try a different search." : "Add a public profile or group to monitor new creations."} /> :
                <div className="grid gap-3 lg:grid-cols-2">{filteredRoblox.map((r) => {
                  const href = r.entity_type === "user" ? `https://www.roblox.com/users/${r.entity_id}/profile` : `https://www.roblox.com/communities/${r.entity_id}`;
                  return <Card key={r.id} className="tracker-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3"><div className="tracker-avatar"><Gamepad2 /></div><div className="min-w-0"><a className="tracker-title" href={href} target="_blank" rel="noreferrer">{r.label} <ExternalLink /></a><p className="tracker-meta">{r.entity_type.toUpperCase()} #{r.entity_id} · Checked {relativeTime(r.last_checked_at)}</p></div></div>
                      <StatusPill error={r.last_error} checked={r.last_checked_at} />
                    </div>
                    <div className="content-panel space-y-3">
                      <p className="panel-label">SCAN SETTINGS</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          ["catalog", "Catalog"],
                          ["experience", "Experiences"],
                          ["game_pass", "Game passes"],
                          ["developer_product", "Developer products"],
                        ].map(([value, label]) => {
                          const active = (r.scan_types ?? []).includes(value);
                          return <label key={value} className={`status-pill ${active ? "status-healthy" : "status-waiting"} cursor-pointer`}>
                            <input type="checkbox" checked={active} onChange={() => {
                              const next = active ? r.scan_types.filter((item) => item !== value) : [...r.scan_types, value];
                              void updateRobloxSettings(r, next, r.lookback_days);
                            }} />
                            {label}
                          </label>;
                        })}
                      </div>
                      <label className="flex items-center gap-2 text-sm text-muted-foreground">Created within
                        <select value={r.lookback_days ?? 30} onChange={(e) => void updateRobloxSettings(r, r.scan_types, Number(e.target.value))} className="command-input h-9 rounded-lg px-2">
                          <option value={7}>1 week</option><option value={30}>1 month</option><option value={90}>3 months</option><option value={365}>1 year</option>
                        </select>
                      </label>
                      <p className="text-xs text-muted-foreground">Newly enabled types create a silent baseline before alerts begin.</p>
                      {r.entity_type === "group" && (
                        <div className="space-y-2 border-t border-white/10 pt-3">
                          <p className="panel-label">FORCE ONE PRODUCT CHECK</p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={forcingRoblox !== null || !robloxKeyConfigured}
                              onClick={() => void forceRobloxProductCheck(r, "game_pass")}
                            >
                              {forcingRoblox === `${r.id}:game_pass` ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                              Check latest game pass
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={forcingRoblox !== null || !robloxKeyConfigured}
                              onClick={() => void forceRobloxProductCheck(r, "developer_product")}
                            >
                              {forcingRoblox === `${r.id}:developer_product` ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
                              Check latest developer product
                            </Button>
                          </div>
                          {!robloxKeyConfigured && <p className="text-xs text-amber-400">Connect the Roblox Open Cloud key to enable manual checks.</p>}
                          {forcedRobloxItems[r.id] && (
                            <a
                              className="flex items-center gap-1 text-sm text-primary hover:underline"
                              href={forcedRobloxItems[r.id].url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Latest result: {forcedRobloxItems[r.id].name} <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                      )}
                    </div>
                    {r.last_error && <p className="error-copy"><AlertTriangle /> {r.last_error}</p>}
                    <div className="card-footer"><span>Discord alerts enabled</span><Button variant="ghost" size="sm" onClick={() => void remove("roblox", r.id, r.label)}><Trash2 /> Remove</Button></div>
                  </Card>;
                })}</div>}
            </TabsContent>

            <TabsContent value="experiences" className="space-y-4">
              <Card className="add-card items-start">
                <div className="add-copy"><div className="add-icon"><Gamepad2 /></div><div><h3>Track an experience</h3><p>Paste a game URL or place ID to watch all game passes and developer products.</p></div></div>
                <div className="grid w-full gap-2 sm:max-w-3xl sm:grid-cols-[1fr_1fr_auto]">
                  <Input aria-label="Roblox game URL or place ID" placeholder="Game URL or place ID" value={experienceTarget} onChange={(e) => setExperienceTarget(e.target.value)} className="h-11 rounded-xl" />
                  <Input aria-label="Experience label" placeholder="Experience label" value={experienceLabel} onChange={(e) => setExperienceLabel(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void addExperienceTracker()} className="h-11 rounded-xl" />
                  <Button onClick={addExperienceTracker} disabled={addingExperience} className="h-11 rounded-xl">
                    {addingExperience ? <LoaderCircle className="animate-spin" /> : <Plus />} {addingExperience ? "Adding…" : "Track"}
                  </Button>
                </div>
                <p className="w-full text-xs text-muted-foreground">Public game passes and developer products are listed for any public experience. Existing items create a silent baseline.</p>
              </Card>
              {!filteredExperiences.length ? <Empty icon={<Gamepad2 />} title={query ? "No matching experiences" : "No experiences tracked yet"} copy={query ? "Try a different search." : "Add a game above to list and monitor its monetization products."} /> :
                <div className="space-y-4">{filteredExperiences.map((experience) => {
                  const items = Array.isArray(experience.items) ? experience.items : [];
                  return <Card key={experience.id} className="tracker-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3"><div className="tracker-avatar"><Gamepad2 /></div><div className="min-w-0"><a className="tracker-title" href={`https://www.roblox.com/games/${experience.place_id}`} target="_blank" rel="noreferrer">{experience.label} <ExternalLink /></a><p className="tracker-meta">PLACE #{experience.place_id} · UNIVERSE #{experience.universe_id} · Checked {relativeTime(experience.last_checked_at)}</p></div></div>
                      <StatusPill error={experience.last_error} checked={experience.last_checked_at} />
                    </div>
                    <ExperienceItemsPanel items={items} lookbackDays={experience.lookback_days} />
                    {experience.last_error && <p className="error-copy"><AlertTriangle /> {experience.last_error}</p>}
                    <div className="card-footer">
                      <span>Every 60 seconds · Complete pass inventory · Discord alerts for new uploads</span>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={() => void runNow()} disabled={running}><RefreshCw /> Refresh</Button>
                        <Button variant="ghost" size="sm" onClick={() => void remove("experience", experience.id, experience.label)}><Trash2 /> Remove</Button>
                      </div>
                    </div>
                  </Card>;
                })}</div>}
            </TabsContent>
          </Tabs>
        )}
        <footer className="site-footer mt-10"><div className="footer-brand"><img src={AB_MARK} alt="" /><span>AMBUNCTIOUS<br /><small>TRACKER COMMAND</small></span></div><span>PRIVATE NETWORK // DISCORD UPLINK ACTIVE</span></footer>
      </main>
    </div>
  );
}

function Empty({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }) {
  return <Card className="empty-state"><div className="empty-icon">{icon}</div><h3>{title}</h3><p>{copy}</p></Card>;
}

type ThumbState = Record<string, string | null>;

async function fetchRobloxThumbs(
  kind: "game_pass" | "developer_product",
  ids: number[],
): Promise<Record<number, string | null>> {
  if (!ids.length) return {};
  const out: Record<number, string | null> = {};
  const endpoint = kind === "game_pass"
    ? "https://thumbnails.roblox.com/v1/game-passes"
    : "https://thumbnails.roblox.com/v1/developer-products/icons";
  const param = kind === "game_pass" ? "gamePassIds" : "developerProductIds";
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = new URL(endpoint);
    url.searchParams.set(param, chunk.join(","));
    url.searchParams.set("size", "150x150");
    url.searchParams.set("format", "Png");
    try {
      const res = await fetch(url.toString());
      if (!res.ok) { chunk.forEach((id) => (out[id] = null)); continue; }
      const body = await res.json() as { data?: Array<{ targetId?: number; state?: string; imageUrl?: string }> };
      for (const row of body.data ?? []) {
        if (typeof row.targetId !== "number") continue;
        out[row.targetId] = row.state === "Completed" && row.imageUrl ? row.imageUrl : null;
      }
      chunk.forEach((id) => { if (!(id in out)) out[id] = null; });
    } catch {
      chunk.forEach((id) => (out[id] = null));
    }
  }
  return out;
}

function ExperienceItemsPanel({ items, lookbackDays }: { items: ExperienceProductItem[]; lookbackDays: number }) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "game_pass" | "developer_product">("all");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name">("newest");
  const [recentOnly, setRecentOnly] = useState(false);
  const [thumbs, setThumbs] = useState<ThumbState>({});

  const hasAnyCreatedAt = useMemo(() => items.some((i) => !!i.createdAt), [items]);

  useEffect(() => {
    let cancelled = false;
    const missingPasses: number[] = [];
    const missingProducts: number[] = [];
    for (const item of items) {
      const key = `${item.kind}:${item.id}`;
      if (key in thumbs) continue;
      (item.kind === "game_pass" ? missingPasses : missingProducts).push(item.id);
    }
    if (!missingPasses.length && !missingProducts.length) return;
    (async () => {
      const [pass, prod] = await Promise.all([
        fetchRobloxThumbs("game_pass", missingPasses),
        fetchRobloxThumbs("developer_product", missingProducts),
      ]);
      if (cancelled) return;
      setThumbs((prev) => {
        const next: ThumbState = { ...prev };
        for (const [id, url] of Object.entries(pass)) next[`game_pass:${id}`] = url;
        for (const [id, url] of Object.entries(prod)) next[`developer_product:${id}`] = url;
        return next;
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoff = recentOnly && lookbackDays > 0
      ? Date.now() - lookbackDays * 86_400_000
      : null;
    const list = items.filter((item) => {
      if (typeFilter !== "all" && item.kind !== typeFilter) return false;
      if (q && !`${item.name} ${item.id}`.toLowerCase().includes(q)) return false;
      if (cutoff != null && item.createdAt) {
        if (Date.parse(item.createdAt) < cutoff) return false;
      } else if (cutoff != null && !item.createdAt) {
        return false;
      }
      return true;
    });
    list.sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      const at = a.createdAt ? Date.parse(a.createdAt) : 0;
      const bt = b.createdAt ? Date.parse(b.createdAt) : 0;
      return sortBy === "newest" ? bt - at || b.id - a.id : at - bt || a.id - b.id;
    });
    return list;
  }, [items, search, typeFilter, sortBy, recentOnly, lookbackDays]);

  const totalPasses = items.filter((i) => i.kind === "game_pass").length;
  const totalProducts = items.filter((i) => i.kind === "developer_product").length;
  const shownPasses = filtered.filter((i) => i.kind === "game_pass").length;
  const shownProducts = filtered.filter((i) => i.kind === "developer_product").length;

  const selectClass = "h-9 rounded-lg border border-input bg-background px-2 text-sm";

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search items"
            placeholder="Search name or ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 rounded-lg pl-8"
          />
        </div>
        <select aria-label="Type filter" className={selectClass} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="all">All types</option>
          <option value="game_pass">Game passes</option>
          <option value="developer_product">Developer products</option>
        </select>
        <select aria-label="Sort by" className={selectClass} value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name A–Z</option>
        </select>
        {hasAnyCreatedAt && lookbackDays > 0 && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={recentOnly} onChange={(e) => setRecentOnly(e.target.checked)} />
            Only last {lookbackDays}d
          </label>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {items.length} · Passes {shownPasses}/{totalPasses} · Dev products {shownProducts}/{totalProducts}
      </p>
      {!filtered.length ? (
        <p className="text-sm text-muted-foreground">No items match these filters.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {filtered.map((item) => {
            const thumb = thumbs[`${item.kind}:${item.id}`];
            const isPass = item.kind === "game_pass";
            return (
              <div
                key={item.key}
                className="group flex items-center gap-3 rounded-lg border border-white/8 bg-card/40 p-2 hover:border-primary/40 hover:bg-card/70"
              >
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-white/8 bg-background"
                  aria-label={`Open ${item.name} on Roblox`}
                >
                  {thumb ? (
                    <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : thumb === null ? (
                    <ImageOff className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                </a>
                <div className="min-w-0 flex-1">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-sm font-medium hover:text-primary group-hover:text-primary"
                  >
                    {item.name}
                  </a>
                  <p className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                    {isPass ? <><Package className="mr-1 inline h-3 w-3" />Game pass</> : <><ShoppingBag className="mr-1 inline h-3 w-3" />Dev product</>}
                    {" · #"}{item.id}
                    {item.createdAt ? ` · ${new Date(item.createdAt).toLocaleDateString()}` : ""}
                  </p>
                </div>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-white/10 px-2 py-1 text-xs font-medium hover:border-primary/50 hover:text-primary"
                  title={isPass ? "Open game pass page" : "Open experience store page (Roblox has no public developer-product detail page)"}
                >
                  View on Roblox <ExternalLink size={12} />
                </a>
              </div>
            );
          })}

        </div>
      )}
    </div>
  );
}
