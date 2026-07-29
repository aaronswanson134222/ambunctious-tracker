import { createFileRoute } from "@tanstack/react-router";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { checkXProfile, sendDiscord } from "@/lib/tracker.server";

const BIG_GAMES_HANDLE = "BuildIntoGames";

function postId(url: string | null) {
  return url?.match(/\/status\/(\d+)/)?.[1] ?? null;
}

async function booleanRpc(
  client: SupabaseClient<Database>,
  functionName: string,
  args: Record<string, unknown>,
) {
  const { data, error } = await (
    client.rpc as unknown as (
      name: string,
      parameters: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: { message: string } | null }>
  )(functionName, args);
  if (error) throw new Error(error.message);
  return data === true;
}

async function authorised(request: Request, client: SupabaseClient<Database>) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7).trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return false;
  return booleanRpc(client, "verify_tracker_cron_secret", { candidate: token });
}

export const Route = createFileRoute("/api/public/big-games-x")({
  server: {
    handlers: {
      GET: async () => Response.json({ error: "Method not allowed" }, { status: 405 }),
      POST: async ({ request }) => {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        if (!(await authorised(request, supabaseAdmin))) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { postUrl, postText } = await checkXProfile(BIG_GAMES_HANDLE);
        const latestId = postId(postUrl);
        if (!latestId || !postUrl) {
          return Response.json({ checked: true, found: false });
        }

        const db = supabaseAdmin as any;
        const { data: state, error: stateError } = await db
          .from("tracker_big_games_x_state")
          .select("last_post_id")
          .eq("singleton", true)
          .maybeSingle();
        if (stateError) throw new Error(stateError.message);

        const previousId =
          typeof state?.last_post_id === "string"
            ? state.last_post_id
            : state?.last_post_id != null
              ? String(state.last_post_id)
              : null;
        const isNew = previousId !== null && BigInt(latestId) > BigInt(previousId);

        if (isNew) {
          const replyIntent = `https://twitter.com/intent/tweet?in_reply_to=${latestId}&text=${encodeURIComponent("first")}`;
          await sendDiscord({
            embeds: [
              {
                author: { name: "BIG GAMES // NEW X POST" },
                title: "BIG Games just posted",
                url: postUrl,
                description:
                  (postText?.slice(0, 700) || "Open the newest BIG Games post.") +
                  `\n\n[Reply “first” on X](${replyIntent}) · [Open puzzle solver](https://ambunctious-tracker.lovable.app/puzzle)`,
                color: 0x1da1f2,
                footer: {
                  text: "Replying is always confirmed by you in X — never posted automatically",
                },
                timestamp: new Date().toISOString(),
              },
            ],
          });
        }

        const { error: saveError } = await db.from("tracker_big_games_x_state").upsert(
          {
            singleton: true,
            last_post_id: latestId,
            last_post_url: postUrl,
            last_post_text: postText,
            checked_at: new Date().toISOString(),
          },
          { onConflict: "singleton" },
        );
        if (saveError) throw new Error(saveError.message);

        return Response.json({ checked: true, found: true, alerted: isNew, post_id: latestId });
      },
    },
  },
});
