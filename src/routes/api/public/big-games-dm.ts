import { createFileRoute } from "@tanstack/react-router";
import { checkXProfile } from "@/lib/tracker.server";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function statusId(url: string | null) {
  return url?.match(/\/status\/(\d+)/)?.[1] ?? null;
}

function authorized(request: Request) {
  const expected = process.env.TRACKER_CRON_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return Boolean(expected && supplied && supplied === expected);
}

async function discordRequest(path: string, init: RequestInit) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) throw new Error("DISCORD_BOT_TOKEN is not configured");
  const response = await fetch(`https://discord.com/api/v10${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "Ambunctious-Tracker/1.0",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Discord bot HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  return response.json().catch(() => null);
}

async function sendPrivateAlert(postUrl: string, postText: string | null) {
  const userId = process.env.DISCORD_USER_ID?.trim();
  if (!userId || !/^\d{10,30}$/.test(userId)) {
    throw new Error("DISCORD_USER_ID is not configured");
  }
  const dm = await discordRequest("/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: userId }),
  }) as { id?: string } | null;
  if (!dm?.id) throw new Error("Discord did not create a DM channel");

  const solverUrl = new URL("https://ambunctious-tracker.lovable.app/puzzle-solver");
  solverUrl.searchParams.set("tweet", postUrl);
  await discordRequest(`/channels/${dm.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content: "🚨 **BIG Games just posted.** Open it now in case it is a puzzle or limited reward.",
      embeds: [{
        title: "New post from @BIGGames",
        url: postUrl,
        description: postText?.slice(0, 1500) || "Open the post to view its contents.",
        color: 0x1da1f2,
        timestamp: new Date().toISOString(),
        footer: { text: "Ambunctious Tracker • Private alert" },
      }],
      components: [{
        type: 1,
        components: [
          { type: 2, style: 5, label: "Open tweet", url: postUrl },
          { type: 2, style: 5, label: "Solve puzzle", url: solverUrl.toString() },
        ],
      }],
      allowed_mentions: { parse: [] },
    }),
  });
}

async function run() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { postUrl, postText } = await checkXProfile("BIGGames");
  const id = statusId(postUrl);
  if (!postUrl || !id) throw new Error("BIG Games did not return a public post");

  const db = supabaseAdmin as any;
  const { error } = await db.from("tracker_notification_events").insert({
    source_type: "big_games_dm",
    source_id: "BIGGames",
    fingerprint: id,
  });
  if (error?.code === "23505") return { sent: false, duplicate: true, post_url: postUrl };
  if (error) throw new Error(`Could not reserve BIG Games alert: ${error.message}`);

  try {
    await sendPrivateAlert(postUrl, postText);
    await db.from("tracker_notification_events")
      .update({ sent_at: new Date().toISOString() })
      .eq("source_type", "big_games_dm")
      .eq("source_id", "BIGGames")
      .eq("fingerprint", id);
    return { sent: true, duplicate: false, post_url: postUrl };
  } catch (error) {
    await db.from("tracker_notification_events")
      .delete()
      .eq("source_type", "big_games_dm")
      .eq("source_id", "BIGGames")
      .eq("fingerprint", id);
    throw error;
  }
}

export const Route = createFileRoute("/api/public/big-games-dm")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!authorized(request)) return json({ error: "Unauthorized" }, 401);
        try {
          return json(await run());
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : String(error) }, 500);
        }
      },
    },
  },
});
