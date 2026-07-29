import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

function json(body: unknown, status = 200) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

export const Route = createFileRoute("/api/local-db")({ server: { handlers: {
  POST: async ({ request }) => {
    const auth = request.headers.get("authorization");
    const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    const user = token ? await supabaseAdmin.auth.getUser(token) : null;
    if (!user || user.error || !user.data.user) return json({ data: null, error: { message: "Unauthorized" } }, 401);
    let body: any;
    try { body = await request.json(); } catch { return json({ data: null, error: { message: "Invalid request" } }, 400); }
    const allowed = new Set(["tracked_x_accounts","tracked_products","price_history","tracked_roblox_entities","tracked_roblox_experiences","tracked_websites","tracker_notification_events","tracker_api_releases","tracker_scan_runs","tracker_discord_status"]);
    if (!allowed.has(body.table)) return json({ data: null, error: { message: "Unknown table" } }, 400);
    let query: any = supabaseAdmin.from(body.table);
    if (body.action === "insert") query = query.insert(body.payload);
    else if (body.action === "update") query = query.update(body.payload);
    else if (body.action === "delete") query = query.delete();
    else if (body.action === "upsert") query = query.upsert(body.payload);
    else query = query.select(body.columns ?? "*", body.options);
    for (const [key, value] of body.filters ?? []) query = query.eq(key, value);
    if (body.order) query = query.order(body.order[0], body.order[1]);
    if (body.limit) query = query.limit(body.limit);
    if (body.single) query = query.maybeSingle();
    return json(await query);
  },
} } });
