// The Lanternport API (Cloudflare Worker + D1).
//
//   POST   /players            {nickname}        -> {id, nickname, token}   (token: keep it secret, send as Bearer)
//   GET    /me                                   -> {id, nickname}
//   DELETE /me                                   -> delete the player and everything stored about them
//   GET    /cup/state                            -> today's fill day and your season (if joined)
//   POST   /cup/join                             -> join this month's season
//   PUT    /cup/plan          {targets}          -> set your plan for today's close
//   DELETE /cup/plan                             -> cancel today's plan
//   GET    /cup/leaderboard?month=YYYY-MM        -> top 100 (and your rank, if signed in)
//
// The server decides when a plan fills: today's close in UK time (Monday's at a weekend), never
// before the latest published edition. The browser can't choose, so nobody can trade on a price
// that's already been published. Scores are computed with the same code the site uses (src/cup.ts),
// from the prices the site publishes.

import { fillDayFor, runSeason, validateTargets, type Plan, type PriceBook } from "../../src/cup";
import { checkNickname, nicknameKey } from "./nickname";

export interface Env {
  DB: D1Database;
  SITE_URL: string;
  ALLOWED_ORIGINS: string;
  FAKE_NOW?: string; // tests only: pretend the current time is this ISO timestamp
}

interface WorldIndex {
  today: string;
  completed: string;
  companies: { id: string; name: string }[];
  prices: PriceBook;
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const MAX_SIGNUPS_PER_IP_PER_DAY = 10;
const LEADERBOARD_SIZE = 100;
const WORLD_TTL_MS = 5 * 60_000;

// --- Helpers ---------------------------------------------------------------------------

function now(env: Env): Date {
  return env.FAKE_NOW ? new Date(env.FAKE_NOW) : new Date();
}

/** Today's date in Lanternport, which keeps UK time. */
function londonDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let worldCache: { at: number; url: string; data: WorldIndex } | null = null;

async function loadWorld(env: Env): Promise<WorldIndex> {
  const url = `${env.SITE_URL}/world/index.json`;
  if (worldCache && worldCache.url === url && Date.now() - worldCache.at < WORLD_TTL_MS) return worldCache.data;
  const res = await fetch(url);
  if (!res.ok) throw new HttpError(503, "The Ledger's prices aren't available right now. Try again shortly.");
  const data = (await res.json()) as WorldIndex;
  worldCache = { at: Date.now(), url, data };
  return data;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, "Send a JSON object.");
}

async function requirePlayer(request: Request, env: Env): Promise<{ id: string; nickname: string }> {
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new HttpError(401, "Choose a nickname first.");
  const row = await env.DB.prepare("SELECT id, nickname FROM players WHERE token_hash = ?").bind(await sha256(token)).first<{ id: string; nickname: string }>();
  if (!row) throw new HttpError(401, "We don't recognise this browser. Choose a nickname again.");
  return row;
}

async function optionalPlayer(request: Request, env: Env) {
  return request.headers.has("Authorization") ? requirePlayer(request, env).catch(() => null) : null;
}

// --- Handlers ----------------------------------------------------------------------------

async function createPlayer(request: Request, env: Env) {
  const body = await readJson(request);
  const check = checkNickname(body.nickname);
  if ("error" in check) throw new HttpError(400, check.error);

  const day = londonDate(now(env));
  const ipHash = await sha256(`${request.headers.get("CF-Connecting-IP") ?? "local"}|${day}`);
  const seen = await env.DB.prepare("SELECT count FROM signups WHERE ip_hash = ? AND day = ?").bind(ipHash, day).first<{ count: number }>();
  if ((seen?.count ?? 0) >= MAX_SIGNUPS_PER_IP_PER_DAY) throw new HttpError(429, "Too many new nicknames from here today. Try again tomorrow.");

  const id = randomHex(8);
  const token = randomHex(24);
  try {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO players (id, nickname, nickname_key, token_hash, created_at) VALUES (?, ?, ?, ?, ?)")
        .bind(id, check.name, nicknameKey(check.name), await sha256(token), now(env).toISOString()),
      env.DB.prepare("INSERT INTO signups (ip_hash, day, count) VALUES (?, ?, 1) ON CONFLICT (ip_hash, day) DO UPDATE SET count = count + 1")
        .bind(ipHash, day),
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE")) throw new HttpError(409, "That nickname is taken. Try another.");
    throw e;
  }
  return { status: 201, body: { id, nickname: check.name, token } };
}

