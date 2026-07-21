// Server-only helpers for the tracker bot.
// Do NOT import from client components.

const MAX_PAGE_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;

function isAllowedPageHost(candidate: URL, original: URL) {
  if (
    candidate.protocol !== "https:" ||
    candidate.username ||
    candidate.password ||
    (candidate.port && candidate.port !== "443")
  ) return false;

  const host = candidate.hostname.toLowerCase();
  const originalHost = original.hostname.toLowerCase();
  if (originalHost === "eldorado.gg" || originalHost.endsWith(".eldorado.gg")) {
    return host === "eldorado.gg" || host.endsWith(".eldorado.gg");
  }
  if (["x.com", "mobile.x.com", "syndication.twitter.com"].includes(originalHost)) {
    return ["x.com", "mobile.x.com", "twitter.com", "syndication.twitter.com"].includes(host);
  }
  if (originalHost === "biggames.io" || originalHost === "www.biggames.io") {
    return host === "biggames.io" || host === "www.biggames.io";
  }
  if (["catalog.roblox.com", "games.roblox.com", "apis.roblox.com"].includes(originalHost)) {
    return host === originalHost;
  }
  return false;
}

async function readLimitedText(response: Response, provider: string) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PAGE_BYTES) {
    throw new Error(`${provider} response was too large`);
  }
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (
    contentType &&
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml") &&
    !contentType.includes("application/json")
  ) {
    throw new Error(`${provider} returned an unsupported content type`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let output = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_PAGE_BYTES) throw new Error(`${provider} response was too large`);
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function fetchPublicPage(
  url: URL,
  provider: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const original = new URL(url);
  let current = new URL(url);
  if (!isAllowedPageHost(current, original)) {
    throw new Error(`${provider} URL is not allowed`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
      const response = await fetch(current, {
        signal: controller.signal,
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml,application/json",
          "Accept-Language": "en-GB,en;q=0.9",
          "User-Agent":
            "Mozilla/5.0 (compatible; AmbunctiousTracker/1.0; +https://ambunctious-tracker.lovable.app)",
          ...extraHeaders,
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) {
          throw new Error(`${provider} returned an invalid redirect`);
        }
        const next = new URL(location, current);
        if (!isAllowedPageHost(next, original)) {
          throw new Error(`${provider} attempted an unsafe redirect`);
        }
        current = next;
        continue;
      }
      if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}`);
      return await readLimitedText(response, provider);
    }
    throw new Error(`${provider} redirected too many times`);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${provider} timed out`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function visibleText(html: string): string {
  return decodeHtml(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  ).replace(/\s+/g, " ").trim();
}

// -------- X (Twitter) profile scraping --------

export type XCheckResult = {
  postUrl: string | null;
  postText: string | null;
};

export async function checkXProfile(handle: string): Promise<XCheckResult> {
  const clean = handle.replace(/^@/, "").trim();
  if (!/^[A-Za-z0-9_]{1,15}$/.test(clean)) {
    throw new Error("Invalid X username");
  }

  const sources = [
    new URL(
      `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(clean)}`,
    ),
    new URL(`https://x.com/${encodeURIComponent(clean)}`),
    new URL(`https://mobile.x.com/${encodeURIComponent(clean)}`),
  ];

  const failures: string[] = [];
  for (const source of sources) {
    try {
      const html = await fetchPublicPage(source, "X public timeline");
      const escapedHandle = clean.replace(/[.*+?^$\{\}()|[\]\\]/g, "\\$&");
      const statusPatterns = [
        new RegExp(
          `https?:\\/\\/(?:x|twitter)\\.com\\/${escapedHandle}\\/status\\/(\\d+)`,
          "i",
        ),
        /data-tweet-id=["'](\d+)["']/i,
        /["']rest_id["']\s*:\s*["'](\d+)["']/i,
      ];
      const id = statusPatterns
        .map((pattern) => html.match(pattern)?.[1])
        .find(Boolean);
      if (!id) throw new Error("No public post was present in the timeline");

      const tweetBlock =
        html.match(
          new RegExp(
            `<[^>]+data-tweet-id=["']${id}["'][^>]*>([\\s\\S]{0,12000})`,
            "i",
          ),
        )?.[1] ?? html;
      const encodedText =
        tweetBlock.match(
          /<p[^>]*class=["'][^"']*timeline-Tweet-text[^"']*["'][^>]*>([\s\S]*?)<\/p>/i,
        )?.[1] ??
        tweetBlock.match(/["']full_text["']\s*:\s*["']((?:\\.|[^"'\\])*)["']/i)?.[1];
      const postText = encodedText
        ? visibleText(encodedText.replace(/\\n/g, " ").replace(/\\(["'\\])/g, "$1")).slice(0, 1000)
        : null;

      return {
        postUrl: `https://x.com/${clean}/status/${id}`,
        postText,
      };
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  throw new Error(`Free X timeline unavailable: ${failures.join("; ").slice(0, 300)}`);
}

// -------- Eldorado.gg price scraping --------

export type PriceCheckResult = {
  price: number | null;
  currency: string | null;
};

const currencyAliases: Record<string, string> = {
  "$": "USD",
  "US$": "USD",
  "€": "EUR",
  "£": "GBP",
};

export function normalizeCurrency(currency: string | null): string | null {
  if (!currency) return null;
  const clean = currency.trim().toUpperCase();
  return currencyAliases[clean] ?? (/^[A-Z]{3}$/.test(clean) ? clean : null);
}

export async function convertToGBP(
  amount: number,
  currency: string | null,
): Promise<number | null> {
  const from = normalizeCurrency(currency);
  if (!from) return null;
  if (from === "GBP") return amount;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(
      `https://api.frankfurter.app/latest?amount=${encodeURIComponent(String(amount))}&from=${encodeURIComponent(from)}&to=GBP`,
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const body = (await res.json()) as { rates?: { GBP?: number } };
    const pounds = body.rates?.GBP;
    return typeof pounds === "number" && isFinite(pounds) ? pounds : null;
  } catch {
    return null;
  }
}

function assertAllowedProductUrl(value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Invalid product URL");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    parsed.protocol !== "https:" ||
    !(hostname === "eldorado.gg" || hostname.endsWith(".eldorado.gg")) ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error("Only secure Eldorado.gg listing URLs are allowed");
  }
  parsed.hash = "";
  return parsed;
}

function parseDisplayedPrice(value: string): number | null {
  const compact = value.replace(/\s/g, "");
  const normalized =
    compact.includes(",") && compact.includes(".")
      ? compact.replace(/,/g, "")
      : compact.replace(",", ".");
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export async function checkProductPrice(url: string): Promise<PriceCheckResult> {
  const safeUrl = assertAllowedProductUrl(url);
  const html = await fetchPublicPage(safeUrl, "Eldorado");
  const text = visibleText(html);

  const displayed =
    text.match(/\bPrice\s+([$€£])\s*([0-9][0-9.,]{0,20})\s*\/\s*[A-Za-z0-9]+/i) ??
    text.match(/\bCurrent offer\s+([$€£])\s*([0-9][0-9.,]{0,20})/i);
  if (displayed) {
    const price = parseDisplayedPrice(displayed[2]);
    if (price != null) {
      return {
        price,
        currency: displayed[1] === "$" ? "USD" : displayed[1] === "€" ? "EUR" : "GBP",
      };
    }
  }

  const structured = html.match(
    /["']price["']\s*:\s*["']?([0-9]+(?:\.[0-9]+)?)["']?[\s\S]{0,300}?["']priceCurrency["']\s*:\s*["']([A-Z]{3})["']/i,
  );
  if (structured) {
    const price = parseDisplayedPrice(structured[1]);
    if (price != null) return { price, currency: normalizeCurrency(structured[2]) };
  }

  const fallback = text.match(/([$€£])\s*([0-9]+(?:[.,][0-9]{1,6})?)\s*\/\s*[A-Za-z0-9]+/);
  if (fallback) {
    const price = parseDisplayedPrice(fallback[2]);
    if (price != null) {
      return {
        price,
        currency: fallback[1] === "$" ? "USD" : fallback[1] === "€" ? "EUR" : "GBP",
      };
    }
  }

  throw new Error("Could not find a price on the public Eldorado page");
}

// -------- BIG Games developer blog monitoring --------

export type WebsiteUpdateResult = {
  itemUrl: string;
  title: string;
  summary: string | null;
};

export async function checkBigGamesUpdates(url: string): Promise<WebsiteUpdateResult> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !(parsed.hostname === "biggames.io" || parsed.hostname === "www.biggames.io")
  ) {
    throw new Error("Only the official BIG Games website is allowed");
  }

  const html = await fetchPublicPage(new URL("https://www.biggames.io/post"), "BIG Games");
  const links = [...html.matchAll(
    /<a\b[^>]*href=["'](\/post\/(?!category\/)[^"'?#]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )];
  const latest = links.find((match) => {
    const text = visibleText(match[2]);
    return text.length > 2 && !/read more/i.test(text);
  }) ?? links[0];

  if (!latest) throw new Error("No developer blog was found on BIG Games");

  const itemUrl = new URL(latest[1], "https://www.biggames.io").toString();
  const text = visibleText(latest[2]);
  const title =
    text.match(/(?:\d{4}\s+)?([^.!?]{3,100}[!?]?)/)?.[1]?.trim() ||
    latest[1].split("/").at(-1)!.replace(/-/g, " ");
  return {
    itemUrl,
    title: title.slice(0, 120),
    summary: text.length > title.length ? text.slice(0, 400) : null,
  };
}

// -------- Roblox creation monitoring --------

export type RobloxScanType =
  | "catalog"
  | "experience"
  | "game_pass"
  | "developer_product";

export type RobloxCreation = {
  key: string;
  id: number;
  kind: RobloxScanType;
  name: string;
  url: string;
  createdAt: string | null;
};

async function fetchRobloxJson(
  url: URL,
  apiKey?: string,
): Promise<unknown> {
  const html = await fetchPublicPage(
    url,
    "Roblox",
    apiKey ? { "x-api-key": apiKey } : {},
  );
  try {
    return JSON.parse(html);
  } catch {
    throw new Error("Roblox returned invalid data");
  }
}

function robloxDate(row: Record<string, unknown>) {
  const value =
    row.createdTimestamp ??
    row.createdAt ??
    row.created ??
    row.creationDate ??
    row.Created ??
    row.itemCreatedUtc;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function rowsFromRobloxResponse(
  value: unknown,
  keys: string[],
): Array<Record<string, unknown>> {
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    const rows = object[key];
    if (Array.isArray(rows)) {
      return rows.filter((row): row is Record<string, unknown> =>
        Boolean(row) && typeof row === "object",
      );
    }
  }
  return [];
}

export async function checkRobloxCreations(
  entityType: "user" | "group",
  entityId: number,
  scanTypes: RobloxScanType[],
  lookbackDays: number,
  openCloudApiKey?: string | null,
): Promise<RobloxCreation[]> {
  if (!Number.isSafeInteger(entityId) || entityId <= 0) {
    throw new Error("Invalid Roblox user or group ID");
  }
  const enabled = new Set(scanTypes);
  if (!enabled.size) throw new Error("Select at least one Roblox scan type");
  const safeLookback = [7, 30, 90, 365].includes(lookbackDays) ? lookbackDays : 30;
  const cutoff = Date.now() - safeLookback * 86_400_000;

  const creatorType = entityType === "user" ? 1 : 2;
  const catalogUrl = new URL("https://catalog.roblox.com/v1/search/items/details");
  catalogUrl.searchParams.set("Category", "1");
  catalogUrl.searchParams.set("CreatorType", String(creatorType));
  catalogUrl.searchParams.set("CreatorTargetId", String(entityId));
  catalogUrl.searchParams.set("SortType", "3");
  catalogUrl.searchParams.set("Limit", "30");

  const gamesUrl = new URL(
    entityType === "user"
      ? `https://games.roblox.com/v2/users/${entityId}/games`
      : `https://games.roblox.com/v2/groups/${entityId}/games`,
  );
  gamesUrl.searchParams.set("accessFilter", "Public");
  gamesUrl.searchParams.set("sortOrder", "Desc");
  gamesUrl.searchParams.set("limit", "25");

  const needsGames =
    enabled.has("experience") ||
    enabled.has("game_pass") ||
    enabled.has("developer_product");
  const [catalogResult, gamesResult] = await Promise.all([
    enabled.has("catalog")
      ? fetchRobloxJson(catalogUrl).then(
          (value) => ({ value, error: null as Error | null }),
          (error) => ({ value: null, error: error instanceof Error ? error : new Error(String(error)) }),
        )
      : Promise.resolve({ value: null, error: null }),
    needsGames
      ? fetchRobloxJson(gamesUrl).then(
          (value) => ({ value, error: null as Error | null }),
          (error) => ({ value: null, error: error instanceof Error ? error : new Error(String(error)) }),
        )
      : Promise.resolve({ value: null, error: null }),
  ]);
  if (
    (enabled.has("catalog") && catalogResult.error) &&
    (needsGames && gamesResult.error)
  ) {
    throw new Error(
      `Roblox checks failed: ${catalogResult.error.message}; ${gamesResult.error.message}`,
    );
  }
  if (needsGames && gamesResult.error) throw gamesResult.error;

  const creations: RobloxCreation[] = [];
  if (enabled.has("catalog") && catalogResult.value) {
    const rows = rowsFromRobloxResponse(catalogResult.value, ["data"]);
    for (const row of rows) {
      const id = Number(row.id);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const createdAt = robloxDate(row);
      creations.push({
        key: `catalog:${id}`,
        id,
        kind: "catalog",
        name: typeof row.name === "string" ? row.name.slice(0, 120) : `Roblox item ${id}`,
        url: `https://www.roblox.com/catalog/${id}`,
        createdAt,
      });
    }
  }

  const games = rowsFromRobloxResponse(gamesResult.value, ["data"]);
  if (enabled.has("experience")) {
    for (const row of games) {
      const id = Number(row.id);
      const rootPlace = row.rootPlace as Record<string, unknown> | undefined;
      const placeId = Number(rootPlace?.id);
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      creations.push({
        key: `experience:${id}`,
        id,
        kind: "experience",
        name: typeof row.name === "string" ? row.name.slice(0, 120) : `Roblox experience ${id}`,
        url: Number.isSafeInteger(placeId) && placeId > 0
          ? `https://www.roblox.com/games/${placeId}`
          : `https://www.roblox.com/games?Keyword=${encodeURIComponent(String(id))}`,
        createdAt: robloxDate(row),
      });
    }
  }

  const monetizationTypes = [
    enabled.has("game_pass") ? "game_pass" as const : null,
    enabled.has("developer_product") ? "developer_product" as const : null,
  ].filter((value): value is "game_pass" | "developer_product" => value !== null);

  if (monetizationTypes.length) {
    const apiKey = openCloudApiKey?.trim();
    if (!apiKey) {
      throw new Error(
        "Roblox monetization scans require ROBLOX_OPEN_CLOUD_API_KEY with game-pass:read and developer-product:read scopes",
      );
    }

    for (const game of games.slice(0, 10)) {
      const universeId = Number(game.id);
      const rootPlace = game.rootPlace as Record<string, unknown> | undefined;
      const placeId = Number(rootPlace?.id);
      if (!Number.isSafeInteger(universeId) || universeId <= 0) continue;

      for (const kind of monetizationTypes) {
        const endpoint = kind === "game_pass"
          ? `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes/creator`
          : `https://apis.roblox.com/developer-products/v2/universes/${universeId}/developer-products/creator`;
        const url = new URL(endpoint);
        url.searchParams.set("maxPageSize", "100");
        let response: unknown;
        try {
          response = await fetchRobloxJson(url, apiKey);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (/HTTP 401|HTTP 403|HTTP 404/.test(message)) continue;
          throw error;
        }
        const rows = rowsFromRobloxResponse(
          response,
          kind === "game_pass"
            ? ["gamePasses", "data"]
            : ["developerProducts", "data"],
        );
        for (const row of rows) {
          const id = Number(row.id ?? row.gamePassId ?? row.productId);
          if (!Number.isSafeInteger(id) || id <= 0) continue;
          const createdAt = robloxDate(row);
          if (createdAt && Date.parse(createdAt) < cutoff) continue;
          const name =
            typeof row.name === "string"
              ? row.name.slice(0, 120)
              : kind === "game_pass"
                ? `Game pass ${id}`
                : `Developer product ${id}`;
          creations.push({
            key: `${kind}:${universeId}:${id}`,
            id,
            kind,
            name,
            url: kind === "game_pass"
              ? `https://www.roblox.com/game-pass/${id}`
              : Number.isSafeInteger(placeId) && placeId > 0
                ? `https://www.roblox.com/games/${placeId}`
                : `https://create.roblox.com/dashboard/creations/experiences/${universeId}/monetization`,
            createdAt,
          });
        }
      }
    }
  }

  return creations.filter((item) =>
    !item.createdAt || Date.parse(item.createdAt) >= cutoff,
  );
}

// -------- Individual Roblox experience product monitoring --------

export type RobloxExperienceProduct = {
  key: string;
  id: number;
  kind: "game_pass" | "developer_product";
  name: string;
  url: string;
  createdAt: string | null;
};

export async function resolveRobloxUniverseId(
  placeId: number,
  openCloudApiKey?: string | null,
): Promise<number> {
  if (!Number.isSafeInteger(placeId) || placeId <= 0) {
    throw new Error("Invalid Roblox game/place ID");
  }
  const value = await fetchRobloxJson(
    new URL(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`),
    openCloudApiKey?.trim() || undefined,
  ) as Record<string, unknown>;
  const universeId = Number(value.universeId);
  if (!Number.isSafeInteger(universeId) || universeId <= 0) {
    throw new Error("Roblox could not resolve that game ID");
  }
  return universeId;
}

export async function checkRobloxExperienceProducts(
  universeId: number,
  placeId: number,
  lookbackDays: number,
  openCloudApiKey?: string | null,
): Promise<RobloxExperienceProduct[]> {
  if (!Number.isSafeInteger(universeId) || universeId <= 0) {
    throw new Error("Invalid Roblox universe ID");
  }
  // Experience inventories always show the complete current product list.
  // New-upload detection is based on unseen product IDs, not item age.
  void lookbackDays;
  const products: RobloxExperienceProduct[] = [];

  // Roblox exposes game passes publicly, including for experiences the key owner
  // does not manage. This endpoint deliberately receives no Open Cloud key.
  const publicPassUrl = new URL(
    `https://apis.roblox.com/game-passes/v1/universes/${universeId}/game-passes`,
  );
  publicPassUrl.searchParams.set("passView", "Full");
  publicPassUrl.searchParams.set("pageSize", "100");
  const publicPassResponse = await fetchRobloxJson(publicPassUrl);
  for (const row of rowsFromRobloxResponse(publicPassResponse, ["gamePasses", "data"])) {
    const id = Number(row.id ?? row.gamePassId);
    if (!Number.isSafeInteger(id) || id <= 0) continue;
    const createdAt = robloxDate(row);
    products.push({
      key: `game_pass:${universeId}:${id}`,
      id,
      kind: "game_pass",
      name: typeof row.name === "string"
        ? row.name.slice(0, 120)
        : typeof row.displayName === "string"
          ? row.displayName.slice(0, 120)
          : `Game pass ${id}`,
      url: `https://www.roblox.com/game-pass/${id}`,
      createdAt,
    });
  }

  // Roblox's public V2 list exposes developer products for any public
  // universe. Fetch multiple pages so larger experiences are fully baselined.
  void openCloudApiKey;
  let nextPageCursor = "";
  for (let page = 0; page < 5; page++) {
    const developerProductUrl = new URL(
      `https://apis.roblox.com/developer-products/v2/universes/${universeId}/developerproducts`,
    );
    developerProductUrl.searchParams.set("limit", "100");
    if (nextPageCursor) {
      developerProductUrl.searchParams.set("cursor", nextPageCursor);
    }
    const developerResponse = await fetchRobloxJson(developerProductUrl) as Record<string, unknown>;
    for (const row of rowsFromRobloxResponse(
      developerResponse,
      ["developerProducts", "data"],
    )) {
      const id = Number(
        row.DeveloperProductId ??
        row.TargetId ??
        row.id ??
        row.productId,
      );
      if (!Number.isSafeInteger(id) || id <= 0) continue;
      const createdAt = robloxDate(row);
      const rawName = row.Name ?? row.displayName ?? row.name;
      products.push({
        key: `developer_product:${universeId}:${id}`,
        id,
        kind: "developer_product",
        name: typeof rawName === "string"
          ? rawName.slice(0, 120)
          : `Developer product ${id}`,
        url: `https://www.roblox.com/games/${placeId}`,
        createdAt,
      });
    }
    const cursor = developerResponse.nextPageCursor;
    if (typeof cursor !== "string" || !cursor) break;
    nextPageCursor = cursor;
  }

  return products.sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
    return bTime - aTime || b.id - a.id;
  });
}

// -------- Discord webhook --------

export async function sendDiscord(payload: {
  content?: string;
  embeds?: Array<Record<string, unknown>>;
}): Promise<void> {
  const webhook =
    process.env.DISCORD_WEBHOOK_URL ??
    process.env.DISCORD_WEBHOOK;
  if (!webhook) {
    throw new Error(
      "Discord webhook is not configured. Add DISCORD_WEBHOOK_URL in project secrets.",
    );
  }

  let webhookUrl: URL;
  try {
    webhookUrl = new URL(webhook);
  } catch {
    throw new Error("DISCORD_WEBHOOK_URL is not a valid URL");
  }
  if (
    webhookUrl.protocol !== "https:" ||
    webhookUrl.username ||
    webhookUrl.password ||
    (webhookUrl.port && webhookUrl.port !== "443") ||
    !["discord.com", "discordapp.com"].some(
      (host) => webhookUrl.hostname === host || webhookUrl.hostname.endsWith(`.${host}`),
    ) ||
    !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(webhookUrl.pathname)
  ) {
    throw new Error("DISCORD_WEBHOOK_URL is not a Discord webhook URL");
  }
  webhookUrl.searchParams.set("wait", "true");

  const body = JSON.stringify({
    ...payload,
    allowed_mentions: { parse: [] },
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(webhookUrl, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Ambunctious-Tracker/1.0",
        },
        body,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (res.ok) return;

    const responseText = await res.text();
    if (attempt === 3 || (res.status < 500 && res.status !== 429)) {
      throw new Error(
        `Discord webhook ${res.status}: ${responseText.slice(0, 240)}`,
      );
    }
    let delay = 500 * attempt;
    if (res.status === 429) {
      try {
        const rateLimit = JSON.parse(responseText) as { retry_after?: number };
        if (typeof rateLimit.retry_after === "number") {
          delay = Math.min(10_000, Math.max(250, rateLimit.retry_after * 1_000));
        }
      } catch {
        // Fall back to a short retry delay.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
