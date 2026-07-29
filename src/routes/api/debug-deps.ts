import { createFileRoute } from "@tanstack/react-router";
import fs from "fs";
import path from "path";

export const Route = createFileRoute("/api/debug-deps")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const pkgPath = path.join(process.cwd(), "package.json");
          const pkgExists = fs.existsSync(pkgPath);
          let deps = null;
          if (pkgExists) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
            deps = {
              dependencies: pkg.dependencies || {},
              devDependencies: pkg.devDependencies || {},
            };
          }
          return Response.json({ ok: true, payload: { pkgExists, deps } }, { status: 200 });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
