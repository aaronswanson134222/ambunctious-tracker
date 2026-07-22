import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

async function ownerClient(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 4096) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const { data: isOwner, error: ownerError } = await (supabaseAdmin as any).rpc("verify_tracker_owner_email", { candidate: data.user.email });
  return !ownerError && isOwner === true ? supabaseAdmin : null;
}

async function count(client: any, table: string) {
  const { count, error } = await client.from(table).select("*", { count: "exact", head: true });
  return { count: error ? null : count ?? 0, error: error?.message ?? null };
}

async function latest(client: any, table: string, limit = 10) {
  const { data, error } = await client.from(table).select("*").order("created_at", { ascending: false }).limit(limit);
  if (!error) return data ?? [];
  const fallback = await client.from(table).select("*").limit(limit);
  return fallback.error ? [] : fallback.data ?? [];
}

export const Route = createFileRoute("/api/bot-connections/status")({
  server: { handlers: { GET: async ({ request }) => {
    const client = await ownerClient(request);
    if (!client) return json({ error: "Unauthorized" }, 401);
    const [discordConfigured, x, roblox, experiences, websites, products, discordRows, runs, notifications, state] = await Promise.all([
      (client as any).rpc("has_private_alert_secrets"),
      count(client, "tracked_x_accounts"),
      count(client, "tracked_roblox_entities"),
      count(client, "tracked_roblox_experiences"),
      count(client, "tracked_websites"),
      count(client, "tracked_products"),
      latest(client, "tracker_discord_status", 5),
      latest(client, "tracker_scan_runs", 25),
      latest(client, "tracker_notification_events", 25),
      latest(client, "tracker_run_state", 10),
    ]);
    return json({
      checkedAt: new Date().toISOString(),
      database: true,
      discordConfigured: discordConfigured.data === true,
      counts: { x: x.count, roblox: roblox.count, experiences: experiences.count, websites: websites.count, products: products.count },
      discord: discordRows,
      runs,
      notifications,
      state,
    });
  } } },
});
