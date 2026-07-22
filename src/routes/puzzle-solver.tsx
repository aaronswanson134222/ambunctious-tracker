import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, Download, ExternalLink, Grid3X3, ImagePlus, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/puzzle-solver")({ component: PuzzleSolver });

type Candidate = { label: string; value: string };
type Tile = { canvas: HTMLCanvasElement; pixels: ImageData; originalIndex: number };

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
  Array.from({ length: 25 }, (_, index) => ({ shift: index + 1, value: caesar(text, index + 1) }))
    .map((item) => ({ ...item, score: scoreEnglish(item.value) }))
    .sort((a, b) => b.score - a.score).slice(0, 5)
    .forEach((item) => add(`Caesar shift ${item.shift}`, item.value));
  const numberTokens = text.match(/\b(?:[1-9]|1\d|2[0-6])\b/g);
  if (numberTokens && numberTokens.length >= 3) add("A1Z26 letters", numberTokens.map((value) => String.fromCharCode(64 + Number(value))).join(""));
  const binary = text.match(/\b[01]{8}(?:\s+[01]{8}){1,}\b/)?.[0];
  if (binary) add("Binary to text", binary.split(/\s+/).map((value) => String.fromCharCode(parseInt(value, 2))).join(""));
  const hex = text.match(/\b(?:[0-9a-fA-F]{2}[\s:-]?){3,}\b/)?.[0];
  if (hex) {
    const decoded = (hex.match(/[0-9a-fA-F]{2}/g) ?? []).map((value) => String.fromCharCode(parseInt(value, 16))).join("");
    if (printable(decoded)) add("Hex to text", decoded);
  }
  for (const token of (text.match(/\b[A-Za-z0-9+/]{8,}={0,2}\b/g) ?? []).slice(0, 5)) {
    try { const decoded = atob(token); if (printable(decoded)) add("Base64 to text", decoded); } catch { /* no-op */ }
  }
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  if (lines.length >= 3) {
    add("Line acrostic", lines.map((line) => line[0]).join(""));
    add("Last letters of lines", lines.map((line) => line.at(-1) ?? "").join(""));
  }
  return candidates.slice(0, 16);
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the uploaded image."));
    img.src = src;
  });
}

function edgeDistance(a: Tile, b: Tile, direction: "right" | "down") {
  const ap = a.pixels.data;
  const bp = b.pixels.data;
  const w = a.pixels.width;
  const h = a.pixels.height;
  let total = 0;
  let samples = 0;
  const strip = Math.max(1, Math.min(3, Math.floor(Math.min(w, h) / 30)));
  if (direction === "right") {
    for (let y = 2; y < h - 2; y += 2) for (let s = 0; s < strip; s++) {
      const ai = (y * w + (w - 1 - s)) * 4;
      const bi = (y * w + s) * 4;
      for (let c = 0; c < 3; c++) { const d = ap[ai + c] - bp[bi + c]; total += d * d; }
      samples++;
    }
  } else {
    for (let x = 2; x < w - 2; x += 2) for (let s = 0; s < strip; s++) {
      const ai = (((h - 1 - s) * w) + x) * 4;
      const bi = ((s * w) + x) * 4;
      for (let c = 0; c < 3; c++) { const d = ap[ai + c] - bp[bi + c]; total += d * d; }
      samples++;
    }
  }
  return total / Math.max(1, samples);
}

function arrangementCost(order: number[], right: number[][], down: number[][], rows: number, cols: number) {
  let cost = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (c + 1 < cols) cost += right[order[i]][order[i + 1]];
    if (r + 1 < rows) cost += down[order[i]][order[i + cols]];
  }
  return cost;
}

