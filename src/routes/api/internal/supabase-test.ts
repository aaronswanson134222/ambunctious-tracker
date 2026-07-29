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

export const Route = createFileRoute("/api/internal/supabase-test")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const declaredLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > 12_288) {
          return json({ error: "Invalid request" }, 400);
        }

        let bodyUrl = "";
        try {
          const body = (await request.json()) as { url?: unknown };
          bodyUrl = typeof body.url === "string" ? body.url.trim().replace(/\/$/, "") : "";
        } catch {
          return json({ error: "Invalid request" }, 400);
        }

        try {
          const parsed = new URL(bodyUrl);
          if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".supabase.co")) {
            return json({ error: "Enter a valid Supabase project URL" }, 400);
          }
        } catch {
          return json({ error: "Enter a valid Supabase project URL" }, 400);
        }

        const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!svc) return json({ error: "Server missing SUPABASE_SERVICE_ROLE_KEY" }, 500);

        const target = `${bodyUrl}/rest/v1/`;
        try {
          const res = await fetch(target, {
            method: "GET",
            headers: { apikey: svc, Authorization: `Bearer ${svc}` },
          });
          const text = await res.text().catch(() => "");
          if (!res.ok && res.status !== 404) return json({ error: text || `Supabase returned ${res.status}` }, 502);
          return json({ ok: true, status: res.status, body: text });
        } catch (err) {
          return json({ error: `Request failed: ${String(err)}` }, 502);
        }
      },
    },
  },
});
