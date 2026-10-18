import type { Bar } from "./engine";

export interface Company {
  name: string;
  sector: string; // fictional/world: the sector; history: the year(s)
  what: string;
  ticker?: string;
  id?: string; // world: company page id
  district?: string;
  boss?: string;
  archive?: string; // world: season and year of the archive round, e.g. "Spring 2021"
}

export interface NewsItem {
  i: number; // bar index; the news came out after this bar's close
  text: string;
}

export interface RecapItem extends NewsItem {
  kind: string;
  lesson: string;
  days: number;
  move: number; // % move from the next open over `days`
}

export interface HistoryAnswer {
  ticker: string;
  name: string;
  what: string;
  start: string;
  end: string;
  after_end: string;
}

interface Base {
  n: number;
  company: Company;
  context: Bar[];
  game: Bar[];
  after: Bar[];
  news: NewsItem[];
}

export type Puzzle =
  | (Base & { mode: "fictional" | "world"; reveal: { recap: RecapItem[] } })
  | (Base & { mode: "history"; reveal: HistoryAnswer });

interface Index {
  count: number;
  epoch: string;
}

const base = import.meta.env.BASE_URL;

export async function loadIndex(): Promise<Index> {
  const res = await fetch(`${base}puzzles/index.json`);
  if (!res.ok) throw new Error("Couldn't load today's puzzle list.");
  return res.json();
}

export async function loadPuzzle(n: number): Promise<Puzzle> {
  const res = await fetch(`${base}puzzles/${n}.json`);
  if (!res.ok) throw new Error(`Couldn't load puzzle #${n}.`);
  const raw = await res.json();
  const bytes = Uint8Array.from(atob(raw.reveal), (c) => c.charCodeAt(0));
  return { ...raw, mode: raw.mode ?? "history", news: raw.news ?? [], reveal: JSON.parse(new TextDecoder().decode(bytes)) };
}

const DAY_MS = 86_400_000;

function localMidnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Today's puzzle number in the player's local time zone (#1 on the epoch date; cycles after the last). */
export function todaysNumber(index: Index, now = new Date()): number {
  const [y, m, d] = index.epoch.split("-").map(Number);
  const days = Math.round((localMidnight(now) - new Date(y, m - 1, d).getTime()) / DAY_MS);
  const n = Math.max(days, 0);
  return (n % index.count) + 1;
}

export function msUntilTomorrow(now = new Date()): number {
  return localMidnight(now) + DAY_MS - now.getTime();
}
