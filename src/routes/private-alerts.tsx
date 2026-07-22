import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, BellRing, CheckCircle2, LoaderCircle, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/private-alerts")({ component: PrivateAlerts });

function PrivateAlerts() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [discordUserId, setDiscordUserId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function token() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? "";
  }

  useEffect(() => {
    void (async () => {
      const auth = await token();
      if (!auth) { setError("Sign into the tracker first."); setLoading(false); return; }
      const response = await fetch("/api/private-alerts/settings", { headers: { Authorization: `Bearer ${auth}` } });
      const body = await response.json() as { configured?: boolean };
      setConfigured(body.configured === true);
      setLoading(false);
    })();
  }, []);

  async function save() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const auth = await token();
      if (!auth) throw new Error("Sign into the tracker first.");
      const response = await fetch("/api/private-alerts/settings", {
        method: "POST",
        headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
        body: JSON.stringify({ botToken, discordUserId }),
      });
      const body = await response.json() as { configured?: boolean; error?: string };
      if (!response.ok || !body.configured) throw new Error(body.error || "Could not save settings.");
      setConfigured(true);
      setBotToken("");
      setDiscordUserId("");
      setMessage("Private BIG Games DMs are configured. The puzzle solver is free and runs in your browser.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-3xl space-y-5">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Back to tracker</Link>
        <Card className="tracker-card space-y-5 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="tracker-avatar"><BellRing /></div>
            <div>
              <p className="eyebrow"><span /> PRIVATE UPLINK</p>
              <h1 className="text-2xl font-semibold">BIG Games DM alerts</h1>
              <p className="mt-2 text-sm text-muted-foreground">The Discord credentials are stored in Supabase Vault and are never returned to the browser.</p>
            </div>
          </div>

          {loading ? <p className="flex items-center gap-2"><LoaderCircle className="animate-spin" /> Checking configuration…</p> : (
            <div className={`status-pill ${configured ? "status-healthy" : "status-waiting"}`}>
              {configured ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}
              {configured ? "Configured" : "Setup required"}
            </div>
          )}

          <div className="space-y-4">
            <div><label className="mb-2 block text-sm font-medium">Discord bot token</label><Input type="password" autoComplete="off" value={botToken} onChange={(e) => setBotToken(e.target.value)} placeholder="Paste your newly regenerated bot token" className="h-11 rounded-xl" /></div>
            <div><label className="mb-2 block text-sm font-medium">Your Discord user ID</label><Input inputMode="numeric" value={discordUserId} onChange={(e) => setDiscordUserId(e.target.value.replace(/\D/g, ""))} placeholder="Example: 123456789012345678" className="h-11 rounded-xl" /></div>
          </div>

          <Button onClick={save} disabled={saving || !botToken || !discordUserId} className="metal-button h-12 w-full rounded-xl">
            {saving ? <LoaderCircle className="animate-spin" /> : <LockKeyhole />}{saving ? "Saving securely…" : "Save private alert settings"}
          </Button>
          {message && <p className="status-pill status-healthy">{message}</p>}
          {error && <p className="error-copy">{error}</p>}

          <div className="content-panel space-y-2 text-sm text-muted-foreground">
            <p className="panel-label">NO PAID API REQUIRED</p>
            <p>Discord DMs are free. The puzzle solver uses on-device OCR and local puzzle checks, so it does not need an OpenAI key or create API charges.</p>
            <p>Invite the bot to at least one server you share, enable direct messages for that server, and enable Developer Mode to copy your user ID.</p>
          </div>
        </Card>
      </div>
    </main>
  );
}