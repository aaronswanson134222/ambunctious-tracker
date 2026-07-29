import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Brain,
  CheckCircle2,
  ChevronsRight,
  Download,
  ExternalLink,
  Gauge,
  ImagePlus,
  LoaderCircle,
  Pause,
  Play,
  Save,
  Sparkles,
  SkipForward,
  StepBack,
  StepForward,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/puzzle-solver")({ component: PuzzleSolver });

// ============================================================================
// Types
// ============================================================================
type Tile = { dataUrl: string; pixels: ImageData };
type Profile = {
  id: string;
  colour: number; // raw RGB seam continuity
  luma: number; // Lab-like luminance
  chroma: number; // Lab-like chroma
  gradient: number; // gradient direction/magnitude across seam
  ssim: number; // SSIM-style local structure
  inward: number; // multi-depth inward strips
  corner: number; // corner continuity
  smooth: number; // whole-image smoothness bonus
};
type CostSet = {
  right: number[][];
  down: number[][];
  cornerR: number[][];
  cornerD: number[][]; // extra corner-continuity term
};
type Candidate = { order: number[]; cost: number; profile: string; label: string };
type Move = {
  kind: "swap" | "cycle3" | "row" | "col" | "block";
  positions: number[]; // positions affected
  before: number[]; // tile ids at those positions before
  after: number[]; // tile ids at those positions after
  scoreBefore: number;
  scoreAfter: number;
  description: string;
};
type Learning = {
  profileScores?: Record<string, number>;
  examples?: number;
  exactOrders?: number;
  totalAccuracy?: number;
  runs?: number;
};
type GroundTruthResult = {
  order: number[];
  ambiguous: number[];
  averageDistance: number;
  accuracy: number;
};

// ============================================================================
// Profiles — different weightings the optimizer tries
// ============================================================================
const PROFILES: Profile[] = [
  {
    id: "balanced",
    colour: 1.0,
    luma: 1.0,
    chroma: 0.9,
    gradient: 0.9,
    ssim: 0.8,
    inward: 0.35,
    corner: 0.6,
    smooth: 0.15,
  },
  {
    id: "colour",
    colour: 1.6,
    luma: 0.9,
    chroma: 1.4,
    gradient: 0.35,
    ssim: 0.4,
    inward: 0.15,
    corner: 0.35,
    smooth: 0.1,
  },
  {
    id: "shape",
    colour: 0.5,
    luma: 0.7,
    chroma: 0.4,
    gradient: 1.7,
    ssim: 1.3,
    inward: 0.5,
    corner: 0.85,
    smooth: 0.25,
  },
  {
    id: "deep",
    colour: 0.9,
    luma: 1.0,
    chroma: 0.9,
    gradient: 1.0,
    ssim: 0.9,
    inward: 1.1,
    corner: 0.8,
    smooth: 0.25,
  },
  {
    id: "structure",
    colour: 0.7,
    luma: 1.1,
    chroma: 0.7,
    gradient: 1.2,
    ssim: 1.6,
    inward: 0.6,
    corner: 1.0,
    smooth: 0.3,
  },
];

// ============================================================================
// Storage
// ============================================================================
const LEARN_KEY = "ambunctious-puzzle-learning-v3";
function loadLearning(): Learning {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LEARN_KEY) || "{}");
  } catch {
    return {};
  }
}
function saveLearning(value: Learning) {
  try {
    localStorage.setItem(LEARN_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

// ============================================================================
// IO helpers
// ============================================================================
function readFile(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}
function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not decode the uploaded image."));
    image.src = src;
  });
}
const yieldToUi = () => new Promise<void>((r) => setTimeout(r, 0));

// ============================================================================
// Colour helpers
// ============================================================================
function rgbAt(data: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return [data[i], data[i + 1], data[i + 2]] as const;
}
// Fast Lab-ish approximation using YCbCr (fine for perceptual difference)
function luma(r: number, g: number, b: number) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}
function chromaR(r: number, g: number, b: number) {
  return 0.5 * r - 0.418688 * g - 0.081312 * b;
}
function chromaB(r: number, g: number, b: number) {
  return -0.168736 * r - 0.331264 * g + 0.5 * b;
}

