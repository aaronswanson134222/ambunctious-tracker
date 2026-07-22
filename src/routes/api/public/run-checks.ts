import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  checkBigGamesUpdates,
  checkProductPrice,
  checkRobloxCreations,
  checkRobloxExperienceProducts,
  checkXProfile,
  convertToGBP,
  editDiscordMessage,
  sendDiscord,
} from "@/lib/tracker.server";

type XRow = {
  id: string;
  handle: string;
  last_post_url: string | null;
};

type RobloxRow = {
  id: string;
  entity_type: "user" | "group";
  entity_id: number;
  label: string;
  known_item_keys: unknown;
  scan_types: unknown;
  baselined_scan_types: unknown;
  lookback_days: number;
};

type RobloxExperienceRow = {
  id: string;
  place_id: number;
  universe_id: number;
  label: string;
  lookback_days: number;
  known_item_keys: unknown;
};

type WebsiteRow = {
  id: string;
  label: string;
  url: string;
  last_item_url: string | null;
};

type ProductRow = {
  id: string;
  url: string;
  label: string;
  last_price: number | null;
  currency: string | null;
  last_price_gbp: number | null;
};

const API_RELEASE = {
  version: "2026.07.21-security-roblox-1",
  title: "Security hardening and Roblox monitoring",
  changes: [
    "X alerts now require a strictly newer numeric post ID",
    "Price alerts are sent only for actual price drops",
    "A notification ledger prevents duplicate Discord messages",
    "BIG Games developer blogs are now monitored automatically",
    "Outbound requests now block unsafe redirects and oversized responses",
    "Roblox user and group creations are now monitored",
  ],
};

