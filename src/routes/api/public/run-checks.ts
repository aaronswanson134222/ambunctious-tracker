import { createFileRoute } from "@tanstack/react-router";

import {
  checkProductPrice,
  checkXProfile,
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
};

async function runChecks() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const results = {
    x_checked: 0,
    x_new_posts: 0,
    products_checked: 0,
    price_changes: 0,
    errors: [] as string[],
  };

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
      await supabaseAdmin
        .from("tracked_x_accounts")
        .update({
          last_post_url: postUrl ?? row.last_post_url,
          last_post_text: postText,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
      if (isNew && row.last_post_url !== null) {
        // Only alert if we had a baseline (skip first-ever check)
        results.x_new_posts++;
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
      } else if (isNew && row.last_post_url === null) {
        // First observation — record without alerting
      }
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
    .select("id, url, label, last_price, currency");
  if (pErr) results.errors.push(`products list: ${pErr.message}`);

  for (const row of (prods ?? []) as ProductRow[]) {
    results.products_checked++;
    try {
      const { price, currency } = await checkProductPrice(row.url);
      if (price == null) throw new Error("Could not extract price");
      await supabaseAdmin.from("price_history").insert({
        product_id: row.id,
        price,
        currency,
      });
      const prev = row.last_price;
      const changed = prev != null && Number(prev) !== price;
      await supabaseAdmin
        .from("tracked_products")
        .update({
          last_price: price,
          currency: currency ?? row.currency,
          last_checked_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", row.id);
      if (changed) {
        results.price_changes++;
        const prevNum = Number(prev);
        const diff = price - prevNum;
        const pct = prevNum > 0 ? (diff / prevNum) * 100 : 0;
        const arrow = diff > 0 ? "🔺" : "🔻";
        const cur = currency ?? row.currency ?? "";
        await sendDiscord({
          embeds: [
            {
              title: `${arrow} Price change: ${row.label}`,
              url: row.url,
              description: `**${cur} ${prevNum.toFixed(2)}** → **${cur} ${price.toFixed(2)}** (${diff > 0 ? "+" : ""}${pct.toFixed(1)}%)`,
              color: diff > 0 ? 0xef4444 : 0x22c55e,
              timestamp: new Date().toISOString(),
            },
          ],
        });
      }
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
