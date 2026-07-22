import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, CheckCircle2, Download, ExternalLink, Grid3X3, ImagePlus, LoaderCircle, Save, Sparkles, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/puzzle-solver")({ component: PuzzleSolver });

type Candidate = { label: string; value: string };
type Tile = { dataUrl: string; pixels: ImageData };
type Profile = { id: string; colour: number; gradient: number; inward: number };
type Solution = { order: number[]; cost: number; profile: string };
type Learning = Record<string, number>;

const PROFILES: Profile[] = [
  { id: "balanced", colour: 1, gradient: 0.8, inward: 0.25 },
  { id: "colour", colour: 1.5, gradient: 0.25, inward: 0.15 },
  { id: "shape", colour: 0.55, gradient: 1.6, inward: 0.35 },
  { id: "deep", colour: 0.9, gradient: 1, inward: 0.9 },
];

function loadLearning(): Learning {
  if (typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem("ambunctious-puzzle-learning") || "{}"); }
  catch { return {}; }
}
function saveLearning(value: Learning) {
  localStorage.setItem("ambunctious-puzzle-learning", JSON.stringify(value));
}
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the uploaded image."));
    image.src = src;
  });
}
function rgb(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]];
}
function edgeCost(a: ImageData, b: ImageData, direction: "right" | "down", profile: Profile) {
  const w = a.width, h = a.height;
  const length = direction === "right" ? h : w;
  const depth = Math.max(3, Math.min(10, Math.floor(Math.min(w, h) / 16)));
  let total = 0, count = 0;
  for (let p = 3; p < length - 3; p += 2) {
    for (let d = 0; d < depth; d++) {
      const ax = direction === "right" ? w - 1 - d : p;
      const ay = direction === "right" ? p : h - 1 - d;
      const bx = direction === "right" ? d : p;
      const by = direction === "right" ? p : d;
      const ai = rgb(a.data, w, ax, ay), bi = rgb(b.data, w, bx, by);
      const ai2 = rgb(a.data, w, direction === "right" ? Math.max(0, ax - 1) : ax, direction === "down" ? Math.max(0, ay - 1) : ay);
      const bi2 = rgb(b.data, w, direction === "right" ? Math.min(w - 1, bx + 1) : bx, direction === "down" ? Math.min(h - 1, by + 1) : by);
      for (let c = 0; c < 3; c++) {
        const colour = ai[c] - bi[c];
        const gradient = (ai[c] - ai2[c]) - (bi2[c] - bi[c]);
        const inward = ai2[c] - bi2[c];
        total += colour * colour * profile.colour + gradient * gradient * profile.gradient + inward * inward * profile.inward;
      }
      count++;
    }
  }
  return total / Math.max(1, count);
}
function normalize(matrix: number[][]) {
  return matrix.map((row, i) => {
    const values = row.filter((_, j) => i !== j && Number.isFinite(row[j])).sort((a, b) => a - b);
    const base = values[Math.min(values.length - 1, 4)] || 1;
    return row.map((value, j) => i === j ? Number.POSITIVE_INFINITY : value / base);
  });
}
function totalCost(order: number[], right: number[][], down: number[][], rows: number, cols: number) {
  let cost = 0;
  for (let i = 0; i < order.length; i++) {
    const col = i % cols, row = Math.floor(i / cols);
    if (col < cols - 1) cost += right[order[i]][order[i + 1]];
    if (row < rows - 1) cost += down[order[i]][order[i + cols]];
  }
  return cost;
}
async function beamSolve(right: number[][], down: number[][], rows: number, cols: number, progress: (value: number) => void) {
  const n = rows * cols;
  let beam = [{ order: [] as number[], used: 0n, cost: 0 }];
  const width = n <= 24 ? 2400 : 850;
  const branch = n <= 24 ? 12 : 7;
  for (let pos = 0; pos < n; pos++) {
    const next: typeof beam = [];
    const col = pos % cols, row = Math.floor(pos / cols);
    for (const state of beam) {
      const options: { tile: number; add: number }[] = [];
      for (let tile = 0; tile < n; tile++) {
        if (state.used & (1n << BigInt(tile))) continue;
        let add = 0;
        if (col > 0) add += right[state.order[pos - 1]][tile];
        if (row > 0) add += down[state.order[pos - cols]][tile];
        options.push({ tile, add });
      }
      options.sort((a, b) => a.add - b.add || a.tile - b.tile);
      for (const option of options.slice(0, branch)) next.push({ order: [...state.order, option.tile], used: state.used | (1n << BigInt(option.tile)), cost: state.cost + option.add });
    }
    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, width);
    progress(Math.round(((pos + 1) / n) * 100));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return beam.slice(0, 15).map((state) => ({ order: state.order, cost: totalCost(state.order, right, down, rows, cols) }));
}
async function solveTiles(src: string, rows: number, cols: number, setProgress: (value: number) => void) {
  const image = await loadImage(src);
  const cellW = image.naturalWidth / cols, cellH = image.naturalHeight / rows;
  const gutter = Math.max(2, Math.min(10, Math.round(Math.min(cellW, cellH) * 0.016)));
  const tileW = Math.floor(cellW - gutter * 2), tileH = Math.floor(cellH - gutter * 2);
  if (tileW < 25 || tileH < 25) throw new Error("The selected grid makes the tiles too small.");
  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    const canvas = document.createElement("canvas");
    canvas.width = tileW; canvas.height = tileH;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Canvas is unavailable.");
    context.drawImage(image, Math.round(col * cellW + gutter), Math.round(row * cellH + gutter), tileW, tileH, 0, 0, tileW, tileH);
    tiles.push({ dataUrl: canvas.toDataURL("image/png"), pixels: context.getImageData(0, 0, tileW, tileH) });
  }
  const learning = loadLearning();
  const all: Solution[] = [];
  for (let profileIndex = 0; profileIndex < PROFILES.length; profileIndex++) {
    const profile = PROFILES[profileIndex];
    const n = tiles.length;
    const right = Array.from({ length: n }, () => Array(n).fill(Number.POSITIVE_INFINITY));
    const down = Array.from({ length: n }, () => Array(n).fill(Number.POSITIVE_INFINITY));
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
      right[i][j] = edgeCost(tiles[i].pixels, tiles[j].pixels, "right", profile);
      down[i][j] = edgeCost(tiles[i].pixels, tiles[j].pixels, "down", profile);
    }
    const nr = normalize(right), nd = normalize(down);
    const results = await beamSolve(nr, nd, rows, cols, (value) => setProgress(Math.round(((profileIndex + value / 100) / PROFILES.length) * 100)));
    for (const result of results.slice(0, 3)) all.push({ ...result, profile: profile.id });
  }
  const unique = new Map<string, Solution>();
  for (const solution of all) {
    const key = solution.order.join(",");
    const learnedBonus = (learning[solution.profile] || 0) * 0.035;
    const adjusted = solution.cost * Math.max(0.65, 1 - learnedBonus);
    const existing = unique.get(key);
    if (!existing || adjusted < existing.cost) unique.set(key, { ...solution, cost: adjusted });
  }
  const solutions = [...unique.values()].sort((a, b) => a.cost - b.cost).slice(0, 6);
  return { tiles, solutions, tileW, tileH };
}
function renderSolution(tiles: Tile[], order: number[], rows: number, cols: number, tileW: number, tileH: number) {
  const canvas = document.createElement("canvas");
  canvas.width = cols * tileW; canvas.height = rows * tileH;
  const context = canvas.getContext("2d");
  if (!context) return "";
  return Promise.all(order.map((tile) => loadImage(tiles[tile].dataUrl))).then((images) => {
    images.forEach((image, index) => context.drawImage(image, (index % cols) * tileW, Math.floor(index / cols) * tileH));
    return canvas.toDataURL("image/png");
  });
}