async function sendApiReleaseLog(
  supabaseAdmin: SupabaseClient<Database>,
  errors: string[],
) {
  const { data, error } = await supabaseAdmin
    .from("tracker_api_releases")
    .select("version")
    .eq("version", API_RELEASE.version)
    .maybeSingle();
  if (error) {
    errors.push(`release log lookup: ${error.message}`);
    return false;
  }
  if (data) return false;

  try {
    await sendDiscord({
      embeds: [
        {
          author: { name: "AMBUNCTIOUS TRACKER // API CHANGELOG" },
          title: API_RELEASE.title,
          description: API_RELEASE.changes.map((item) => `• ${item}`).join("\n"),
          color: 0xd8dbe2,
          fields: [
            { name: "Release", value: `\`${API_RELEASE.version}\``, inline: true },
            { name: "Status", value: "Deployed", inline: true },
          ],
          footer: { text: "AB monitoring network" },
          timestamp: new Date().toISOString(),
        },
      ],
    });
    const { error: insertError } = await supabaseAdmin
      .from("tracker_api_releases")
      .insert({
        version: API_RELEASE.version,
        title: API_RELEASE.title,
        changes: API_RELEASE.changes,
        notified_at: new Date().toISOString(),
      });
    if (insertError) errors.push(`release log save: ${insertError.message}`);
    return true;
  } catch (error) {
    errors.push(
      `release log Discord: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}


function xStatusId(url: string | null) {
  const value = url?.match(/\/status\/(\d+)/)?.[1];
  return value ? BigInt(value) : null;
}

async function reserveNotification(
  supabaseAdmin: SupabaseClient<Database>,
  sourceType: string,
  sourceId: string,
  fingerprint: string,
) {
  const db = supabaseAdmin as unknown as {
    from: (table: string) => {
      insert: (value: Record<string, string>) => Promise<{
        error: { code?: string; message: string } | null;
      }>;
      delete: () => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => Promise<unknown>;
          };
        };
      };
      update: (value: Record<string, string>) => {
        eq: (column: string, value: string) => {
          eq: (column: string, value: string) => {
            eq: (column: string, value: string) => Promise<unknown>;
          };
        };
      };
    };
  };
  const { error } = await db.from("tracker_notification_events").insert({
    source_type: sourceType,
    source_id: sourceId,
    fingerprint,
  });
  if (!error) return {
    markSent: () => db.from("tracker_notification_events")
      .update({ sent_at: new Date().toISOString() })
      .eq("source_type", sourceType).eq("source_id", sourceId).eq("fingerprint", fingerprint),
    release: () => db.from("tracker_notification_events")
      .delete()
      .eq("source_type", sourceType).eq("source_id", sourceId).eq("fingerprint", fingerprint),
  };
  if (error.code === "23505") return null;
  throw new Error(`Could not reserve notification: ${error.message}`);
}

type ScanMetrics = {
  x_checked: number;
  x_new_posts: number;
  products_checked: number;
  price_drops: number;
  websites_checked: number;
  website_updates: number;
  roblox_checked: number;
  roblox_new_items: number;
  errors: string[];
};

async function recordScanAndMaybeSendHourlySummary(
  supabaseAdmin: SupabaseClient<Database>,
  results: ScanMetrics,
) {
  const db = supabaseAdmin as any;
  const recordedAt = new Date();
  const { error: insertError } = await db.from("tracker_scan_runs").insert({
    x_checked: results.x_checked,
    x_new_posts: results.x_new_posts,
    products_checked: results.products_checked,
    price_drops: results.price_drops,
    websites_checked: results.websites_checked,
    website_updates: results.website_updates,
    roblox_checked: results.roblox_checked,
    roblox_new_items: results.roblox_new_items,
    error_count: results.errors.length,
  });
  if (insertError) throw new Error(`Could not record scan: ${insertError.message}`);

  const currentHour = new Date(recordedAt);
  currentHour.setUTCMinutes(0, 0, 0);
  const previousHour = new Date(currentHour.getTime() - 60 * 60 * 1000);
  const fingerprint = previousHour.toISOString().slice(0, 13);
  const reservation = await reserveNotification(
    supabaseAdmin, "hourly_summary", "global", fingerprint,
  );
  if (!reservation) return false;

  try {
    const { data: scans, error } = await db
      .from("tracker_scan_runs")
      .select("x_checked,x_new_posts,products_checked,price_drops,websites_checked,website_updates,roblox_checked,roblox_new_items,error_count")
      .gte("created_at", previousHour.toISOString())
      .lt("created_at", currentHour.toISOString());
    if (error) throw new Error(`Could not read hourly scans: ${error.message}`);

    const totals = (scans ?? []).reduce(
      (sum: Record<string, number>, scan: Record<string, number>) => {
        for (const [key, value] of Object.entries(scan)) {
          sum[key] = (sum[key] ?? 0) + (Number(value) || 0);
        }
        return sum;
      },
      {},
    );
    const detected =
      (totals.x_new_posts ?? 0) +
      (totals.price_drops ?? 0) +
      (totals.website_updates ?? 0) +
      (totals.roblox_new_items ?? 0);
    const scanCount = scans?.length ?? 0;
    const errorCount = totals.error_count ?? 0;

    await sendDiscord({
      embeds: [{
        author: { name: "AMBUNCTIOUS TRACKER // HOURLY REPORT" },
        title: detected > 0
          ? `Detected ${detected} new update${detected === 1 ? "" : "s"}`
          : "No new updates found",
        description: scanCount > 0
          ? "The monitoring network completed its scheduled checks for the last hour."
          : "No completed scans were recorded during the last hour.",
        color: errorCount > 0 ? 0xf59e0b : detected > 0 ? 0x22c55e : 0x8b95a5,
        fields: [
          { name: "X posts", value: String(totals.x_new_posts ?? 0), inline: true },
          { name: "Price drops", value: String(totals.price_drops ?? 0), inline: true },
          { name: "Website updates", value: String(totals.website_updates ?? 0), inline: true },
          { name: "Roblox uploads", value: String(totals.roblox_new_items ?? 0), inline: true },
          { name: "Scans completed", value: String(scanCount), inline: true },
          {
            name: "Check status",
            value: errorCount > 0
              ? `${errorCount} check error${errorCount === 1 ? "" : "s"}`
              : "All checks healthy",
            inline: true,
          },
        ],
        footer: { text: `Hour beginning ${previousHour.toISOString().replace("T", " ").slice(0, 16)} UTC` },
        timestamp: recordedAt.toISOString(),
      }],
    });
    await reservation.markSent();
    return true;
  } catch (error) {
    await reservation.release();
    throw error;
  }
}

async function runChecks() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const results = {
    x_checked: 0,
    x_new_posts: 0,
    products_checked: 0,
    price_drops: 0,
    websites_checked: 0,
    website_updates: 0,
    roblox_checked: 0,
    roblox_new_items: 0,
    discord_sent: 0,
    release_notifications: 0,
    hourly_summaries: 0,
    errors: [] as string[],
  };

  if (await sendApiReleaseLog(supabaseAdmin, results.errors)) {
    results.discord_sent++;
    results.release_notifications++;
  }

  // --- X accounts ---
  const { data: xs, error: xErr } = await supabaseAdmin
    .from("tracked_x_accounts")
    .select("id, handle, last_post_url");
  if (xErr) results.errors.push(`x list: ${xErr.message}`);

  for (const row of (xs ?? []) as XRow[]) {
    results.x_checked++;
    try {
      const { postUrl, postText } = await checkXProfile(row.handle);
      const candidateId = xStatusId(postUrl);
      const previousId = xStatusId(row.last_post_url);
      const isFirstObservation = previousId === null;
      const isStrictlyNewer =
        candidateId !== null && previousId !== null && candidateId > previousId;

      if (isStrictlyNewer && postUrl) {
        const reservation = await reserveNotification(
          supabaseAdmin, "x_post", row.id, candidateId.toString(),
        );
        if (reservation) {
          try {
            await sendDiscord({
              embeds: [
                {
                  title: `New post from @${row.handle.replace(/^@/, "")}`,
                  url: postUrl,
                  description: postText?.slice(0, 500) ?? "",
                  color: 0x1da1f2,
                  timestamp: new Date().toISOString(),
                },
              ],
            });
            await reservation.markSent();
            results.x_new_posts++;
            results.discord_sent++;
          } catch (error) {
            await reservation.release();
            throw error;
          }
        }
      }

      const shouldAdvance = isFirstObservation || isStrictlyNewer;
      await supabaseAdmin
        .from("tracked_x_accounts")
        .update({
          last_post_url: shouldAdvance && postUrl ? postUrl : row.last_post_url,
          last_post_text: shouldAdvance ? postText : undefined,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.errors.push(`x/${row.handle}: ${msg}`);
      await supabaseAdmin
        .from("tracked_x_accounts")
        .update({
          last_checked_at: new Date().toISOString(),
          last_error: msg.slice(0, 500),
        })
        .eq("id", row.id);
    }
  }

  // --- Products ---
  const { data: prods, error: pErr } = await supabaseAdmin
    .from("tracked_products")
    .select("id, url, label, last_price, currency, last_price_gbp");
  if (pErr) results.errors.push(`products list: ${pErr.message}`);

  for (const row of (prods ?? []) as ProductRow[]) {
    results.products_checked++;
    try {
      const { price, currency } = await checkProductPrice(row.url);
      if (price == null) throw new Error("Could not extract price");
      const effectiveCurrency = currency ?? row.currency;
      const priceGbp = await convertToGBP(price, effectiveCurrency);
      const prev = row.last_price;
      const dropped = prev != null && price < Number(prev);
      if (dropped) {
        const prevNum = Number(prev);
        const diff = price - prevNum;
        const pct = prevNum > 0 ? (diff / prevNum) * 100 : 0;
        const cur = effectiveCurrency ?? "";
        const pounds =
          priceGbp == null
            ? ""
            : `\nApprox. **£${priceGbp.toFixed(2)} GBP**`;
        const fingerprint = `${effectiveCurrency ?? "unknown"}:${price.toFixed(8)}`;
        const reservation = await reserveNotification(
          supabaseAdmin, "price_drop", row.id, fingerprint,
        );
        if (reservation) {
          try {
            await sendDiscord({
              embeds: [
                {
                  title: `🔻 Price drop: ${row.label}`,
                  url: row.url,
                  description: `**${cur} ${prevNum.toFixed(2)}** → **${cur} ${price.toFixed(2)}** (${pct.toFixed(1)}%)${pounds}`,
                  color: 0x22c55e,
                  timestamp: new Date().toISOString(),
                },
              ],
            });
            await reservation.markSent();
            results.price_drops++;
            results.discord_sent++;
          } catch (error) {
            await reservation.release();
            throw error;
          }
        }
      }
      await supabaseAdmin.from("price_history").insert({
        product_id: row.id,
        price,
        currency: effectiveCurrency,
        price_gbp: priceGbp,
      });
      await supabaseAdmin
        .from("tracked_products")
        .update({
          last_price: price,
          last_price_gbp: priceGbp,
          currency: effectiveCurrency,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.errors.push(`product/${row.label}: ${msg}`);
      await supabaseAdmin
        .from("tracked_products")
        .update({
          last_checked_at: new Date().toISOString(),
          last_error: msg.slice(0, 500),
        })
        .eq("id", row.id);
    }
  }

  // --- Roblox profiles and groups ---
  const robloxDb = supabaseAdmin as unknown as { from: (table: string) => any };
  const { data: robloxEntities, error: robloxListError } = await robloxDb
    .from("tracked_roblox_entities")
    .select("id, entity_type, entity_id, label, known_item_keys, scan_types, baselined_scan_types, lookback_days");
  if (robloxListError) results.errors.push(`roblox list: ${robloxListError.message}`);

  const { data: robloxOpenCloudKey } = await (
    robloxDb.from
      ? (supabaseAdmin as any).rpc("get_roblox_open_cloud_key")
      : Promise.resolve({ data: null })
  );

  for (const row of (robloxEntities ?? []) as RobloxRow[]) {
    results.roblox_checked++;
    try {
      const scanTypes = Array.isArray(row.scan_types)
        ? row.scan_types.filter((value): value is "catalog" | "experience" | "game_pass" | "developer_product" =>
            ["catalog", "experience", "game_pass", "developer_product"].includes(String(value)),
          )
        : ["catalog", "experience"];
      const baselinedTypes = new Set(
        Array.isArray(row.baselined_scan_types)
          ? row.baselined_scan_types.filter((value): value is string => typeof value === "string")
          : [],
      );
      const creations = await checkRobloxCreations(
        row.entity_type,
        Number(row.entity_id),
        scanTypes,
        Number(row.lookback_days),
        typeof robloxOpenCloudKey === "string" ? robloxOpenCloudKey : null,
      );
      const known = new Set(
        Array.isArray(row.known_item_keys)
          ? row.known_item_keys.filter((value): value is string => typeof value === "string")
          : [],
      );
      const fresh = creations
        .filter((item) => baselinedTypes.has(item.kind) && !known.has(item.key))
        .slice(0, 10);

      for (const item of fresh) {
        const reservation = await reserveNotification(
          supabaseAdmin, "roblox_creation", row.id, item.key,
        );
        if (!reservation) continue;
        try {
          await sendDiscord({
            embeds: [{
              author: {
                name: `Roblox ${row.entity_type}: ${row.label}`,
                icon_url: "https://www.roblox.com/favicon.ico",
              },
              title: `New ${item.kind.replaceAll("_", " ")}: ${item.name}`,
              url: item.url,
              description: `A new public ${item.kind.replaceAll("_", " ")} was detected on Roblox.`,
              thumbnail: { url: "https://www.roblox.com/favicon.ico" },
              color: 0x00a2ff,
              timestamp: new Date().toISOString(),
            }],
          });
          await reservation.markSent();
          results.roblox_new_items++;
          results.discord_sent++;
        } catch (error) {
          await reservation.release();
          throw error;
        }
      }

      const mergedKeys = [...new Set([
        ...creations.map((item) => item.key),
        ...known,
      ])].slice(0, 500);
      await robloxDb.from("tracked_roblox_entities").update({
        known_item_keys: mergedKeys,
        baselined_scan_types: [...new Set([...baselinedTypes, ...scanTypes])],
        last_checked_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", row.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.errors.push(`roblox/${row.label}: ${msg}`);
      await robloxDb.from("tracked_roblox_entities").update({
        last_checked_at: new Date().toISOString(),
        last_error: msg.slice(0, 500),
      }).eq("id", row.id);
    }
  }

  // --- Individual Roblox experiences ---
  const { data: experienceTrackers, error: experienceListError } = await robloxDb
    .from("tracked_roblox_experiences")
    .select("id,place_id,universe_id,label,lookback_days,known_item_keys");
  if (experienceListError) {
    results.errors.push(`roblox experiences list: ${experienceListError.message}`);
  }

  for (const row of (experienceTrackers ?? []) as RobloxExperienceRow[]) {
    results.roblox_checked++;
    try {
      const products = await checkRobloxExperienceProducts(
        Number(row.universe_id),
        Number(row.place_id),
        Number(row.lookback_days),
        typeof robloxOpenCloudKey === "string" ? robloxOpenCloudKey : null,
      );
      const known = new Set(
        Array.isArray(row.known_item_keys)
          ? row.known_item_keys.filter((value): value is string => typeof value === "string")
          : [],
      );
      const hasDeveloperProductBaseline = [...known].some((key) =>
        key.startsWith("developer_product:"),
      );
      const fresh = products
        .filter((item) =>
          !known.has(item.key) &&
          (item.kind !== "developer_product" || hasDeveloperProductBaseline),
        )
        .slice(0, 20);

      for (const item of fresh) {
        const reservation = await reserveNotification(
          supabaseAdmin,
          "roblox_experience_product",
          row.id,
          item.key,
        );
        if (!reservation) continue;
        try {
          await sendDiscord({
            embeds: [{
              author: {
                name: `ROBLOX EXPERIENCE // ${row.label}`,
                icon_url: "https://www.roblox.com/favicon.ico",
              },
              title: `New ${item.kind.replaceAll("_", " ")}: ${item.name}`,
              url: item.url,
              description: "A new monetization product was detected for this tracked experience.",
              thumbnail: { url: "https://www.roblox.com/favicon.ico" },
              color: 0x00a2ff,
              timestamp: new Date().toISOString(),
            }],
          });
          await reservation.markSent();
          results.roblox_new_items++;
          results.discord_sent++;
        } catch (error) {
          await reservation.release();
          throw error;
        }
      }

      await robloxDb.from("tracked_roblox_experiences").update({
        known_item_keys: [...new Set([
          ...products.map((item) => item.key),
          ...known,
        ])].slice(0, 1000),
        items: products,
        last_checked_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.errors.push(`roblox experience/${row.label}: ${message}`);
      await robloxDb.from("tracked_roblox_experiences").update({
        last_checked_at: new Date().toISOString(),
        last_error: message.slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
    }
  }

  // --- BIG Games website (navigation/category links are excluded by the parser) ---
  const websiteDb = supabaseAdmin as unknown as {
    from: (table: string) => any;
  };
  const { data: websites, error: websiteListError } = await websiteDb
    .from("tracked_websites")
    .select("id, label, url, last_item_url");
  if (websiteListError) results.errors.push(`websites list: ${websiteListError.message}`);

  for (const row of (websites ?? []) as WebsiteRow[]) {
    results.websites_checked++;
    try {
      const update = await checkBigGamesUpdates(row.url);
      const isNew = row.last_item_url !== null && update.itemUrl !== row.last_item_url;
      if (isNew) {
        const reservation = await reserveNotification(
          supabaseAdmin, "website_update", row.id, update.itemUrl,
        );
        if (reservation) {
          try {
            await sendDiscord({
              embeds: [
                {
                  author: {
                    name: "BIG Games // Website update",
                    icon_url: "https://www.biggames.io/favicon.ico",
                    url: "https://www.biggames.io/post",
                  },
                  title: `New BIG Games update: ${update.title}`,
                  url: update.itemUrl,
                  thumbnail: { url: "https://www.biggames.io/favicon.ico" },
                  description: update.summary?.slice(0, 500) ?? "A new developer blog has been published.",
                  color: 0xf4c542,
                  timestamp: new Date().toISOString(),
                },
              ],
            });
            await reservation.markSent();
            results.website_updates++;
            results.discord_sent++;
          } catch (error) {
            await reservation.release();
            throw error;
          }
        }
      }
      await websiteDb.from("tracked_websites").update({
        last_item_url: update.itemUrl,
        last_item_title: update.title,
        last_checked_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", row.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      results.errors.push(`website/${row.label}: ${msg}`);
      await websiteDb.from("tracked_websites").update({
        last_checked_at: new Date().toISOString(),
        last_error: msg.slice(0, 500),
      }).eq("id", row.id);
    }
  }

  try {
    if (await recordScanAndMaybeSendHourlySummary(supabaseAdmin, results)) {
      results.hourly_summaries++;
      results.discord_sent++;
    }
  } catch (error) {
    results.errors.push(
      `hourly summary: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return results;
}

type AdminClient = SupabaseClient<Database>;

async function booleanRpc(
  client: AdminClient,
  functionName: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await (
    client.rpc as unknown as (
      name: string,
      parameters: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(functionName, args);
  if (error) throw new Error(`Authorization check failed: ${error.message}`);
  return data === true;
}

async function authorizeRequest(request: Request, client: AdminClient) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 4096) return null;

  if (
    /^[a-f0-9]{64}$/i.test(token) &&
    await booleanRpc(client, "verify_tracker_cron_secret", { candidate: token })
  ) {
    return { kind: "cron" as const };
  }

  const { data, error } = await client.auth.getUser(token);
  const email = data.user?.email;
  if (error || !email) return null;
  const isOwner = await booleanRpc(client, "verify_tracker_owner_email", {
    candidate: email,
  });
  return isOwner ? { kind: "owner" as const } : null;
}

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/public/run-checks")({
  server: {
    handlers: {
      GET: async () => json(
        { error: "Method not allowed" },
        405,
      ),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const caller = await authorizeRequest(request, supabaseAdmin);
        if (!caller) return json({ error: "Unauthorized" }, 401);

        const acquired = await booleanRpc(
          supabaseAdmin,
          "acquire_tracker_run_lock",
          {},
        );
        if (!acquired) {
          return json({ error: "A tracker scan is already running or ran moments ago." }, 409);
        }

        try {
          const result = await runChecks();
          if (caller.kind === "cron") {
            const { errors: _errors, ...safeResult } = result;
            return json({ ...safeResult, error_count: result.errors.length });
          }
          return json(result);
        } finally {
          try {
            await booleanRpc(supabaseAdmin, "release_tracker_run_lock", {});
          } catch (error) {
            console.error("Could not release tracker run lock", error);
          }
        }
      },
    },
  },
});
