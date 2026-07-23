import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, Gauge, ImagePlus, LoaderCircle, Sparkles, Undo2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/object-puzzle-solver")({ component: ObjectPuzzleSolver });

type Tile = {
  url: string;
  pixels: ImageData;
  mask: Uint8Array;
  foregroundRatio: number;
  colour: [number, number, number];
};
type Costs = { right: number[][]; down: number[][] };
type Suggestion = { a: number; b: number; delta: number; reason: string };

const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not decode the image."));
    img.src = src;
  });
}
function rgb(data: Uint8ClampedArray, width: number, x: number, y: number) {
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2]] as const;
}
function colourDistance(a: readonly number[], b: readonly number[]) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}
function estimateBackground(image: ImageData): [number, number, number] {
  const points: number[][] = [];
  const w = image.width, h = image.height;
  const marginX = Math.max(2, Math.floor(w * 0.12));
  const marginY = Math.max(2, Math.floor(h * 0.12));
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 20))) {
    for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 20))) {
      if (x < marginX || x >= w - marginX || y < marginY || y >= h - marginY) points.push([...rgb(image.data, w, x, y)]);
    }
  }
  const channel = (i: number) => points.map((p) => p[i]).sort((a, b) => a - b)[Math.floor(points.length / 2)] || 0;
  return [channel(0), channel(1), channel(2)];
}
function buildMask(image: ImageData, background: [number, number, number]) {
  const mask = new Uint8Array(image.width * image.height);
  let count = 0, sr = 0, sg = 0, sb = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const c = rgb(image.data, image.width, x, y);
    const saturation = Math.max(...c) - Math.min(...c);
    const foreground = colourDistance(c, background) > 25 || saturation > 34;
    if (foreground) {
      mask[y * image.width + x] = 1;
      count++; sr += c[0]; sg += c[1]; sb += c[2];
    }
  }
  return {
    mask,
    ratio: count / Math.max(1, image.width * image.height),
    colour: [sr / Math.max(1, count), sg / Math.max(1, count), sb / Math.max(1, count)] as [number, number, number],
  };
}
async function extractTiles(src: string, rows: number, cols: number, gutterPercent: number) {
  const image = await loadImage(src);
  const cellW = image.naturalWidth / cols;
  const cellH = image.naturalHeight / rows;
  const gutter = Math.max(1, Math.round(Math.min(cellW, cellH) * gutterPercent / 100));
  const tileW = Math.max(20, Math.floor(cellW - gutter * 2));
  const tileH = Math.max(20, Math.floor(cellH - gutter * 2));
  const raw: { url: string; pixels: ImageData }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const canvas = document.createElement("canvas");
    canvas.width = tileW; canvas.height = tileH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.drawImage(image, c * cellW + gutter, r * cellH + gutter, tileW, tileH, 0, 0, tileW, tileH);
    raw.push({ url: canvas.toDataURL("image/png"), pixels: ctx.getImageData(0, 0, tileW, tileH) });
  }
  const bgSamples = raw.map((t) => estimateBackground(t.pixels));
  const median = (index: number) => bgSamples.map((v) => v[index]).sort((a, b) => a - b)[Math.floor(bgSamples.length / 2)] || 0;
  const background: [number, number, number] = [median(0), median(1), median(2)];
  const tiles: Tile[] = raw.map((t) => ({ ...t, ...buildMask(t.pixels, background) }));
  return { tiles, tileW, tileH };
}
function seamCost(a: Tile, b: Tile, direction: "right" | "down") {
  const w = a.pixels.width, h = a.pixels.height;
  const length = direction === "right" ? h : w;
  const depth = Math.max(3, Math.min(10, Math.floor(Math.min(w, h) / 12)));
  let colour = 0, mask = 0, gradient = 0, objectReward = 0;
  for (let p = 1; p < length - 1; p++) for (let d = 0; d < depth; d++) {
    const ax = direction === "right" ? w - 1 - d : p;
    const ay = direction === "right" ? p : h - 1 - d;
    const bx = direction === "right" ? d : p;
    const by = direction === "right" ? p : d;
    const ca = rgb(a.pixels.data, w, ax, ay), cb = rgb(b.pixels.data, w, bx, by);
    const ma = a.mask[ay * w + ax], mb = b.mask[by * w + bx];
    colour += colourDistance(ca, cb) / (d + 1);
    mask += Math.abs(ma - mb) * 80 / (d + 1);
    if (d + 1 < depth) {
      const ca2 = rgb(a.pixels.data, w, direction === "right" ? ax - 1 : ax, direction === "right" ? ay : ay - 1);
      const cb2 = rgb(b.pixels.data, w, direction === "right" ? bx + 1 : bx, direction === "right" ? by : by + 1);
      gradient += Math.abs(colourDistance(ca, ca2) - colourDistance(cb2, cb)) / (d + 1);
    }
    if (ma && mb) objectReward += Math.max(0, 70 - colourDistance(ca, cb)) / (d + 1);
  }
  const sameObjectColour = Math.max(0, 90 - colourDistance(a.colour, b.colour));
  const bothObjectHeavy = Math.min(a.foregroundRatio, b.foregroundRatio);
  return colour * 0.42 + mask * 1.25 + gradient * 0.55 - objectReward * 0.9 - sameObjectColour * bothObjectHeavy * 14;
}
function buildCosts(tiles: Tile[]): Costs {
  const n = tiles.length;
  const right = Array.from({ length: n }, () => Array(n).fill(Infinity));
  const down = Array.from({ length: n }, () => Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) {
    right[i][j] = seamCost(tiles[i], tiles[j], "right");
    down[i][j] = seamCost(tiles[i], tiles[j], "down");
  }
  return { right, down };
}
function boardScore(order: number[], costs: Costs, rows: number, cols: number, tiles: Tile[]) {
  let score = 0;
  for (let i = 0; i < order.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    if (c < cols - 1) score += costs.right[order[i]][order[i + 1]];
    if (r < rows - 1) score += costs.down[order[i]][order[i + cols]];
  }
  for (let i = 0; i < order.length; i++) {
    const t = tiles[order[i]];
    if (t.foregroundRatio < 0.04) continue;
    let nearest = Infinity;
    for (let j = 0; j < order.length; j++) {
      if (i === j) continue;
      const u = tiles[order[j]];
      if (colourDistance(t.colour, u.colour) > 78) continue;
      const dr = Math.abs(Math.floor(i / cols) - Math.floor(j / cols));
      const dc = Math.abs(i % cols - j % cols);
      nearest = Math.min(nearest, dr + dc);
    }
    if (Number.isFinite(nearest)) score += Math.max(0, nearest - 1) * t.foregroundRatio * 1200;
  }
  return score;
}
async function beamSolve(costs: Costs, rows: number, cols: number, deep: boolean, progress: (n: number) => void) {
  const n = rows * cols;
  const width = deep ? 4500 : 1800;
  const branch = deep ? 18 : 11;
  let beam: { order: number[]; used: bigint; cost: number }[] = [{ order: [], used: 0n, cost: 0 }];
  for (let pos = 0; pos < n; pos++) {
    const r = Math.floor(pos / cols), c = pos % cols;
    const next: typeof beam = [];
    for (const state of beam) {
      const options: { tile: number; cost: number }[] = [];
      for (let t = 0; t < n; t++) {
        if (state.used & (1n << BigInt(t))) continue;
        let add = 0;
        if (c > 0) add += costs.right[state.order[pos - 1]][t];
        if (r > 0) add += costs.down[state.order[pos - cols]][t];
        options.push({ tile: t, cost: add });
      }
      options.sort((a, b) => a.cost - b.cost);
      for (const option of options.slice(0, branch)) next.push({ order: [...state.order, option.tile], used: state.used | (1n << BigInt(option.tile)), cost: state.cost + option.cost });
    }
    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, width);
    progress(Math.round((pos + 1) / n * 65));
    if (pos % 2 === 0) await wait();
  }
  return beam.slice(0, deep ? 12 : 6).map((b) => b.order);
}
async function refine(start: number[], costs: Costs, tiles: Tile[], rows: number, cols: number, deep: boolean, progress: (n: number) => void) {
  let order = start.slice();
  let score = boardScore(order, costs, rows, cols, tiles);
  const rounds = deep ? 45 : 18;
  for (let round = 0; round < rounds; round++) {
    let best: { order: number[]; score: number } | null = null;
    for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
      const candidate = order.slice();
      [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
      const candidateScore = boardScore(candidate, costs, rows, cols, tiles);
      if (candidateScore < score - 0.001 && (!best || candidateScore < best.score)) best = { order: candidate, score: candidateScore };
    }
    if (!best) break;
    order = best.order; score = best.score;
    progress(65 + Math.round((round + 1) / rounds * 35));
    await wait();
  }
  return { order, score };
}
function getSuggestions(order: number[], costs: Costs, rows: number, cols: number, tiles: Tile[]): Suggestion[] {
  if (!order.length) return [];
  const current = boardScore(order, costs, rows, cols, tiles);
  const options: Suggestion[] = [];
  for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
    const candidate = order.slice();
    [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
    const next = boardScore(candidate, costs, rows, cols, tiles);
    const delta = current - next;
    if (delta > -Math.abs(current) * 0.012) {
      const ar = Math.floor(a / cols) + 1, ac = a % cols + 1;
      const br = Math.floor(b / cols) + 1, bc = b % cols + 1;
      options.push({ a, b, delta, reason: `Try swapping row ${ar}, column ${ac} with row ${br}, column ${bc}.` });
    }
  }
  return options.sort((x, y) => y.delta - x.delta).slice(0, 5);
}
async function renderBoard(tiles: Tile[], order: number[], rows: number, cols: number, tileW: number, tileH: number) {
  const canvas = document.createElement("canvas");
  canvas.width = cols * tileW; canvas.height = rows * tileH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const images = await Promise.all(order.map((id) => loadImage(tiles[id].url)));
  images.forEach((img, i) => ctx.drawImage(img, (i % cols) * tileW, Math.floor(i / cols) * tileH));
  return canvas.toDataURL("image/png");
}

