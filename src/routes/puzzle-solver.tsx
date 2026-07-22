import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, ExternalLink, ImagePlus, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/puzzle-solver")({
  component: PuzzleSolver,
});

function PuzzleSolver() {
  const tweet = useMemo(() => {
    if (typeof window === "undefined") return "";
    const value = new URLSearchParams(window.location.search).get("tweet") ?? "";
    try {
      const url = new URL(value);
      return ["x.com", "twitter.com"].includes(url.hostname) ? url.toString() : "";
    } catch {
      return "";
    }
  }, []);
  const [image, setImage] = useState("");
  const [fileName, setFileName] = useState("");
  const [notes, setNotes] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [solving, setSolving] = useState(false);

  async function chooseFile(file: File | undefined) {
    setError("");
    setAnswer("");
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      setError("Upload a PNG, JPG or WebP screenshot.");
      return;
    }
    if (file.size > 8_000_000) {
      setError("Keep the screenshot below 8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setImage(typeof reader.result === "string" ? reader.result : "");
      setFileName(file.name);
    };
    reader.onerror = () => setError("Could not read that image.");
    reader.readAsDataURL(file);
  }

  async function solve() {
    if (!image) {
      setError("Upload the puzzle screenshot first.");
      return;
    }
    setSolving(true);
    setError("");
    setAnswer("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign into the tracker first.");
      const response = await fetch("/api/puzzle/solve", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ image, notes, tweet }),
      });
      const body = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !body.answer) throw new Error(body.error || "Could not solve the puzzle.");
      setAnswer(body.answer);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not solve the puzzle.");
    } finally {
      setSolving(false);
    }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} /> Back to tracker
          </Link>
          {tweet && (
            <a href={tweet} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">
              Open BIG Games post <ExternalLink size={14} />
            </a>
          )}
        </div>

        <Card className="tracker-card space-y-5 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="tracker-avatar"><Brain /></div>
            <div>
              <p className="eyebrow"><span /> RAPID RESPONSE</p>
              <h1 className="text-2xl font-semibold sm:text-3xl">BIG Games puzzle solver</h1>
              <p className="mt-2 text-sm text-muted-foreground">Upload the clearest screenshot available. The solver checks visible text, ciphers, anagrams, sequences, symbols and visual clues.</p>
            </div>
          </div>

          <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-card/40 p-4 text-center hover:border-primary/50">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="sr-only"
              onChange={(event) => void chooseFile(event.target.files?.[0])}
            />
            <ImagePlus className="mx-auto mb-2" />
            <span className="block font-medium">Upload puzzle screenshot</span>
            <span className="mt-1 block text-xs text-muted-foreground">PNG, JPG or WebP · maximum 8 MB</span>
          </label>

          {image && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">{fileName}</p>
              <img src={image} alt="Uploaded puzzle" className="max-h-[480px] w-full rounded-xl border border-white/10 object-contain" />
            </div>
          )}

          <div>
            <label htmlFor="puzzle-notes" className="mb-2 block text-sm font-medium">Extra context</label>
            <Input
              id="puzzle-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="For example: the answer might be a Roblox pet name or code"
              className="h-11 rounded-xl"
            />
          </div>

          <Button onClick={solve} disabled={solving || !image} className="metal-button h-12 w-full rounded-xl">
            {solving ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
            {solving ? "Solving puzzle…" : "Solve now"}
          </Button>

          {error && <p className="error-copy">{error}</p>}
          {answer && (
            <section className="content-panel space-y-2" aria-live="polite">
              <p className="panel-label">MOST LIKELY SOLUTION</p>
              <div className="whitespace-pre-wrap text-sm leading-6">{answer}</div>
            </section>
          )}
        </Card>
      </div>
    </main>
  );
}
