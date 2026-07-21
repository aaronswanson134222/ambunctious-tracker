import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

import {
  checkProductPrice,
  checkXProfile,
  convertToGBP,
  sendDiscord,
} from "@/lib/tracker.server";

type XRow = {
  id: string;
  handle: string;
  last_post_url: string | null;
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
  version: "2026.07.21-ab-command-1",
  title: "AB Command update",
  changes: [
    "New metallic AB command-centre interface",
    "AB logo and widescreen identity added across the dashboard",
    "Automatic API update logs now post to Discord",
    "Five-minute monitoring, Discord retries and GBP prices remain active",
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

async function runChecks() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const results = {
    x_checked: 0,
    x_new_posts: 0,
    products_checked: 0,
    price_changes: 0,
    discord_sent: 0,
    release_notifications: 0,
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
      const isNew = postUrl && postUrl !== row.last_post_url;
      if (isNew && row.last_post_url !== null) {
        // Only alert if we had a baseline (skip first-ever check)
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
        results.x_new_posts++;
        results.discord_sent++;
      } else if (isNew && row.last_post_url === null) {
        // First observation — record without alerting
      }
      await supabaseAdmin
        .from("tracked_x_accounts")
        .update({
          last_post_url: postUrl ?? row.last_post_url,
          last_post_text: postText,
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
      const changed = prev != null && Number(prev) !== price;
      if (changed) {
        const prevNum = Number(prev);
        const diff = price - prevNum;
        const pct = prevNum > 0 ? (diff / prevNum) * 100 : 0;
        const arrow = diff > 0 ? "🔺" : "🔻";
        const cur = effectiveCurrency ?? "";
        const pounds =
          priceGbp == null
            ? ""
            : `\nApprox. **£${priceGbp.toFixed(2)} GBP**`;
        await sendDiscord({
          embeds: [
            {
              title: `${arrow} Price change: ${row.label}`,
              url: row.url,
              description: `**${cur} ${prevNum.toFixed(2)}** → **${cur} ${price.toFixed(2)}** (${diff > 0 ? "+" : ""}${pct.toFixed(1)}%)${pounds}`,
              color: diff > 0 ? 0xef4444 : 0x22c55e,
              timestamp: new Date().toISOString(),
            },
          ],
        });
        results.price_changes++;
        results.discord_sent++;
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

  return results;
}

export const Route = createFileRoute("/api/public/run-checks")({
  server: {
    handlers: {
      GET: async () => {
        const r = await runChecks();
        return Response.json(r);
      },
      POST: async () => {
        const r = await runChecks();
        return Response.json(r);
      },
    },
  },
});
