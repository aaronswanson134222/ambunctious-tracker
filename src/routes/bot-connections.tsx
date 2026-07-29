import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowLeft,
  BellRing,
  Bot,
  CheckCircle2,
  Database,
  ExternalLink,
  Gamepad2,
  Globe2,
  LoaderCircle,
  RefreshCw,
  Send,
  Settings,
  TriangleAlert,
  Twitter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/bot-connections")({ component: BotConnections });

type StatusData = {
  checkedAt: string;
  database: boolean;
  discordConfigured: boolean;
  counts: {
    x: number | null;
    roblox: number | null;
    experiences: number | null;
    websites: number | null;
    products: number | null;
  };
  discord: Record<string, unknown>[];
  runs: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  state: Record<string, unknown>[];
};

function time(value: unknown) {
  if (typeof value !== "string" || !value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function latestTime(row?: Record<string, unknown>) {
  if (!row) return "No activity yet";
  for (const key of [
    "created_at",
    "checked_at",
    "finished_at",
    "started_at",
    "updated_at",
    "last_checked_at",
    "sent_at",
  ]) {
    if (row[key]) return time(row[key]);
  }
  return "Recorded";
}

function rowTitle(row: Record<string, unknown>) {
  for (const key of [
    "message",
    "event_type",
    "status",
    "kind",
    "source",
    "job_name",
    "tracker_type",
    "label",
  ]) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "Tracker activity";
}

function StatusCard({
  icon,
  title,
  healthy,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  healthy: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="tracker-card space-y-4 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="tracker-avatar">{icon}</div>
          <h2 className="text-lg font-semibold">{title}</h2>
        </div>
        <span className={`status-pill ${healthy ? "status-healthy" : "status-waiting"}`}>
          {healthy ? <CheckCircle2 size={14} /> : <TriangleAlert size={14} />}
          {healthy ? "Connected" : "Setup required"}
        </span>
      </div>
      {children}
    </Card>
  );
}

function BotConnections() {
  const [data, setData] = useState<StatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [testingDm, setTestingDm] = useState(false);
  const [dmResult, setDmResult] = useState<{ ok: boolean; message: string } | null>(null);

  const accessToken = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token ?? "";
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = await accessToken();
      if (!token) throw new Error("Sign into the tracker first.");
      const response = await fetch("/api/bot-connections/status", {
        Authorization: Bearer $trailing
      });
      const body = (await response.json()) as StatusData & { error?: string };
      if (!response.ok) throw new Error(body.error || "Could not load connection status.");
      setData(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load connection status.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  async function sendTestDm() {
    setTestingDm(true);
    setDmResult(null);
    try {
      const token = await accessToken();
      if (!token) throw new Error("Sign into the tracker first.");
      const response = await fetch("/api/bot-connections/test-dm", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`` },
      });
      const body = (await response.json()) as {
        sent?: boolean;
        sentAt?: string;
        botName?: string;
        error?: string;
      };
      if (!response.ok || !body.sent) throw new Error(body.error || "Could not send the test DM.");
      setDmResult({
        ok: true,
        message: `Test DM sent successfully from ${body.botName ?? "your bot"} at ${time(body.sentAt)}.`,
      });
      await load();
    } catch (cause) {
      setDmResult({
        ok: false,
        message: cause instanceof Error ? cause.message : "Could not send the test DM.",
      });
    } finally {
      setTestingDm(false);
    }
  }

  useEffect(() => {
    void load();
  }, [load]);

  const activity = useMemo(() => {
    const rows = [...(data?.notifications ?? []), ...(data?.runs ?? [])];
    return rows.slice(0, 50);
  }, [data]);

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} /> Back to tracker
          </Link>
          <Button
            onClick={() => void load()}
            disabled={loading}
            className="metal-button rounded-xl"
          >
            {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />} Refresh
          </Button>
        </div>

        <Card className="tracker-card p-5 sm:p-7">
          <p className="eyebrow">
            <span /> CONNECTION CONTROL
          </p>
          <div className="mt-3 flex items-start gap-4">
            <div className="tracker-avatar">
              <Bot />
            </div>
            <div>
              <h1 className="text-2xl font-semibold sm:text-3xl">Bot Connections</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Live status for Discord, X, Roblox, websites and the tracker database.
              </p>
            </div>
          </div>
        </Card>

        {error && (
          <Card className="tracker-card p-5">
            <p className="error-copy">
              <TriangleAlert /> {error}
            </p>
          </Card>
        )}
        {loading && !data ? (
          <Card className="tracker-card flex min-h-52 items-center justify-center">
            <LoaderCircle className="mr-2 animate-spin" /> Loading connections…
          </Card>
        ) : (
          data && (
            <>
              <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <StatusCard icon={<BellRing />} title="Discord" healthy={data.discordConfigured}>
                  <p className="text-sm text-muted-foreground">
                    {data.discordConfigured
                      ? "Bot token and DM recipient are securely configured."
                      : "Add your Discord bot token and user ID."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last status: {latestTime(data.discord[0])}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void sendTestDm()}
                      disabled={testingDm || !data.discordConfigured}
                    >
                      {testingDm ? <LoaderCircle className="animate-spin" /> : <Send />}{" "}
                      {testingDm ? "Sending…" : "Send Test DM"}
                    </Button>
                    <a href="/private-alerts">
                      <Button size="sm" variant="outline">
                        <Settings size={15} /> Configure
                      </Button>
                    </a>
                  </div>
                  {dmResult && (
                    <p className={`text-sm ${dmResult.ok ? "text-emerald-400" : "error-copy"}`}>
                      {dmResult.ok ? (
                        <CheckCircle2 className="mr-1 inline" size={15} />
                      ) : (
                        <TriangleAlert className="mr-1 inline" size={15} />
                      )}
                      {dmResult.message}
                    </p>
                  )}
                </StatusCard>

                <StatusCard
                  icon={<Twitter />}
                  title="X / BIG Games"
                  healthy={(data.counts.x ?? 0) > 0}
                >
                  <p className="text-3xl font-semibold">{data.counts.x ?? "—"}</p>
                  <p className="text-sm text-muted-foreground">Monitored X accounts</p>
                  <p className="text-xs text-muted-foreground">
                    Latest event:{" "}
                    {latestTime(
                      data.notifications.find(
                        (r) =>
                          String(r.source ?? r.kind ?? "")
                            .toLowerCase()
                            .includes("x") ||
                          String(r.source ?? r.kind ?? "")
                            .toLowerCase()
                            .includes("big"),
                      ),
                    )}
                  </p>
                </StatusCard>

                <StatusCard
                  icon={<Gamepad2 />}
                  title="Roblox"
                  healthy={(data.counts.roblox ?? 0) + (data.counts.experiences ?? 0) > 0}
                >
                  <p className="text-sm">
                    <strong>{data.counts.roblox ?? "—"}</strong> creators ·{" "}
                    <strong>{data.counts.experiences ?? "—"}</strong> experiences
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last scan: {latestTime(data.runs[0])}
                  </p>
                  <a
                    href="/"
                    className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    Open Roblox trackers <ExternalLink size={14} />
                  </a>
                </StatusCard>

                <StatusCard
                  icon={<Globe2 />}
                  title="Websites & prices"
                  healthy={(data.counts.websites ?? 0) + (data.counts.products ?? 0) > 0}
                >
                  <p className="text-sm">
                    <strong>{data.counts.websites ?? "—"}</strong> websites ·{" "}
                    <strong>{data.counts.products ?? "—"}</strong> price watches
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Latest activity: {latestTime(data.notifications[0])}
                  </p>
                </StatusCard>

                <StatusCard icon={<Database />} title="System health" healthy={data.database}>
                  <p className="text-sm text-muted-foreground">Database connection is reachable.</p>
                  <p className="text-xs text-muted-foreground">
                    Status refreshed: {time(data.checkedAt)}
                  </p>
                </StatusCard>

                <StatusCard icon={<Activity />} title="Quick actions" healthy>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      onClick={() => void sendTestDm()}
                      disabled={testingDm || !data.discordConfigured}
                    >
                      {testingDm ? <LoaderCircle className="animate-spin" /> : <Send />} Test DM
                    </Button>
                    <a href="/puzzle-solver">
                      <Button size="sm" variant="outline">
                        Puzzle solver
                      </Button>
                    </a>
                    <a href="/">
                      <Button size="sm" variant="outline">
                        Run checks
                      </Button>
                    </a>
                  </div>
                </StatusCard>
              </section>

              <Card className="tracker-card p-5 sm:p-6">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="panel-label">RECENT ACTIVITY</p>
                    <h2 className="text-xl font-semibold">Connection logs</h2>
                  </div>
                  <span className="status-pill status-healthy">
                    <Activity size={14} /> {activity.length} entries
                  </span>
                </div>
                {!activity.length ? (
                  <p className="text-sm text-muted-foreground">
                    No tracker activity has been recorded yet.
                  </p>
                ) : (
                  <div className="divide-y divide-white/10">
                    {activity.map((row, index) => (
                      <div
                        key={String(row.id ?? index)}
                        className="flex items-start justify-between gap-4 py-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{rowTitle(row)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{latestTime(row)}</p>
                        </div>
                        <span
                          className={`status-pill ${
                            String(row.status ?? "")
                              .toLowerCase()
                              .includes("fail") || row.error
                              ? "status-error"
                              : "status-healthy"
                          }`}
                        >
                          {row.error ? "Error" : String(row.status ?? "Recorded")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )
        )}
      </div>
    </main>
  );
}

