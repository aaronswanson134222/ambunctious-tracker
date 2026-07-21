// Server-only helpers for the tracker bot.
// Do NOT import from client components.

const GATEWAY = "https://connector-gateway.lovable.dev/firecrawl/v2";

type ScrapeResult = {
  markdown?: string;
  html?: string;
  json?: Record<string, unknown>;
  metadata?: { title?: string; sourceURL?: string; statusCode?: number };
};

async function firecrawlScrape(
  url: string,
  formats: (string | { type: "json"; prompt?: string; schema?: object })[],
): Promise<ScrapeResult> {
  const lovableKey = process.env.LOVABLE_API_KEY;
  const fcKey = process.env.FIRECRAWL_API_KEY;
  if (!lovableKey || !fcKey) throw new Error("Firecrawl credentials missing");

  const res = await fetch(`${GATEWAY}/scrape`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": fcKey,
    },
    body: JSON.stringify({
      url,
      formats,
      onlyMainContent: true,
      waitFor: 2000,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Firecrawl ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = JSON.parse(text) as { data?: ScrapeResult } & ScrapeResult;
  return json.data ?? json;
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
  const url = `https://x.com/${encodeURIComponent(clean)}`;
  const result = await firecrawlScrape(url, [
    {
      type: "json",
      prompt:
        "Extract the most recent original post (not a reply, not a repost) from this X/Twitter profile. Return { post_url: string (full https://x.com/... status URL), post_text: string (the tweet text) } or null if none found.",
    },
    "markdown",
  ]);
  const j = (result.json ?? {}) as { post_url?: string; post_text?: string };
  let postUrl = typeof j.post_url === "string" ? j.post_url : null;
  let postText = typeof j.post_text === "string" ? j.post_text : null;

  // Fallback: scrape a status URL out of markdown
  if (!postUrl && result.markdown) {
    const m = result.markdown.match(
      /https?:\/\/(?:x|twitter)\.com\/[^/\s)]+\/status\/\d+/i,
    );
    if (m) postUrl = m[0];
  }
  return { postUrl, postText };
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

export async function checkProductPrice(url: string): Promise<PriceCheckResult> {
  const safeUrl = assertAllowedProductUrl(url);
  const result = await firecrawlScrape(safeUrl.toString(), [
    {
      type: "json",
      prompt:
        "Extract the current listing price shown on this Eldorado.gg product page. Return { price: number (numeric value only, no currency symbol, no thousands separators, use '.' as decimal), currency: string (ISO code like USD, EUR, GBP, or the symbol if code is unknown) }. If multiple prices are shown, return the current buy-now price for one unit.",
    },
    "markdown",
  ]);
  const j = (result.json ?? {}) as { price?: number | string; currency?: string };
  let price: number | null = null;
  if (typeof j.price === "number" && isFinite(j.price)) price = j.price;
  else if (typeof j.price === "string") {
    const n = parseFloat(j.price.replace(/[^0-9.]/g, ""));
    if (isFinite(n)) price = n;
  }
  const currency =
    typeof j.currency === "string" ? normalizeCurrency(j.currency) : null;

  // Fallback: regex in markdown
  if (price == null && result.markdown) {
    const m = result.markdown.match(/([$€£])\s?([0-9]+(?:[.,][0-9]{2})?)/);
    if (m) {
      price = parseFloat(m[2].replace(",", "."));
      if (!currency) {
        const sym = m[1];
        return {
          price,
          currency: sym === "$" ? "USD" : sym === "€" ? "EUR" : "GBP",
        };
      }
    }
  }
  return { price, currency };
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
    !["discord.com", "discordapp.com"].some(
      (host) => webhookUrl.hostname === host || webhookUrl.hostname.endsWith(`.${host}`),
    ) ||
    !webhookUrl.pathname.includes("/api/webhooks/")
  ) {
    throw new Error("DISCORD_WEBHOOK_URL is not a Discord webhook URL");
  }
  webhookUrl.searchParams.set("wait", "true");

  const body = JSON.stringify({
    ...payload,
    allowed_mentions: { parse: [] },
  });

  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Ambunctious-Tracker/1.0",
      },
      body,
    });
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
          delay = Math.max(250, rateLimit.retry_after * 1_000);
        }
      } catch {
        // Fall back to a short retry delay.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}
