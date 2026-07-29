import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        return new Response(JSON.stringify({ ok: true, uptime: process.uptime() }), { status: 200 });
      },
    },
  },
});
