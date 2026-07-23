import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, Gauge, ImagePlus, LoaderCircle, Sparkles, Undo2, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/object-puzzle-solver")({ component: ObjectPuzzleSolver });

type Tile = { url: string; pixels: ImageData; mask: Uint8Array; foregroundRatio: number; colour: [number, number, number] };
type Costs = { right: number[][]; down: number[][] };
type Suggestion = { a: number; b: number; delta: number; reason: string };
type Candidate = { order: number[]; score: number; image: string; label: string };

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
  const mx = Math.max(2, Math.floor(w * 0.12)), my = Math.max(2, Math.floor(h * 0.12));
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 20))) for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 20))) {
    if (x < mx || x >= w - mx || y < my || y >= h - my) points.push([...rgb(image.data, w, x, y)]);
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
    if (colourDistance(c, background) > 25 || saturation > 34) {
      mask[y * image.width + x] = 1;
      count++; sr += c[0]; sg += c[1]; sb += c[2];
    }
  }
  return { mask, foregroundRatio: count / Math.max(1, image.width * image.height), colour: [sr / Math.max(1, count), sg / Math.max(1, count), sb / Math.max(1, count)] as [number, number, number] };
}
async function extractTiles(src: string, rows: number, cols: number, gutterPercent: number) {
  const image = await loadImage(src);
  const cellW = image.naturalWidth / cols, cellH = image.naturalHeight / rows;
  const gutter = Math.max(1, Math.round(Math.min(cellW, cellH) * gutterPercent / 100));
  const tileW = Math.max(20, Math.floor(cellW - gutter * 2)), tileH = Math.max(20, Math.floor(cellH - gutter * 2));
  const raw: { url: string; pixels: ImageData }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const canvas = document.createElement("canvas"); canvas.width = tileW; canvas.height = tileH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.drawImage(image, c * cellW + gutter, r * cellH + gutter, tileW, tileH, 0, 0, tileW, tileH);
    raw.push({ url: canvas.toDataURL("image/png"), pixels: ctx.getImageData(0, 0, tileW, tileH) });
  }
  const bgSamples = raw.map((t) => estimateBackground(t.pixels));
  const median = (i: number) => bgSamples.map((v) => v[i]).sort((a, b) => a - b)[Math.floor(bgSamples.length / 2)] || 0;
  const background: [number, number, number] = [median(0), median(1), median(2)];
  const tiles: Tile[] = raw.map((t) => ({ ...t, ...buildMask(t.pixels, background) }));
  return { tiles, tileW, tileH };
}
function seamCost(a: Tile, b: Tile, direction: "right" | "down") {
  const w = a.pixels.width, h = a.pixels.height, length = direction === "right" ? h : w;
  const depth = Math.max(3, Math.min(10, Math.floor(Math.min(w, h) / 12)));
  let colour = 0, mask = 0, gradient = 0, objectReward = 0;
  for (let p = 1; p < length - 1; p++) for (let d = 0; d < depth; d++) {
    const ax = direction === "right" ? w - 1 - d : p, ay = direction === "right" ? p : h - 1 - d;
    const bx = direction === "right" ? d : p, by = direction === "right" ? p : d;
    const ca = rgb(a.pixels.data, w, ax, ay), cb = rgb(b.pixels.data, w, bx, by);
    const ma = a.mask[ay * w + ax], mb = b.mask[by * w + bx], weight = 1 / (d + 1);
    colour += colourDistance(ca, cb) * weight;
    mask += Math.abs(ma - mb) * 80 * weight;
    if (d + 1 < depth) {
      const ca2 = rgb(a.pixels.data, w, direction === "right" ? ax - 1 : ax, direction === "right" ? ay : ay - 1);
      const cb2 = rgb(b.pixels.data, w, direction === "right" ? bx + 1 : bx, direction === "right" ? by : by + 1);
      gradient += Math.abs(colourDistance(ca, ca2) - colourDistance(cb2, cb)) * weight;
    }
    if (ma && mb) objectReward += Math.max(0, 70 - colourDistance(ca, cb)) * weight;
  }
  const sameObjectColour = Math.max(0, 90 - colourDistance(a.colour, b.colour));
  return colour * 0.42 + mask * 1.25 + gradient * 0.55 - objectReward * 0.9 - sameObjectColour * Math.min(a.foregroundRatio, b.foregroundRatio) * 14;
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
    const t = tiles[order[i]]; if (t.foregroundRatio < 0.04) continue;
    let nearest = Infinity;
    for (let j = 0; j < order.length; j++) if (i !== j) {
      const u = tiles[order[j]]; if (colourDistance(t.colour, u.colour) > 78) continue;
      nearest = Math.min(nearest, Math.abs(Math.floor(i / cols) - Math.floor(j / cols)) + Math.abs(i % cols - j % cols));
    }
    if (Number.isFinite(nearest)) score += Math.max(0, nearest - 1) * t.foregroundRatio * 1200;
  }
  return score;
}
async function beamSolve(costs: Costs, rows: number, cols: number, deep: boolean, progress: (n: number) => void) {
  const n = rows * cols, width = deep ? 4500 : 1800, branch = deep ? 18 : 11;
  let beam: { order: number[]; used: bigint; cost: number }[] = [{ order: [], used: 0n, cost: 0 }];
  for (let pos = 0; pos < n; pos++) {
    const r = Math.floor(pos / cols), c = pos % cols, next: typeof beam = [];
    for (const state of beam) {
      const options: { tile: number; cost: number }[] = [];
      for (let t = 0; t < n; t++) if (!(state.used & (1n << BigInt(t)))) {
        let add = 0; if (c > 0) add += costs.right[state.order[pos - 1]][t]; if (r > 0) add += costs.down[state.order[pos - cols]][t];
        options.push({ tile: t, cost: add });
      }
      options.sort((a, b) => a.cost - b.cost);
      for (const option of options.slice(0, branch)) next.push({ order: [...state.order, option.tile], used: state.used | (1n << BigInt(option.tile)), cost: state.cost + option.cost });
    }
    next.sort((a, b) => a.cost - b.cost); beam = next.slice(0, width);
    progress(Math.round((pos + 1) / n * 65)); if (pos % 2 === 0) await wait();
  }
  return beam.slice(0, deep ? 20 : 10).map((b) => b.order);
}
async function refine(start: number[], costs: Costs, tiles: Tile[], rows: number, cols: number, deep: boolean) {
  let order = start.slice(), score = boardScore(order, costs, rows, cols, tiles);
  for (let round = 0; round < (deep ? 36 : 16); round++) {
    let best: { order: number[]; score: number } | null = null;
    for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
      const candidate = order.slice(); [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
      const candidateScore = boardScore(candidate, costs, rows, cols, tiles);
      if (candidateScore < score - 0.001 && (!best || candidateScore < best.score)) best = { order: candidate, score: candidateScore };
    }
    if (!best) break; order = best.order; score = best.score; await wait();
  }
  return { order, score };
}
function orderDistance(a: number[], b: number[]) {
  let different = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
  return different;
}
function chooseDiverse(results: { order: number[]; score: number }[], limit: number) {
  const sorted = [...results].sort((a, b) => a.score - b.score);
  const selected: typeof sorted = [];
  for (const item of sorted) {
    if (!selected.length || selected.every((s) => orderDistance(s.order, item.order) >= Math.max(3, Math.floor(item.order.length * 0.16)))) selected.push(item);
    if (selected.length >= limit) break;
  }
  for (const item of sorted) {
    if (selected.length >= limit) break;
    if (!selected.some((s) => s.order.join(",") === item.order.join(","))) selected.push(item);
  }
  return selected;
}
function getSuggestions(order: number[], costs: Costs, rows: number, cols: number, tiles: Tile[]): Suggestion[] {
  if (!order.length) return [];
  const current = boardScore(order, costs, rows, cols, tiles), options: Suggestion[] = [];
  for (let a = 0; a < order.length; a++) for (let b = a + 1; b < order.length; b++) {
    const candidate = order.slice(); [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
    const delta = current - boardScore(candidate, costs, rows, cols, tiles);
    if (delta > -Math.abs(current) * 0.018) {
      const ar = Math.floor(a / cols) + 1, ac = a % cols + 1, br = Math.floor(b / cols) + 1, bc = b % cols + 1;
      options.push({ a, b, delta, reason: `Swap row ${ar}, column ${ac} with row ${br}, column ${bc}.` });
    }
  }
  return options.sort((x, y) => y.delta - x.delta).slice(0, 8);
}
async function renderBoard(tiles: Tile[], order: number[], rows: number, cols: number, tileW: number, tileH: number) {
  const canvas = document.createElement("canvas"); canvas.width = cols * tileW; canvas.height = rows * tileH;
  const ctx = canvas.getContext("2d"); if (!ctx) return "";
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
  const [baseOrder, setBaseOrder] = useState<number[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [activeCandidate, setActiveCandidate] = useState(0);
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
    setError(""); setResult(""); setOrder([]); setBaseOrder([]); setCandidates([]); setCosts(null); setSelected(null);
    setSource(await readFile(file)); setName(file.name);
  }
  async function solve() {
    if (!source) return setError("Upload the shuffled puzzle first.");
    setSolving(true); setError(""); setProgress(0); setStage("Extracting objects");
    try {
      const extracted = await extractTiles(source, rows, cols, gutter);
      setTiles(extracted.tiles); setSize({ w: extracted.tileW, h: extracted.tileH });
      setStage("Building object-aware compatibility map");
      const nextCosts = buildCosts(extracted.tiles); setCosts(nextCosts); setProgress(8); await wait();
      setStage("Generating different full-board options");
      const starts = await beamSolve(nextCosts, rows, cols, deep, setProgress);
      const refined: { order: number[]; score: number }[] = [];
      for (let i = 0; i < starts.length; i++) {
        refined.push(await refine(starts[i], nextCosts, extracted.tiles, rows, cols, deep));
        setProgress(65 + Math.round((i + 1) / starts.length * 30));
      }
      const diverse = chooseDiverse(refined, 6);
      const rendered: Candidate[] = [];
      for (let i = 0; i < diverse.length; i++) rendered.push({ ...diverse[i], image: await renderBoard(extracted.tiles, diverse[i].order, rows, cols, extracted.tileW, extracted.tileH), label: `Option ${i + 1}` });
      if (!rendered.length) throw new Error("No candidate layouts were generated.");
      setCandidates(rendered); setActiveCandidate(0); setOrder(rendered[0].order); setBaseOrder(rendered[0].order); setResult(rendered[0].image); setSelected(null);
      setProgress(100); setStage("Choose the closest option, then make manual corrections");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Object solve failed."); }
    finally { setSolving(false); }
  }
  async function chooseCandidate(index: number) {
    const candidate = candidates[index]; if (!candidate) return;
    setActiveCandidate(index); setOrder(candidate.order); setBaseOrder(candidate.order); setResult(candidate.image); setSelected(null);
  }
  async function tapTile(index: number) {
    if (selected === null) return setSelected(index);
    if (selected === index) return setSelected(null);
    const next = order.slice(); [next[selected], next[index]] = [next[index], next[selected]];
    setSelected(null); setOrder(next); setResult(await renderBoard(tiles, next, rows, cols, size.w, size.h));
  }
  async function applySuggestion(s: Suggestion) {
    const next = order.slice(); [next[s.a], next[s.b]] = [next[s.b], next[s.a]];
    setOrder(next); setSelected(null); setResult(await renderBoard(tiles, next, rows, cols, size.w, size.h));
  }
  async function resetToCandidate() {
    setOrder(baseOrder); setSelected(null); setResult(await renderBoard(tiles, baseOrder, rows, cols, size.w, size.h));
  }

  return <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6"><div className="mx-auto max-w-6xl space-y-5">
    <Link to="/menu" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16}/> Main menu</Link>
    <Card className="tracker-card space-y-5 p-5 sm:p-7">
      <div className="flex items-start gap-4"><div className="tracker-avatar"><Brain/></div><div><p className="eyebrow"><span/> OBJECT-AWARE SOLVER</p><h1 className="text-2xl font-semibold sm:text-3xl">Pet and object puzzle solver</h1><p className="mt-2 text-sm text-muted-foreground">Generates several genuinely different layouts instead of pretending one score is always correct. Pick the closest result, then use manual swap suggestions.</p></div></div>
      <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-card/40 p-5 text-center hover:border-primary/50"><input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e)=>void upload(e.target.files?.[0])}/><ImagePlus className="mx-auto mb-2"/><span className="font-medium">Upload shuffled puzzle</span></label>
      {source && <img src={source} alt="Puzzle" className="max-h-[480px] w-full rounded-xl border border-white/10 object-contain"/>}
      <div className="grid gap-3 sm:grid-cols-4"><div><label className="mb-2 block text-sm">Rows</label><Input type="number" min={2} max={10} value={rows} onChange={(e)=>setRows(Math.max(2,Math.min(10,Number(e.target.value)||2)))}/></div><div><label className="mb-2 block text-sm">Columns</label><Input type="number" min={2} max={10} value={cols} onChange={(e)=>setCols(Math.max(2,Math.min(10,Number(e.target.value)||2)))}/></div><div><label className="mb-2 block text-sm">Grid gutter %</label><Input type="number" min={0} max={10} step={0.1} value={gutter} onChange={(e)=>setGutter(Math.max(0,Math.min(10,Number(e.target.value)||0)))}/></div><label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={deep} onChange={(e)=>setDeep(e.target.checked)}/><Gauge size={15}/> Maximum object search</label></div>
      <Button onClick={solve} disabled={solving || !source} className="metal-button h-12 w-full rounded-xl">{solving?<LoaderCircle className="animate-spin"/>:<Sparkles/>}{solving?`${stage} · ${progress}%`:"Generate multiple options"}</Button>
      {error && <p className="error-copy">{error}</p>}
      {!!tiles.length && <p className="status-pill status-healthy">Detected object content in {objectTiles} of {tiles.length} tiles</p>}
      {!!candidates.length && <section className="space-y-5">
        <Card className="space-y-3 p-4"><p className="panel-label">CHOOSE THE CLOSEST RESULT</p><p className="text-xs text-muted-foreground">The first option has the best computer score, but another option may look more correct. Tap one to use it.</p><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{candidates.map((c,i)=><button key={c.label} type="button" onClick={()=>void chooseCandidate(i)} className={`rounded-xl border p-2 text-left transition ${activeCandidate===i?"border-primary ring-2 ring-primary/30":"border-white/10 hover:border-white/30"}`}><img src={c.image} alt={c.label} className="w-full rounded-lg"/><div className="mt-2 flex items-center justify-between"><span className="text-sm font-medium">{c.label}</span><span className="text-[11px] text-muted-foreground">Score {c.score.toFixed(0)}</span></div></button>)}</div></Card>
        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="space-y-3"><div className="grid overflow-hidden rounded-xl border border-white/10" style={{gridTemplateColumns:`repeat(${cols},minmax(0,1fr))`}}>{order.map((id,index)=><button type="button" key={`slot-${index}`} onClick={()=>void tapTile(index)} className={`relative aspect-square overflow-hidden border border-black/30 transition-all ${selected===index?"z-10 ring-4 ring-primary ring-inset":""}`}><img src={tiles[id]?.url} alt={`Tile ${id+1}`} className="h-full w-full object-fill"/><span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">{index+1}</span></button>)}</div><p className="text-xs text-muted-foreground">Tap any two tiles to swap them. Numbers show board positions.</p><Button variant="outline" onClick={()=>void resetToCandidate()}><Undo2 size={15}/> Reset to selected option</Button></div>
          <div className="space-y-4"><Card className="space-y-3 p-4"><p className="panel-label">SUGGESTED MANUAL CHECKS</p>{suggestions.length?suggestions.map((s,i)=><div key={`${s.a}-${s.b}`} className="rounded-lg border border-white/10 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">Suggestion {i+1}</p><p className="mt-1 text-xs text-muted-foreground">{s.reason}</p><p className="mt-1 text-[11px] text-muted-foreground">Computer estimate: {s.delta>=0?"likely improvement":"visual alternative"} ({s.delta.toFixed(1)})</p></div><Button size="sm" variant="outline" onClick={()=>void applySuggestion(s)}><WandSparkles size={14}/> Try</Button></div></div>):<p className="text-sm text-muted-foreground">No useful swap suggestions remain. Try another candidate or tap two tiles manually.</p>}</Card>{result&&<Card className="space-y-3 p-4"><p className="panel-label">CURRENT RESULT</p><img src={result} alt="Solved result" className="w-full rounded-lg border border-white/10"/><a href={result} download={`object-solved-${name||"puzzle"}.png`}><Button variant="outline" className="w-full">Save result PNG</Button></a></Card>}</div>
        </div>
      </section>}
    </Card>
  </div></main>;
}
