import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type Row = Record<string, any>;
type State = { tables: Record<string, Row[]>; secrets: Record<string, string>; lockUntil: number };

const STORE_PATH = process.env.TRACKER_DATA_FILE || "/tmp/ambunctious-tracker.json";
const g = globalThis as typeof globalThis & { __ambunctiousState?: State; __ambunctiousLoading?: Promise<State> };

function seed(): State {
  const now = new Date().toISOString();
  return {
    tables: {
      tracked_x_accounts: [], tracked_products: [], price_history: [], tracked_roblox_entities: [],
      tracked_roblox_experiences: [], tracked_websites: [{ id: crypto.randomUUID(), label: "BIG Games", url: "https://www.biggames.io/post", last_item_url: null, last_item_title: null, last_checked_at: null, last_error: null, created_at: now, updated_at: now }],
      tracker_notification_events: [], tracker_api_releases: [], tracker_scan_runs: [], tracker_discord_status: [],
    },
    secrets: {},
    lockUntil: 0,
  };
}

async function persist(state: State) {
  try {
    await mkdir(dirname(STORE_PATH), { recursive: true });
    await writeFile(STORE_PATH, JSON.stringify(state), "utf8");
  } catch (error) {
    console.error("Could not persist tracker data", error);
  }
}

export async function getState(): Promise<State> {
  if (g.__ambunctiousState) return g.__ambunctiousState;
  if (!g.__ambunctiousLoading) {
    g.__ambunctiousLoading = (async () => {
      try {
        const parsed = JSON.parse(await readFile(STORE_PATH, "utf8")) as State;
        if (parsed?.tables && parsed?.secrets) return parsed;
      } catch {}
      const initial = seed();
      await persist(initial);
      return initial;
    })();
  }
  g.__ambunctiousState = await g.__ambunctiousLoading;
  return g.__ambunctiousState;
}

export async function saveState() { await persist(await getState()); }
export function newRow(input: Row): Row {
  const now = new Date().toISOString();
  return { id: input.id ?? crypto.randomUUID(), created_at: input.created_at ?? now, updated_at: input.updated_at ?? now, ...input };
}

export function matches(row: Row, filters: Array<[string, any]>) {
  return filters.every(([key, value]) => row[key] === value);
}