// ============================================================================
// Auto crop / gutter detection
// ============================================================================
async function autoDetectCrop(
  src: string,
): Promise<{ x: number; y: number; w: number; h: number } | null> {
  try {
    const img = await loadImage(src);
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(20, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(20, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const W = canvas.width,
      H = canvas.height;
    const rowVar = new Float32Array(H),
      colVar = new Float32Array(W);
    for (let y = 0; y < H; y++) {
      let mean = 0,
        sq = 0;
      for (let x = 0; x < W; x++) {
        const [r, g, b] = rgbAt(d, W, x, y);
        const v = luma(r, g, b);
        mean += v;
        sq += v * v;
      }
      mean /= W;
      rowVar[y] = sq / W - mean * mean;
    }
    for (let x = 0; x < W; x++) {
      let mean = 0,
        sq = 0;
      for (let y = 0; y < H; y++) {
        const [r, g, b] = rgbAt(d, W, x, y);
        const v = luma(r, g, b);
        mean += v;
        sq += v * v;
      }
      mean /= H;
      colVar[x] = sq / H - mean * mean;
    }
    const rowT = 15,
      colT = 15;
    let top = 0,
      bot = H - 1,
      left = 0,
      right = W - 1;
    while (top < H && rowVar[top] < rowT) top++;
    while (bot > 0 && rowVar[bot] < rowT) bot--;
    while (left < W && colVar[left] < colT) left++;
    while (right > 0 && colVar[right] < colT) right--;
    if (right - left < W * 0.4 || bot - top < H * 0.4) return null;
    const ratio = 1 / scale;
    return {
      x: Math.round(left * ratio),
      y: Math.round(top * ratio),
      w: Math.round((right - left + 1) * ratio),
      h: Math.round((bot - top + 1) * ratio),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// Tile extraction with crop and gutter
// ============================================================================
async function extractSourceTiles(
  src: string,
  rows: number,
  cols: number,
  crop: { x: number; y: number; w: number; h: number } | null,
  gutterPct: number,
) {
  const image = await loadImage(src);
  const region = crop || { x: 0, y: 0, w: image.naturalWidth, h: image.naturalHeight };
  const cellW = region.w / cols,
    cellH = region.h / rows;
  const gutter = Math.max(
    0,
    Math.min(Math.min(cellW, cellH) * 0.25, Math.min(cellW, cellH) * (gutterPct / 100)),
  );
  const tileW = Math.max(20, Math.floor(cellW - gutter * 2));
  const tileH = Math.max(20, Math.floor(cellH - gutter * 2));
  if (tileW < 20 || tileH < 20) throw new Error("The selected grid makes the tiles too small.");
  const tiles: Tile[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const canvas = document.createElement("canvas");
      canvas.width = tileW;
      canvas.height = tileH;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas unavailable.");
      ctx.drawImage(
        image,
        Math.round(region.x + c * cellW + gutter),
        Math.round(region.y + r * cellH + gutter),
        tileW,
        tileH,
        0,
        0,
        tileW,
        tileH,
      );
      tiles.push({
        dataUrl: canvas.toDataURL("image/png"),
        pixels: ctx.getImageData(0, 0, tileW, tileH),
      });
    }
  return { tiles, tileW, tileH };
}

// ============================================================================
// Multi-feature edge cost with SSIM-style structure
// ============================================================================
function edgeCost(a: ImageData, b: ImageData, direction: "right" | "down", p: Profile) {
  const w = a.width,
    h = a.height;
  const length = direction === "right" ? h : w;
  const depth = Math.max(2, Math.min(6, Math.floor(Math.min(w, h) / 20)));
  let colour = 0,
    lum = 0,
    chr = 0,
    grad = 0,
    ssim = 0,
    inward = 0,
    corner = 0,
    count = 0;

  // Accumulators for SSIM patches
  let sumA = 0,
    sumB = 0,
    sqA = 0,
    sqB = 0,
    sumAB = 0;

  for (let pi = 1; pi < length - 1; pi++) {
    const ax = direction === "right" ? w - 1 : pi;
    const ay = direction === "right" ? pi : h - 1;
    const bx = direction === "right" ? 0 : pi;
    const by = direction === "right" ? pi : 0;
    const [ar, ag, ab] = rgbAt(a.data, w, ax, ay);
    const [br, bg, bb] = rgbAt(b.data, w, bx, by);
    const dR = ar - br,
      dG = ag - bg,
      dB = ab - bb;
    colour += dR * dR + dG * dG + dB * dB;
    const dL = luma(ar, ag, ab) - luma(br, bg, bb);
    const dCr = chromaR(ar, ag, ab) - chromaR(br, bg, bb);
    const dCb = chromaB(ar, ag, ab) - chromaB(br, bg, bb);
    lum += dL * dL;
    chr += dCr * dCr + dCb * dCb;

    // Gradient across seam (compare 2nd-derivative direction)
    for (let d = 1; d <= depth; d++) {
      const ax2 = direction === "right" ? w - 1 - d : pi;
      const ay2 = direction === "right" ? pi : h - 1 - d;
      const bx2 = direction === "right" ? d : pi;
      const by2 = direction === "right" ? pi : d;
      const [ar2, ag2, ab2] = rgbAt(a.data, w, ax2, ay2);
      const [br2, bg2, bb2] = rgbAt(b.data, w, bx2, by2);
      const gA = luma(ar, ag, ab) - luma(ar2, ag2, ab2);
      const gB = luma(br2, bg2, bb2) - luma(br, bg, bb);
      const gd = gA - gB;
      grad += (gd * gd) / d;
      const iw = (ar2 - br2) ** 2 + (ag2 - bg2) ** 2 + (ab2 - bb2) ** 2;
      inward += iw / d;

      // SSIM patch accumulators (luma)
      const va = luma(ar2, ag2, ab2),
        vb = luma(br2, bg2, bb2);
      sumA += va;
      sumB += vb;
      sqA += va * va;
      sqB += vb * vb;
      sumAB += va * vb;
    }
    count++;
  }
  // SSIM approximation for the seam strip
  const N = Math.max(1, count * depth);
  const mA = sumA / N,
    mB = sumB / N;
  const vA = sqA / N - mA * mA,
    vB = sqB / N - mB * mB;
  const cov = sumAB / N - mA * mB;
  const C1 = 6.5025,
    C2 = 58.5225;
  const ssimVal =
    ((2 * mA * mB + C1) * (2 * cov + C2)) / ((mA * mA + mB * mB + C1) * (vA + vB + C2));
  ssim = (1 - ssimVal) * 10000;

  // Corner continuity: sample 2x2 corners
  {
    const pick = (img: ImageData, x: number, y: number) => rgbAt(img.data, img.width, x, y);
    const pairs: Array<[readonly [number, number, number], readonly [number, number, number]]> =
      direction === "right"
        ? [
            [pick(a, w - 1, 0), pick(b, 0, 0)],
            [pick(a, w - 1, h - 1), pick(b, 0, h - 1)],
          ]
        : [
            [pick(a, 0, h - 1), pick(b, 0, 0)],
            [pick(a, w - 1, h - 1), pick(b, w - 1, 0)],
          ];
    for (const [pa, pb] of pairs)
      corner += (pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2 + (pa[2] - pb[2]) ** 2;
  }

  const c = Math.max(1, count);
  return (
    (p.colour * (colour / c)) / 255 +
    (p.luma * (lum / c)) / 255 +
    (p.chroma * (chr / c)) / 255 +
    (p.gradient * (grad / c)) / 255 +
    (p.ssim * ssim) / 10000 +
    (p.inward * (inward / c)) / 255 +
    (p.corner * corner) / 255
  );
}

function buildCostMatrix(tiles: Tile[], profile: Profile): CostSet {
  const n = tiles.length;
  const right = Array.from({ length: n }, () => Array(n).fill(Number.POSITIVE_INFINITY));
  const down = Array.from({ length: n }, () => Array(n).fill(Number.POSITIVE_INFINITY));
  const cornerR = Array.from({ length: n }, () => Array(n).fill(0));
  const cornerD = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++)
      if (i !== j) {
        right[i][j] = edgeCost(tiles[i].pixels, tiles[j].pixels, "right", profile);
        down[i][j] = edgeCost(tiles[i].pixels, tiles[j].pixels, "down", profile);
        cornerR[i][j] = right[i][j];
        cornerD[i][j] = down[i][j];
      }
  return { right: robustNormalise(right), down: robustNormalise(down), cornerR, cornerD };
}

// Robust normalisation: divide each row by median of finite non-self values to
// stop a flat/dark separator (which has tiny costs to everything) from dominating.
function robustNormalise(m: number[][]) {
  const n = m.length;
  const rowMed: number[] = [],
    colMed: number[] = [];
  for (let i = 0; i < n; i++) {
    const vals: number[] = [];
    for (let j = 0; j < n; j++) if (i !== j && Number.isFinite(m[i][j])) vals.push(m[i][j]);
    vals.sort((a, b) => a - b);
    rowMed[i] = vals[Math.floor(vals.length / 2)] || 1;
  }
  for (let j = 0; j < n; j++) {
    const vals: number[] = [];
    for (let i = 0; i < n; i++) if (i !== j && Number.isFinite(m[i][j])) vals.push(m[i][j]);
    vals.sort((a, b) => a - b);
    colMed[j] = vals[Math.floor(vals.length / 2)] || 1;
  }
  return m.map((row, i) =>
    row.map((v, j) => (i === j ? Number.POSITIVE_INFINITY : v / Math.sqrt(rowMed[i] * colMed[j]))),
  );
}

// ============================================================================
// Global scoring
// ============================================================================
function globalScore(order: number[], cs: CostSet, rows: number, cols: number) {
  let s = 0;
  for (let i = 0; i < order.length; i++) {
    const col = i % cols,
      row = Math.floor(i / cols);
    if (col < cols - 1) s += cs.right[order[i]][order[i + 1]];
    if (row < rows - 1) s += cs.down[order[i]][order[i + cols]];
  }
  return s;
}

// ============================================================================
// Beam search (initial candidates)
// ============================================================================
async function beamSolve(
  cs: CostSet,
  rows: number,
  cols: number,
  onProgress: (v: number) => void,
  maxAccuracy: boolean,
) {
  const n = rows * cols;
  let beam: { order: number[]; used: bigint; cost: number }[] = [{ order: [], used: 0n, cost: 0 }];
  const width = maxAccuracy ? (n <= 24 ? 4000 : 1400) : n <= 24 ? 2000 : 700;
  const branch = maxAccuracy ? (n <= 24 ? 16 : 9) : n <= 24 ? 12 : 6;
  for (let pos = 0; pos < n; pos++) {
    const next: typeof beam = [];
    const col = pos % cols,
      row = Math.floor(pos / cols);
    for (const state of beam) {
      const options: { tile: number; add: number }[] = [];
      for (let tile = 0; tile < n; tile++) {
        if (state.used & (1n << BigInt(tile))) continue;
        let add = 0;
        if (col > 0) add += cs.right[state.order[pos - 1]][tile];
        if (row > 0) add += cs.down[state.order[pos - cols]][tile];
        options.push({ tile, add });
      }
      options.sort((a, b) => a.add - b.add);
      for (const o of options.slice(0, branch)) {
        next.push({
          order: [...state.order, o.tile],
          used: state.used | (1n << BigInt(o.tile)),
          cost: state.cost + o.add,
        });
      }
    }
    next.sort((a, b) => a.cost - b.cost);
    beam = next.slice(0, width);
    onProgress(Math.round(((pos + 1) / n) * 100));
    if (pos % 2 === 0) await yieldToUi();
  }
  return beam
    .slice(0, 10)
    .map((s) => ({ order: s.order, cost: globalScore(s.order, cs, rows, cols) }));
}

// ============================================================================
// Local optimiser — pair swaps, 3-cycles, row/col swaps, block moves
// ============================================================================
function applySwap(order: number[], i: number, j: number) {
  const next = order.slice();
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
function applyPerm(order: number[], positions: number[], mapping: number[]) {
  const next = order.slice();
  for (let k = 0; k < positions.length; k++) next[positions[k]] = order[positions[mapping[k]]];
  return next;
}

async function optimise(
  startOrder: number[],
  cs: CostSet,
  rows: number,
  cols: number,
  maxAccuracy: boolean,
  deadlineMs: number,
  onMove: (m: Move) => void,
): Promise<number[]> {
  let order = startOrder.slice();
  let score = globalScore(order, cs, rows, cols);
  const start = Date.now();
  const n = order.length;
  let improved = true,
    iter = 0;
  const softCap = maxAccuracy ? 40 : 15;

  while (improved && iter < softCap) {
    improved = false;
    iter++;

    // Pair swaps — full O(n^2)
    for (let i = 0; i < n; i++) {
      if (Date.now() - start > deadlineMs) break;
      for (let j = i + 1; j < n; j++) {
        const cand = applySwap(order, i, j);
        const s = globalScore(cand, cs, rows, cols);
        if (s < score - 1e-9) {
          onMove({
            kind: "swap",
            positions: [i, j],
            before: [order[i], order[j]],
            after: [cand[i], cand[j]],
            scoreBefore: score,
            scoreAfter: s,
            description: `Swap positions ${i + 1} ↔ ${j + 1}`,
          });
          order = cand;
          score = s;
          improved = true;
        }
      }
      if (i % 4 === 0) await yieldToUi();
    }

    // Row swaps
    for (let r1 = 0; r1 < rows; r1++)
      for (let r2 = r1 + 1; r2 < rows; r2++) {
        if (Date.now() - start > deadlineMs) break;
        const cand = order.slice();
        const positions: number[] = [];
        for (let c = 0; c < cols; c++) {
          const a = r1 * cols + c,
            b = r2 * cols + c;
          [cand[a], cand[b]] = [cand[b], cand[a]];
          positions.push(a, b);
        }
        const s = globalScore(cand, cs, rows, cols);
        if (s < score - 1e-9) {
          onMove({
            kind: "row",
            positions,
            before: positions.map((p) => order[p]),
            after: positions.map((p) => cand[p]),
            scoreBefore: score,
            scoreAfter: s,
            description: `Swap rows ${r1 + 1} ↔ ${r2 + 1}`,
          });
          order = cand;
          score = s;
          improved = true;
        }
      }
    await yieldToUi();

    // Column swaps
    for (let c1 = 0; c1 < cols; c1++)
      for (let c2 = c1 + 1; c2 < cols; c2++) {
        if (Date.now() - start > deadlineMs) break;
        const cand = order.slice();
        const positions: number[] = [];
        for (let r = 0; r < rows; r++) {
          const a = r * cols + c1,
            b = r * cols + c2;
          [cand[a], cand[b]] = [cand[b], cand[a]];
          positions.push(a, b);
        }
        const s = globalScore(cand, cs, rows, cols);
        if (s < score - 1e-9) {
          onMove({
            kind: "col",
            positions,
            before: positions.map((p) => order[p]),
            after: positions.map((p) => cand[p]),
            scoreBefore: score,
            scoreAfter: s,
            description: `Swap columns ${c1 + 1} ↔ ${c2 + 1}`,
          });
          order = cand;
          score = s;
          improved = true;
        }
      }
    await yieldToUi();

    // Selected 3-cycles: only among positions currently contributing highest edge costs
    const worst = worstPositions(order, cs, rows, cols, Math.min(n, maxAccuracy ? 18 : 12));
    for (let a = 0; a < worst.length; a++) {
      if (Date.now() - start > deadlineMs) break;
      for (let b = a + 1; b < worst.length; b++)
        for (let c = b + 1; c < worst.length; c++) {
          const pa = worst[a],
            pb = worst[b],
            pc = worst[c];
          // rotate a→b→c→a
          const cand = order.slice();
          cand[pa] = order[pc];
          cand[pb] = order[pa];
          cand[pc] = order[pb];
          const s = globalScore(cand, cs, rows, cols);
          if (s < score - 1e-9) {
            onMove({
              kind: "cycle3",
              positions: [pa, pb, pc],
              before: [order[pa], order[pb], order[pc]],
              after: [cand[pa], cand[pb], cand[pc]],
              scoreBefore: score,
              scoreAfter: s,
              description: `3-cycle ${pa + 1}→${pb + 1}→${pc + 1}`,
            });
            order = cand;
            score = s;
            improved = true;
            continue;
          }
          // rotate the other way a→c→b→a
          const cand2 = order.slice();
          cand2[pa] = order[pb];
          cand2[pc] = order[pa];
          cand2[pb] = order[pc];
          const s2 = globalScore(cand2, cs, rows, cols);
          if (s2 < score - 1e-9) {
            onMove({
              kind: "cycle3",
              positions: [pa, pc, pb],
              before: [order[pa], order[pc], order[pb]],
              after: [cand2[pa], cand2[pc], cand2[pb]],
              scoreBefore: score,
              scoreAfter: s2,
              description: `3-cycle ${pa + 1}→${pc + 1}→${pb + 1}`,
            });
            order = cand2;
            score = s2;
            improved = true;
          }
        }
      if (a % 2 === 0) await yieldToUi();
    }

    // 2x2 block rotations (short block moves)
    for (let r = 0; r < rows - 1; r++)
      for (let c = 0; c < cols - 1; c++) {
        if (Date.now() - start > deadlineMs) break;
        const tl = r * cols + c,
          tr = tl + 1,
          bl = tl + cols,
          br = bl + 1;
        const positions = [tl, tr, br, bl];
        // rotate clockwise
        const cand = order.slice();
        cand[tr] = order[tl];
        cand[br] = order[tr];
        cand[bl] = order[br];
        cand[tl] = order[bl];
        const s = globalScore(cand, cs, rows, cols);
        if (s < score - 1e-9) {
          onMove({
            kind: "block",
            positions,
            before: positions.map((p) => order[p]),
            after: positions.map((p) => cand[p]),
            scoreBefore: score,
            scoreAfter: s,
            description: `Rotate 2×2 block at (${r + 1},${c + 1})`,
          });
          order = cand;
          score = s;
          improved = true;
        }
      }
    await yieldToUi();
    if (Date.now() - start > deadlineMs) break;
  }
  return order;
}

function worstPositions(order: number[], cs: CostSet, rows: number, cols: number, k: number) {
  const contrib: { pos: number; c: number }[] = [];
  for (let i = 0; i < order.length; i++) {
    const col = i % cols,
      row = Math.floor(i / cols);
    let c = 0;
    if (col < cols - 1) c += cs.right[order[i]][order[i + 1]];
    if (col > 0) c += cs.right[order[i - 1]][order[i]];
    if (row < rows - 1) c += cs.down[order[i]][order[i + cols]];
    if (row > 0) c += cs.down[order[i - cols]][order[i]];
    contrib.push({ pos: i, c });
  }
  contrib.sort((a, b) => b.c - a.c);
  return contrib.slice(0, k).map((x) => x.pos);
}

// ============================================================================
// Move-sequence builder: transform initial order into final via minimal swaps
// so we can auto-play from shuffled → best final.
// ============================================================================
function buildTransformMoves(from: number[], to: number[]): Move[] {
  const order = from.slice();
  const moves: Move[] = [];
  for (let i = 0; i < order.length; i++) {
    if (order[i] === to[i]) continue;
    const j = order.indexOf(to[i], i + 1);
    if (j < 0) continue;
    moves.push({
      kind: "swap",
      positions: [i, j],
      before: [order[i], order[j]],
      after: [order[j], order[i]],
      scoreBefore: 0,
      scoreAfter: 0,
      description: `Move tile into position ${i + 1}`,
    });
    [order[i], order[j]] = [order[j], order[i]];
  }
  return moves;
}

// ============================================================================
// Final rendering
// ============================================================================
function renderSolution(
  tiles: Tile[],
  order: number[],
  rows: number,
  cols: number,
  tileW: number,
  tileH: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = cols * tileW;
  canvas.height = rows * tileH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve("");
  return Promise.all(order.map((t) => loadImage(tiles[t].dataUrl))).then((imgs) => {
    imgs.forEach((img, i) => ctx.drawImage(img, (i % cols) * tileW, Math.floor(i / cols) * tileH));
    return canvas.toDataURL("image/png");
  });
}

// ============================================================================
// Ground-truth mapping (Hungarian assignment)
// ============================================================================
function featureVector(image: ImageData) {
  const size = 24;
  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  const sctx = source.getContext("2d");
  const target = document.createElement("canvas");
  target.width = size;
  target.height = size;
  const tctx = target.getContext("2d", { willReadFrequently: true });
  if (!sctx || !tctx) return [] as number[];
  sctx.putImageData(image, 0, 0);
  tctx.drawImage(source, 0, 0, size, size);
  const data = tctx.getImageData(0, 0, size, size).data;
  const v: number[] = [];
  for (let i = 0; i < data.length; i += 4)
    v.push(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
  return v;
}
function vectorDistance(a: number[], b: number[]) {
  let sum = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum / Math.max(1, n);
}
async function extractFinalTiles(src: string, rows: number, cols: number, w: number, h: number) {
  const img = await loadImage(src);
  const ratioA = img.naturalWidth / img.naturalHeight;
  const ratioB = (cols * w) / (rows * h);
  if (Math.abs(ratioA - ratioB) / ratioB > 0.1)
    throw new Error("The final image aspect ratio does not match the selected grid.");
  const tiles: ImageData[] = [];
  const cellW = img.naturalWidth / cols,
    cellH = img.naturalHeight / rows;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("Canvas unavailable.");
      ctx.drawImage(img, c * cellW, r * cellH, cellW, cellH, 0, 0, w, h);
      tiles.push(ctx.getImageData(0, 0, w, h));
    }
  return tiles;
}
function hungarian(cost: number[][]) {
  const n = cost.length;
  const u = Array(n + 1).fill(0),
    v = Array(n + 1).fill(0),
    p = Array(n + 1).fill(0),
    way = Array(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = Array(n + 1).fill(Number.POSITIVE_INFINITY),
      used = Array(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Number.POSITIVE_INFINITY,
        j1 = 0;
      for (let j = 1; j <= n; j++)
        if (!used[j]) {
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) {
            minv[j] = cur;
            way[j] = j0;
          }
          if (minv[j] < delta) {
            delta = minv[j];
            j1 = j;
          }
        }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const assignment = Array(n).fill(-1);
  for (let j = 1; j <= n; j++) assignment[p[j] - 1] = j - 1;
  return assignment;
}
async function mapGroundTruth(
  sourceTiles: Tile[],
  finalSrc: string,
  rows: number,
  cols: number,
  w: number,
  h: number,
  currentOrder: number[],
): Promise<GroundTruthResult> {
  const finalTiles = await extractFinalTiles(finalSrc, rows, cols, w, h);
  const srcV = sourceTiles.map((t) => featureVector(t.pixels));
  const finV = finalTiles.map(featureVector);
  const cost = finV.map((f) => srcV.map((s) => vectorDistance(f, s)));
  const order = hungarian(cost);
  const ambiguous: number[] = [];
  let total = 0;
  cost.forEach((row, pos) => {
    total += row[order[pos]];
    const best = row[order[pos]];
    const sorted = row.map((v, t) => ({ v, t })).sort((a, b) => a.v - b.v);
    const alt = sorted.find((e) => e.t !== order[pos])?.v ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(alt) || alt - best < Math.max(0.0025, best * 0.12)) ambiguous.push(pos);
  });
  const correct = order.filter((tile, i) => tile === currentOrder[i]).length;
  return {
    order,
    ambiguous,
    averageDistance: total / Math.max(1, order.length),
    accuracy: correct / Math.max(1, order.length),
  };
}

// ============================================================================
// Solve pipeline: candidates → optimise → dedupe → rank
// ============================================================================
async function solveTiles(
  tiles: Tile[],
  rows: number,
  cols: number,
  setProgress: (v: number) => void,
  setStage: (s: string) => void,
  maxAccuracy: boolean,
) {
  const learning = loadLearning();
  const scores = learning.profileScores || {};
  const allMoves: { candidateIndex: number; moves: Move[] }[] = [];
  const candidates: Candidate[] = [];
  const perProfileTime = maxAccuracy ? 3500 : 1400;

  for (let pi = 0; pi < PROFILES.length; pi++) {
    const profile = PROFILES[pi];
    setStage(`Profile ${pi + 1}/${PROFILES.length}: ${profile.id} — building costs`);
    const cs = buildCostMatrix(tiles, profile);
    setStage(`Profile ${profile.id} — beam search`);
    const beamResults = await beamSolve(
      cs,
      rows,
      cols,
      (v) => setProgress(Math.round(((pi + v / 100) / PROFILES.length) * 60)),
      maxAccuracy,
    );

    for (let ci = 0; ci < Math.min(beamResults.length, maxAccuracy ? 4 : 2); ci++) {
      setStage(`Profile ${profile.id} — optimising candidate ${ci + 1}`);
      const moves: Move[] = [];
      const optimised = await optimise(
        beamResults[ci].order,
        cs,
        rows,
        cols,
        maxAccuracy,
        perProfileTime,
        (m) => moves.push(m),
      );
      const finalScore = globalScore(optimised, cs, rows, cols);
      candidates.push({
        order: optimised,
        cost: finalScore,
        profile: profile.id,
        label: `${profile.id}#${ci + 1}`,
      });
      allMoves.push({ candidateIndex: candidates.length - 1, moves });
    }
    await yieldToUi();
  }

  // Dedupe by order
  const unique = new Map<string, { candidate: Candidate; moves: Move[] }>();
  candidates.forEach((c, i) => {
    const key = c.order.join(",");
    const bonus = Math.min(0.3, (scores[c.profile] || 0) * 0.02);
    const adjusted = c.cost * (1 - bonus);
    const prev = unique.get(key);
    if (!prev || adjusted < prev.candidate.cost) {
      unique.set(key, { candidate: { ...c, cost: adjusted }, moves: allMoves[i].moves });
    }
  });
  const ranked = [...unique.values()]
    .sort((a, b) => a.candidate.cost - b.candidate.cost)
    .slice(0, 6);
  return { candidates: ranked.map((r) => r.candidate), moves: ranked.map((r) => r.moves) };
}

// ============================================================================
// Component
// ============================================================================
function PuzzleSolver() {
  const tweet = useMemo(() => {
    if (typeof window === "undefined") return "";
    const value = new URLSearchParams(window.location.search).get("tweet") || "";
    try {
      const u = new URL(value);
      return ["x.com", "twitter.com"].includes(u.hostname) ? u.toString() : "";
    } catch {
      return "";
    }
  }, []);

  const [image, setImage] = useState("");
  const [fileName, setFileName] = useState("");
  const [finalImage, setFinalImage] = useState("");
  const [finalFileName, setFinalFileName] = useState("");
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(6);

  const [autoCrop, setAutoCrop] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  const [useAutoCrop, setUseAutoCrop] = useState(true);
  const [gutter, setGutter] = useState(1.6);
  const [maxAccuracy, setMaxAccuracy] = useState(false);

  const [tiles, setTiles] = useState<Tile[]>([]);
  const [tileSize, setTileSize] = useState({ width: 0, height: 0 });
  const [initialOrder, setInitialOrder] = useState<number[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateMoves, setCandidateMoves] = useState<Move[][]>([]);
  const [active, setActive] = useState(0);

  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [solvedImage, setSolvedImage] = useState("");

  const [solving, setSolving] = useState(false);
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [trained, setTrained] = useState(false);
  const [groundTruth, setGroundTruth] = useState<GroundTruthResult | null>(null);

  // Playback
  const [playMoves, setPlayMoves] = useState<Move[]>([]);
  const [moveIndex, setMoveIndex] = useState(0); // 0..playMoves.length (before move N)
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const playTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const [highlight, setHighlight] = useState<Set<number>>(new Set());

  // Confidence
  const confidence = useMemo(() => {
    if (!candidates.length) return null;
    const top = candidates[0];
    const second = candidates[1];
    const agree =
      candidates.filter((c) => c.order.join(",") === top.order.join(",")).length /
      candidates.length;
    const margin = second ? (second.cost - top.cost) / Math.max(1e-6, second.cost) : 1;
    const ambigWeight = groundTruth
      ? 1 - groundTruth.ambiguous.length / Math.max(1, order.length)
      : 1;
    const raw = 0.45 * agree + 0.35 * Math.max(0, Math.min(1, margin * 4)) + 0.2 * ambigWeight;
    const level: "low" | "medium" | "high" = raw < 0.35 ? "low" : raw < 0.7 ? "medium" : "high";
    return { agree, margin, level, score: Math.round(raw * 100) };
  }, [candidates, groundTruth, order.length]);

  useEffect(
    () => () => {
      if (playTimer.current) clearTimeout(playTimer.current);
    },
    [],
  );

  // Auto-crop detection when image changes
  useEffect(() => {
    let cancelled = false;
    if (!image) {
      setAutoCrop(null);
      return;
    }
    void autoDetectCrop(image).then((c) => {
      if (!cancelled) setAutoCrop(c);
    });
    return () => {
      cancelled = true;
    };
  }, [image]);

  async function chooseSource(file?: File) {
    resetSolveState();
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type))
      return setError("Upload a PNG, JPG or WebP screenshot.");
    setImage(await readFile(file));
    setFileName(file.name);
  }
  async function chooseFinal(file?: File) {
    setError("");
    setGroundTruth(null);
    setTrained(false);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type))
      return setError("Upload a PNG, JPG or WebP final image.");
    setFinalImage(await readFile(file));
    setFinalFileName(file.name);
  }
  function resetSolveState() {
    setError("");
    setCandidates([]);
    setCandidateMoves([]);
    setTiles([]);
    setOrder([]);
    setInitialOrder([]);
    setSolvedImage("");
    setTrained(false);
    setGroundTruth(null);
    setPlayMoves([]);
    setMoveIndex(0);
    setPlaying(false);
  }

  const rebuildImage = useCallback(
    async (nextOrder: number[], nextTiles = tiles, size = tileSize) => {
      setSolvedImage(
        await renderSolution(nextTiles, nextOrder, rows, cols, size.width, size.height),
      );
    },
    [tiles, tileSize, rows, cols],
  );

  async function solve() {
    if (!image) return setError("Upload a shuffled puzzle screenshot first.");
    setSolving(true);
    setError("");
    setProgress(0);
    setStage("Extracting tiles");
    setTrained(false);
    setGroundTruth(null);
    try {
      const crop = useAutoCrop ? autoCrop : null;
      const {
        tiles: extracted,
        tileW,
        tileH,
      } = await extractSourceTiles(image, rows, cols, crop, gutter);
      setTiles(extracted);
      setTileSize({ width: tileW, height: tileH });
      const initial = Array.from({ length: extracted.length }, (_, i) => i);
      setInitialOrder(initial);
      setOrder(initial);

      const { candidates: cands, moves } = await solveTiles(
        extracted,
        rows,
        cols,
        setProgress,
        setStage,
        maxAccuracy,
      );
      if (!cands.length) throw new Error("No valid arrangements were found.");
      setCandidates(cands);
      setCandidateMoves(moves);
      setActive(0);

      // Auto-play from shuffled → best final
      const transformMoves = buildTransformMoves(initial, cands[0].order);
      setPlayMoves(transformMoves);
      setMoveIndex(0);
      setOrder(initial);
      await rebuildImage(cands[0].order, extracted, { width: tileW, height: tileH });
      setPlaying(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Puzzle solving failed.");
    } finally {
      setSolving(false);
      setProgress(0);
      setStage("");
    }
  }

  async function analyseFinal() {
    if (!finalImage) return setError("Upload the real finished image first.");
    if (!tiles.length)
      return setError("Generate puzzle solutions before training from a final image.");
    setTraining(true);
    setError("");
    setTrained(false);
    try {
      const result = await mapGroundTruth(
        tiles,
        finalImage,
        rows,
        cols,
        tileSize.width,
        tileSize.height,
        order,
      );
      setGroundTruth(result);
      setSelected(null);
      // Animate current order → ground truth order
      const gtMoves = buildTransformMoves(order, result.order);
      setPlayMoves(gtMoves);
      setMoveIndex(0);
      setPlaying(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not compare the final image.");
    } finally {
      setTraining(false);
    }
  }

  async function chooseCandidate(index: number) {
    setActive(index);
    setSelected(null);
    setTrained(false);
    setGroundTruth(null);
    const transformMoves = buildTransformMoves(initialOrder, candidates[index].order);
    setPlayMoves(transformMoves);
    setMoveIndex(0);
    setOrder(initialOrder);
    setPlaying(true);
    await rebuildImage(candidates[index].order);
  }

  async function tapTile(index: number) {
    if (playing) return;
    if (selected === null) return setSelected(index);
    if (selected === index) return setSelected(null);
    const next = [...order];
    [next[selected], next[index]] = [next[index], next[selected]];
    setSelected(null);
    setTrained(false);
    setOrder(next);
    await rebuildImage(next);
  }

  // ============ Playback engine ============
  const applyMove = useCallback(
    async (move: Move, direction: 1 | -1) => {
      setTransitioning(true);
      setHighlight(new Set(move.positions));
      // Update order: swap positions[k] with positions[(k+1)%len] cycle? For simplicity:
      // direction 1 => before → after mapping; -1 reverse.
      setOrder((prev) => {
        const next = prev.slice();
        const targetIds = direction === 1 ? move.after : move.before;
        move.positions.forEach((p, i) => {
          next[p] = targetIds[i];
        });
        return next;
      });
      await new Promise<void>((r) => setTimeout(r, Math.max(120, 360 / speed)));
      setTransitioning(false);
      setHighlight(new Set());
    },
    [speed],
  );

  useEffect(() => {
    if (!playing || !playMoves.length) return;
    if (moveIndex >= playMoves.length) {
      setPlaying(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const move = playMoves[moveIndex];
      await applyMove(move, 1);
      if (cancelled) return;
      setMoveIndex((i) => i + 1);
    })();
    return () => {
      cancelled = true;
    };
  }, [playing, moveIndex, playMoves, applyMove]);

  async function stepForward() {
    if (moveIndex >= playMoves.length) return;
    setPlaying(false);
    await applyMove(playMoves[moveIndex], 1);
    setMoveIndex((i) => i + 1);
  }
  async function stepBackward() {
    if (moveIndex <= 0) return;
    setPlaying(false);
    const move = playMoves[moveIndex - 1];
    await applyMove(move, -1);
    setMoveIndex((i) => i - 1);
  }
  async function skipToFinal() {
    setPlaying(false);
    if (!playMoves.length) return;
    // Apply remaining instantly
    setOrder((prev) => {
      let cur = prev.slice();
      for (let i = moveIndex; i < playMoves.length; i++) {
        const m = playMoves[i];
        const next = cur.slice();
        m.positions.forEach((p, k) => {
          next[p] = m.after[k];
        });
        cur = next;
      }
      return cur;
    });
    setMoveIndex(playMoves.length);
  }
  async function restartPlayback() {
    setPlaying(false);
    setOrder(initialOrder.length ? initialOrder : order);
    setMoveIndex(0);
  }

  const currentMove = moveIndex > 0 ? playMoves[moveIndex - 1] : null;
  const totalOptimiseMoves = candidateMoves[active]?.length || 0;

  function saveTraining() {
    const learning = loadLearning();
    const scores = { ...(learning.profileScores || {}) };
    let totalAcc = learning.totalAccuracy || 0;
    let runs = learning.runs || 0;
    if (groundTruth) {
      for (const c of candidates) {
        const correct =
          c.order.filter((tile, i) => tile === groundTruth.order[i]).length /
          Math.max(1, groundTruth.order.length);
        scores[c.profile] = (scores[c.profile] || 0) + correct;
      }
      totalAcc += groundTruth.accuracy;
      runs += 1;
      saveLearning({
        profileScores: scores,
        examples: (learning.examples || 0) + 1,
        exactOrders: (learning.exactOrders || 0) + 1,
        totalAccuracy: totalAcc,
        runs,
      });
    } else {
      const profile = candidates[active]?.profile || "balanced";
      scores[profile] = (scores[profile] || 0) + 1;
      saveLearning({ ...learning, profileScores: scores, examples: (learning.examples || 0) + 1 });
    }
    setTrained(true);
  }

  const stats = loadLearning();
  const avgAccuracy = stats.runs
    ? Math.round(((stats.totalAccuracy || 0) / stats.runs) * 100)
    : null;

  // ==========================================================================
  // Render
  // ==========================================================================
  return (
    <main className="min-h-screen bg-background px-4 py-6 text-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/menu"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft size={16} /> Main menu
          </Link>
          {tweet && (
            <a
              href={tweet}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
            >
              Open BIG Games post <ExternalLink size={14} />
            </a>
          )}
        </div>

        <Card className="tracker-card space-y-5 p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="tracker-avatar">
              <Brain />
            </div>
            <div>
              <p className="eyebrow">
                <span /> TRAINABLE PUZZLE LAB
              </p>
              <h1 className="text-2xl font-semibold sm:text-3xl">Image puzzle solver</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Multi-profile candidate search, multi-stage local optimiser, animated playback of
                every accepted move. No solver can guarantee perfection — confidence scores tell you
                when to double-check.
              </p>
              {avgAccuracy !== null && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Local training: {stats.runs} runs · avg ground-truth accuracy {avgAccuracy}%
                </p>
              )}
            </div>
          </div>

          {/* Uploads */}
          <div className="grid gap-4 lg:grid-cols-2">
            <label className="block cursor-pointer rounded-xl border border-dashed border-white/20 bg-card/40 p-4 text-center hover:border-primary/50">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => void chooseSource(e.target.files?.[0])}
              />
              <ImagePlus className="mx-auto mb-2" />
              <span className="block font-medium">Upload shuffled puzzle</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Full grid with outside border visible
              </span>
            </label>
            <label className="block cursor-pointer rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 text-center hover:border-primary">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                onChange={(e) => void chooseFinal(e.target.files?.[0])}
              />
              <CheckCircle2 className="mx-auto mb-2" />
              <span className="block font-medium">Upload final correct image for training</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Optional ground truth · raw image is not saved
              </span>
            </label>
          </div>

          {(image || finalImage) && (
            <div className="grid gap-4 md:grid-cols-2">
              {image && (
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Shuffled: {fileName}</p>
                  <img
                    src={image}
                    alt="Shuffled puzzle"
                    className="max-h-[420px] w-full rounded-xl border border-white/10 object-contain"
                  />
                </div>
              )}
              {finalImage && (
                <div>
                  <p className="mb-2 text-xs text-muted-foreground">Final: {finalFileName}</p>
                  <img
                    src={finalImage}
                    alt="Final correct result"
                    className="max-h-[420px] w-full rounded-xl border border-primary/20 object-contain"
                  />
                </div>
              )}
            </div>
          )}

          {/* Grid, crop, gutter */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="mb-2 block text-sm font-medium">Rows</label>
              <Input
                type="number"
                min={2}
                max={10}
                value={rows}
                onChange={(e) => setRows(Math.max(2, Math.min(10, Number(e.target.value) || 2)))}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Columns</label>
              <Input
                type="number"
                min={2}
                max={10}
                value={cols}
                onChange={(e) => setCols(Math.max(2, Math.min(10, Number(e.target.value) || 2)))}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Gutter %</label>
              <Input
                type="number"
                min={0}
                max={15}
                step={0.1}
                value={gutter}
                onChange={(e) => setGutter(Math.max(0, Math.min(15, Number(e.target.value) || 0)))}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Manual fallback if auto-crop misses borders.
              </p>
            </div>
            <div className="flex flex-col justify-between gap-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useAutoCrop}
                  onChange={(e) => setUseAutoCrop(e.target.checked)}
                />
                Auto-detect crop{" "}
                {autoCrop && <span className="text-xs text-muted-foreground">(found)</span>}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={maxAccuracy}
                  onChange={(e) => setMaxAccuracy(e.target.checked)}
                />
                <Gauge size={14} /> Maximum accuracy (slower)
              </label>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              onClick={solve}
              disabled={solving || !image}
              className="metal-button h-12 rounded-xl"
            >
              {solving ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
              {solving ? `${stage || "Solving"} ${progress}%` : "Generate best solutions"}
            </Button>
            <Button
              onClick={analyseFinal}
              disabled={training || !finalImage || !tiles.length}
              className="h-12 rounded-xl"
            >
              {training ? <LoaderCircle className="animate-spin" /> : <CheckCircle2 />}
              {training ? "Matching exact tiles…" : "Use final image as ground truth"}
            </Button>
          </div>

          {error && <p className="error-copy">{error}</p>}

          {confidence && (
            <div
              className={`status-pill ${
                confidence.level === "high"
                  ? "status-healthy"
                  : confidence.level === "medium"
                    ? "status-waiting"
                    : "status-warning"
              }`}
            >
              <CheckCircle2 size={14} />
              Confidence: {confidence.level.toUpperCase()} ({confidence.score}%) — agreement{" "}
              {(confidence.agree * 100).toFixed(0)}%, seam margin{" "}
              {(confidence.margin * 100).toFixed(1)}%
              {confidence.level === "low" && " — please double-check manually"}
            </div>
          )}

          {groundTruth && (
            <div
              className={`status-pill ${groundTruth.ambiguous.length ? "status-waiting" : "status-healthy"}`}
            >
              <CheckCircle2 size={14} />
              Ground-truth accuracy: {(groundTruth.accuracy * 100).toFixed(1)}%
              {groundTruth.ambiguous.length
                ? ` · ${groundTruth.ambiguous.length} ambiguous positions`
                : " · unique mapping"}
            </div>
          )}

          {!!candidates.length && (
            <section className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {candidates.map((c, i) => (
                  <Button
                    key={`${c.profile}-${i}`}
                    size="sm"
                    variant={active === i && !groundTruth ? "default" : "outline"}
                    onClick={() => void chooseCandidate(i)}
                  >
                    Option {i + 1} · {c.profile}
                  </Button>
                ))}
              </div>

              {/* Playback controls */}
              {playMoves.length > 0 && (
                <Card className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm">
                      <span className="font-medium">
                        Move {Math.min(moveIndex, playMoves.length)} of {playMoves.length}
                      </span>
                      {currentMove && (
                        <span className="ml-3 text-xs text-muted-foreground">
                          {currentMove.description}
                          {currentMove.scoreAfter !== 0 &&
                            ` · Δ ${(currentMove.scoreBefore - currentMove.scoreAfter).toFixed(3)}`}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void restartPlayback()}
                        disabled={transitioning}
                      >
                        <Undo2 size={14} /> Restart
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void stepBackward()}
                        disabled={transitioning || moveIndex === 0}
                      >
                        <StepBack size={14} />
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => setPlaying((p) => !p)}
                        disabled={transitioning || moveIndex >= playMoves.length}
                      >
                        {playing ? <Pause size={14} /> : <Play size={14} />}
                        {playing ? "Pause" : "Play"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void stepForward()}
                        disabled={transitioning || moveIndex >= playMoves.length}
                      >
                        <StepForward size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void skipToFinal()}
                        disabled={transitioning || moveIndex >= playMoves.length}
                      >
                        <SkipForward size={14} /> Skip
                      </Button>
                      <select
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                        className="rounded-md border border-white/10 bg-card/40 px-2 py-1 text-xs"
                      >
                        <option value={0.5}>0.5×</option>
                        <option value={1}>1×</option>
                        <option value={2}>2×</option>
                        <option value={4}>4×</option>
                      </select>
                    </div>
                  </div>
                  {totalOptimiseMoves > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Optimiser recorded {totalOptimiseMoves} accepted improvement moves for the
                      active candidate.
                    </p>
                  )}
                </Card>
              )}

              <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
                <div className="space-y-3">
                  <div
                    className="grid overflow-hidden rounded-xl border border-white/10"
                    style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
                  >
                    {order.map((tile, index) => {
                      const isHighlighted = highlight.has(index);
                      return (
                        <button
                          key={`slot-${index}`}
                          type="button"
                          onClick={() => void tapTile(index)}
                          className={`relative aspect-square overflow-hidden border border-black/30 transition-all duration-300 ${
                            selected === index ? "ring-4 ring-primary ring-inset z-10" : ""
                          } ${
                            isHighlighted
                              ? "ring-2 ring-amber-400 ring-inset scale-105 z-10 shadow-lg"
                              : ""
                          } ${
                            groundTruth?.ambiguous.includes(index)
                              ? "outline outline-2 outline-amber-400 outline-offset-[-2px]"
                              : ""
                          }`}
                          style={{
                            transition: `transform ${Math.max(120, 360 / speed)}ms ease, box-shadow 200ms ease`,
                          }}
                        >
                          <img
                            key={`tile-${tile}`}
                            src={tiles[tile]?.dataUrl}
                            alt={`Tile ${tile + 1}`}
                            className="h-full w-full object-fill transition-opacity duration-200"
                          />
                          <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px] text-white">
                            {tile + 1}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Tap two tiles to swap them (pause playback first). Amber outlines mark ambiguous
                    ground-truth positions.
                  </p>
                </div>

                <Card className="space-y-3 p-4">
                  <p className="panel-label">CURRENT RESULT</p>
                  {solvedImage && (
                    <img
                      src={solvedImage}
                      alt="Solved puzzle"
                      className="w-full rounded-lg border border-white/10"
                    />
                  )}
                  <p className="break-words text-xs text-muted-foreground">
                    Order: {order.map((v) => v + 1).join(", ")}
                  </p>
                  {groundTruth && (
                    <p className="text-xs text-muted-foreground">
                      Avg visual distance: {groundTruth.averageDistance.toFixed(5)}
                    </p>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => {
                      const target = groundTruth?.order || candidates[active].order;
                      setOrder(target);
                      void rebuildImage(target);
                      setPlayMoves([]);
                      setMoveIndex(0);
                    }}
                  >
                    <ChevronsRight /> Jump to arrangement
                  </Button>
                  <Button onClick={saveTraining}>
                    <Save />{" "}
                    {groundTruth ? "Save ground-truth training" : "Save correction as training"}
                  </Button>
                  {trained && (
                    <p className="status-pill status-healthy">
                      <CheckCircle2 size={14} /> Training saved locally
                    </p>
                  )}
                  {solvedImage && (
                    <a href={solvedImage} download={`solved-${fileName || "puzzle"}.png`}>
                      <Button variant="outline" className="w-full">
                        <Download /> Save PNG
                      </Button>
                    </a>
                  )}
                </Card>
              </div>
            </section>
          )}

          <p className="text-xs text-muted-foreground">
            Privacy: only learned scores and aggregate accuracy statistics are stored in this
            browser. Uploaded images are never persisted.
          </p>
        </Card>
      </div>
    </main>
  );
}