async function cupState(env: Env, playerId: string) {
  const world = await loadWorld(env);
  const fill = fillDayFor(londonDate(now(env)), world.today);
  const month = fill.slice(0, 7);
  const season = await env.DB.prepare("SELECT joined FROM cup_seasons WHERE player_id = ? AND month = ?").bind(playerId, month).first<{ joined: string }>();
  let plans: Plan[] = [];
  if (season) {
    const rows = await env.DB.prepare("SELECT fill, targets, placed_at FROM cup_plans WHERE player_id = ? AND month = ? ORDER BY fill")
      .bind(playerId, month).all<{ fill: string; targets: string; placed_at: string }>();
    plans = rows.results.map((r) => ({ fill: r.fill, targets: JSON.parse(r.targets), placed: r.placed_at }));
  }
  return { fill, month, today: world.today, completed: world.completed, season: season ? { joined: season.joined, plans } : null };
}

async function joinCup(env: Env, playerId: string) {
  const state = await cupState(env, playerId);
  if (!state.season) {
    await env.DB.prepare("INSERT OR IGNORE INTO cup_seasons (player_id, month, joined) VALUES (?, ?, ?)").bind(playerId, state.month, state.fill).run();
  }
  return cupState(env, playerId);
}

async function setPlan(request: Request, env: Env, playerId: string) {
  const body = await readJson(request);
  const world = await loadWorld(env);
  const known = new Set(world.companies.map((c) => c.id));
  if (!body.targets || typeof body.targets !== "object" || Array.isArray(body.targets)) throw new HttpError(400, "Send your plan as {targets: {company: percent}}.");
  const targets: Record<string, number> = {};
  for (const [id, pct] of Object.entries(body.targets as Record<string, unknown>)) {
    if (!known.has(id)) throw new HttpError(400, `There's no company called "${id}" on the Exchange.`);
    if (typeof pct !== "number" || !Number.isFinite(pct)) throw new HttpError(400, "Percentages must be numbers.");
    if (pct > 0) targets[id] = Math.round(pct * 100) / 100;
  }
  const problem = validateTargets(targets);
  if (problem) throw new HttpError(400, problem);

  const state = await joinCup(env, playerId);
  await env.DB.prepare(
    "INSERT INTO cup_plans (player_id, fill, month, targets, placed_at) VALUES (?, ?, ?, ?, ?) " +
    "ON CONFLICT (player_id, fill) DO UPDATE SET targets = excluded.targets, placed_at = excluded.placed_at",
  ).bind(playerId, state.fill, state.month, JSON.stringify(targets), now(env).toISOString()).run();
  return cupState(env, playerId);
}

async function cancelPlan(env: Env, playerId: string) {
  const state = await cupState(env, playerId);
  if (state.fill <= state.completed) throw new HttpError(409, "That plan has already filled.");
  await env.DB.prepare("DELETE FROM cup_plans WHERE player_id = ? AND fill = ?").bind(playerId, state.fill).run();
  return cupState(env, playerId);
}

