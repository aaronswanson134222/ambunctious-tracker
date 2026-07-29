import { createFileRoute, Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";

function SupabaseRemoved() {
  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <p className="eyebrow">DATABASE</p>
          <h1 className="mt-3 text-3xl font-semibold">Supabase integration removed</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This application no longer uses Supabase. A bundled SQLite-backed compatibility shim
            provides the required database and RPCs. If you previously configured a public Supabase
            project in-browser, those settings are no longer used.
          </p>
        </div>

        <Card className="tracker-card space-y-5 p-5 sm:p-6">
          <h2 className="text-xl font-semibold">What changed</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            <li>Removed public Supabase settings from the UI.</li>
            <li>Server-side compatibility shim now handles data and RPCs via SQLite.</li>
            <li>Owner access is managed via OWNER_BEARER_TOKEN environment variable.</li>
          </ul>
        </Card>

        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <Link to="/menu" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground">
            ← Back to menu
          </Link>
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/supabase-settings")({ component: SupabaseRemoved });
export default SupabaseRemoved;
