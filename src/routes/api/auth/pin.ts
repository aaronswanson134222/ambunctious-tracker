import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
      ...(status === 429 ? { "Retry-After": "900" } : {}),
    },
  });
}

export const Route = createFileRoute("/api/auth/pin")({
  server: {
    handlers: {
      GET: async () => json({ error: "Method not allowed" }, 405),
      POST: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const origin = request.headers.get("origin");
        if (origin && origin !== requestUrl.origin) {
          return json({ error: "Unauthorized" }, 401);
        }
        const declaredLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > 256) {
          return json({ error: "Invalid request" }, 400);
        }

        let pin = "";
        try {
          const body = await request.json() as { pin?: unknown };
          pin = typeof body.pin === "string" ? body.pin : "";
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        if (!/^\d{6}$/.test(pin)) {
          return json({ error: "Invalid PIN or temporarily locked" }, 401);
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const rpc = supabaseAdmin.rpc as unknown as (
          name: string,
          args: Record<string, string>,
        ) => Promise<{
          data: Array<{ owner_email?: string; internal_password?: string }> | null;
          error: { message: string } | null;
        }>;
        const { data, error } = await rpc("authenticate_tracker_pin", { candidate: pin });
        pin = "";
        const credentials = data?.[0];
        if (error || !credentials?.owner_email || !credentials.internal_password) {
          return json({ error: "Invalid PIN or temporarily locked" }, 401);
        }

        const { data: signIn, error: signInError } =
          await supabaseAdmin.auth.signInWithPassword({
            email: credentials.owner_email,
            password: credentials.internal_password,
          });
        if (signInError || !signIn.session) {
          console.error("PIN authentication session exchange failed", signInError?.message);
          return json({ error: "Sign-in is temporarily unavailable" }, 503);
        }

        return json({
          access_token: signIn.session.access_token,
          refresh_token: signIn.session.refresh_token,
        });
      },
    },
  },
});
