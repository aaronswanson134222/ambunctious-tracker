// Server-only helpers for the tracker bot.
// Do NOT import from client components.

async function fetchPublicPage(url: URL, provider: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-GB,en;q=0.9",
        "User-Agent":
          "Mozilla/5.0 (compatible; AmbunctiousTracker/1.0; +https://ambunctious-tracker.lovable.app)",
      },
    });
    if (!response.ok) throw new Error(`${provider} returned HTTP ${response.status}`);
    return await response.text();
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
