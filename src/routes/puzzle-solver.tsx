import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, ExternalLink, ImagePlus, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/puzzle-solver")({ component: PuzzleSolver });

type Candidate = { label: string; value: string };

function caesar(text: string, shift: number) {
  return text.replace(/[A-Za-z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base - shift + 26) % 26) + base);
  });
}

function atbash(text: string) {
  return text.replace(/[A-Za-z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(base + 25 - (char.charCodeAt(0) - base));
  });
}

function scoreEnglish(text: string) {
  const value = ` ${text.toLowerCase()} `;
  const common = [" the ", " and ", " pet ", " code ", " game ", " big ", " is ", " of ", " to ", " a ", " secret ", " reward "];
  return common.reduce((score, word) => score + (value.includes(word) ? word.length : 0), 0);
}

function printable(value: string) {
  return value.length >= 2 && [...value].filter((char) => /[\x20-\x7E\n]/.test(char)).length / value.length > 0.85;
}

function analyseText(raw: string, notes: string): Candidate[] {
  const text = `${raw}\n${notes}`.trim();
  if (!text) return [];
  const candidates: Candidate[] = [];
  const add = (label: string, value: string) => {
    const clean = value.trim();
    if (clean && clean !== text.trim() && !candidates.some((item) => item.value === clean)) candidates.push({ label, value: clean });
  };

  add("Reversed text", [...text].reverse().join(""));
  add("Atbash", atbash(text));

  const shifts = Array.from({ length: 25 }, (_, index) => {
    const value = caesar(text, index + 1);
    return { shift: index + 1, value, score: scoreEnglish(value) };
  }).sort((a, b) => b.score - a.score).slice(0, 5);
  shifts.forEach((item) => add(`Caesar shift ${item.shift}`, item.value));

  const numberTokens = text.match(/\b(?:[1-9]|1\d|2[0-6])\b/g);
  if (numberTokens && numberTokens.length >= 3) {
    add("A1Z26 letters", numberTokens.map((value) => String.fromCharCode(64 + Number(value))).join(""));
  }

  const binary = text.match(/\b[01]{8}(?:\s+[01]{8}){1,}\b/)?.[0];
  if (binary) add("Binary to text", binary.split(/\s+/).map((value) => String.fromCharCode(parseInt(value, 2))).join(""));

  const hex = text.match(/\b(?:[0-9a-fA-F]{2}[\s:-]?){3,}\b/)?.[0];
  if (hex) {
    const bytes = hex.match(/[0-9a-fA-F]{2}/g) ?? [];
    const decoded = bytes.map((value) => String.fromCharCode(parseInt(value, 16))).join("");
    if (printable(decoded)) add("Hex to text", decoded);
  }

  const base64 = text.match(/\b[A-Za-z0-9+/]{8,}={0,2}\b/g) ?? [];
  for (const token of base64.slice(0, 5)) {
    try {
      const decoded = atob(token);
      if (printable(decoded)) add("Base64 to text", decoded);
    } catch { /* not base64 */ }
  }

  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 3) {
    add("Line acrostic", lines.map((line) => line[0]).join(""));
    add("Last letters of lines", lines.map((line) => line.at(-1) ?? "").join(""));
  }

  const words = text.match(/[A-Za-z]+/g) ?? [];
  if (words.length >= 4) {
    add("Word initials", words.map((word) => word[0]).join(""));
    add("Word endings", words.map((word) => word.at(-1) ?? "").join(""));
  }

  const nums = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
  if (nums.length >= 4 && nums.length <= 30) {
    const diffs = nums.slice(1).map((value, index) => value - nums[index]);
    const sameDiff = diffs.every((value) => value === diffs[0]);
    if (sameDiff) add("Number sequence", `Arithmetic pattern: add ${diffs[0]}. Likely next number: ${nums.at(-1)! + diffs[0]}`);
    const ratios = nums.slice(1).map((value, index) => nums[index] === 0 ? NaN : value / nums[index]);
    const sameRatio = ratios.every((value) => Number.isFinite(value) && Math.abs(value - ratios[0]) < 0.0001);
    if (sameRatio) add("Number sequence", `Multiplication pattern: ×${ratios[0]}. Likely next number: ${nums.at(-1)! * ratios[0]}`);
  }

  return candidates.slice(0, 16);
}

