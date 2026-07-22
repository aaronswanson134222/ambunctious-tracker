type DiscordPayload = {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
};

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
  if (!response.ok) {
    throw new Error(`Discord bot HTTP ${response.status}: ${(await response.text()).slice(0, 240)}`);
  }
  return response.json().catch(() => null);
}

export async function sendOwnerDm(payload: DiscordPayload) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await (supabaseAdmin as any).rpc("get_private_alert_secrets");
  if (error) throw new Error(`Could not read private alert settings: ${error.message}`);
  const secrets = (data ?? {}) as PrivateSecrets;
  const token = secrets.discord_bot_token?.trim() ?? "";
  const userId = secrets.discord_user_id?.trim() ?? "";
  if (!token || token.length < 30) throw new Error("Discord bot token is not configured");
  if (!/^\d{10,30}$/.test(userId)) throw new Error("Discord user ID is not configured");

  const dm = await discordRequest(token, "/users/@me/channels", {
    method: "POST",
    body: JSON.stringify({ recipient_id: userId }),
  }) as { id?: string } | null;
  if (!dm?.id) throw new Error("Discord did not create a DM channel");

  await discordRequest(token, `/channels/${dm.id}/messages`, {
    method: "POST",
    body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
  });
}