function PuzzleSolver() {
  const tweet = useMemo(() => {
    if (typeof window === "undefined") return "";
    const value = new URLSearchParams(window.location.search).get("tweet") || "";
    try { const url = new URL(value); return ["x.com", "twitter.com"].includes(url.hostname) ? url.toString() : ""; } catch { return ""; }
  }, []);
  const [image, setImage] = useState("");
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(6);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [active, setActive] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [solvedImage, setSolvedImage] = useState("");
  const [tileSize, setTileSize] = useState({ width: 0, height: 0 });
  const [solving, setSolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [trained, setTrained] = useState(false);

  async function chooseFile(file?: File) {
    setError(""); setSolutions([]); setTiles([]); setOrder([]); setSolvedImage(""); setTrained(false);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setError("Upload a PNG, JPG or WebP screenshot.");
    const reader = new FileReader();
    reader.onload = () => { setImage(String(reader.result || "")); setFileName(file.name); };
    reader.readAsDataURL(file);
  }
  async function rebuild(nextOrder: number[], nextTiles = tiles, size = tileSize) {
    setOrder(nextOrder);
    setSolvedImage(await renderSolution(nextTiles, nextOrder, rows, cols, size.width, size.height));
  }
  async function solve() {
    if (!image) return setError("Upload a shuffled puzzle screenshot first.");
    setSolving(true); setError(""); setProgress(0); setTrained(false);
    try {
      const result = await solveTiles(image, rows, cols, setProgress);
      if (!result.solutions.length) throw new Error("No valid arrangements were found.");
      setTiles(result.tiles); setSolutions(result.solutions); setTileSize({ width: result.tileW, height: result.tileH }); setActive(0);
      await rebuild(result.solutions[0].order, result.tiles, { width: result.tileW, height: result.tileH });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Puzzle solving failed."); }
    finally { setSolving(false); setProgress(0); }
  }
  async function chooseSolution(index: number) {
    setActive(index); setSelected(null); setTrained(false); await rebuild(solutions[index].order);
  }
  async function tapTile(index: number) {
    if (selected === null) return setSelected(index);
    if (selected === index) return setSelected(null);
    const next = [...order];
    [next[selected], next[index]] = [next[index], next[selected]];
    setSelected(null); setTrained(false); await rebuild(next);
  }
  function train() {
    const learning = loadLearning();
    const profile = solutions[active]?.profile || "balanced";
    learning[profile] = (learning[profile] || 0) + 1;
    saveLearning(learning); setTrained(true);
  }

  return <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6"><div className="mx-auto max-w-6xl space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><Link to="/menu" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} /> Main menu</Link>{tweet && <a href={tweet} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-sm text-primary hover:underline">Open BIG Games post <ExternalLink size={14} /></a>}</div>
    <Card className="tracker-card space-y-5 p-5 sm:p-7">
      <div className="flex items-start gap-4"><div className="tracker-avatar"><Brain /></div><div><p className="eyebrow"><span /> TRAINABLE PUZZLE LAB</p><h1 className="text-2xl font-semibold sm:text-3xl">Image puzzle solver</h1><p className="mt-2 text-sm text-muted-foreground">Runs four different matching models, produces several candidates, lets you correct mistakes, and learns which model performs best from confirmed solutions.</p></div></div>
      <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-card/40 p-4 text-center hover:border-primary/50"><input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void chooseFile(event.target.files?.[0])} /><ImagePlus className="mx-auto mb-2" /><span className="block font-medium">Upload puzzle screenshot</span><span className="mt-1 block text-xs text-muted-foreground">Use the full grid with the outside border visible</span></label>
      {image && <img src={image} alt="Uploaded puzzle" className="max-h-[500px] w-full rounded-xl border border-white/10 object-contain" />}
      <div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-2 block text-sm font-medium">Rows</label><Input type="number" min={2} max={10} value={rows} onChange={(event) => setRows(Math.max(2, Math.min(10, Number(event.target.value) || 2)))} /></div><div><label className="mb-2 block text-sm font-medium">Columns</label><Input type="number" min={2} max={10} value={cols} onChange={(event) => setCols(Math.max(2, Math.min(10, Number(event.target.value) || 2)))} /></div></div>
      <Button onClick={solve} disabled={solving || !image} className="metal-button h-12 w-full rounded-xl">{solving ? <LoaderCircle className="animate-spin" /> : <Sparkles />}{solving ? `Testing matching models ${progress}%` : "Generate best solutions"}</Button>
      {error && <p className="error-copy">{error}</p>}
      {!!solutions.length && <section className="space-y-4"><div className="flex flex-wrap gap-2">{solutions.map((solution, index) => <Button key={`${solution.profile}-${index}`} size="sm" variant={active === index ? "default" : "outline"} onClick={() => void chooseSolution(index)}>Option {index + 1} · {solution.profile}</Button>)}</div>
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]"><div className="space-y-3"><div className="grid overflow-hidden rounded-xl border border-white/10" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>{order.map((tile, index) => <button key={`${index}-${tile}`} type="button" onClick={() => void tapTile(index)} className={`relative aspect-square overflow-hidden border border-black/30 ${selected === index ? "ring-4 ring-primary ring-inset" : ""}`}><img src={tiles[tile]?.dataUrl} alt={`Tile ${tile + 1}`} className="h-full w-full object-fill" /><span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{tile + 1}</span></button>)}</div><p className="text-xs text-muted-foreground">Correction mode: tap one incorrect tile, then tap the tile it should swap with. Repeat until the picture is exact.</p></div>
        <Card className="space-y-3 p-4"><p className="panel-label">FINAL RESULT</p>{solvedImage && <img src={solvedImage} alt="Solved puzzle" className="w-full rounded-lg border border-white/10" />}<p className="break-words text-xs text-muted-foreground">Order: {order.map((value) => value + 1).join(", ")}</p><Button variant="outline" onClick={() => void rebuild(solutions[active].order)}><Undo2 /> Reset option</Button><Button onClick={train}><Save /> Save correction as training</Button>{trained && <p className="status-pill status-healthy"><CheckCircle2 size={14} /> Training saved</p>}{solvedImage && <a href={solvedImage} download={`solved-${fileName || "puzzle"}.png`}><Button variant="outline" className="w-full"><Download /> Save PNG</Button></a>}</Card></div>
      </section>}
    </Card>
  </div></main>;
}