async function leaderboard(request: Request, env: Env) {
  const world = await loadWorld(env);
  const param = new URL(request.url).searchParams.get("month");
  const month = param && /^\d{4}-\d{2}$/.test(param) ? param : fillDayFor(londonDate(now(env)), world.today).slice(0, 7);

  const seasons = await env.DB.prepare("SELECT s.player_id, s.joined, p.nickname FROM cup_seasons s JOIN players p ON p.id = s.player_id WHERE s.month = ?")
    .bind(month).all<{ player_id: string; joined: string; nickname: string }>();
  // Only plans whose close has been published can affect scores.
  const planRows = await env.DB.prepare("SELECT player_id, fill, targets, placed_at FROM cup_plans WHERE month = ? AND fill <= ?")
    .bind(month, world.completed).all<{ player_id: string; fill: string; targets: string; placed_at: string }>();
  const plansBy = new Map<string, Plan[]>();
  for (const r of planRows.results) {
    const list = plansBy.get(r.player_id) ?? [];
    list.push({ fill: r.fill, targets: JSON.parse(r.targets), placed: r.placed_at });
    plansBy.set(r.player_id, list);
  }
  const scored = seasons.results.map((s) => {
    const season = runSeason(world.prices, plansBy.get(s.player_id) ?? [], month, s.joined);
    return { id: s.player_id, nickname: s.nickname, value: season.value, joined: s.joined };
  }).sort((a, b) => b.value - a.value || a.joined.localeCompare(b.joined) || a.nickname.localeCompare(b.nickname));

  const me = await optionalPlayer(request, env);
  const rows = scored.map((s, i) => ({
    rank: i + 1, nickname: s.nickname, value: Math.round(s.value * 100) / 100,
    return_pct: Math.round((s.value / 10_000 - 1) * 10_000) / 100, me: me?.id === s.id,
  }));
  return {
    month, completed: world.completed, players: rows.length,
    rows: rows.slice(0, LEADERBOARD_SIZE),
    you: me ? rows.find((r) => r.me) ?? null : null,
  };
}

// --- Routing -------------------------------------------------------------------------------

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  if (!allowed.includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function route(request: Request, env: Env): Promise<{ status?: number; body: unknown }> {
  const { pathname } = new URL(request.url);
  const key = `${request.method} ${pathname.replace(/\/+$/, "") || "/"}`;
  switch (key) {
    case "GET /":
    case "GET /health":
      return { body: { ok: true, service: "lanternport-api" } };
    case "POST /players":
      return createPlayer(request, env);
    case "GET /me": {
      const p = await requirePlayer(request, env);
      return { body: { id: p.id, nickname: p.nickname } };
    }
    case "DELETE /me": {
      const p = await requirePlayer(request, env);
      // Explicit deletes rather than relying on foreign-key cascades being enabled.
      await env.DB.batch([
        env.DB.prepare("DELETE FROM cup_plans WHERE player_id = ?").bind(p.id),
        env.DB.prepare("DELETE FROM cup_seasons WHERE player_id = ?").bind(p.id),
        env.DB.prepare("DELETE FROM players WHERE id = ?").bind(p.id),
      ]);
      return { body: { deleted: true } };
    }
    case "GET /cup/state":
      return { body: await cupState(env, (await requirePlayer(request, env)).id) };
    case "POST /cup/join":
      return { body: await joinCup(env, (await requirePlayer(request, env)).id) };
    case "PUT /cup/plan":
      return { body: await setPlan(request, env, (await requirePlayer(request, env)).id) };
    case "DELETE /cup/plan":
      return { body: await cancelPlan(env, (await requirePlayer(request, env)).id) };
    case "GET /cup/leaderboard":
      return { body: await leaderboard(request, env) };
    default:
      throw new HttpError(404, "Not found.");
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const headers = { ...cors(request, env), "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    try {
      const { status = 200, body } = await route(request, env);
      return new Response(JSON.stringify(body), { status, headers });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      const message = e instanceof HttpError ? e.message : "Something went wrong on our side. Please try again.";
      return new Response(JSON.stringify({ error: message }), { status, headers });
    }
  },
} satisfies ExportedHandler<Env>;
