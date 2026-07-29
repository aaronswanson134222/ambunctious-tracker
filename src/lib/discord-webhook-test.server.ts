let blockedUntil = 0;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(response: Response, body: string): number {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.ceil(header * 1000);

  const resetAfter = Number(response.headers.get("x-ratelimit-reset-after"));
  if (Number.isFinite(resetAfter) && resetAfter > 0) return Math.ceil(resetAfter * 1000);

  try {
    const parsed = JSON.parse(body) as { retry_after?: unknown };
    const value = Number(parsed.retry_after);
    if (Number.isFinite(value) && value > 0) {
      return Math.ceil(value > 1000 ? value : value * 1000);
    }
  } catch {
    // Cloudflare 1015 responses are HTML, not JSON.
  }

  if (/error\s*1015|rate limited/i.test(body)) return 15_000;
  return 2_000;
}

function webhookUrlFromEnvironment() {
  const raw = process.env.DISCORD_WEBHOOK_URL ?? process.env.DISCORD_WEBHOOK;
  if (!raw) throw new Error("Discord webhook is not configured.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("The Discord webhook URL is invalid.");
  }

  const allowedHost = ["discord.com", "discordapp.com"].some(
    (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
  );
  if (
    url.protocol !== "https:" ||
    !allowedHost ||
    url.username ||
    url.password ||
    !/^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+\/?$/.test(url.pathname)
  ) {
    throw new Error("The configured URL is not a valid Discord webhook.");
  }

  url.searchParams.set("wait", "true");
  return url;
}

export class DiscordRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterMs: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    super(`Discord is temporarily rate-limiting this webhook. Try again in ${seconds} seconds.`);
    this.name = "DiscordRateLimitError";
    this.retryAfterSeconds = seconds;
  }
}

export async function sendDiscordTestEmbed(embed: Record<string, unknown>) {
  const now = Date.now();
  if (blockedUntil > now) throw new DiscordRateLimitError(blockedUntil - now);

  const url = webhookUrlFromEnvironment();
  const body = JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } });
  let lastDelay = 2_000;

  for (let attempt = 1; attempt <= 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Ambunctious-Tracker/1.0",
        },
        body,
      });
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(1_000 * attempt);
      continue;
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok) {
      blockedUntil = 0;
      const result = (await response.json().catch(() => null)) as { id?: unknown } | null;
      return typeof result?.id === "string" ? result.id : null;
    }

    const text = await response.text();
    if (response.status !== 429) {
      throw new Error(`Discord webhook ${response.status}: ${text.slice(0, 180)}`);
    }

    lastDelay = Math.min(15_000, Math.max(1_000, parseRetryAfter(response, text)));
    blockedUntil = Date.now() + lastDelay;

    if (attempt < 4) {
      await sleep(lastDelay + Math.floor(Math.random() * 500));
    }
  }

  throw new DiscordRateLimitError(lastDelay);
}
