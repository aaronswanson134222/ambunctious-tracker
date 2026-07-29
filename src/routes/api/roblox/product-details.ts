import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
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
  const { data: isOwner, error: ownerError } = await (supabaseAdmin as any).rpc(
    "verify_tracker_owner_email",
    { candidate: data.user.email },
  );
  return !ownerError && isOwner === true ? supabaseAdmin : null;
}

async function robloxJson(url: URL): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": "Ambunctious-Tracker/1.0" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchThumbnail(kind: "game_pass" | "developer_product", id: number) {
  try {
    const url = new URL(
      kind === "game_pass"
        ? "https://thumbnails.roblox.com/v1/game-passes"
        : "https://thumbnails.roblox.com/v1/developer-products/icons",
    );
    url.searchParams.set(kind === "game_pass" ? "gamePassIds" : "developerProductIds", String(id));
    url.searchParams.set("size", "420x420");
    url.searchParams.set("format", "Png");
    url.searchParams.set("isCircular", "false");
    const row = (await robloxJson(url))?.data?.[0];
    return row?.state === "Completed" && typeof row.imageUrl === "string" ? row.imageUrl : null;
  } catch {
    return null;
  }
}

async function fetchUniverseDetails(universeId: number) {
  try {
    const url = new URL("https://games.roblox.com/v1/games");
    url.searchParams.set("universeIds", String(universeId));
    const row = (await robloxJson(url))?.data?.[0];
    if (!row) return null;
    return {
      name: typeof row.name === "string" ? row.name : null,
      creatorName: typeof row.creator?.name === "string" ? row.creator.name : null,
      creatorType: typeof row.creator?.type === "string" ? row.creator.type : null,
      creatorId: typeof row.creator?.id === "number" ? row.creator.id : null,
    };
  } catch {
    return null;
  }
}

async function fetchGamePassInfo(id: number) {
  try {
    const body = await robloxJson(
      new URL(`https://apis.roblox.com/game-passes/v1/game-passes/${id}`),
    );
    return {
      name: typeof body?.name === "string" ? body.name : null,
      description: typeof body?.description === "string" ? body.description : null,
      priceInRobux: typeof body?.priceInRobux === "number" ? body.priceInRobux : null,
      isForSale: typeof body?.isForSale === "boolean" ? body.isForSale : null,
      createdAt: typeof body?.created === "string" ? body.created : null,
      iconImageAssetId: typeof body?.iconImageAssetId === "number" ? body.iconImageAssetId : null,
    };
  } catch {
    return null;
  }
}

async function fetchDeveloperProductInfo(universeId: number, productId: number) {
  let cursor = "";
  for (let page = 0; page < 8; page++) {
    try {
      const url = new URL(
        `https://apis.roblox.com/developer-products/v2/universes/${universeId}/developerproducts`,
      );
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const body = await robloxJson(url);
      const rows = Array.isArray(body?.developerProducts)
        ? body.developerProducts
        : Array.isArray(body?.data)
          ? body.data
          : [];
      const row = rows.find(
        (item: any) =>
          Number(item?.DeveloperProductId ?? item?.TargetId ?? item?.id ?? item?.productId) ===
          productId,
      );
      if (row) {
        const price = row.PriceInRobux ?? row.priceInRobux ?? row.Price ?? row.price;
        const sale = row.ShopEnabled ?? row.shopEnabled ?? row.isForSale;
        return {
          name: typeof (row.Name ?? row.name) === "string" ? (row.Name ?? row.name) : null,
          description:
            typeof (row.Description ?? row.description) === "string"
              ? (row.Description ?? row.description)
              : null,
          priceInRobux: Number.isFinite(Number(price)) ? Number(price) : null,
          isForSale: typeof sale === "boolean" ? sale : null,
          createdAt:
            typeof (row.Created ?? row.createdAt) === "string"
              ? (row.Created ?? row.createdAt)
              : null,
          iconImageAssetId: Number.isFinite(Number(row.IconImageAssetId ?? row.iconImageAssetId))
            ? Number(row.IconImageAssetId ?? row.iconImageAssetId)
            : null,
        };
      }
      cursor = typeof body?.nextPageCursor === "string" ? body.nextPageCursor : "";
      if (!cursor) break;
    } catch {
      break;
    }
  }
  return null;
}

