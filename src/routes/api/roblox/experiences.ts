import { createFileRoute } from "@tanstack/react-router";
import {
  checkRobloxExperienceProducts,
  resolveRobloxUniverseId,
} from "@/lib/tracker.server";

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
  const { data: isOwner, error: ownerError } = await (supabaseAdmin as any)
    .rpc("verify_tracker_owner_email", { candidate: data.user.email });
  return !ownerError && isOwner === true ? supabaseAdmin : null;
}

export const Route = createFileRoute("/api/roblox/experiences")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);

        let placeId = 0;
        let label = "";
        let lookbackDays = 30;
        try {
          const body = await request.json() as {
            placeId?: unknown;
            label?: unknown;
            lookbackDays?: unknown;
          };
          placeId = Number(body.placeId);
          label = typeof body.label === "string" ? body.label.trim() : "";
          lookbackDays = Number(body.lookbackDays);
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        if (!Number.isSafeInteger(placeId) || placeId <= 0) {
          return json({ error: "Enter a valid Roblox game/place ID" }, 400);
        }
        if (!label || label.length > 120) {
          return json({ error: "Enter a short experience label" }, 400);
        }
        if (![7, 30, 90, 365].includes(lookbackDays)) lookbackDays = 30;

        const db = client as any;
        const { data: apiKey, error: keyError } = await db.rpc(
          "get_roblox_open_cloud_key",
        );
        if (keyError || typeof apiKey !== "string" || !apiKey.trim()) {
          return json({ error: "Connect your Roblox Open Cloud key first" }, 400);
        }

        try {
          const universeId = await resolveRobloxUniverseId(placeId);
          const products = await checkRobloxExperienceProducts(
            universeId,
            placeId,
            lookbackDays,
            apiKey,
          );
          const { data: tracker, error } = await db
            .from("tracked_roblox_experiences")
            .insert({
              place_id: placeId,
              universe_id: universeId,
              label,
              lookback_days: lookbackDays,
              known_item_keys: products.map((item) => item.key),
              items: products,
              last_checked_at: new Date().toISOString(),
              last_error: null,
            })
            .select("*")
            .single();
          if (error) {
            const duplicate = error.code === "23505"
              ? "That experience is already being tracked"
              : error.message;
            return json({ error: duplicate }, 400);
          }
          return json({ tracker, baseline_count: products.length });
        } catch (error) {
          return json({
            error: error instanceof Error ? error.message : "Roblox experience check failed",
          }, 502);
        }
      },
    },
  },
});
