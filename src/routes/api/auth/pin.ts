/* eslint-disable @typescript-eslint/no-explicit-any */

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
          const { data, error } = await (supabaseAdmin as any).rpc("authenticate_tracker_pin", {
            candidate: pin,
          });
          pin = "";

          if (error) {
            console.error("PIN verification RPC failed", error);
            return json(
              {
                error: "Sign-in is temporarily unavailable",
                code: "AUTH_VERIFY",
                diagnostic: {
                  message:
                    typeof error.message === "string"
                      ? error.message
                      : "Unknown Supabase RPC error",
                  postgresCode: typeof error.code === "string" ? error.code : null,
                  details: typeof error.details === "string" ? error.details : null,
                  hint: typeof error.hint === "string" ? error.hint : null,
                },
              },
              503,
            );
          }

          const credentials = (
            data as Array<{
              owner_email?: string;
              internal_password?: string;
            }> | null
          )?.[0];

          if (!credentials?.owner_email || !credentials.internal_password) {
            return json(
              {
                error: "Incorrect PIN or sign-in is temporarily locked.",
                code: "AUTH_INVALID_PIN",
              },
              401,
            );
          }

          // Legacy Supabase sign-in removed. Issue a server-owned bearer token for owner flows.
          const ownerToken = process.env.OWNER_BEARER_TOKEN;
          if (!ownerToken) {
            console.error("OWNER_BEARER_TOKEN not set on server");
            return json({ error: "Sign-in is temporarily unavailable", code: "AUTH_CONFIG" }, 503);
          }

          // Return the owner bearer token as the access_token so the client can call owner-only routes.
          return json({ access_token: ownerToken, refresh_token: "" });
        } catch (error) {
          console.error(`PIN authentication failed during ${stage}`, error);
          return json(
            {
              error: "Sign-in is temporarily unavailable",
              code: `AUTH_${stage.toUpperCase()}`,
              diagnostic: error instanceof Error ? error.message : "Unknown server error",
            },
            503,
          );
        }
      },
    },
  },
});
