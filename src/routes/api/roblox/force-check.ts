import { createFileRoute } from "@tanstack/react-router";
import { checkRobloxCreations, sendDiscord } from "@/lib/tracker.server";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function ownerClient(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 4096) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const { data: isOwner, error: ownerError } = await (supabaseAdmin as any).rpc(
    "verify_tracker_owner_email",
    { candidate: data.user.email },
  );
  return !ownerError && isOwner === true ? supabaseAdmin : null;
}

export const Route = createFileRoute("/api/roblox/force-check")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);

        let trackerId = "";
        let kind: "game_pass" | "developer_product" | null = null;
        try {
          const body = (await request.json()) as {
            trackerId?: unknown;
            kind?: unknown;
          };
          trackerId = typeof body.trackerId === "string" ? body.trackerId : "";
          kind = body.kind === "game_pass" || body.kind === "developer_product" ? body.kind : null;
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        if (!/^[0-9a-f-]{36}$/i.test(trackerId) || !kind) {
          return json({ error: "Choose a valid group and product type" }, 400);
        }

        const db = client as any;
        const { data: tracker, error: trackerError } = await db
          .from("tracked_roblox_entities")
          .select("id,entity_type,entity_id,label,lookback_days")
          .eq("id", trackerId)
          .maybeSingle();
        if (trackerError || !tracker) return json({ error: "Roblox tracker not found" }, 404);
        if (tracker.entity_type !== "group") {
          return json({ error: "Manual product checks are available for groups only" }, 400);
        }

        const { data: apiKey, error: keyError } = await db.rpc("get_roblox_open_cloud_key");
        if (keyError || typeof apiKey !== "string" || !apiKey.trim()) {
          return json({ error: "Connect your Roblox Open Cloud key first" }, 400);
        }

        try {
          const items = await checkRobloxCreations(
            "group",
            Number(tracker.entity_id),
            [kind],
            Number(tracker.lookback_days) || 30,
            apiKey,
          );
          const latest = [...items].sort((a, b) => {
            const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
            const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
            return bTime - aTime || b.id - a.id;
          })[0];

          if (!latest) {
            await db
              .from("tracked_roblox_entities")
              .update({
                last_checked_at: new Date().toISOString(),
                last_error: null,
              })
              .eq("id", tracker.id);
            return json({
              found: false,
              message: `No ${kind === "game_pass" ? "game passes" : "developer products"} were found in the selected timeframe.`,
            });
          }

          await sendDiscord({
            embeds: [
              {
                author: {
                  name: `MANUAL ROBLOX CHECK // ${tracker.label}`,
                  icon_url: "https://www.roblox.com/favicon.ico",
                },
                title: `Latest ${kind === "game_pass" ? "game pass" : "developer product"}: ${latest.name}`,
                url: latest.url,
                description: "This item was returned by an owner-requested targeted scan.",
                thumbnail: { url: "https://www.roblox.com/favicon.ico" },
                color: 0x00a2ff,
                fields: latest.createdAt
                  ? [
                      {
                        name: "Created",
                        value:
                          new Date(latest.createdAt).toLocaleString("en-GB", { timeZone: "UTC" }) +
                          " UTC",
                      },
                    ]
                  : [],
                timestamp: new Date().toISOString(),
              },
            ],
          });

          await db
            .from("tracked_roblox_entities")
            .update({
              last_checked_at: new Date().toISOString(),
              last_error: null,
            })
            .eq("id", tracker.id);

          return json({
            found: true,
            item: {
              id: latest.id,
              name: latest.name,
              url: latest.url,
              kind: latest.kind,
              createdAt: latest.createdAt,
            },
            discord_sent: true,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await db
            .from("tracked_roblox_entities")
            .update({
              last_checked_at: new Date().toISOString(),
              last_error: message.slice(0, 500),
            })
            .eq("id", tracker.id);
          return json({ error: message }, 502);
        }
      },
    },
  },
});