function ObjectPuzzleSolver() {
  const [source, setSource] = useState("");
  const [name, setName] = useState("");
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(6);
  const [gutter, setGutter] = useState(1.2);
  const [deep, setDeep] = useState(true);
  const [tiles, setTiles] = useState<Tile[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [order, setOrder] = useState<number[]>([]);
  const [originalSolvedOrder, setOriginalSolvedOrder] = useState<number[]>([]);
  const [costs, setCosts] = useState<Costs | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [solving, setSolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const objectTiles = useMemo(() => tiles.filter((t) => t.foregroundRatio > 0.04).length, [tiles]);
  const suggestions = useMemo(() => costs ? getSuggestions(order, costs, rows, cols, tiles) : [], [order, costs, rows, cols, tiles]);

  async function upload(file?: File) {
    if (!file) return;
    setError(""); setResult(""); setOrder([]); setOriginalSolvedOrder([]); setCosts(null); setSelected(null);
    setSource(await readFile(file)); setName(file.name);
  }
  async function solve() {
    if (!source) return setError("Upload the shuffled puzzle first.");
    setSolving(true); setError(""); setProgress(0); setStage("Extracting objects");
    try {
      const extracted = await extractTiles(source, rows, cols, gutter);
      setTiles(extracted.tiles); setSize({ w: extracted.tileW, h: extracted.tileH });
      setStage("Building object-aware compatibility map");
      const nextCosts = buildCosts(extracted.tiles);
      setCosts(nextCosts); setProgress(8); await wait();
      setStage("Searching full-board layouts");
      const candidates = await beamSolve(nextCosts, rows, cols, deep, setProgress);
      setStage("Grouping complete pets and refining positions");
      let bestOrder = candidates[0], bestScore = Infinity;
      for (const candidate of candidates) {
        const refined = await refine(candidate, nextCosts, extracted.tiles, rows, cols, deep, setProgress);
        if (refined.score < bestScore) { bestScore = refined.score; bestOrder = refined.order; }
      }
      setOrder(bestOrder); setOriginalSolvedOrder(bestOrder); setSelected(null);
      setResult(await renderBoard(extracted.tiles, bestOrder, rows, cols, extracted.tileW, extracted.tileH));
      setProgress(100); setStage("Near-perfect solve ready for manual review");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Object solve failed."); }
    finally { setSolving(false); }
  }
  async function tapTile(index: number) {
    if (selected === null) { setSelected(index); return; }
    if (selected === index) { setSelected(null); return; }
    const next = order.slice();
    [next[selected], next[index]] = [next[index], next[selected]];
    setSelected(null); setOrder(next);
    setResult(await renderBoard(tiles, next, rows, cols, size.w, size.h));
  }
  async function applySuggestion(s: Suggestion) {
    const next = order.slice();
    [next[s.a], next[s.b]] = [next[s.b], next[s.a]];
    setOrder(next); setSelected(null);
    setResult(await renderBoard(tiles, next, rows, cols, size.w, size.h));
  }
  async function resetToSolved() {
    setOrder(originalSolvedOrder); setSelected(null);
    setResult(await renderBoard(tiles, originalSolvedOrder, rows, cols, size.w, size.h));
  }

  return <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <Link to="/menu" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16}/> Main menu</Link>
      <Card className="tracker-card space-y-5 p-5 sm:p-7">
        <div className="flex items-start gap-4"><div className="tracker-avatar"><Brain/></div><div>
          <p className="eyebrow"><span/> OBJECT-AWARE SOLVER</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Pet and object puzzle solver</h1>
          <p className="mt-2 text-sm text-muted-foreground">Restored to the earlier near-perfect solver. It now shows the result immediately and suggests optional swaps for you to review manually.</p>
        </div></div>
        <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-card/40 p-5 text-center hover:border-primary/50">
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])}/>
          <ImagePlus className="mx-auto mb-2"/><span className="font-medium">Upload shuffled puzzle</span>
        </label>
        {source && <img src={source} alt="Puzzle" className="max-h-[480px] w-full rounded-xl border border-white/10 object-contain"/>}
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label className="mb-2 block text-sm">Rows</label><Input type="number" min={2} max={10} value={rows} onChange={(e)=>setRows(Math.max(2,Math.min(10,Number(e.target.value)||2)))}/></div>
          <div><label className="mb-2 block text-sm">Columns</label><Input type="number" min={2} max={10} value={cols} onChange={(e)=>setCols(Math.max(2,Math.min(10,Number(e.target.value)||2)))}/></div>
          <div><label className="mb-2 block text-sm">Grid gutter %</label><Input type="number" min={0} max={10} step={0.1} value={gutter} onChange={(e)=>setGutter(Math.max(0,Math.min(10,Number(e.target.value)||0)))}/></div>
          <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={deep} onChange={(e)=>setDeep(e.target.checked)}/><Gauge size={15}/> Maximum object search</label>
        </div>
        <Button onClick={solve} disabled={solving || !source} className="metal-button h-12 w-full rounded-xl">{solving?<LoaderCircle className="animate-spin"/>:<Sparkles/>}{solving?`${stage} · ${progress}%`:"Run object-aware solve"}</Button>
        {error && <p className="error-copy">{error}</p>}
        {!!tiles.length && <p className="status-pill status-healthy">Detected object content in {objectTiles} of {tiles.length} tiles</p>}
        {!!order.length && <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3">
            <div className="grid overflow-hidden rounded-xl border border-white/10" style={{gridTemplateColumns:`repeat(${cols},minmax(0,1fr))`}}>
              {order.map((id,index)=><button type="button" key={`slot-${index}`} onClick={()=>void tapTile(index)} className={`relative aspect-square overflow-hidden border border-black/30 transition-all ${selected===index?"z-10 ring-4 ring-primary ring-inset":""}`}><img src={tiles[id]?.url} alt={`Tile ${id+1}`} className="h-full w-full object-fill"/><span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{index+1}</span></button>)}
            </div>
            <p className="text-xs text-muted-foreground">Tap any two tiles to swap them yourself. The small number is the board position.</p>
            <Button variant="outline" onClick={()=>void resetToSolved()}><Undo2 size={15}/> Reset to solver result</Button>
          </div>
          <div className="space-y-4">
            <Card className="space-y-3 p-4">
              <p className="panel-label">SUGGESTED MANUAL CHECKS</p>
              {suggestions.length ? suggestions.map((s,i)=><div key={`${s.a}-${s.b}`} className="rounded-lg border border-white/10 p-3">
                <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">Suggestion {i+1}</p><p className="mt-1 text-xs text-muted-foreground">{s.reason}</p><p className="mt-1 text-[11px] text-muted-foreground">Estimated score change: {s.delta>=0?"improves":"may improve visually"} ({s.delta.toFixed(1)})</p></div><Button size="sm" variant="outline" onClick={()=>void applySuggestion(s)}><WandSparkles size={14}/> Try</Button></div>
              </div>) : <p className="text-sm text-muted-foreground">No useful swap suggestions remain. Review the image and tap two tiles manually if something still looks wrong.</p>}
            </Card>
            {result && <Card className="space-y-3 p-4"><p className="panel-label">CURRENT RESULT</p><img src={result} alt="Solved result" className="w-full rounded-lg border border-white/10"/><a href={result} download={`object-solved-${name||"puzzle"}.png`}><Button variant="outline" className="w-full">Save result PNG</Button></a></Card>}
          </div>
        </section>}
      </Card>
    </div>
  </main>;
}