async function solveTileImage(src: string, rows: number, cols: number, onProgress: (n: number) => void) {
  const img = await loadImage(src);
  const tileW = Math.floor(img.naturalWidth / cols);
  const tileH = Math.floor(img.naturalHeight / rows);
  if (tileW < 20 || tileH < 20) throw new Error("The selected grid creates tiles that are too small.");
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const canvas = document.createElement("canvas");
    canvas.width = tileW; canvas.height = tileH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is unavailable in this browser.");
    ctx.drawImage(img, c * tileW, r * tileH, tileW, tileH, 0, 0, tileW, tileH);
    tiles.push({ canvas, pixels: ctx.getImageData(0, 0, tileW, tileH), originalIndex: r * cols + c });
  }
  const n = tiles.length;
  const right = Array.from({ length: n }, () => Array(n).fill(0));
  const down = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
    right[i][j] = edgeDistance(tiles[i], tiles[j], "right");
    down[i][j] = edgeDistance(tiles[i], tiles[j], "down");
  }
  let best = Array.from({ length: n }, (_, i) => i);
  let bestCost = Number.POSITIVE_INFINITY;
  const restarts = Math.max(12, Math.min(50, n * 2));
  for (let restart = 0; restart < restarts; restart++) {
    const current = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
    let cost = arrangementCost(current, right, down, rows, cols);
    let temperature = cost / Math.max(1, n * 3);
    const iterations = Math.max(3000, n * 500);
    for (let step = 0; step < iterations; step++) {
      const a = Math.floor(Math.random() * n);
      let b = Math.floor(Math.random() * n);
      if (a === b) b = (b + 1) % n;
      [current[a], current[b]] = [current[b], current[a]];
      const next = arrangementCost(current, right, down, rows, cols);
      const delta = next - cost;
      if (delta < 0 || Math.random() < Math.exp(-delta / Math.max(1, temperature))) cost = next;
      else [current[a], current[b]] = [current[b], current[a]];
      temperature *= 0.9992;
    }
    if (cost < bestCost) { bestCost = cost; best = [...current]; }
    onProgress(Math.round(((restart + 1) / restarts) * 100));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  const output = document.createElement("canvas");
  output.width = tileW * cols; output.height = tileH * rows;
  const out = output.getContext("2d");
  if (!out) throw new Error("Could not render the solved image.");
  best.forEach((tileIndex, position) => {
    out.drawImage(tiles[tileIndex].canvas, (position % cols) * tileW, Math.floor(position / cols) * tileH);
  });
  return { dataUrl: output.toDataURL("image/png"), order: best.map((index) => index + 1), score: bestCost };
}

