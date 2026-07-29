import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";

export const Route = createFileRoute("/api/debug-db")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const dataDir = path.resolve(process.cwd(), "data");
          const dbJson = path.join(dataDir, "app.json");
          const exists = fs.existsSync(dbJson);
          const stats = exists ? fs.statSync(dbJson) : null;
          let sample = null;
          if (exists) {
            const content = fs.readFileSync(dbJson, "utf8");
            sample = content.slice(0, 4000); // limit size
            try {
              sample = JSON.parse(sample + (content.length > 4000 ? '...' : ''));
            } catch (e) {
              // keep raw truncated string if not valid JSON
            }
          }

          const payload = {
            data_dir: {
              path: dataDir,
              app_json_exists: exists,
              app_json_bytes: stats ? stats.size : 0,
            },
            sample,
          };
          return Response.json({ ok: true, payload }, { status: 200 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
