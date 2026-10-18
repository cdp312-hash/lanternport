// Client for the Lanternport API (worker/). Off unless VITE_API_URL is set at build time, in which
// case the Lantern Cup uses the server (shared leaderboards, server-decided fill days) instead of
// saving only in this browser.
import type { Plan } from "./cup";

const API = (import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const PLAYER_KEY = "lanternport:player";

export const apiEnabled = () => API !== "";

export interface Player {
  id: string;
  nickname: string;
  token: string;
}

export interface CupServerState {
  fill: string;
  month: string;
  today: string;
  completed: string;
  season: { joined: string; plans: Plan[] } | null;
}

export interface LeaderRow {
  rank: number;
  nickname: string;
  value: number;
  return_pct: number;
  me: boolean;
}

export interface Leaderboard {
  month: string;
  completed: string;
  players: number;
  rows: LeaderRow[];
  you: LeaderRow | null;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function getPlayer(): Player | null {
  try {
    return JSON.parse(localStorage.getItem(PLAYER_KEY) ?? "null");
  } catch {
    return null;
  }
}

function setPlayer(p: Player | null) {
  try {
    if (p) localStorage.setItem(PLAYER_KEY, JSON.stringify(p));
    else localStorage.removeItem(PLAYER_KEY);
  } catch {
    /* storage unavailable */
  }
}

async function request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const player = getPlayer();
  if (auth && player) headers.Authorization = `Bearer ${player.token}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, "Can't reach the Lanternport server. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && auth) setPlayer(null); // the server no longer knows this browser
    throw new ApiError(res.status, data.error ?? `Something went wrong (${res.status}).`);
  }
  return data as T;
}

export async function createPlayer(nickname: string): Promise<Player> {
  const p = await request<Player>("POST", "/players", { nickname }, false);
  setPlayer(p);
  return p;
}

export async function forgetMe(): Promise<void> {
  await request("DELETE", "/me");
  setPlayer(null);
}

export const cupState = () => request<CupServerState>("GET", "/cup/state");
export const joinCup = () => request<CupServerState>("POST", "/cup/join");
export const setPlan = (targets: Record<string, number>) => request<CupServerState>("PUT", "/cup/plan", { targets });
export const cancelPlan = () => request<CupServerState>("DELETE", "/cup/plan");
export const leaderboard = (month?: string) =>
  request<Leaderboard>("GET", `/cup/leaderboard${month ? `?month=${month}` : ""}`, undefined, getPlayer() !== null);