function displayKind(kind: "game_pass" | "developer_product") {
  return kind === "game_pass" ? "Game Pass" : "Developer Product";
}

function buildTestEmbed(details: any, customTitle: string | null, customMessage: string | null) {
  const title = customTitle || `New ${displayKind(details.kind)}: ${details.name}`;
  const fields: Array<Record<string, unknown>> = [
    { name: "Type", value: displayKind(details.kind), inline: true },
    { name: "Product ID", value: `\`${details.productId}\``, inline: true },
  ];
  if (details.priceInRobux != null)
    fields.push({
      name: "Price",
      value: `**R$ ${Number(details.priceInRobux).toLocaleString("en-GB")}**`,
      inline: true,
    });
  if (details.experienceName)
    fields.push({
      name: "Experience",
      value: String(details.experienceName).slice(0, 1024),
      inline: true,
    });
  if (details.creatorName)
    fields.push({
      name: "Creator",
      value: String(details.creatorName).slice(0, 1024),
      inline: true,
    });
  if (details.universeId)
    fields.push({ name: "Universe ID", value: `\`${details.universeId}\``, inline: true });
  if (details.placeId)
    fields.push({ name: "Place ID", value: `\`${details.placeId}\``, inline: true });
  if (details.isForSale != null)
    fields.push({ name: "On sale", value: details.isForSale ? "Yes" : "No", inline: true });

  return {
    author: {
      name: "AMBUNCTIOUS TRACKER • TEST EMBED",
      icon_url: "https://www.roblox.com/favicon.ico",
    },
    title: title.slice(0, 256),
    url: details.url,
    description:
      `⚠️ **TEST MESSAGE — not a real tracker detection.**\n\n${customMessage || details.description || "A Roblox product was loaded for embed testing."}`.slice(
        0,
        4096,
      ),
    color: details.kind === "developer_product" ? 0x22c55e : 0x00a2ff,
    fields,
    ...(details.thumbnailUrl
      ? { thumbnail: { url: details.thumbnailUrl }, image: { url: details.thumbnailUrl } }
      : {}),
    footer: { text: "Ambunctious Tracker • Discord embed test" },
    timestamp: new Date().toISOString(),
  };
}

