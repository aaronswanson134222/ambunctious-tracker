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

export async function checkProductPrice(url: string): Promise<PriceCheckResult> {
  const result = await firecrawlScrape(url, [
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
  const currency = typeof j.currency === "string" ? j.currency : null;

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
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) throw new Error("DISCORD_WEBHOOK_URL not set");
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Discord webhook ${res.status}: ${t.slice(0, 200)}`);
  }
}
