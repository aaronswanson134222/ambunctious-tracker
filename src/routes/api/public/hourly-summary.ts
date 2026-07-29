import { createFileRoute } from "@tanstack/react-router";
import { sendDiscord } from "@/lib/tracker.server";

const EVENT_LABELS: Record<string, string> = {
  x_post: "New X posts",
  price_drop: "Price drops",
  website_update: "Website updates",
  roblox_item: "Roblox uploads",
};

async function sendHourlySummary() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const now = new Date();
  const hourStart = new Date(now);
  hourStart.setUTCMinutes(0, 0, 0);
  const previousHour = new Date(hourStart.getTime() - 60 * 60 * 1000);
  const hourKey = previousHour.toISOString();

  const { error: reserveError } = await (supabaseAdmin as any)
    .from("tracker_hourly_reports")
    .insert({ hour_start: hourKey });

  if (reserveError?.code === "23505") {
    return { sent: false, reason: "already-sent", hour_start: hourKey };
  }
  if (reserveError) throw new Error(`Could not reserve hourly report: ${reserveError.message}`);

  try {
    const [{ data: events, error: eventsError }, xCount, productCount, websiteCount, robloxCount] =
      await Promise.all([
        (supabaseAdmin as any)
          .from("tracker_notification_events")
          .select("source_type")
          .gte("sent_at", previousHour.toISOString())
          .lt("sent_at", hourStart.toISOString()),
        supabaseAdmin.from("tracked_x_accounts").select("id", { count: "exact", head: true }),
        supabaseAdmin.from("tracked_products").select("id", { count: "exact", head: true }),
        (supabaseAdmin as any)
          .from("tracked_websites")
          .select("id", { count: "exact", head: true }),
        (supabaseAdmin as any)
          .from("tracked_roblox_entities")
          .select("id", { count: "exact", head: true }),
      ]);

    if (eventsError) throw new Error(`Could not read tracker activity: ${eventsError.message}`);

    const totals = new Map<string, number>();
    for (const event of events ?? []) {
      const type = String(event.source_type ?? "other");
      totals.set(type, (totals.get(type) ?? 0) + 1);
    }

    const activityTotal = [...totals.values()].reduce((sum, value) => sum + value, 0);
    const activeTrackers =
      (xCount.count ?? 0) +
      (productCount.count ?? 0) +
      (websiteCount.count ?? 0) +
      (robloxCount.count ?? 0);

    if (activityTotal === 0) {
      await sendDiscord({
        content: "Tracker is active.",
      });
    } else {
      const fields = [...totals.entries()].map(([type, count]) => ({
        name: EVENT_LABELS[type] ?? type.replaceAll("_", " "),
        value: String(count),
        inline: true,
      }));
      fields.push({ name: "Active trackers", value: String(activeTrackers), inline: true });

      await sendDiscord({
        embeds: [
          {
            author: { name: "AMBUNCTIOUS TRACKER // HOURLY STATUS" },
            title: "Tracking activity summary",
            description: `Activity detected between <t:${Math.floor(previousHour.getTime() / 1000)}:t> and <t:${Math.floor(hourStart.getTime() / 1000)}:t>.`,
            color: 0x38bdf8,
            fields,
            footer: { text: "AB monitoring network" },
            timestamp: now.toISOString(),
          },
        ],
      });
    }

    await (supabaseAdmin as any)
      .from("tracker_hourly_reports")
      .update({ sent_at: now.toISOString(), activity_count: activityTotal })
      .eq("hour_start", hourKey);

    return { sent: true, activity_count: activityTotal, hour_start: hourKey };
  } catch (error) {
    await (supabaseAdmin as any).from("tracker_hourly_reports").delete().eq("hour_start", hourKey);
    throw error;
  }
}

export const Route = createFileRoute("/api/public/hourly-summary")({
  server: {
    handlers: {
      GET: async () => {
        try {
          return Response.json(await sendHourlySummary());
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Hourly summary failed" },
            { status: 500 },
          );
        }
      },
      POST: async () => {
        try {
          return Response.json(await sendHourlySummary());
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Hourly summary failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});
