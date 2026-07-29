import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff", ...(status === 429 ? { "Retry-After": "900" } : {}) } });
}

const attempts = new Map<string, { count: number; reset: number }>();
export const Route = createFileRoute("/api/auth/pin")({ server: { handlers: {
  GET: async () => json({ error: "Method not allowed" }, 405),
  POST: async ({ request }) => {
    const requestUrl = new URL(request.url);
    const origin = request.headers.get("origin");
    if (origin && origin !== requestUrl.origin) return json({ error: "Unauthorized" }, 401);
    const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "local";
    const now = Date.now();
    const rate = attempts.get(ip) ?? { count: 0, reset: now + 15 * 60_000 };
    if (rate.reset < now) { rate.count = 0; rate.reset = now + 15 * 60_000; }
    if (rate.count >= 5) return json({ error: "Too many attempts. Try again later." }, 429);
    let pin = "";
    try { const body = await request.json() as { pin?: unknown }; pin = typeof body.pin === "string" ? body.pin.trim() : ""; } catch { return json({ error: "Invalid request" }, 400); }
    if (!/^\d{6}$/.test(pin)) return json({ error: "Enter the six-digit owner PIN." }, 401);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("authenticate_tracker_pin", { candidate: pin });
    const token = data?.[0]?.internal_password;
    if (!token) { rate.count++; attempts.set(ip, rate); return json({ error: "Invalid PIN or temporarily locked" }, 401); }
    attempts.delete(ip);
    return json({ access_token: token, refresh_token: token });
  },
} } });
