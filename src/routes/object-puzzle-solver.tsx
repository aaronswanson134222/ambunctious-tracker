import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Brain, Download, Gauge, ImagePlus, LoaderCircle, RotateCcw, Sparkles, Upload, WandSparkles } from "lucide-react";
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
  centroid: [number, number];
  edgeDensity: number;
  signature: string;
};
type Direction = "right" | "down";
type PairCosts = { right: number[][]; down: number[][] };
type EngineWeights = { colour: number; mask: number; gradient: number; object: number; centroid: number; compactness: number };
type EngineResult = { order: number[]; score: number; engine: number; costs: PairCosts };
type Candidate = { order: number[]; score: number; label: string; confidence: number[]; preview: string };
type Suggestion = { a: number; b: number; gain: number; reason: string };
type LearningProfile = {
  version: 1;
  correctionCount: number;
  acceptedNeighbourPairs: Record<string, number>;
  rejectedNeighbourPairs: Record<string, number>;
  adjustments: EngineWeights;
  lastUpdated: number;
};
type PendingCorrection = { before: number[]; after: number[] } | null;

const wait = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const PROFILE_KEY = "hybrid-puzzle-learning-v1";
const BASE_ADJUSTMENTS: EngineWeights = { colour: 1, mask: 1, gradient: 1, object: 1, centroid: 1, compactness: 1 };
const ENGINES: { label: string; weights: EngineWeights }[] = [
  { label: "Balanced consensus", weights: { colour: .42, mask: 1.2, gradient: .55, object: 1, centroid: .55, compactness: 1 } },
  { label: "Object-first", weights: { colour: .25, mask: 1.45, gradient: .35, object: 1.55, centroid: .8, compactness: 1.5 } },
  { label: "Edge-first", weights: { colour: .65, mask: .85, gradient: .9, object: .55, centroid: .25, compactness: .45 } },
  { label: "Shape-first", weights: { colour: .28, mask: 1.65, gradient: .75, object: .9, centroid: 1.05, compactness: 1.1 } },
  { label: "Background-aware", weights: { colour: .52, mask: 1.5, gradient: .5, object: .65, centroid: .35, compactness: .7 } },
];

