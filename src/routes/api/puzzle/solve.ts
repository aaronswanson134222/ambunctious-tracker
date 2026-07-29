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

async function ownerClient(request: Request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.length > 4096) return null;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user?.email) return null;
  const { data: isOwner, error: ownerError } = await (supabaseAdmin as any).rpc(
    "verify_tracker_owner_email",
    { candidate: data.user.email },
  );
  return !ownerError && isOwner === true ? supabaseAdmin : null;
}

export const Route = createFileRoute("/api/puzzle/solve")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const client = await ownerClient(request);
        if (!client) return json({ error: "Unauthorized" }, 401);
        const { data: secretData, error: secretError } = await (client as any).rpc(
          "get_private_alert_secrets",
        );
        if (secretError) return json({ error: "Could not read puzzle solver settings" }, 503);
        const apiKey =
          typeof secretData?.openai_puzzle_key === "string"
            ? secretData.openai_puzzle_key.trim()
            : "";
        if (!apiKey) return json({ error: "OpenAI puzzle solver key is not configured" }, 503);

        const declaredLength = Number(request.headers.get("content-length"));
        if (Number.isFinite(declaredLength) && declaredLength > 8_500_000) {
          return json({ error: "Image is too large" }, 413);
        }

        let body: { image?: unknown; notes?: unknown; tweet?: unknown };
        try {
          body = await request.json();
        } catch {
          return json({ error: "Invalid request" }, 400);
        }
        const image = typeof body.image === "string" ? body.image : "";
        const notes = typeof body.notes === "string" ? body.notes.slice(0, 2000) : "";
        const tweet = typeof body.tweet === "string" ? body.tweet.slice(0, 500) : "";
        if (!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/.test(image)) {
          return json({ error: "Upload a PNG, JPG or WebP screenshot" }, 400);
        }

        const prompt = [
          "Solve this puzzle as quickly and accurately as possible.",
          "It may be a Roblox/BIG Games teaser involving ciphers, hidden text, visual patterns, coordinates, anagrams, sequences or codes.",
          "Read every visible detail. Give the most likely final answer first, then concise reasoning, alternative answers if uncertain, and the exact action the user should take.",
          tweet ? `Tweet URL/context: ${tweet}` : "",
          notes ? `User notes: ${notes}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            Authorization: Bearer $trailing
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4.1-mini",
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: prompt },
                  { type: "input_image", image_url: image },
                ],
              },
            ],
            max_output_tokens: 1200,
          }),
        });
        const result = (await response.json().catch(() => null)) as any;
        if (!response.ok) {
          return json(
            { error: result?.error?.message || `Puzzle solver HTTP ${response.status}` },
            502,
          );
        }
        const answer =
          typeof result?.output_text === "string"
            ? result.output_text
            : Array.isArray(result?.output)
              ? result.output
                  .flatMap((item: any) => item?.content ?? [])
                  .map((part: any) => part?.text)
                  .filter(Boolean)
                  .join("\n")
              : "";
        if (!answer) return json({ error: "The solver returned no answer" }, 502);
        return json({ answer });
      },
    },
  },
});

