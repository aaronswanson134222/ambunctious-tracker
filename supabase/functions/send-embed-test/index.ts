import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function safeString(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function validateWebhook(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && ["discord.com", "discordapp.com"].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
      && /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

function sanitiseEmbed(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid embed payload");
  const raw = input as Record<string, unknown>;
  const title = safeString(raw.title, 256);
  const description = safeString(raw.description, 4096);
  const url = safeUrl(raw.url);
  const color = Number(raw.color);
  const timestamp = safeString(raw.timestamp, 64);

  const fields = Array.isArray(raw.fields)
    ? raw.fields.slice(0, 25).map((field) => {
        if (!field || typeof field !== "object" || Array.isArray(field)) return null;
        const item = field as Record<string, unknown>;
        const name = safeString(item.name, 256);
        const value = safeString(item.value, 1024);
        if (!name || !value) return null;
        return { name, value, inline: item.inline === true };
      }).filter(Boolean)
    : [];

  const authorRaw = raw.author && typeof raw.author === "object" && !Array.isArray(raw.author)
    ? raw.author as Record<string, unknown>
    : null;
  const footerRaw = raw.footer && typeof raw.footer === "object" && !Array.isArray(raw.footer)
    ? raw.footer as Record<string, unknown>
    : null;
  const imageRaw = raw.image && typeof raw.image === "object" && !Array.isArray(raw.image)
    ? raw.image as Record<string, unknown>
    : null;
  const thumbnailRaw = raw.thumbnail && typeof raw.thumbnail === "object" && !Array.isArray(raw.thumbnail)
    ? raw.thumbnail as Record<string, unknown>
    : null;

  const embed: Record<string, unknown> = {
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(url ? { url } : {}),
    ...(Number.isInteger(color) && color >= 0 && color <= 0xffffff ? { color } : {}),
    ...(fields.length ? { fields } : {}),
    ...(timestamp && Number.isFinite(Date.parse(timestamp)) ? { timestamp: new Date(timestamp).toISOString() } : {}),
  };

  const authorName = safeString(authorRaw?.name, 256);
  if (authorName) embed.author = { name: authorName, ...(safeUrl(authorRaw?.icon_url) ? { icon_url: safeUrl(authorRaw?.icon_url) } : {}) };
  const footerText = safeString(footerRaw?.text, 2048);
  if (footerText) embed.footer = { text: footerText, ...(safeUrl(footerRaw?.icon_url) ? { icon_url: safeUrl(footerRaw?.icon_url) } : {}) };
  const imageUrl = safeUrl(imageRaw?.url);
  if (imageUrl) embed.image = { url: imageUrl };
  const thumbnailUrl = safeUrl(thumbnailRaw?.url);
  if (thumbnailUrl) embed.thumbnail = { url: thumbnailUrl };

  if (!title && !description && !fields.length) throw new Error("Embed is empty");
  return embed;
}

async function sendDiscord(webhook: string, embed: Record<string, unknown>) {
  const url = new URL(webhook);
  url.searchParams.set("wait", "true");

  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        redirect: "manual",
        headers: { "Content-Type": "application/json", "User-Agent": "Ambunctious-Tracker-Edge/1.0" },
        body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
      });
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text();
    if (response.ok) {
      try {
        const body = JSON.parse(text) as { id?: unknown };
        return typeof body.id === "string" ? body.id : null;
      } catch {
        return null;
      }
    }

    if (response.status !== 429 || attempt === 4) {
      throw Object.assign(new Error(`Discord webhook ${response.status}: ${text.slice(0, 240)}`), { status: response.status });
    }

    let retryAfterSeconds = Number(response.headers.get("retry-after")) || 0;
    try {
      const parsed = JSON.parse(text) as { retry_after?: unknown };
      if (typeof parsed.retry_after === "number") retryAfterSeconds = parsed.retry_after;
    } catch {
      // Cloudflare may return HTML.
    }
    retryAfterSeconds = Math.min(30, Math.max(1, retryAfterSeconds || attempt * 2));
    await new Promise((resolve) => setTimeout(resolve, retryAfterSeconds * 1000 + Math.floor(Math.random() * 250)));
  }
  return null;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) return json({ error: "Edge Function is not configured" }, 500);

  const authHeader = request.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const token = authHeader.slice(7).trim();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const email = userData.user?.email;
  if (userError || !email) return json({ error: "Unauthorized" }, 401);

  const { data: isOwner, error: ownerError } = await admin.rpc("verify_tracker_owner_email", { candidate: email });
  if (ownerError || isOwner !== true) return json({ error: "Forbidden" }, 403);

  let body: { embed?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request body" }, 400);
  }

  let embed: Record<string, unknown>;
  try {
    embed = sanitiseEmbed(body.embed);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid embed" }, 400);
  }

  const { data: webhook, error: webhookError } = await admin.rpc("get_embed_test_webhook");
  if (webhookError || !validateWebhook(webhook)) return json({ error: "Add a dedicated embed webhook before sending tests." }, 400);

  try {
    const messageId = await sendDiscord(webhook, embed);
    return json({ sent: true, messageId });
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === "number" ? Number((error as { status?: number }).status) : 502;
    return json({ error: error instanceof Error ? error.message : "Discord send failed" }, status === 429 ? 429 : 502);
  }
});
