import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" },
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
  const { data: isOwner, error: ownerError } = await (supabaseAdmin as any).rpc(
    "verify_tracker_owner_email",
    { candidate: data.user.email },
  );
  return !ownerError && isOwner === true ? supabaseAdmin : null;
}

type PrivateSecrets = {
  discord_bot_token?: string;
  discord_user_id?: string;
};

async function discordRequest(token: string, path: string, init: RequestInit) {
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Ambunctious-Tracker/1.0",
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    let detail = text.slice(0, 300);
    try {
      const parsed = JSON.parse(text) as { message?: string };
      detail = parsed.message || detail;
    } catch (_e) {
      /* ignore parse errors */
    }
    throw new Error(`Discord HTTP ${response.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : null;
}

export const Route = createFileRoute("/api/bot-connections/test-dm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);
        try {
          const { data, error } = await (client as any).rpc("get_private_alert_secrets");
          if (error) throw new Error(`Could not read Discord settings: ${error.message}`);
          const secrets = (data ?? {}) as PrivateSecrets;
          const botToken = secrets.discord_bot_token?.trim() ?? "";
          const userId = secrets.discord_user_id?.trim() ?? "";
          if (botToken.length < 30 || !/^\d{10,30}$/.test(userId)) {
            return json({ error: "Configure your Discord bot token and user ID first." }, 400);
          }

          const bot = (await discordRequest(botToken, "/users/@me", { method: "GET" })) as {
            username?: string;
          } | null;
          const dm = (await discordRequest(botToken, "/users/@me/channels", {
            method: "POST",
            body: JSON.stringify({ recipient_id: userId }),
          })) as { id?: string } | null;
          if (!dm?.id) throw new Error("Discord did not create a DM channel.");

          const sentAt = new Date().toISOString();
          await discordRequest(botToken, `/channels/${dm.id}/messages`, {
            method: "POST",
            body: JSON.stringify({
              content:
                "✅ **Ambunctious Tracker test successful**\n\nYour private Discord alerts are connected and ready. You will receive a DM here when BIG Games posts something new.",
              embeds: [
                {
                  title: "Connection confirmed",
                  description:
                    "Discord bot token: valid\nDM recipient: reachable\nBIG Games alert channel: ready",
                  color: 0x22c55e,
                  timestamp: sentAt,
                  footer: { text: "Ambunctious Tracker • Test message" },
                },
              ],
              allowed_mentions: { parse: [] },
            }),
          });

          return json({ sent: true, sentAt, botName: bot?.username ?? "Discord bot" });
        } catch (cause) {
          return json(
            { error: cause instanceof Error ? cause.message : "Could not send the test DM." },
            502,
          );
        }
      },
    },
  },
});
