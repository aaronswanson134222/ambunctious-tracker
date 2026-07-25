export type RobloxPreviewKind = "catalog" | "experience" | "game_pass" | "developer_product";

export type RobloxPreviewInput = {
  id: number;
  kind: RobloxPreviewKind;
  name: string;
  url: string;
  createdAt?: string | null;
  universeId?: number | null;
  placeId?: number | null;
  experienceName?: string | null;
};

export type RobloxPreview = RobloxPreviewInput & {
  description: string | null;
  priceInRobux: number | null;
  isForSale: boolean | null;
  thumbnailUrl: string | null;
  creatorName: string | null;
};

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { expires: number; value: RobloxPreview }>();

async function fetchJson(url: URL): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "AmbunctiousTracker/1.0",
      },
    });
    if (!response.ok) throw new Error(`Roblox returned HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function firstRow(body: any) {
  return Array.isArray(body?.data) ? body.data[0] : null;
}

async function thumbnailFor(input: RobloxPreviewInput): Promise<string | null> {
  try {
    let url: URL;
    if (input.kind === "game_pass") {
      url = new URL("https://thumbnails.roblox.com/v1/game-passes");
      url.searchParams.set("gamePassIds", String(input.id));
    } else if (input.kind === "developer_product") {
      url = new URL("https://thumbnails.roblox.com/v1/developer-products/icons");
      url.searchParams.set("developerProductIds", String(input.id));
    } else if (input.kind === "experience" && input.universeId) {
      url = new URL("https://thumbnails.roblox.com/v1/games/icons");
      url.searchParams.set("universeIds", String(input.universeId));
    } else {
      url = new URL("https://thumbnails.roblox.com/v1/assets");
      url.searchParams.set("assetIds", String(input.id));
    }
    url.searchParams.set("size", "420x420");
    url.searchParams.set("format", "Png");
    url.searchParams.set("isCircular", "false");
    const row = firstRow(await fetchJson(url));
    return row?.state === "Completed" && typeof row?.imageUrl === "string"
      ? row.imageUrl
      : null;
  } catch {
    return null;
  }
}

async function universeInfo(universeId: number | null | undefined) {
  if (!universeId) return null;
  try {
    const url = new URL("https://games.roblox.com/v1/games");
    url.searchParams.set("universeIds", String(universeId));
    const row = firstRow(await fetchJson(url));
    if (!row) return null;
    return {
      name: typeof row.name === "string" ? row.name : null,
      creatorName: typeof row.creator?.name === "string" ? row.creator.name : null,
    };
  } catch {
    return null;
  }
}

async function gamePassInfo(id: number) {
  try {
    const body = await fetchJson(new URL(`https://apis.roblox.com/game-passes/v1/game-passes/${id}`));
    return {
      name: typeof body?.name === "string" ? body.name : null,
      description: typeof body?.description === "string" ? body.description : null,
      priceInRobux: typeof body?.priceInRobux === "number" ? body.priceInRobux : null,
      isForSale: typeof body?.isForSale === "boolean" ? body.isForSale : null,
    };
  } catch {
    return null;
  }
}

async function developerProductInfo(universeId: number | null | undefined, id: number) {
  if (!universeId) return null;
  let cursor = "";
  for (let page = 0; page < 8; page++) {
    try {
      const url = new URL(
        `https://apis.roblox.com/developer-products/v2/universes/${universeId}/developerproducts`,
      );
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);
      const body = await fetchJson(url);
      const rows = Array.isArray(body?.developerProducts)
        ? body.developerProducts
        : Array.isArray(body?.data)
          ? body.data
          : [];
      const row = rows.find((value: any) => Number(
        value?.DeveloperProductId ?? value?.TargetId ?? value?.id ?? value?.productId,
      ) === id);
      if (row) {
        const price = row.PriceInRobux ?? row.priceInRobux ?? row.Price ?? row.price;
        const sale = row.ShopEnabled ?? row.shopEnabled ?? row.isForSale;
        return {
          name: typeof (row.Name ?? row.name) === "string" ? (row.Name ?? row.name) : null,
          description: typeof (row.Description ?? row.description) === "string"
            ? (row.Description ?? row.description)
            : null,
          priceInRobux: Number.isFinite(Number(price)) ? Number(price) : null,
          isForSale: typeof sale === "boolean" ? sale : null,
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

export async function enrichRobloxPreview(input: RobloxPreviewInput): Promise<RobloxPreview> {
  const key = `${input.kind}:${input.universeId ?? 0}:${input.id}`;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const [thumbnailUrl, universe, product] = await Promise.all([
    thumbnailFor(input),
    universeInfo(input.universeId),
    input.kind === "game_pass"
      ? gamePassInfo(input.id)
      : input.kind === "developer_product"
        ? developerProductInfo(input.universeId, input.id)
        : Promise.resolve(null),
  ]);

  const value: RobloxPreview = {
    ...input,
    name: product?.name ?? input.name,
    experienceName: universe?.name ?? input.experienceName ?? null,
    creatorName: universe?.creatorName ?? null,
    description: product?.description ?? null,
    priceInRobux: product?.priceInRobux ?? null,
    isForSale: product?.isForSale ?? null,
    thumbnailUrl,
  };
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  return value;
}

function displayKind(kind: RobloxPreviewKind) {
  return kind.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function buildRobloxPreviewEmbed(
  preview: RobloxPreview,
  context: string,
): Record<string, unknown> {
  const fields: Array<Record<string, unknown>> = [
    { name: "Type", value: displayKind(preview.kind), inline: true },
    { name: "Product ID", value: `\`${preview.id}\``, inline: true },
  ];
  if (preview.priceInRobux != null) {
    fields.push({ name: "Price", value: `**R$ ${preview.priceInRobux.toLocaleString("en-GB")}**`, inline: true });
  }
  if (preview.experienceName) {
    fields.push({ name: "Experience", value: preview.experienceName.slice(0, 1024), inline: true });
  }
  if (preview.creatorName) {
    fields.push({ name: "Creator", value: preview.creatorName.slice(0, 1024), inline: true });
  }
  if (preview.universeId) {
    fields.push({ name: "Universe ID", value: `\`${preview.universeId}\``, inline: true });
  }
  if (preview.placeId) {
    fields.push({ name: "Place ID", value: `\`${preview.placeId}\``, inline: true });
  }
  if (preview.isForSale != null) {
    fields.push({ name: "On sale", value: preview.isForSale ? "Yes" : "No", inline: true });
  }

  return {
    author: {
      name: context.slice(0, 256),
      icon_url: "https://www.roblox.com/favicon.ico",
    },
    title: `New ${displayKind(preview.kind)}: ${preview.name}`.slice(0, 256),
    url: preview.url,
    description: (preview.description || "A new Roblox item was detected by Ambunctious Tracker.").slice(0, 4096),
    color: preview.kind === "developer_product" ? 0x22c55e : 0x00a2ff,
    fields,
    ...(preview.thumbnailUrl ? {
      thumbnail: { url: preview.thumbnailUrl },
      image: { url: preview.thumbnailUrl },
    } : {}),
    footer: { text: "Ambunctious Tracker • Roblox preview" },
    timestamp: preview.createdAt && !Number.isNaN(Date.parse(preview.createdAt))
      ? new Date(preview.createdAt).toISOString()
      : new Date().toISOString(),
  };
}