function PuzzleSolver() {
  const tweet = useMemo(() => {
    if (typeof window === "undefined") return "";
    const value = new URLSearchParams(window.location.search).get("tweet") ?? "";
    try {
      const url = new URL(value);
      return ["x.com", "twitter.com"].includes(url.hostname) ? url.toString() : "";
    } catch { return ""; }
  }, []);
  const [image, setImage] = useState("");
  const [fileName, setFileName] = useState("");
  const [notes, setNotes] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [answer, setAnswer] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [solving, setSolving] = useState(false);
  const [progress, setProgress] = useState(0);

  async function chooseFile(file: File | undefined) {
    setError(""); setAnswer([]); setExtractedText("");
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError("Upload a PNG, JPG or WebP screenshot.");
    if (file.size > 8_000_000) return setError("Keep the screenshot below 8 MB.");
    const reader = new FileReader();
    reader.onload = () => { setImage(typeof reader.result === "string" ? reader.result : ""); setFileName(file.name); };
    reader.onerror = () => setError("Could not read that image.");
    reader.readAsDataURL(file);
  }

  async function solve() {
    if (!image && !extractedText.trim()) return setError("Upload a screenshot or paste the puzzle text first.");
    setSolving(true); setError(""); setAnswer([]); setProgress(0);
    try {
      let text = extractedText.trim();
      if (image) {
        const { recognize } = await import("tesseract.js");
        const result = await recognize(image, "eng", {
          logger: (message) => {
            if (message.status === "recognizing text" && typeof message.progress === "number") setProgress(Math.round(message.progress * 100));
          },
        });
        text = result.data.text.trim();
        setExtractedText(text);
      }
      const candidates = analyseText(text, notes);
      if (!text) throw new Error("No readable text was detected. Try a clearer crop or type the symbols/text manually.");
      setAnswer(candidates.length ? candidates : [{ label: "Extracted text", value: text }]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not analyse the puzzle.");
    } finally { setSolving(false); setProgress(0); }
  }

  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-4xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Back to tracker</Link>
          {tweet && <a href={tweet} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">Open BIG Games post <ExternalLink size={14} /></a>}
        </div>

        <Card className="tracker-card space-y-5 p-5 sm:p-7">
          <div className="flex items-start gap-4"><div className="tracker-avatar"><Brain /></div><div><p className="eyebrow"><span /> FREE LOCAL SOLVER</p><h1 className="text-2xl font-semibold sm:text-3xl">BIG Games puzzle solver</h1><p className="mt-2 text-sm text-muted-foreground">Runs in your browser with no paid API, subscription or usage fee. It extracts text and checks common encodings and patterns.</p></div></div>

          <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-card/40 p-4 text-center hover:border-primary/50">
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void chooseFile(event.target.files?.[0])} />
            <ImagePlus className="mx-auto mb-2" /><span className="block font-medium">Upload puzzle screenshot</span><span className="mt-1 block text-xs text-muted-foreground">PNG, JPG or WebP · processed on your device</span>
          </label>

          {image && <div className="space-y-2"><p className="text-xs text-muted-foreground">{fileName}</p><img src={image} alt="Uploaded puzzle" className="max-h-[480px] w-full rounded-xl border border-white/10 object-contain" /></div>}

          <div><label htmlFor="puzzle-text" className="mb-2 block text-sm font-medium">Detected or manually entered puzzle text</label><textarea id="puzzle-text" value={extractedText} onChange={(event) => setExtractedText(event.target.value)} placeholder="OCR results appear here. You can correct them or paste the puzzle text manually." className="command-input min-h-32 w-full rounded-xl p-3 text-sm" /></div>
          <div><label htmlFor="puzzle-notes" className="mb-2 block text-sm font-medium">Extra context</label><Input id="puzzle-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="For example: the answer might be a Roblox pet name or code" className="h-11 rounded-xl" /></div>

          <Button onClick={solve} disabled={solving || (!image && !extractedText.trim())} className="metal-button h-12 w-full rounded-xl">
            {solving ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{solving ? `Reading puzzle${progress ? ` ${progress}%` : "…"}` : "Analyse for free"}
          </Button>

          {error && <p className="error-copy">{error}</p>}
          {!!answer.length && <section className="content-panel space-y-3" aria-live="polite"><p className="panel-label">POSSIBLE SOLUTIONS</p>{answer.map((item, index) => <div key={`${item.label}-${index}`} className="rounded-lg border border-white/10 p-3"><strong className="text-xs uppercase tracking-wide text-primary">{item.label}</strong><div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{item.value}</div></div>)}<p className="text-xs text-muted-foreground">Local analysis can miss image-only or highly visual clues. Check the original image and compare the strongest candidates.</p></section>}
        </Card>
      </div>
    </main>
  );
}