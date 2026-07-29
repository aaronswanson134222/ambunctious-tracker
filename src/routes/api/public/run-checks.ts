import { createFileRoute } from "@tanstack/react-router";
// Supabase client types removed; using a loose DB client shape
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
import {
  buildRobloxPreviewEmbed,
  enrichRobloxPreview,
  type RobloxPreviewKind,
} from "@/lib/roblox-product-preview.server";

type AdminClient = { from: (table: string) => any; rpc: (...args: any[]) => Promise<any> };
type LooseDb = AdminClient;

type ScanMetrics = {
  x_checked: number;
  x_new_posts: number;
  products_checked: number;
  price_drops: number;
  websites_checked: number;
  website_updates: number;
  roblox_checked: number;
  roblox_new_items: number;
  discord_sent: number;
  release_notifications: number;
  hourly_summaries: number;
  errors: string[];
};

const API_RELEASE = {
  version: "2026.07.26-roblox-rich-previews-1",
  title: "Roblox rich product previews",
  changes: [
    "Discord alerts now show real Roblox thumbnails instead of the favicon",
    "Developer-product alerts include the icon and Robux price when Roblox exposes it",
    "Game-pass alerts include price, sale status and product metadata",
    "Experience product rows now store enriched preview data for the website",
  ],
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function xStatusId(url: string | null) {
  const value = url?.match(/\/status\/(\d+)/)?.[1];
  return value ? BigInt(value) : null;
}

async function booleanRpc(client: AdminClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await (client.rpc as any)(name, args);
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
    (await booleanRpc(client, "verify_tracker_cron_secret", { candidate: token }))
  ) {
    return { kind: "cron" as const };
  }
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user?.email) return null;
  return (await booleanRpc(client, "verify_tracker_owner_email", { candidate: data.user.email }))
    ? { kind: "owner" as const }
    : null;
}

async function reserveNotification(
  client: AdminClient,
  sourceType: string,
  sourceId: string,
  fingerprint: string,
) {
  const db = client as unknown as LooseDb;
  const { error } = await db.from("tracker_notification_events").insert({
    source_type: sourceType,
    source_id: sourceId,
    fingerprint,
  });
  if (!error)
    return {
      markSent: () =>
        db
          .from("tracker_notification_events")
          .update({ sent_at: new Date().toISOString() })
          .eq("source_type", sourceType)
          .eq("source_id", sourceId)
          .eq("fingerprint", fingerprint),
      release: () =>
        db
          .from("tracker_notification_events")
          .delete()
          .eq("source_type", sourceType)
          .eq("source_id", sourceId)
          .eq("fingerprint", fingerprint),
    };
  if (error.code === "23505") return null;
  throw new Error(`Could not reserve notification: ${error.message}`);
}