function validateWebhook(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      ["discord.com", "discordapp.com"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      ) &&
      /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

async function sendEmbedWebhook(webhook: string, embed: Record<string, unknown>) {
  const url = new URL(webhook);
  url.searchParams.set("wait", "true");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Ambunctious-Tracker/1.0" },
    body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } }),
  });
  const text = await response.text();
  if (response.status === 429) {
    let retryAfter = Number(response.headers.get("retry-after")) || 0;
    try {
      const parsed = JSON.parse(text) as { retry_after?: number };
      if (typeof parsed.retry_after === "number") retryAfter = parsed.retry_after;
    } catch {
      // Cloudflare may return HTML instead of JSON.
    }
    const seconds = Math.max(5, Math.ceil(retryAfter || 60));
    throw Object.assign(
      new Error(
        `Discord is rate limiting the dedicated embed webhook. Try again in ${seconds} seconds.`,
      ),
      { status: 429, retryAfter: seconds },
    );
  }
  if (!response.ok) throw new Error(`Discord webhook ${response.status}: ${text.slice(0, 200)}`);
  try {
    const parsed = JSON.parse(text) as { id?: unknown };
    return typeof parsed.id === "string" ? parsed.id : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/api/roblox/product-details")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);
        const { data, error } = await (client as any).rpc("has_embed_test_webhook");
        if (error) return json({ error: "Could not read embed webhook settings" }, 503);
        return json({ webhookConfigured: data === true });
      },
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);

        let body: Record<string, unknown>;
        try {
          body = (await request.json()) as Record<string, unknown>;
        } catch {
          return json({ error: "Invalid request" }, 400);
        }

        if (body.action === "save_embed_webhook") {
          const webhook = typeof body.webhook === "string" ? body.webhook.trim() : "";
          if (!validateWebhook(webhook))
            return json({ error: "Enter a valid Discord webhook URL" }, 400);
          const { data, error } = await (client as any).rpc("set_embed_test_webhook", {
            candidate: webhook,
          });
          if (error || data !== true)
            return json({ error: error?.message || "Could not save the embed webhook" }, 400);
          return json({ webhookConfigured: true });
        }

        const productId = Number(body.productId);
        const universeId = Number(body.universeId) || 0;
        const placeId = Number(body.placeId) || 0;
        const kind =
          body.kind === "game_pass"
            ? "game_pass"
            : body.kind === "developer_product"
              ? "developer_product"
              : null;
        const action = body.action === "send_test_embed" ? "send_test_embed" : "preview";
        const fallbackName =
          typeof body.fallbackName === "string" ? body.fallbackName.trim().slice(0, 120) : "";
        const customTitle =
          typeof body.customTitle === "string"
            ? body.customTitle.trim().slice(0, 256) || null
            : null;
        const customMessage =
          typeof body.customMessage === "string"
            ? body.customMessage.trim().slice(0, 3500) || null
            : null;

        if (!kind || !Number.isSafeInteger(productId) || productId <= 0)
          return json({ error: "Choose a valid product type and product ID" }, 400);
        if (kind === "developer_product" && (!Number.isSafeInteger(universeId) || universeId <= 0))
          return json({ error: "Developer products require a valid universe ID" }, 400);

        const [thumbnailUrl, universe, info] = await Promise.all([
          fetchThumbnail(kind, productId),
          universeId > 0 ? fetchUniverseDetails(universeId) : Promise.resolve(null),
          kind === "game_pass"
            ? fetchGamePassInfo(productId)
            : fetchDeveloperProductInfo(universeId, productId),
        ]);

        const name = info?.name || fallbackName || `${displayKind(kind)} ${productId}`;
        const details = {
          kind,
          productId,
          universeId: universeId || null,
          placeId: placeId || null,
          name,
          description: info?.description ?? null,
          priceInRobux: info?.priceInRobux ?? null,
          isForSale: info?.isForSale ?? null,
          iconImageAssetId: info?.iconImageAssetId ?? null,
          createdAt: info?.createdAt ?? null,
          thumbnailUrl,
          experienceName: universe?.name ?? null,
          creatorName: universe?.creatorName ?? null,
          creatorType: universe?.creatorType ?? null,
          creatorId: universe?.creatorId ?? null,
          url:
            kind === "game_pass"
              ? `https://www.roblox.com/game-pass/${productId}`
              : placeId > 0
                ? `https://www.roblox.com/games/${placeId}#!/store`
                : `https://create.roblox.com/dashboard/creations/experiences/${universeId}/monetization`,
          warnings: [
            ...(!thumbnailUrl ? ["Thumbnail unavailable"] : []),
            ...(!info
              ? ["Roblox product details were unavailable, so fallback values were used"]
              : []),
            ...(universeId > 0 && !universe ? ["Experience details unavailable"] : []),
          ],
        };

        const embed = buildTestEmbed(details, customTitle, customMessage);
        if (action === "send_test_embed") {
          const { data: webhook, error: webhookError } = await (client as any).rpc(
            "get_embed_test_webhook",
          );
          if (webhookError || typeof webhook !== "string" || !validateWebhook(webhook)) {
            return json(
              { error: "Add a dedicated embed webhook before sending tests.", details, embed },
              400,
            );
          }
          try {
            const messageId = await sendEmbedWebhook(webhook, embed);
            return json({ sent: true, messageId, details, embed });
          } catch (error) {
            const status = typeof (error as any)?.status === "number" ? (error as any).status : 502;
            const retryAfter =
              typeof (error as any)?.retryAfter === "number"
                ? (error as any).retryAfter
                : undefined;
            return json(
              { error: error instanceof Error ? error.message : String(error), details, embed },
              status,
              retryAfter ? { "Retry-After": String(retryAfter) } : {},
            );
          }
        }

        return json({ sent: false, details, embed });
      },
    },
  },
});
