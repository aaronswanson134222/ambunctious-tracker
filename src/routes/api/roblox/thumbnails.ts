import { createFileRoute } from "@tanstack/react-router";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export const Route = createFileRoute("/api/roblox/thumbnails")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const kind = url.searchParams.get("kind");
        if (kind !== "game_pass" && kind !== "developer_product") {
          return json({ error: "Invalid thumbnail type" }, 400);
        }

        const ids = (url.searchParams.get("ids") ?? "")
          .split(",")
          .map((value) => Number(value))
          .filter((value) => Number.isSafeInteger(value) && value > 0)
          .slice(0, 100);
        if (!ids.length) return json({ data: [] });

        const upstream = new URL(
          kind === "game_pass"
            ? "https://thumbnails.roblox.com/v1/game-passes"
            : "https://thumbnails.roblox.com/v1/developer-products/icons",
        );
        upstream.searchParams.set(
          kind === "game_pass" ? "gamePassIds" : "developerProductIds",
          ids.join(","),
        );
        upstream.searchParams.set("size", "150x150");
        upstream.searchParams.set("format", "Png");
        upstream.searchParams.set("isCircular", "false");

        try {
          const response = await fetch(upstream, {
            headers: {
              Accept: "application/json",
              "User-Agent": "Ambunctious-Tracker/1.0",
            },
          });
          if (!response.ok) return json({ data: [] });
          const body = (await response.json()) as { data?: unknown[] };
          return json({ data: Array.isArray(body.data) ? body.data : [] });
        } catch {
          return json({ data: [] });
        }
      },
    },
  },
});
