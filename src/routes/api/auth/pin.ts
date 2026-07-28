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
        let stage = "request";
        try {
          // Lovable terminates requests behind a reverse proxy, so request.url can
          // contain an internal origin while the browser sends the public origin.
          // Sec-Fetch-Site is proxy-safe and still blocks cross-site form requests.
          const fetchSite = request.headers.get("sec-fetch-site");
          if (fetchSite === "cross-site") {
            return json({ error: "Unauthorized", code: "AUTH_ORIGIN" }, 401);
          }

          const contentType = request.headers.get("content-type") ?? "";
          if (!contentType.toLowerCase().startsWith("application/json")) {
            return json({ error: "Invalid request", code: "AUTH_CONTENT_TYPE" }, 400);
          }

          const declaredLength = Number(request.headers.get("content-length"));
          if (Number.isFinite(declaredLength) && declaredLength > 256) {
            return json({ error: "Invalid request", code: "AUTH_SIZE" }, 400);
          }

          let pin = "";
          try {
            const body = (await request.json()) as { pin?: unknown };
            pin = typeof body.pin === "string" ? body.pin.trim() : "";
          } catch {
            return json({ error: "Invalid request", code: "AUTH_BODY" }, 400);
          }

          if (!/^\d{6}$/.test(pin)) {
            return json({ error: "Enter the six-digit owner PIN.", code: "AUTH_PIN_FORMAT" }, 401);
          }

          stage = "admin";
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          stage = "verify";
          const { data, error } = await (supabaseAdmin as any).rpc(
            "authenticate_tracker_pin",
            { candidate: pin },
          );
          pin = "";

          if (error) {
            console.error("PIN verification RPC failed", error.message);
            return json(
              { error: "Sign-in is temporarily unavailable", code: "AUTH_VERIFY" },
              503,
            );
          }

          const credentials = (data as Array<{
            owner_email?: string;
            internal_password?: string;
          }> | null)?.[0];

          if (!credentials?.owner_email || !credentials.internal_password) {
            return json(
              { error: "Incorrect PIN or sign-in is temporarily locked.", code: "AUTH_INVALID_PIN" },
              401,
            );
          }

          stage = "config";
          const supabaseUrl = process.env.SUPABASE_URL;
          const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
          if (!supabaseUrl || !publishableKey) {
            console.error("PIN authentication is missing Supabase server configuration");
            return json(
              { error: "Sign-in is temporarily unavailable", code: "AUTH_CONFIG" },
              503,
            );
          }

          stage = "exchange";
          const { createClient } = await import("@supabase/supabase-js");
          const authClient = createClient(supabaseUrl, publishableKey, {
            auth: {
              storage: undefined,
              persistSession: false,
              autoRefreshToken: false,
            },
          });

          const { data: signIn, error: signInError } =
            await authClient.auth.signInWithPassword({
              email: credentials.owner_email,
              password: credentials.internal_password,
            });

          if (signInError || !signIn.session) {
            console.error("PIN authentication session exchange failed", signInError?.message);
            return json(
              { error: "Sign-in is temporarily unavailable", code: "AUTH_EXCHANGE" },
              503,
            );
          }

          return json({
            access_token: signIn.session.access_token,
            refresh_token: signIn.session.refresh_token,
          });
        } catch (error) {
          console.error(`PIN authentication failed during ${stage}`, error);
          return json(
            {
              error: "Sign-in is temporarily unavailable",
              code: `AUTH_${stage.toUpperCase()}`,
            },
            503,
          );
        }
      },
    },
  },
});