async function sendApiReleaseLog(client: AdminClient, errors: string[]) {
  const { data, error } = await client
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
          color: 0x22c55e,
          fields: [
            { name: "Release", value: `\`${API_RELEASE.version}\``, inline: true },
            { name: "Status", value: "Deployed", inline: true },
          ],
          footer: { text: "AB monitoring network" },
          timestamp: new Date().toISOString(),
        },
      ],
    });
    await client.from("tracker_api_releases").insert({
      version: API_RELEASE.version,
      title: API_RELEASE.title,
      changes: API_RELEASE.changes,
      notified_at: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    errors.push(`release log Discord: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function recordStatus(client: AdminClient, results: ScanMetrics) {
  const db = client as unknown as LooseDb;
  const now = new Date();
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
  const { count } = await db.from("tracker_scan_runs").select("id", { count: "exact", head: true });
  const { data: statusRow } = await db
    .from("tracker_discord_status")
    .select("message_id")
    .eq("singleton", true)
    .maybeSingle();
  const nextScan = Math.floor((Math.floor(Date.now() / 60_000) + 1) * 60);
  const checked =
    results.x_checked +
    results.products_checked +
    results.websites_checked +
    results.roblox_checked;
  const detected =
    results.x_new_posts + results.price_drops + results.website_updates + results.roblox_new_items;
  const payload = {
    embeds: [
      {
        author: { name: "AMBUNCTIOUS TRACKER // LIVE STATUS" },
        title: results.errors.length
          ? "Monitoring active with warnings"
          : "Monitoring network online",
        description: "This permanent status message is edited after every scheduled scan.",
        color: results.errors.length ? 0xf59e0b : 0x22c55e,
        fields: [
          {
            name: "Total scans",
            value: `**${Number(count ?? 0).toLocaleString("en-GB")}**`,
            inline: true,
          },
          { name: "Last scan", value: `<t:${Math.floor(now.getTime() / 1000)}:R>`, inline: true },
          { name: "Next scan", value: `<t:${nextScan}:R>`, inline: true },
          { name: "Trackers checked", value: String(checked), inline: true },
          { name: "Updates detected", value: String(detected), inline: true },
          {
            name: "Health",
            value: results.errors.length
              ? `${results.errors.length} warning(s)`
              : "All checks healthy",
            inline: true,
          },
        ],
        footer: { text: "Updates every 60 seconds • Do not delete this message" },
        timestamp: now.toISOString(),
      },
    ],
  };
  let messageId = typeof statusRow?.message_id === "string" ? statusRow.message_id : null;
  const edited = messageId ? await editDiscordMessage(messageId, payload) : false;
  if (!edited) messageId = await sendDiscord(payload);
  if (!messageId) throw new Error("Discord did not return a message ID");
  await db
    .from("tracker_discord_status")
    .upsert(
      { singleton: true, message_id: messageId, updated_at: now.toISOString() },
      { onConflict: "singleton" },
    );
}

function universeFromKey(key: string) {
  const value = Number(key.split(":")[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

async function runChecks() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const db = supabaseAdmin as unknown as LooseDb;
  const results: ScanMetrics = {
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
    errors: [],
  };

  if (await sendApiReleaseLog(supabaseAdmin, results.errors)) {
    results.discord_sent++;
    results.release_notifications++;
  }

  const { data: xs, error: xErr } = await db
    .from("tracked_x_accounts")
    .select("id,handle,last_post_url");
  if (xErr) results.errors.push(`x list: ${xErr.message}`);
  for (const row of xs ?? []) {
    results.x_checked++;
    try {
      const { postUrl, postText } = await checkXProfile(row.handle);
      const current = xStatusId(postUrl);
      const previous = xStatusId(row.last_post_url);
      const isNew = current !== null && previous !== null && current > previous;
      if (isNew && postUrl) {
        const reservation = await reserveNotification(
          supabaseAdmin,
          "x_post",
          row.id,
          current.toString(),
        );
        if (reservation) {
          try {
            await sendDiscord({
              embeds: [
                {
                  title: `New post from @${String(row.handle).replace(/^@/, "")}`,
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
      await db
        .from("tracked_x_accounts")
        .update({
          last_post_url: (previous === null || isNew) && postUrl ? postUrl : row.last_post_url,
          last_post_text: previous === null || isNew ? postText : undefined,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.errors.push(`x/${row.handle}: ${message}`);
      await db
        .from("tracked_x_accounts")
        .update({ last_checked_at: new Date().toISOString(), last_error: message.slice(0, 500) })
        .eq("id", row.id);
    }
  }

  const { data: trackedProducts, error: productsError } = await db
    .from("tracked_products")
    .select("id,url,label,last_price,currency,last_price_gbp");
  if (productsError) results.errors.push(`products list: ${productsError.message}`);
  for (const row of trackedProducts ?? []) {
    results.products_checked++;
    try {
      const { price, currency } = await checkProductPrice(row.url);
      if (price == null) throw new Error("Could not extract price");
      const effectiveCurrency = currency ?? row.currency;
      const priceGbp = await convertToGBP(price, effectiveCurrency);
      if (row.last_price != null && price < Number(row.last_price)) {
        const oldPrice = Number(row.last_price);
        const pct = oldPrice > 0 ? ((price - oldPrice) / oldPrice) * 100 : 0;
        const reservation = await reserveNotification(
          supabaseAdmin,
          "price_drop",
          row.id,
          `${effectiveCurrency}:${price}`,
        );
        if (reservation) {
          try {
            await sendDiscord({
              embeds: [
                {
                  title: `🔻 Price drop: ${row.label}`,
                  url: row.url,
                  description: `**${effectiveCurrency ?? ""} ${oldPrice.toFixed(2)}** → **${effectiveCurrency ?? ""} ${price.toFixed(2)}** (${pct.toFixed(1)}%)${priceGbp == null ? "" : `\nApprox. **£${priceGbp.toFixed(2)} GBP**`}`,
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
      await db
        .from("price_history")
        .insert({ product_id: row.id, price, currency: effectiveCurrency, price_gbp: priceGbp });
      await db
        .from("tracked_products")
        .update({
          last_price: price,
          last_price_gbp: priceGbp,
          currency: effectiveCurrency,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.errors.push(`product/${row.label}: ${message}`);
      await db
        .from("tracked_products")
        .update({ last_checked_at: new Date().toISOString(), last_error: message.slice(0, 500) })
        .eq("id", row.id);
    }
  }

  const { data: openCloudKey } = await db.rpc("get_roblox_open_cloud_key");
  const { data: entities, error: entityError } = await db
    .from("tracked_roblox_entities")
    .select(
      "id,entity_type,entity_id,label,known_item_keys,scan_types,baselined_scan_types,lookback_days",
    );
  if (entityError) results.errors.push(`roblox list: ${entityError.message}`);
  for (const row of entities ?? []) {
    results.roblox_checked++;
    try {
      const scanTypes = (
        Array.isArray(row.scan_types) ? row.scan_types : ["catalog", "experience"]
      ).filter((value: string) =>
        ["catalog", "experience", "game_pass", "developer_product"].includes(value),
      );
      const baselined = new Set(
        Array.isArray(row.baselined_scan_types) ? row.baselined_scan_types : [],
      );
      const known = new Set(Array.isArray(row.known_item_keys) ? row.known_item_keys : []);
      const creations = await checkRobloxCreations(
        row.entity_type,
        Number(row.entity_id),
        scanTypes,
        Number(row.lookback_days),
        typeof openCloudKey === "string" ? openCloudKey : null,
      );
      const fresh = creations
        .filter((item) => baselined.has(item.kind) && !known.has(item.key))
        .slice(0, 10);
      for (const item of fresh) {
        const reservation = await reserveNotification(
          supabaseAdmin,
          "roblox_creation",
          row.id,
          item.key,
        );
        if (!reservation) continue;
        try {
          const preview = await enrichRobloxPreview({
            id: item.id,
            kind: item.kind as RobloxPreviewKind,
            name: item.name,
            url: item.url,
            createdAt: item.createdAt,
            universeId: ["game_pass", "developer_product"].includes(item.kind)
              ? universeFromKey(item.key)
              : item.kind === "experience"
                ? item.id
                : null,
          });
          await sendDiscord({
            embeds: [
              buildRobloxPreviewEmbed(
                preview,
                `ROBLOX ${String(row.entity_type).toUpperCase()} // ${row.label}`,
              ),
            ],
          });
          await reservation.markSent();
          results.roblox_new_items++;
          results.discord_sent++;
        } catch (error) {
          await reservation.release();
          throw error;
        }
      }
      await db
        .from("tracked_roblox_entities")
        .update({
          known_item_keys: [...new Set([...creations.map((item) => item.key), ...known])].slice(
            0,
            500,
          ),
          baselined_scan_types: [...new Set([...baselined, ...scanTypes])],
          last_checked_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.errors.push(`roblox/${row.label}: ${message}`);
      await db
        .from("tracked_roblox_entities")
        .update({ last_checked_at: new Date().toISOString(), last_error: message.slice(0, 500) })
        .eq("id", row.id);
    }
  }

  const { data: experienceRows, error: experienceError } = await db
    .from("tracked_roblox_experiences")
    .select("id,place_id,universe_id,label,lookback_days,known_item_keys");
  if (experienceError) results.errors.push(`roblox experiences list: ${experienceError.message}`);
  for (const row of experienceRows ?? []) {
    results.roblox_checked++;
    try {
      const rawProducts = await checkRobloxExperienceProducts(
        Number(row.universe_id),
        Number(row.place_id),
        Number(row.lookback_days),
        typeof openCloudKey === "string" ? openCloudKey : null,
      );
      const products = await Promise.all(
        rawProducts.map((item) =>
          enrichRobloxPreview({
            id: item.id,
            kind: item.kind,
            name: item.name,
            url: item.url,
            createdAt: item.createdAt,
            universeId: Number(row.universe_id),
            placeId: Number(row.place_id),
            experienceName: row.label,
          }).then((preview) => ({
            ...item,
            description: preview.description,
            priceInRobux: preview.priceInRobux,
            isForSale: preview.isForSale,
            thumbnailUrl: preview.thumbnailUrl,
            experienceName: preview.experienceName,
            creatorName: preview.creatorName,
          })),
        ),
      );
      const known = new Set(Array.isArray(row.known_item_keys) ? row.known_item_keys : []);
      const hasDevBaseline = [...known].some((key) => String(key).startsWith("developer_product:"));
      const fresh = products
        .filter(
          (item) => !known.has(item.key) && (item.kind !== "developer_product" || hasDevBaseline),
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
          const preview = await enrichRobloxPreview({
            id: item.id,
            kind: item.kind,
            name: item.name,
            url: item.url,
            createdAt: item.createdAt,
            universeId: Number(row.universe_id),
            placeId: Number(row.place_id),
            experienceName: row.label,
          });
          await sendDiscord({
            embeds: [buildRobloxPreviewEmbed(preview, `ROBLOX EXPERIENCE // ${row.label}`)],
          });
          await reservation.markSent();
          results.roblox_new_items++;
          results.discord_sent++;
        } catch (error) {
          await reservation.release();
          throw error;
        }
      }
      await db
        .from("tracked_roblox_experiences")
        .update({
          known_item_keys: [...new Set([...products.map((item) => item.key), ...known])].slice(
            0,
            1000,
          ),
          items: products,
          last_checked_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.errors.push(`roblox experience/${row.label}: ${message}`);
      await db
        .from("tracked_roblox_experiences")
        .update({
          last_checked_at: new Date().toISOString(),
          last_error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  const { data: websites, error: websitesError } = await db
    .from("tracked_websites")
    .select("id,label,url,last_item_url");
  if (websitesError) results.errors.push(`websites list: ${websitesError.message}`);
  for (const row of websites ?? []) {
    results.websites_checked++;
    try {
      const update = await checkBigGamesUpdates(row.url);
      if (row.last_item_url !== null && update.itemUrl !== row.last_item_url) {
        const reservation = await reserveNotification(
          supabaseAdmin,
          "website_update",
          row.id,
          update.itemUrl,
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
                  description:
                    update.summary?.slice(0, 500) ?? "A new developer blog has been published.",
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
      await db
        .from("tracked_websites")
        .update({
          last_item_url: update.itemUrl,
          last_item_title: update.title,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.errors.push(`website/${row.label}: ${message}`);
      await db
        .from("tracked_websites")
        .update({ last_checked_at: new Date().toISOString(), last_error: message.slice(0, 500) })
        .eq("id", row.id);
    }
  }

  try {
    await recordStatus(supabaseAdmin, results);
    results.hourly_summaries++;
    results.discord_sent++;
  } catch (error) {
    results.errors.push(
      `permanent Discord status: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return results;
}

export const Route = createFileRoute("/api/public/run-checks")({
  server: {
    handlers: {
      GET: async () => json({ error: "Method not allowed" }, 405),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const caller = await authorizeRequest(request, supabaseAdmin);
        if (!caller) return json({ error: "Unauthorized" }, 401);
        const acquired = await booleanRpc(supabaseAdmin, "acquire_tracker_run_lock", {});
        if (!acquired)
          return json({ error: "A tracker scan is already running or ran moments ago." }, 409);
        try {
          const result = await runChecks();
          if (caller.kind === "cron") {
            const { errors: _errors, ...safe } = result;
            return json({ ...safe, error_count: result.errors.length });
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
