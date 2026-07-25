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

async function robloxJson(url: URL, apiKey?: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Ambunctious-Tracker/1.0",
      ...(apiKey ? { "x-api-key": apiKey } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function fetchThumbnail(kind: "game_pass" | "developer_product", id: number): Promise<string | null> {
  try {
    const endpoint = kind === "game_pass"
      ? "https://thumbnails.roblox.com/v1/game-passes"
      : "https://thumbnails.roblox.com/v1/developer-products/icons";
    const param = kind === "game_pass" ? "gamePassIds" : "developerProductIds";
    const url = new URL(endpoint);
    url.searchParams.set(param, String(id));
    url.searchParams.set("size", "420x420");
    url.searchParams.set("format", "Png");
    const body = await robloxJson(url);
    const row = Array.isArray(body?.data) ? body.data[0] : null;
    return row?.state === "Completed" && typeof row?.imageUrl === "string" ? row.imageUrl : null;
  } catch {
    return null;
  }
}

async function fetchUniverseDetails(universeId: number) {
  try {
    const url = new URL("https://games.roblox.com/v1/games");
    url.searchParams.set("universeIds", String(universeId));
    const body = await robloxJson(url);
    const row = Array.isArray(body?.data) ? body.data[0] : null;
    if (!row) return null;
    return {
      name: typeof row.name === "string" ? row.name : null,
      creatorName: row.creator?.name ?? null,
      creatorType: row.creator?.type ?? null,
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

async function fetchDeveloperProductFromList(universeId: number, productId: number) {
  let cursor = "";
  for (let page = 0; page < 8; page++) {
    const url = new URL(
      `https://apis.roblox.com/developer-products/v2/universes/${universeId}/developerproducts`,
    );
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    let body: any;
    try {
      body = await robloxJson(url);
    } catch {
      return null;
    }
    const rows: any[] = Array.isArray(body?.developerProducts)
      ? body.developerProducts
      : Array.isArray(body?.data)
        ? body.data
        : [];
    for (const row of rows) {
      const id = Number(
        row?.DeveloperProductId ?? row?.TargetId ?? row?.id ?? row?.productId,
      );
      if (id === productId) {
        return {
          name: (typeof row.Name === "string" && row.Name)
            || (typeof row.name === "string" && row.name)
            || null,
          description: (typeof row.Description === "string" && row.Description)
            || (typeof row.description === "string" && row.description)
            || null,
          priceInRobux: typeof row.PriceInRobux === "number"
            ? row.PriceInRobux
            : typeof row.priceInRobux === "number"
              ? row.priceInRobux
              : null,
          iconImageAssetId: typeof row.IconImageAssetId === "number"
            ? row.IconImageAssetId
            : typeof row.iconImageAssetId === "number"
              ? row.iconImageAssetId
              : null,
          shopEnabled: typeof row.ShopEnabled === "boolean"
            ? row.ShopEnabled
            : typeof row.shopEnabled === "boolean"
              ? row.shopEnabled
              : null,
          createdAt: (typeof row.Created === "string" && row.Created)
            || (typeof row.createdAt === "string" && row.createdAt)
            || null,
        };
      }
    }
    const next = body?.nextPageCursor;
    if (typeof next !== "string" || !next) break;
    cursor = next;
  }
  return null;
}

export const Route = createFileRoute("/api/roblox/product-details")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);

        let productId = 0;
        let universeId = 0;
        let placeId = 0;
        let kind: "game_pass" | "developer_product" = "developer_product";
        try {
          const body = await request.json() as {
            productId?: unknown; universeId?: unknown; placeId?: unknown; kind?: unknown;
          };
          productId = Number(body.productId);
          universeId = Number(body.universeId) || 0;
          placeId = Number(body.placeId) || 0;
          if (body.kind === "game_pass" || body.kind === "developer_product") kind = body.kind;
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        if (!Number.isSafeInteger(productId) || productId <= 0) {
          return json({ error: "Invalid product ID" }, 400);
        }

        const warnings: string[] = [];

        const { data: keyRaw } = await (client as any).rpc("get_roblox_open_cloud_key");
        const apiKey = typeof keyRaw === "string" && keyRaw.trim() ? keyRaw.trim() : null;
        void apiKey; // Detail endpoints below are public; key not required.

        const [thumb, universe, info] = await Promise.all([
          fetchThumbnail(kind, productId),
          universeId > 0 ? fetchUniverseDetails(universeId) : Promise.resolve(null),
          kind === "game_pass"
            ? fetchGamePassInfo(productId)
            : universeId > 0
              ? fetchDeveloperProductFromList(universeId, productId)
              : Promise.resolve(null),
        ]);

        if (!thumb) warnings.push("Thumbnail unavailable");
        if (!info) warnings.push(
          kind === "developer_product"
            ? "Product details could not be fetched (Roblox does not expose a public per-product endpoint; owner scans may be required)."
            : "Game pass details could not be fetched.",
        );
        if (universeId > 0 && !universe) warnings.push("Experience details unavailable");

        return json({
          kind,
          productId,
          universeId: universeId || null,
          placeId: placeId || null,
          name: info?.name ?? null,
          description: info?.description ?? null,
          priceInRobux: info?.priceInRobux ?? null,
          isForSale: (info as any)?.isForSale ?? (info as any)?.shopEnabled ?? null,
          iconImageAssetId: info?.iconImageAssetId ?? null,
          createdAt: info?.createdAt ?? null,
          thumbnailUrl: thumb,
          experienceName: universe?.name ?? null,
          creatorName: universe?.creatorName ?? null,
          creatorType: universe?.creatorType ?? null,
          creatorId: universe?.creatorId ?? null,
          warnings,
          source: kind === "game_pass"
            ? "https://apis.roblox.com/game-passes/v1"
            : "https://apis.roblox.com/developer-products/v2 (universe list)",
        });
      },
    },
  },
});
