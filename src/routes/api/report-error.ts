import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";

export const Route = createFileRoute("/api/report-error")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const contentType = request.headers.get("content-type") ?? "";
          if (!contentType.toLowerCase().startsWith("application/json")) {
            return Response.json({ ok: false, error: "Invalid content type" }, { status: 400 });
          }
          const body = await request.json().catch(() => null);
          const dataDir = path.resolve(process.cwd(), "data");
          try {
            if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
          } catch (e) {}
          const logPath = path.join(dataDir, "errors.log");
          const entry = { ts: new Date().toISOString(), body };
          try {
            fs.appendFileSync(logPath, JSON.stringify(entry) + "\n", "utf8");
          } catch (e) {
            // best-effort; ignore
          }
          return Response.json({ ok: true }, { status: 200 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
      GET: async () => Response.json({ ok: true, message: "Report endpoint" }, { status: 200 }),
    },
  },
});
