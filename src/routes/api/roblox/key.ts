import { createFileRoute } from "@tanstack/react-router";

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

export const Route = createFileRoute("/api/roblox/key")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);
        const { data, error } = await (client as any)
          .rpc("has_roblox_open_cloud_key");
        if (error) return json({ error: "Could not read Roblox connection status" }, 503);
        return json({ configured: data === true });
      },
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);
        const declaredLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > 12_288) {
          return json({ error: "Invalid request" }, 400);
        }
        let key = "";
        try {
          const body = await request.json() as { key?: unknown };
          key = typeof body.key === "string" ? body.key.trim() : "";
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        const { data, error } = await (client as any)
          .rpc("set_roblox_open_cloud_key", { candidate: key });
        key = "";
        if (error || data !== true) {
          return json({ error: "Enter a valid Roblox Open Cloud API key" }, 400);
        }
        return json({ configured: true });
      },
    },
  },
});
