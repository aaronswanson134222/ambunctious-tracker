import { createFileRoute } from "@tanstack/react-router";
import { sendOwnerDm } from "@/lib/private-discord.server";

type NotificationEvent = {
  source_type: string;
  source_id: string;
  fingerprint: string;
  sent_at: string | null;
  created_at?: string | null;
};

function fallbackPayload(event: NotificationEvent) {
  const title = event.source_type.replaceAll("_", " ");
  return {
    embeds: [
      {
        title: `Ambunctious Tracker: ${title}`,
        description: `A new tracked update was detected.\n\nReference: \`${event.fingerprint.slice(0, 180)}\``,
        color: 0x5865f2,
        timestamp: event.sent_at ?? event.created_at ?? new Date().toISOString(),
        footer: { text: "Ambunctious Tracker • Private DM mirror" },
      },
    ],
  };
}

async function payloadFor(client: any, event: NotificationEvent) {
  if (event.source_type === "x_post") {
    const { data } = await client
      .from("tracked_x_accounts")
      .select("handle,last_post_url,last_post_text")
      .eq("id", event.source_id)
      .maybeSingle();
    return {
      embeds: [
        {
          title: `New post from @${String(data?.handle ?? "tracked account").replace(/^@/, "")}`,
          url: data?.last_post_url ?? undefined,
          description: data?.last_post_text?.slice(0, 1500) || "A new X post was detected.",
          color: 0x1da1f2,
          timestamp: event.sent_at ?? new Date().toISOString(),
          footer: { text: "Ambunctious Tracker • Server + DM" },
        },
      ],
    };
  }
  if (event.source_type === "website_update") {
    const { data } = await client
      .from("tracked_websites")
      .select("label,last_item_url,last_item_title")
      .eq("id", event.source_id)
      .maybeSingle();
    return {
      embeds: [
        {
          title: data?.last_item_title
            ? `New BIG Games update: ${data.last_item_title}`
            : "New BIG Games developer blog",
          url: data?.last_item_url ?? undefined,
          description: `A new update was detected on ${data?.label ?? "BIG Games"}.`,
          color: 0xf4c542,
          timestamp: event.sent_at ?? new Date().toISOString(),
          footer: { text: "Ambunctious Tracker • Server + DM" },
        },
      ],
    };
  }
  if (event.source_type === "price_drop") {
    const { data } = await client
      .from("tracked_products")
      .select("label,url,last_price,currency,last_price_gbp")
      .eq("id", event.source_id)
      .maybeSingle();
    const gbp =
      data?.last_price_gbp == null
        ? ""
        : `\nApprox. **£${Number(data.last_price_gbp).toFixed(2)} GBP**`;
    return {
      embeds: [
        {
          title: `🔻 Price drop: ${data?.label ?? "Tracked product"}`,
          url: data?.url ?? undefined,
          description:
            data?.last_price == null
              ? "A tracked price dropped."
              : `Current price: **${data?.currency ?? ""} ${Number(data.last_price).toFixed(2)}**${gbp}`,
          color: 0x22c55e,
          timestamp: event.sent_at ?? new Date().toISOString(),
          footer: { text: "Ambunctious Tracker • Server + DM" },
        },
      ],
    };
  }
  if (event.source_type === "roblox_experience_product") {
    const { data } = await client
      .from("tracked_roblox_experiences")
      .select("label,place_id,items")
      .eq("id", event.source_id)
      .maybeSingle();
    const items = Array.isArray(data?.items) ? data.items : [];
    const item = items.find((candidate: any) => candidate?.key === event.fingerprint);
    const kind = String(item?.kind ?? event.fingerprint.split(":")[0] ?? "product").replaceAll(
      "_",
      " ",
    );
    return {
      embeds: [
        {
          title: `New ${kind}: ${item?.name ?? "Roblox monetization item"}`,
          url:
            item?.url ??
            (data?.place_id ? `https://www.roblox.com/games/${data.place_id}` : undefined),
          description: `Detected for tracked experience **${data?.label ?? "Roblox experience"}**.`,
          color: 0x00a2ff,
          timestamp: event.sent_at ?? new Date().toISOString(),
          footer: { text: "Ambunctious Tracker • Server + DM" },
        },
      ],
    };
  }
  if (event.source_type === "roblox_creation") {
    const { data } = await client
      .from("tracked_roblox_entities")
      .select("label,entity_type,entity_id")
      .eq("id", event.source_id)
      .maybeSingle();
    const parts = event.fingerprint.split(":");
    const kind = String(parts[0] ?? "creation").replaceAll("_", " ");
    const id = parts.at(-1);
    const url =
      parts[0] === "game_pass" && id ? `https://www.roblox.com/game-pass/${id}` : undefined;
    return {
      embeds: [
        {
          title: `New Roblox ${kind}`,
          url,
          description: `Detected for **${data?.label ?? "tracked Roblox creator"}** (${data?.entity_type ?? "creator"} ${data?.entity_id ?? ""}).`,
          color: 0x00a2ff,
          timestamp: event.sent_at ?? new Date().toISOString(),
          footer: { text: "Ambunctious Tracker • Server + DM" },
        },
      ],
    };
  }
  return fallbackPayload(event);
}

async function runMirror() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as any;
  const { data: events, error } = await client
    .from("tracker_notification_events")
    .select("source_type,source_id,fingerprint,sent_at,created_at")
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: true })
    .limit(100);
  if (error) throw new Error(`Could not read notification events: ${error.message}`);

  let sent = 0;
  const errors: string[] = [];
  for (const event of (events ?? []) as NotificationEvent[]) {
    if (event.source_type === "big_games_dm") continue;
    const { data: existing } = await client
      .from("tracker_dm_deliveries")
      .select("source_type")
      .eq("source_type", event.source_type)
      .eq("source_id", event.source_id)
      .eq("fingerprint", event.fingerprint)
      .maybeSingle();
    if (existing) continue;

    const { error: reserveError } = await client.from("tracker_dm_deliveries").insert({
      source_type: event.source_type,
      source_id: event.source_id,
      fingerprint: event.fingerprint,
    });
    if (reserveError?.code === "23505") continue;
    if (reserveError) {
      errors.push(`${event.source_type}: ${reserveError.message}`);
      continue;
    }

    try {
      await sendOwnerDm(await payloadFor(client, event));
      await client
        .from("tracker_dm_deliveries")
        .update({ sent_at: new Date().toISOString(), last_error: null })
        .eq("source_type", event.source_type)
        .eq("source_id", event.source_id)
        .eq("fingerprint", event.fingerprint);
      sent++;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      errors.push(`${event.source_type}: ${message}`);
      await client
        .from("tracker_dm_deliveries")
        .update({ last_error: message.slice(0, 500) })
        .eq("source_type", event.source_type)
        .eq("source_id", event.source_id)
        .eq("fingerprint", event.fingerprint);
    }
  }
  return { sent, errors };
}

export const Route = createFileRoute("/api/public/mirror-dms")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await runMirror());
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "DM mirror failed" },
            { status: 500 },
          );
        }
      },
      POST: async () => {
        try {
          return Response.json(await runMirror());
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "DM mirror failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
