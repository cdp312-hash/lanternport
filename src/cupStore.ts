// The player's Lantern Cup seasons, kept in this browser. Guarded: storage can be unavailable.
import { CUP_START, fillDayFor, runSeason, type Plan, type SeasonState } from "./cup";
import type { WorldIndex } from "./world";

const KEY = "lanternport:cup";

export interface SeasonRecord {
  joined: string;
  plans: Plan[];
}

type Store = Record<string, SeasonRecord>; // by month, YYYY-MM

export function loadCup(): Store {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function save(store: Store): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    return false;
  }
}

export function joinSeason(month: string, joined: string): Store {
  const store = loadCup();
  if (!store[month]) store[month] = { joined, plans: [] };
  save(store);
  return store;
}

export function placePlan(month: string, plan: Plan): Store {
  const store = loadCup();
  const season = store[month];
  if (!season) throw new Error("Join the season first.");
  season.plans = [...season.plans.filter((p) => p.fill !== plan.fill), plan];
  if (!save(store)) throw new Error("Your browser didn't let us save the plan (private browsing?).");
  return store;
}

export function cancelPlan(month: string, fill: string): Store {
  const store = loadCup();
  if (store[month]) store[month].plans = store[month].plans.filter((p) => p.fill !== fill);
  save(store);
  return store;
}

export function localToday(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** What a plan placed right now applies to, and the player's current season (if they've joined). */
export function currentCup(world: WorldIndex, store = loadCup()): { fillDay: string; month: string; season: SeasonState | null } {
  const fillDay = fillDayFor(localToday(), world.today);
  const month = fillDay.slice(0, 7);
  const record = store[month];
  return { fillDay, month, season: record ? runSeason(world.prices, record.plans, month, record.joined) : null };
}

export function seasonReturn(season: SeasonState): number {
  return (season.value / CUP_START - 1) * 100;
}
