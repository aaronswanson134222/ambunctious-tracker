import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function ownerClient(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 4096) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const { data: isOwner, error: ownerError } = await (supabaseAdmin as any)
    .rpc("verify_tracker_owner_email", { candidate: data.user.email });
  return !ownerError && isOwner === true ? supabaseAdmin : null;
}

export const Route = createFileRoute("/api/private-alerts/settings")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);
        const { data, error } = await (client as any).rpc("has_private_alert_secrets");
        if (error) return json({ error: "Could not read private alert settings" }, 503);
        return json({ configured: data === true });
      },
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);
        let body: { botToken?: unknown; discordUserId?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        const botToken = typeof body.botToken === "string" ? body.botToken.trim() : "";
        const discordUserId = typeof body.discordUserId === "string" ? body.discordUserId.trim() : "";
        if (botToken.length < 30 || !/^\d{10,30}$/.test(discordUserId)) {
          return json({ error: "Enter a valid bot token and Discord user ID" }, 400);
        }
        const { data, error } = await (client as any).rpc("set_private_alert_secrets", {
          bot_token: botToken,
          discord_user_id: discordUserId,
        });
        if (error || data !== true) return json({ error: error?.message || "Could not save settings" }, 400);
        return json({ configured: true });
      },
    },
  },
});