function emptyProfile(): LearningProfile {
  return { version: 1, correctionCount: 0, acceptedNeighbourPairs: {}, rejectedNeighbourPairs: {}, adjustments: { ...BASE_ADJUSTMENTS }, lastUpdated: 0 };
}
function loadProfile(): LearningProfile {
  try {
    const value = JSON.parse(localStorage.getItem(PROFILE_KEY) || "null") as Partial<LearningProfile> | null;
    if (!value || value.version !== 1) return emptyProfile();
    return {
      version: 1,
      correctionCount: Number(value.correctionCount) || 0,
      acceptedNeighbourPairs: value.acceptedNeighbourPairs || {},
      rejectedNeighbourPairs: value.rejectedNeighbourPairs || {},
      adjustments: { ...BASE_ADJUSTMENTS, ...(value.adjustments || {}) },
      lastUpdated: Number(value.lastUpdated) || 0,
    };
  } catch { return emptyProfile(); }
}
function saveProfile(profile: LearningProfile) { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
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
  const samples: number[][] = [];
  const stepX = Math.max(1, Math.floor(image.width / 24));
  const stepY = Math.max(1, Math.floor(image.height / 24));
  for (let y = 0; y < image.height; y += stepY) for (let x = 0; x < image.width; x += stepX) {
    if (x < image.width * .16 || x > image.width * .84 || y < image.height * .16 || y > image.height * .84) samples.push([...rgb(image.data, image.width, x, y)]);
  }
  const median = (i: number) => samples.map((s) => s[i]).sort((a, b) => a - b)[Math.floor(samples.length / 2)] || 0;
  return [median(0), median(1), median(2)];
}
function buildMask(image: ImageData, background: [number, number, number]) {
  const mask = new Uint8Array(image.width * image.height);
  let count = 0, sr = 0, sg = 0, sb = 0, sx = 0, sy = 0, edgeCount = 0;
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    const c = rgb(image.data, image.width, x, y);
    const saturation = Math.max(...c) - Math.min(...c);
    if (colourDistance(c, background) <= 23 && saturation <= 31) continue;
    mask[y * image.width + x] = 1;
    count++; sr += c[0]; sg += c[1]; sb += c[2]; sx += x; sy += y;
  }
  for (let y = 1; y < image.height - 1; y++) for (let x = 1; x < image.width - 1; x++) {
    const m = mask[y * image.width + x];
    if (m && (!mask[y * image.width + x - 1] || !mask[y * image.width + x + 1] || !mask[(y - 1) * image.width + x] || !mask[(y + 1) * image.width + x])) edgeCount++;
  }
  const colour: [number, number, number] = [sr / Math.max(1, count), sg / Math.max(1, count), sb / Math.max(1, count)];
  const foregroundRatio = count / Math.max(1, image.width * image.height);
  const centroid: [number, number] = [sx / Math.max(1, count) / image.width, sy / Math.max(1, count) / image.height];
  const edgeDensity = edgeCount / Math.max(1, count);
  const signature = [Math.round(colour[0] / 24), Math.round(colour[1] / 24), Math.round(colour[2] / 24), Math.round(foregroundRatio * 10), Math.round(centroid[0] * 5), Math.round(centroid[1] * 5), Math.round(edgeDensity * 10)].join(".");
  return { mask, foregroundRatio, colour, centroid, edgeDensity, signature };
}
async function extractTiles(src: string, rows: number, cols: number, gutterPercent: number) {
  const image = await loadImage(src);
  const cellW = image.naturalWidth / cols, cellH = image.naturalHeight / rows;
  const gutter = Math.max(0, Math.round(Math.min(cellW, cellH) * gutterPercent / 100));
  const tileW = Math.max(20, Math.floor(cellW - gutter * 2));
  const tileH = Math.max(20, Math.floor(cellH - gutter * 2));
  const raw: { url: string; pixels: ImageData }[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const canvas = document.createElement("canvas"); canvas.width = tileW; canvas.height = tileH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas is unavailable.");
    ctx.drawImage(image, c * cellW + gutter, r * cellH + gutter, tileW, tileH, 0, 0, tileW, tileH);
    raw.push({ url: canvas.toDataURL("image/png"), pixels: ctx.getImageData(0, 0, tileW, tileH) });
  }
  const backgrounds = raw.map((t) => estimateBackground(t.pixels));
  const median = (i: number) => backgrounds.map((v) => v[i]).sort((a, b) => a - b)[Math.floor(backgrounds.length / 2)] || 0;
  const background: [number, number, number] = [median(0), median(1), median(2)];
  return { tiles: raw.map((t) => ({ ...t, ...buildMask(t.pixels, background) })), tileW, tileH };
}
function rawSeam(a: Tile, b: Tile, direction: Direction) {
  const w = a.pixels.width, h = a.pixels.height, length = direction === "right" ? h : w;
  const depth = Math.max(4, Math.min(12, Math.floor(Math.min(w, h) / 10)));
  let colour = 0, mask = 0, gradient = 0, object = 0;
  for (let p = 1; p < length - 1; p++) for (let d = 0; d < depth; d++) {
    const ax = direction === "right" ? w - 1 - d : p, ay = direction === "right" ? p : h - 1 - d;
    const bx = direction === "right" ? d : p, by = direction === "right" ? p : d;
    const ca = rgb(a.pixels.data, w, ax, ay), cb = rgb(b.pixels.data, w, bx, by);
    const ma = a.mask[ay * w + ax], mb = b.mask[by * w + bx], weight = 1 / (d + 1);
    colour += colourDistance(ca, cb) * weight;
    mask += Math.abs(ma - mb) * 90 * weight;
    if (d + 1 < depth) {
      const ca2 = rgb(a.pixels.data, w, direction === "right" ? ax - 1 : ax, direction === "right" ? ay : ay - 1);
      const cb2 = rgb(b.pixels.data, w, direction === "right" ? bx + 1 : bx, direction === "right" ? by : by + 1);
      gradient += Math.abs(colourDistance(ca, ca2) - colourDistance(cb2, cb)) * weight;
    }
    if (ma && mb) object += Math.max(0, 85 - colourDistance(ca, cb)) * weight;
  }
  const similarity = Math.max(0, 100 - colourDistance(a.colour, b.colour)) * Math.min(a.foregroundRatio, b.foregroundRatio);
  const centroid = direction === "right" ? Math.abs((1 - a.centroid[0]) - b.centroid[0]) : Math.abs((1 - a.centroid[1]) - b.centroid[1]);
  return { colour, mask, gradient, object: object + similarity * 10, centroid: centroid * 220 * Math.min(a.foregroundRatio, b.foregroundRatio) };
}
function pairKey(a: Tile, b: Tile, direction: Direction) { return `${direction}:${a.signature}>${b.signature}`; }
function learnedPairAdjustment(a: Tile, b: Tile, direction: Direction, profile: LearningProfile) {
  const key = pairKey(a, b, direction);
  return (profile.rejectedNeighbourPairs[key] || 0) * 90 - (profile.acceptedNeighbourPairs[key] || 0) * 90;
}
function adjustedWeights(base: EngineWeights, profile: LearningProfile): EngineWeights {
  return {
    colour: base.colour * profile.adjustments.colour,
    mask: base.mask * profile.adjustments.mask,
    gradient: base.gradient * profile.adjustments.gradient,
    object: base.object * profile.adjustments.object,
    centroid: base.centroid * profile.adjustments.centroid,
    compactness: base.compactness * profile.adjustments.compactness,
  };
}
function buildCosts(tiles: Tile[], weights: EngineWeights, profile: LearningProfile): PairCosts {
  const n = tiles.length;
  const right = Array.from({ length: n }, () => Array(n).fill(Infinity));
  const down = Array.from({ length: n }, () => Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) for (const direction of ["right", "down"] as const) {
    const f = rawSeam(tiles[i], tiles[j], direction);
    const score = f.colour * weights.colour + f.mask * weights.mask + f.gradient * weights.gradient - f.object * weights.object + f.centroid * weights.centroid + learnedPairAdjustment(tiles[i], tiles[j], direction, profile);
    (direction === "right" ? right : down)[i][j] = score;
  }
  return { right, down };
}
function boardScore(order: number[], costs: PairCosts, rows: number, cols: number, tiles: Tile[], compactness = 1) {
  let score = 0;
  for (let i = 0; i < order.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    if (c < cols - 1) score += costs.right[order[i]][order[i + 1]];
    if (r < rows - 1) score += costs.down[order[i]][order[i + cols]];
  }
  for (let i = 0; i < order.length; i++) {
    const t = tiles[order[i]]; if (t.foregroundRatio < .04) continue;
    let nearest = Infinity;
    for (let j = 0; j < order.length; j++) if (i !== j) {
      const u = tiles[order[j]]; if (colourDistance(t.colour, u.colour) > 74) continue;
      const distance = Math.abs(Math.floor(i / cols) - Math.floor(j / cols)) + Math.abs(i % cols - j % cols);
      nearest = Math.min(nearest, distance + Math.abs(t.edgeDensity - u.edgeDensity) * .35);
    }
    if (Number.isFinite(nearest)) score += Math.max(0, nearest - 1) * t.foregroundRatio * 1350 * compactness;
  }
  return score;
}
async function beamSolve(costs: PairCosts, rows: number, cols: number, deep: boolean, progress: (value: number) => void, offset: number, span: number) {
  const n = rows * cols, width = deep ? 3600 : 1350, branch = deep ? 16 : 9;
  let beam: { order: number[]; used: bigint; cost: number }[] = [{ order: [], used: 0n, cost: 0 }];
  for (let pos = 0; pos < n; pos++) {
    const r = Math.floor(pos / cols), c = pos % cols, next: typeof beam = [];
    for (const state of beam) {
      const options: { tile: number; cost: number }[] = [];
      for (let tile = 0; tile < n; tile++) if (!(state.used & (1n << BigInt(tile)))) {
        let add = 0;
        if (c > 0) add += costs.right[state.order[pos - 1]][tile];
        if (r > 0) add += costs.down[state.order[pos - cols]][tile];
        options.push({ tile, cost: add });
      }
      options.sort((a, b) => a.cost - b.cost);
      for (const option of options.slice(0, branch)) next.push({ order: [...state.order, option.tile], used: state.used | (1n << BigInt(option.tile)), cost: state.cost + option.cost });
    }
    next.sort((a, b) => a.cost - b.cost); beam = next.slice(0, width);
    progress(Math.round(offset + ((pos + 1) / n) * span));
    if (pos % 2 === 0) await wait();
  }
  return beam.slice(0, deep ? 8 : 4).map((state) => state.order);
}
async function localRefine(start: number[], costs: PairCosts, tiles: Tile[], rows: number, cols: number, compactness: number, rounds: number, allowed?: Set<number>) {
  let order = start.slice(), score = boardScore(order, costs, rows, cols, tiles, compactness);
  for (let round = 0; round < rounds; round++) {
    let bestOrder: number[] | null = null, bestScore = score;
    for (let a = 0; a < order.length; a++) {
      if (allowed && !allowed.has(a)) continue;
      for (let b = a + 1; b < order.length; b++) {
        if (allowed && !allowed.has(b)) continue;
        const candidate = order.slice(); [candidate[a], candidate[b]] = [candidate[b], candidate[a]];
        const nextScore = boardScore(candidate, costs, rows, cols, tiles, compactness);
        if (nextScore < bestScore) { bestScore = nextScore; bestOrder = candidate; }
      }
    }
    if (!bestOrder) break;
    order = bestOrder; score = bestScore;
    await wait();
  }
  return { order, score };
}
function boardDistance(a: number[], b: number[]) {
  let different = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
  return different / Math.max(1, a.length);
}
function localCost(order: number[], position: number, costs: PairCosts, rows: number, cols: number) {
  const r = Math.floor(position / cols), c = position % cols, tile = order[position]; let score = 0;
  if (c > 0) score += costs.right[order[position - 1]][tile];
  if (c < cols - 1) score += costs.right[tile][order[position + 1]];
  if (r > 0) score += costs.down[order[position - cols]][tile];
  if (r < rows - 1) score += costs.down[tile][order[position + cols]];
  return score;
}
function mutate(order: number[], costs: PairCosts, rows: number, cols: number) {
  const child = order.slice();
  const suspicious = child.map((_, i) => ({ i, cost: localCost(child, i, costs, rows, cols) })).sort((a, b) => b.cost - a.cost).slice(0, Math.min(10, child.length));
  const pick = () => suspicious[Math.floor(Math.random() * suspicious.length)]?.i ?? Math.floor(Math.random() * child.length);
  const kind = Math.random();
  if (kind < .72) {
    const a = pick(), b = Math.random() < .72 ? pick() : Math.floor(Math.random() * child.length);
    [child[a], child[b]] = [child[b], child[a]];
  } else if (kind < .88) {
    const row = Math.floor(Math.random() * rows), shift = 1 + Math.floor(Math.random() * Math.max(1, cols - 1));
    const start = row * cols, segment = child.slice(start, start + cols);
    const moved = [...segment.slice(shift), ...segment.slice(0, shift)];
    child.splice(start, cols, ...moved);
  } else {
    const a = Math.floor(Math.random() * child.length), b = Math.floor(Math.random() * child.length);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    child.splice(lo, hi - lo + 1, ...child.slice(lo, hi + 1).reverse());
  }
  return child;
}
async function evolve(seeds: EngineResult[], tiles: Tile[], rows: number, cols: number, deep: boolean, stage: (value: string) => void, progress: (value: number) => void) {
  const generations = deep ? 10 : 5, populationSize = deep ? 34 : 20;
  let population = seeds.slice(0, populationSize);
  for (let generation = 0; generation < generations; generation++) {
    stage(`Evolution generation ${generation + 1} of ${generations}`);
    population.sort((a, b) => a.score - b.score);
    const elites = population.slice(0, Math.max(5, Math.floor(populationSize * .28)));
    const children: EngineResult[] = [...elites];
    while (children.length < populationSize * 2) {
      const parent = elites[Math.floor(Math.random() * elites.length)];
      const changed = mutate(parent.order, parent.costs, rows, cols);
      const refined = await localRefine(changed, parent.costs, tiles, rows, cols, ENGINES[parent.engine].weights.compactness, deep ? 5 : 3);
      children.push({ ...refined, engine: parent.engine, costs: parent.costs });
      if (children.length % 5 === 0) await wait();
    }
    children.sort((a, b) => a.score - b.score);
    const diverse: EngineResult[] = [];
    for (const candidate of children) {
      if (diverse.every((existing) => boardDistance(existing.order, candidate.order) > .075)) diverse.push(candidate);
      if (diverse.length >= populationSize) break;
    }
    population = diverse.length >= 5 ? diverse : children.slice(0, populationSize);
    progress(80 + Math.round(((generation + 1) / generations) * 17));
  }
  return population;
}
function neighbourKey(order: number[], index: number, rows: number, cols: number) {
  const r = Math.floor(index / cols), c = index % cols, values: number[] = [];
  if (c > 0) values.push(order[index - 1]); if (c < cols - 1) values.push(order[index + 1]);
  if (r > 0) values.push(order[index - cols]); if (r < rows - 1) values.push(order[index + cols]);
  return values;
}
function confidenceFor(order: number[], pool: number[][], rows: number, cols: number) {
  return order.map((tile, position) => {
    let positionVotes = 0, neighbourVotes = 0, neighbourTotal = 0;
    const expected = new Set(neighbourKey(order, position, rows, cols));
    for (const candidate of pool) {
      if (candidate[position] === tile) positionVotes++;
      const candidatePosition = candidate.indexOf(tile);
      if (candidatePosition < 0) continue;
      for (const neighbour of neighbourKey(candidate, candidatePosition, rows, cols)) { neighbourTotal++; if (expected.has(neighbour)) neighbourVotes++; }
    }
    return Math.round(clamp((positionVotes / Math.max(1, pool.length) * .5 + neighbourVotes / Math.max(1, neighbourTotal) * .5) * 100, 8, 99));
  });
}
function normalisedRank(results: EngineResult[]) {
  const byEngine = new Map<number, EngineResult[]>();
  for (const result of results) byEngine.set(result.engine, [...(byEngine.get(result.engine) || []), result]);
  const ranks = new Map<EngineResult, number>();
  for (const group of byEngine.values()) {
    group.sort((a, b) => a.score - b.score);
    group.forEach((value, index) => ranks.set(value, index / Math.max(1, group.length - 1)));
  }
  return ranks;
}
function candidateConsensusScore(candidate: EngineResult, all: EngineResult[], rank: Map<EngineResult, number>) {
  const close = all.filter((other) => boardDistance(candidate.order, other.order) < .26).length / Math.max(1, all.length);
  return (rank.get(candidate) || 0) * .62 + (1 - close) * .38;
}
async function renderBoard(tiles: Tile[], order: number[], rows: number, cols: number, tileW: number, tileH: number) {
  const canvas = document.createElement("canvas"); canvas.width = cols * tileW; canvas.height = rows * tileH;
  const ctx = canvas.getContext("2d"); if (!ctx) return "";
  const images = await Promise.all(order.map((id) => loadImage(tiles[id].url)));
  images.forEach((image, index) => ctx.drawImage(image, (index % cols) * tileW, Math.floor(index / cols) * tileH));
  return canvas.toDataURL("image/png");
}
function suggestionsFor(order: number[], costs: PairCosts, tiles: Tile[], rows: number, cols: number, confidence: number[]) {
  const current = boardScore(order, costs, rows, cols, tiles, 1);
  const suspicious = confidence.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value).slice(0, Math.min(8, order.length)).map((entry) => entry.index);
  const suggestions: Suggestion[] = [];
  for (const a of suspicious) for (let b = 0; b < order.length; b++) if (a !== b) {
    const next = order.slice(); [next[a], next[b]] = [next[b], next[a]];
    const gain = current - boardScore(next, costs, rows, cols, tiles, 1);
    const ar = Math.floor(a / cols) + 1, ac = a % cols + 1, br = Math.floor(b / cols) + 1, bc = b % cols + 1;
    suggestions.push({ a, b, gain, reason: `Swap row ${ar}, column ${ac} with row ${br}, column ${bc}` });
  }
  const unique = new Map<string, Suggestion>();
  for (const suggestion of suggestions.sort((a, b) => b.gain - a.gain)) {
    const key = [suggestion.a, suggestion.b].sort((a, b) => a - b).join("-"); if (!unique.has(key)) unique.set(key, suggestion);
  }
  return [...unique.values()].slice(0, 6);
}
function adjacencySet(order: number[], tiles: Tile[], rows: number, cols: number) {
  const values = new Set<string>();
  for (let i = 0; i < order.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    if (c < cols - 1) values.add(pairKey(tiles[order[i]], tiles[order[i + 1]], "right"));
    if (r < rows - 1) values.add(pairKey(tiles[order[i]], tiles[order[i + cols]], "down"));
  }
  return values;
}
function seamTotals(order: number[], tiles: Tile[], rows: number, cols: number) {
  const totals = { colour: 0, mask: 0, gradient: 0, object: 0, centroid: 0 };
  for (let i = 0; i < order.length; i++) {
    const r = Math.floor(i / cols), c = i % cols;
    for (const [j, direction] of [[i + 1, "right"], [i + cols, "down"]] as const) {
      if ((direction === "right" && c >= cols - 1) || (direction === "down" && r >= rows - 1)) continue;
      const f = rawSeam(tiles[order[i]], tiles[order[j]], direction);
      totals.colour += f.colour; totals.mask += f.mask; totals.gradient += f.gradient; totals.object += f.object; totals.centroid += f.centroid;
    }
  }
  return totals;
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
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [activeCandidate, setActiveCandidate] = useState(0);
  const [order, setOrder] = useState<number[]>([]);
  const [baseOrder, setBaseOrder] = useState<number[]>([]);
  const [confidence, setConfidence] = useState<number[]>([]);
  const [costs, setCosts] = useState<PairCosts | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [solving, setSolving] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<LearningProfile>(() => loadProfile());
  const [pendingCorrection, setPendingCorrection] = useState<PendingCorrection>(null);

  const objectTiles = useMemo(() => tiles.filter((tile) => tile.foregroundRatio > .04).length, [tiles]);
  const suggestions = useMemo(() => costs ? suggestionsFor(order, costs, tiles, rows, cols, confidence) : [], [order, costs, tiles, rows, cols, confidence]);

  async function upload(file?: File) {
    if (!file) return;
    setError(""); setResult(""); setCandidates([]); setOrder([]); setBaseOrder([]); setSelected(null); setCosts(null); setPendingCorrection(null);
    setSource(await readFile(file)); setName(file.name);
  }
  async function finishCandidates(results: EngineResult[], extractedTiles: Tile[], tileW: number, tileH: number) {
    const ranks = normalisedRank(results);
    const sorted = [...results].sort((a, b) => candidateConsensusScore(a, results, ranks) - candidateConsensusScore(b, results, ranks));
    const diverse: EngineResult[] = [];
    for (const candidate of sorted) {
      if (diverse.every((existing) => boardDistance(candidate.order, existing.order) > .1)) diverse.push(candidate);
      if (diverse.length >= 8) break;
    }
    const pool = sorted.slice(0, Math.min(36, sorted.length)).map((candidate) => candidate.order);
    const finished: Candidate[] = [];
    for (let i = 0; i < diverse.length; i++) {
      const candidate = diverse[i];
      finished.push({ order: candidate.order, score: candidateConsensusScore(candidate, results, ranks), label: `${ENGINES[candidate.engine].label} + evolution`, confidence: confidenceFor(candidate.order, pool, rows, cols), preview: await renderBoard(extractedTiles, candidate.order, rows, cols, tileW, tileH) });
    }
    return { finished, primaryCosts: diverse[0]?.costs || results[0].costs };
  }
  async function solve() {
    if (!source) return setError("Upload the shuffled puzzle first.");
    setSolving(true); setError(""); setProgress(0); setStage("Extracting object, edge and shape features"); setPendingCorrection(null);
    try {
      const extracted = await extractTiles(source, rows, cols, gutter);
      setTiles(extracted.tiles); setSize({ w: extracted.tileW, h: extracted.tileH });
      const raw: EngineResult[] = [];
      for (let engine = 0; engine < ENGINES.length; engine++) {
        setStage(`Running ${ENGINES[engine].label}`);
        const weights = adjustedWeights(ENGINES[engine].weights, profile);
        const engineCosts = buildCosts(extracted.tiles, weights, profile);
        const starts = await beamSolve(engineCosts, rows, cols, deep, setProgress, engine / ENGINES.length * 78, 78 / ENGINES.length);
        for (const start of starts.slice(0, deep ? 5 : 3)) {
          const refined = await localRefine(start, engineCosts, extracted.tiles, rows, cols, weights.compactness, deep ? 24 : 10);
          raw.push({ ...refined, engine, costs: engineCosts });
        }
      }
      const evolved = await evolve(raw, extracted.tiles, rows, cols, deep, setStage, setProgress);
      const combined = [...raw, ...evolved];
      setStage("Ranking consensus across engines and generations");
      const { finished, primaryCosts } = await finishCandidates(combined, extracted.tiles, extracted.tileW, extracted.tileH);
      if (!finished.length) throw new Error("No complete puzzle layouts were generated.");
      const primary = finished[0];
      setCandidates(finished); setActiveCandidate(0); setOrder(primary.order); setBaseOrder(primary.order); setConfidence(primary.confidence);
      setCosts(primaryCosts); setResult(primary.preview); setSelected(null); setProgress(100); setStage("Adaptive hybrid solve complete");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Hybrid solve failed."); }
    finally { setSolving(false); }
  }
  async function focusedResolve() {
    if (!costs || !order.length) return;
    setSolving(true); setError(""); setStage("Focused re-solve of uncertain tiles"); setProgress(5); setPendingCorrection(null);
    try {
      const count = Math.min(order.length, Math.max(4, deep ? 10 : 7));
      const unlocked = new Set(confidence.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value).slice(0, count).map((x) => x.index));
      const attempts: EngineResult[] = [];
      for (let i = 0; i < (deep ? 28 : 14); i++) {
        let mutated = order.slice();
        const positions = [...unlocked];
        for (let j = 0; j < 1 + Math.floor(Math.random() * 3); j++) {
          const a = positions[Math.floor(Math.random() * positions.length)], b = positions[Math.floor(Math.random() * positions.length)];
          [mutated[a], mutated[b]] = [mutated[b], mutated[a]];
        }
        const refined = await localRefine(mutated, costs, tiles, rows, cols, 1, deep ? 16 : 8, unlocked);
        attempts.push({ ...refined, engine: 0, costs });
        setProgress(5 + Math.round((i + 1) / (deep ? 28 : 14) * 90));
      }
      const merged = attempts.sort((a, b) => a.score - b.score);
      const pool = merged.map((x) => x.order);
      const newCandidates: Candidate[] = [];
      for (const item of merged) {
        if (newCandidates.every((existing) => boardDistance(existing.order, item.order) > .08)) newCandidates.push({ order: item.order, score: item.score, label: "Focused uncertain-tile search", confidence: confidenceFor(item.order, pool, rows, cols), preview: await renderBoard(tiles, item.order, rows, cols, size.w, size.h) });
        if (newCandidates.length >= 6) break;
      }
      if (newCandidates.length) {
        const primary = newCandidates[0]; setCandidates(newCandidates); setActiveCandidate(0); setOrder(primary.order); setBaseOrder(primary.order); setConfidence(primary.confidence); setResult(primary.preview);
      }
      setProgress(100); setStage("Focused re-solve complete");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Focused re-solve failed."); }
    finally { setSolving(false); }
  }
  async function chooseCandidate(index: number) {
    const candidate = candidates[index]; if (!candidate) return;
    setActiveCandidate(index); setOrder(candidate.order); setBaseOrder(candidate.order); setConfidence(candidate.confidence); setResult(candidate.preview); setSelected(null); setPendingCorrection(null);
  }
  async function swapTiles(a: number, b: number) {
    const before = order.slice(), after = order.slice(); [after[a], after[b]] = [after[b], after[a]];
    setOrder(after); setSelected(null); setPendingCorrection({ before, after }); setResult(await renderBoard(tiles, after, rows, cols, size.w, size.h));
  }
  async function tapTile(index: number) {
    if (selected === null) return setSelected(index);
    if (selected === index) return setSelected(null);
    await swapTiles(selected, index);
  }
  function confirmCorrection() {
    if (!pendingCorrection) return;
    const beforePairs = adjacencySet(pendingCorrection.before, tiles, rows, cols), afterPairs = adjacencySet(pendingCorrection.after, tiles, rows, cols);
    const next: LearningProfile = JSON.parse(JSON.stringify(profile));
    for (const key of afterPairs) if (!beforePairs.has(key)) next.acceptedNeighbourPairs[key] = clamp((next.acceptedNeighbourPairs[key] || 0) + 1, 0, 8);
    for (const key of beforePairs) if (!afterPairs.has(key)) next.rejectedNeighbourPairs[key] = clamp((next.rejectedNeighbourPairs[key] || 0) + 1, 0, 8);
    const before = seamTotals(pendingCorrection.before, tiles, rows, cols), after = seamTotals(pendingCorrection.after, tiles, rows, cols);
    for (const key of ["colour", "mask", "gradient", "centroid"] as const) {
      const improved = after[key] < before[key];
      next.adjustments[key] = clamp(next.adjustments[key] * (improved ? 1.012 : .994), .72, 1.32);
    }
    next.adjustments.object = clamp(next.adjustments.object * (after.object > before.object ? 1.012 : .994), .72, 1.32);
    next.adjustments.compactness = clamp(next.adjustments.compactness, .72, 1.32);
    next.correctionCount++; next.lastUpdated = Date.now();
    saveProfile(next); setProfile(next); setBaseOrder(pendingCorrection.after); setPendingCorrection(null);
  }
  async function undoPending() {
    if (!pendingCorrection) return;
    setOrder(pendingCorrection.before); setResult(await renderBoard(tiles, pendingCorrection.before, rows, cols, size.w, size.h)); setPendingCorrection(null);
  }
  async function resetCandidate() {
    setOrder(baseOrder); setSelected(null); setPendingCorrection(null); setResult(await renderBoard(tiles, baseOrder, rows, cols, size.w, size.h));
  }
  function resetLearning() { const next = emptyProfile(); saveProfile(next); setProfile(next); }
  function exportLearning() {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "puzzle-learning-profile.json"; a.click(); URL.revokeObjectURL(url);
  }
  async function importLearning(file?: File) {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as LearningProfile;
      if (parsed.version !== 1 || !parsed.adjustments) throw new Error("Unsupported profile.");
      const safe: LearningProfile = { ...emptyProfile(), ...parsed, adjustments: { ...BASE_ADJUSTMENTS, ...parsed.adjustments } };
      saveProfile(safe); setProfile(safe);
    } catch { setError("That learning profile is invalid."); }
  }
  const confidenceClass = (value: number) => value >= 78 ? "ring-2 ring-emerald-400/80" : value >= 48 ? "ring-2 ring-amber-400/80" : "ring-2 ring-red-500/90";

  return <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
    <div className="mx-auto max-w-7xl space-y-5">
      <Link to="/menu" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16}/> Main menu</Link>
      <Card className="tracker-card space-y-5 p-5 sm:p-7">
        <div className="flex items-start gap-4"><div className="tracker-avatar"><Brain/></div><div>
          <p className="eyebrow"><span/> ADAPTIVE HYBRID SOLVER</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">Multi-generation pet puzzle solver</h1>
          <p className="mt-2 text-sm text-muted-foreground">Runs five independent engines, evolves their strongest layouts, and locally adapts from corrections you explicitly confirm on this device.</p>
        </div></div>
        <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-card/40 p-5 text-center hover:border-primary/50">
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(event) => void upload(event.target.files?.[0])}/>
          <ImagePlus className="mx-auto mb-2"/><span className="font-medium">Upload shuffled puzzle</span>
        </label>
        {source && <img src={source} alt="Puzzle" className="max-h-[440px] w-full rounded-xl border border-white/10 object-contain"/>}
        <div className="grid gap-3 sm:grid-cols-4">
          <div><label className="mb-2 block text-sm">Rows</label><Input type="number" min={2} max={10} value={rows} onChange={(event)=>setRows(Math.max(2, Math.min(10, Number(event.target.value) || 2)))}/></div>
          <div><label className="mb-2 block text-sm">Columns</label><Input type="number" min={2} max={10} value={cols} onChange={(event)=>setCols(Math.max(2, Math.min(10, Number(event.target.value) || 2)))}/></div>
          <div><label className="mb-2 block text-sm">Grid gutter %</label><Input type="number" min={0} max={10} step={.1} value={gutter} onChange={(event)=>setGutter(Math.max(0, Math.min(10, Number(event.target.value) || 0)))}/></div>
          <label className="flex items-center gap-2 self-end pb-3 text-sm"><input type="checkbox" checked={deep} onChange={(event)=>setDeep(event.target.checked)}/><Gauge size={15}/> Maximum hybrid search</label>
        </div>
        <Button onClick={solve} disabled={solving || !source} className="metal-button h-12 w-full rounded-xl">{solving ? <LoaderCircle className="animate-spin"/> : <Sparkles/>}{solving ? `${stage} · ${progress}%` : "Run adaptive hybrid solve"}</Button>
        {error && <p className="error-copy">{error}</p>}
        {!!tiles.length && <p className="status-pill status-healthy">Detected object content in {objectTiles} of {tiles.length} tiles</p>}

        {!!candidates.length && <section className="space-y-5">
          <Card className="space-y-3 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="panel-label">CANDIDATE BROWSER</p><p className="text-xs text-muted-foreground">Ranked by normalised engine rank, evolutionary consensus and neighbour agreement.</p></div><Button variant="outline" onClick={()=>void focusedResolve()} disabled={solving}><WandSparkles size={15}/> Re-solve uncertain tiles</Button></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{candidates.map((candidate, index) => <button type="button" key={`${candidate.label}-${index}`} onClick={()=>void chooseCandidate(index)} className={`rounded-xl border p-2 text-left transition ${activeCandidate===index ? "border-primary ring-2 ring-primary/40" : "border-white/10 hover:border-white/30"}`}>
              <img src={candidate.preview} alt={`Candidate ${index + 1}`} className="w-full rounded-md"/><p className="mt-2 text-sm font-medium">Option {index + 1}</p><p className="text-[11px] text-muted-foreground">{candidate.label}</p>
            </button>)}</div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
            <div className="space-y-3">
              <div className="grid overflow-hidden rounded-xl border border-white/10" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                {order.map((id, index) => <button type="button" key={`slot-${index}`} onClick={()=>void tapTile(index)} className={`relative aspect-square overflow-hidden border border-black/30 transition ${confidenceClass(confidence[index] || 0)} ${selected===index ? "z-10 scale-105 ring-4 ring-primary" : ""}`}>
                  <img src={tiles[id]?.url} alt={`Tile ${id + 1}`} className="h-full w-full object-fill"/>
                  <span className="absolute left-1 top-1 rounded bg-black/75 px-1 text-[10px] text-white">{confidence[index] || 0}%</span>
                  <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 text-[10px] text-white">{index + 1}</span>
                </button>)}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><span>🟢 High consensus</span><span>🟡 Uncertain</span><span>🔴 Likely needs checking</span></div>
              <p className="text-xs text-muted-foreground">Tap two tiles to make a trial swap. The solver only learns after you press Confirm correction.</p>
              {pendingCorrection && <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-400/30 p-3"><p className="text-sm">Does this swap look better?</p><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>void undoPending()}>Undo</Button><Button size="sm" onClick={confirmCorrection}>Confirm correction</Button></div></Card>}
              <Button variant="outline" onClick={()=>void resetCandidate()}><RotateCcw size={15}/> Reset selected option</Button>
            </div>
            <div className="space-y-4">
              <Card className="space-y-3 p-4"><p className="panel-label">TARGETED SWAP ASSISTANT</p>
                {suggestions.length ? suggestions.map((suggestion, index) => <div key={`${suggestion.a}-${suggestion.b}`} className="rounded-lg border border-white/10 p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">Suggestion {index + 1}</p><p className="mt-1 text-xs text-muted-foreground">{suggestion.reason}</p><p className="mt-1 text-[11px] text-muted-foreground">Model improvement: {suggestion.gain.toFixed(1)}</p></div><Button size="sm" variant="outline" onClick={()=>void swapTiles(suggestion.a, suggestion.b)}><WandSparkles size={14}/> Try</Button></div></div>) : <p className="text-sm text-muted-foreground">No strong swap is available. Compare another candidate or run the focused re-solve.</p>}
              </Card>
              <Card className="space-y-3 p-4"><p className="panel-label">LOCAL ADAPTIVE LEARNING</p><p className="text-xs text-muted-foreground">Learns recurring neighbour patterns from confirmed corrections. Images and pixels are never stored.</p><div className="text-sm"><p>Confirmed corrections: <strong>{profile.correctionCount}</strong></p><p className="text-xs text-muted-foreground">Last updated: {profile.lastUpdated ? new Date(profile.lastUpdated).toLocaleString() : "Never"}</p></div><div className="grid grid-cols-2 gap-2"><Button size="sm" variant="outline" onClick={exportLearning}><Download size={14}/> Export</Button><label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-input px-3 text-sm"><Upload size={14}/> Import<input type="file" accept="application/json" className="sr-only" onChange={(event)=>void importLearning(event.target.files?.[0])}/></label></div><Button size="sm" variant="outline" onClick={resetLearning}>Reset learning</Button></Card>
              {result && <Card className="space-y-3 p-4"><p className="panel-label">CURRENT RESULT</p><img src={result} alt="Current result" className="w-full rounded-lg border border-white/10"/><a href={result} download={`hybrid-solved-${name || "puzzle"}.png`}><Button variant="outline" className="w-full">Save result PNG</Button></a></Card>}
            </div>
          </div>
        </section>}
      </Card>
    </div>
  </main>;
}
