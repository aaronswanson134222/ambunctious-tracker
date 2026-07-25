import { createFileRoute } from "@tanstack/react-router";
import { createRobloxProductEmbed, enrichRobloxProduct } from "@/lib/roblox-product-preview.server";
import { sendDiscord } from "@/lib/tracker.server";

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

export const Route = createFileRoute("/api/roblox/test-embed")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);

        let body: {
          kind?: unknown;
          productId?: unknown;
          universeId?: unknown;
          placeId?: unknown;
          experienceLabel?: unknown;
          fallbackName?: unknown;
        };
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid request body" }, 400);
        }

        const kind = body.kind === "game_pass" || body.kind === "developer_product"
          ? body.kind
          : null;
        const productId = Number(body.productId);
        const universeId = Number(body.universeId);
        const placeId = Number(body.placeId);
        const experienceLabel = typeof body.experienceLabel === "string"
          ? body.experienceLabel.trim().slice(0, 120)
          : "Roblox experience";
        const fallbackName = typeof body.fallbackName === "string"
          ? body.fallbackName.trim().slice(0, 120)
          : undefined;

        if (!kind || !Number.isSafeInteger(productId) || productId <= 0) {
          return json({ error: "Choose a valid product type and product ID" }, 400);
        }

        try {
          const preview = await enrichRobloxProduct({
            kind,
            productId,
            universeId: Number.isSafeInteger(universeId) && universeId > 0 ? universeId : null,
            placeId: Number.isSafeInteger(placeId) && placeId > 0 ? placeId : null,
            experienceLabel,
            fallbackName,
          });

          const embed = createRobloxProductEmbed(preview, {
            authorName: `TEST EMBED // ${experienceLabel}`,
            descriptionPrefix: "⚠️ **TEST MESSAGE — this is not a real tracker detection.**\n\n",
          });
          embed.footer = { text: "Ambunctious Tracker • Discord embed test" };

          const messageId = await sendDiscord({ embeds: [embed] });
          return json({
            sent: true,
            message_id: messageId,
            preview,
          });
        } catch (error) {
          return json({
            error: error instanceof Error ? error.message : String(error),
          }, 502);
        }
      },
    },
  },
});