function PuzzleSolver() {
  const tweet = useMemo(() => {
    if (typeof window === "undefined") return "";
    const value = new URLSearchParams(window.location.search).get("tweet") ?? "";
    try { const url = new URL(value); return ["x.com", "twitter.com"].includes(url.hostname) ? url.toString() : ""; } catch { return ""; }
  }, []);
  const [image, setImage] = useState("");
  const [fileName, setFileName] = useState("");
  const [notes, setNotes] = useState("");
  const [extractedText, setExtractedText] = useState("");
  const [answer, setAnswer] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [solving, setSolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [mode, setMode] = useState<"text" | "tiles">("tiles");
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(6);
  const [solvedImage, setSolvedImage] = useState("");
  const [tileOrder, setTileOrder] = useState<number[]>([]);

  async function chooseFile(file: File | undefined) {
    setError(""); setAnswer([]); setExtractedText(""); setSolvedImage(""); setTileOrder([]);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError("Upload a PNG, JPG or WebP screenshot.");
    if (file.size > 12_000_000) return setError("Keep the screenshot below 12 MB.");
    const reader = new FileReader();
    reader.onload = () => { setImage(typeof reader.result === "string" ? reader.result : ""); setFileName(file.name); };
    reader.onerror = () => setError("Could not read that image.");
    reader.readAsDataURL(file);
  }

  async function solve() {
    if (!image && !extractedText.trim()) return setError("Upload a screenshot or paste the puzzle text first.");
    setSolving(true); setError(""); setAnswer([]); setProgress(0); setSolvedImage(""); setTileOrder([]);
    try {
      if (mode === "tiles") {
        if (!image) throw new Error("Upload the shuffled tile screenshot first.");
        const result = await solveTileImage(image, rows, cols, setProgress);
        setSolvedImage(result.dataUrl);
        setTileOrder(result.order);
      } else {
        let text = extractedText.trim();
        if (image) {
          const { recognize } = await import("tesseract.js");
          const result = await recognize(image, "eng", { logger: (message) => {
            if (message.status === "recognizing text" && typeof message.progress === "number") setProgress(Math.round(message.progress * 100));
          } });
          text = result.data.text.trim(); setExtractedText(text);
        }
        const candidates = analyseText(text, notes);
        if (!text) throw new Error("No readable text was detected. Try a clearer crop or use image-tile mode.");
        setAnswer(candidates.length ? candidates : [{ label: "Extracted text", value: text }]);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not analyse the puzzle."); }
    finally { setSolving(false); setProgress(0); }
  }

  return <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6"><div className="mx-auto max-w-5xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Back to tracker</Link>{tweet && <a href={tweet} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">Open BIG Games post <ExternalLink size={14} /></a>}</div>
    <Card className="tracker-card space-y-5 p-5 sm:p-7">
      <div className="flex items-start gap-4"><div className="tracker-avatar"><Brain /></div><div><p className="eyebrow"><span /> FREE LOCAL SOLVER</p><h1 className="text-2xl font-semibold sm:text-3xl">BIG Games puzzle solver</h1><p className="mt-2 text-sm text-muted-foreground">Reconstruct shuffled image grids or analyse text, ciphers and codes directly in your browser.</p></div></div>
      <div className="grid grid-cols-2 gap-2"><Button type="button" variant={mode === "tiles" ? "default" : "outline"} onClick={() => setMode("tiles")}><Grid3X3 /> Image tiles</Button><Button type="button" variant={mode === "text" ? "default" : "outline"} onClick={() => setMode("text")}><Brain /> Text and codes</Button></div>
      <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-card/40 p-4 text-center hover:border-primary/50"><input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void chooseFile(event.target.files?.[0])} /><ImagePlus className="mx-auto mb-2" /><span className="block font-medium">Upload puzzle screenshot</span><span className="mt-1 block text-xs text-muted-foreground">PNG, JPG or WebP · processed on your device</span></label>
      {image && <div className="space-y-2"><p className="text-xs text-muted-foreground">{fileName}</p><img src={image} alt="Uploaded puzzle" className="max-h-[520px] w-full rounded-xl border border-white/10 object-contain" /></div>}
      {mode === "tiles" ? <div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-2 block text-sm font-medium">Grid rows</label><Input type="number" min={2} max={10} value={rows} onChange={(e) => setRows(Math.max(2, Math.min(10, Number(e.target.value) || 2)))} /></div><div><label className="mb-2 block text-sm font-medium">Grid columns</label><Input type="number" min={2} max={10} value={cols} onChange={(e) => setCols(Math.max(2, Math.min(10, Number(e.target.value) || 2)))} /></div><p className="sm:col-span-2 text-xs text-muted-foreground">For the screenshot you sent, use 4 rows and 6 columns. Crop the image tightly to the outside border for the best result.</p></div> : <><div><label htmlFor="puzzle-text" className="mb-2 block text-sm font-medium">Detected or manually entered puzzle text</label><textarea id="puzzle-text" value={extractedText} onChange={(event) => setExtractedText(event.target.value)} placeholder="OCR results appear here. You can correct them or paste puzzle text manually." className="command-input min-h-32 w-full rounded-xl p-3 text-sm" /></div><div><label htmlFor="puzzle-notes" className="mb-2 block text-sm font-medium">Extra context</label><Input id="puzzle-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="For example: the answer might be a Roblox pet name or code" className="h-11 rounded-xl" /></div></>}
      <Button onClick={solve} disabled={solving || (!image && !extractedText.trim())} className="metal-button h-12 w-full rounded-xl">{solving ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{solving ? `${mode === "tiles" ? "Matching tiles" : "Reading puzzle"}${progress ? ` ${progress}%` : "…"}` : mode === "tiles" ? "Reconstruct image" : "Analyse for free"}</Button>
      {error && <p className="error-copy">{error}</p>}
      {solvedImage && <section className="content-panel space-y-3" aria-live="polite"><div className="flex items-center justify-between gap-3"><div><p className="panel-label">RECONSTRUCTED IMAGE</p><h2 className="font-semibold">Best local match</h2></div><a href={solvedImage} download={`solved-${fileName || "puzzle"}.png`}><Button size="sm" variant="outline"><Download /> Save PNG</Button></a></div><img src={solvedImage} alt="Reconstructed puzzle" className="w-full rounded-xl border border-white/10" /><div className="rounded-lg border border-white/10 p-3"><strong className="text-xs uppercase tracking-wide text-primary">Tile order</strong><p className="mt-1 break-words text-sm">{tileOrder.join(", ")}</p></div><p className="text-xs text-muted-foreground">This is an edge-matching estimate. For difficult artwork, run it again—the random optimiser may find a stronger arrangement on another attempt.</p></section>}
      {!!answer.length && <section className="content-panel space-y-3" aria-live="polite"><p className="panel-label">POSSIBLE SOLUTIONS</p>{answer.map((item, index) => <div key={`${item.label}-${index}`} className="rounded-lg border border-white/10 p-3"><strong className="text-xs uppercase tracking-wide text-primary">{item.label}</strong><div className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{item.value}</div></div>)}</section>}
    </Card>
  </div></main>;
}
