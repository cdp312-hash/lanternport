import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { checkNickname } from "../src/nickname";

const BASE = "https://api.test";

async function call(method: string, path: string, opts: { token?: string; body?: unknown; origin?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.origin) headers.Origin = opts.origin;
  const res = await SELF.fetch(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, headers: res.headers, json: (await res.json().catch(() => null)) as any };
}

let counter = 0;
async function newPlayer(prefix = "Trader") {
  const res = await call("POST", "/players", { body: { nickname: `${prefix} ${++counter}` } });
  expect(res.status).toBe(201);
  return res.json as { id: string; nickname: string; token: string };
}

describe("nicknames", () => {
  it("accepts friendly names and rejects the rest", () => {
    expect(checkNickname("Big Sal 99")).toEqual({ name: "Big Sal 99" });
    expect(checkNickname("  Fizz   Fan ")).toEqual({ name: "Fizz Fan" });
    expect(checkNickname("ab")).toHaveProperty("error");
    expect(checkNickname("_underscore")).toHaveProperty("error");
    expect(checkNickname("sh1t trader")).toHaveProperty("error");
    expect(checkNickname("Lanternport HQ")).toHaveProperty("error");
  });

  it("creates a player, recognises their token, and rejects a duplicate in any case", async () => {
    const res = await call("POST", "/players", { body: { nickname: "Custard King" } });
    expect(res.status).toBe(201);
    expect(res.json.token).toMatch(/^[0-9a-f]{48}$/);
    const me = await call("GET", "/me", { token: res.json.token });
    expect(me.json).toEqual({ id: res.json.id, nickname: "Custard King" });
    const dup = await call("POST", "/players", { body: { nickname: "custard_king" } });
    expect(dup.status).toBe(409);
  });

  it("only stores a hash of the token", async () => {
    const p = await newPlayer();
    const row = await env.DB.prepare("SELECT token_hash FROM players WHERE id = ?").bind(p.id).first<{ token_hash: string }>();
    expect(row?.token_hash).not.toBe(p.token);
    expect(row?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("deletes a player and their Cup data on request", async () => {
    const p = await newPlayer();
    await call("PUT", "/cup/plan", { token: p.token, body: { targets: { fizzco: 30 } } });
    expect((await call("DELETE", "/me", { token: p.token })).json).toEqual({ deleted: true });
    expect((await call("GET", "/me", { token: p.token })).status).toBe(401);
    const left = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM cup_plans WHERE player_id = ?1) + (SELECT COUNT(*) FROM cup_seasons WHERE player_id = ?1) AS n").bind(p.id).first<{ n: number }>();
    expect(left?.n).toBe(0);
  });

  it("refuses unknown tokens", async () => {
    expect((await call("GET", "/me")).status).toBe(401);
    expect((await call("GET", "/me", { token: "nope" })).status).toBe(401);
  });
});

describe("Lantern Cup plans", () => {
  it("fills on Monday when placed at a weekend, whatever the browser says", async () => {
    const p = await newPlayer();
    const state = await call("GET", "/cup/state", { token: p.token });
    expect(state.json).toMatchObject({ fill: "2026-10-19", month: "2026-10", season: null });
    // A browser trying to choose its own (already published) fill day is ignored.
    const placed = await call("PUT", "/cup/plan", { token: p.token, body: { targets: { fizzco: 50 }, fill: "2026-10-02" } });
    expect(placed.status).toBe(200);
    expect(placed.json.season.plans).toEqual([expect.objectContaining({ fill: "2026-10-19", targets: { fizzco: 50 } })]);
    expect(placed.json.season.joined).toBe("2026-10-19"); // placing a plan joins the season
  });

  it("validates plans", async () => {
    const p = await newPlayer();
    expect((await call("PUT", "/cup/plan", { token: p.token, body: { targets: { nope: 10 } } })).json.error).toMatch(/no company/);
    expect((await call("PUT", "/cup/plan", { token: p.token, body: { targets: { fizzco: 80, thimble: 40 } } })).json.error).toMatch(/120%/);
    expect((await call("PUT", "/cup/plan", { token: p.token, body: { targets: { fizzco: "lots" } } })).status).toBe(400);
    expect((await call("PUT", "/cup/plan", { body: { targets: { fizzco: 10 } } })).status).toBe(401);
  });

  it("replaces and cancels today's plan", async () => {
    const p = await newPlayer();
    await call("PUT", "/cup/plan", { token: p.token, body: { targets: { fizzco: 50 } } });
    const updated = await call("PUT", "/cup/plan", { token: p.token, body: { targets: { thimble: 20 } } });
    expect(updated.json.season.plans).toHaveLength(1);
    expect(updated.json.season.plans[0].targets).toEqual({ thimble: 20 });
    const cancelled = await call("DELETE", "/cup/plan", { token: p.token });
    expect(cancelled.json.season.plans).toEqual([]);
  });
});

describe("leaderboard", () => {
  it("ranks players by value using published closes only", async () => {
    const bull = await newPlayer("Bull");
    const bear = await newPlayer("Bear");
    const idle = await newPlayer("Idle");
    // Seed past plans directly (the API itself only allows plans for the next close).
    await env.DB.batch([
      env.DB.prepare("INSERT INTO cup_seasons VALUES (?, '2026-10', '2026-10-01')").bind(bull.id),
      env.DB.prepare("INSERT INTO cup_seasons VALUES (?, '2026-10', '2026-10-01')").bind(bear.id),
      env.DB.prepare("INSERT INTO cup_seasons VALUES (?, '2026-10', '2026-10-01')").bind(idle.id),
      env.DB.prepare("INSERT INTO cup_plans VALUES (?, '2026-10-01', '2026-10', '{\"fizzco\":100}', '2026-10-01T09:00:00Z')").bind(bull.id),
      env.DB.prepare("INSERT INTO cup_plans VALUES (?, '2026-10-01', '2026-10', '{\"thimble\":100}', '2026-10-01T09:00:00Z')").bind(bear.id),
      // A plan for a close that isn't published yet can't count.
      env.DB.prepare("INSERT INTO cup_plans VALUES (?, '2026-10-19', '2026-10', '{\"fizzco\":100}', '2026-10-17T09:00:00Z')").bind(idle.id),
    ]);
    const board = await call("GET", "/cup/leaderboard?month=2026-10", { token: bear.token });
    const names = board.json.rows.map((r: { nickname: string }) => r.nickname);
    expect(names.indexOf(bull.nickname)).toBeLessThan(names.indexOf(idle.nickname));
    expect(names.indexOf(idle.nickname)).toBeLessThan(names.indexOf(bear.nickname));
    const idleRow = board.json.rows.find((r: { nickname: string }) => r.nickname === idle.nickname);
    expect(idleRow.value).toBe(10_000);
    // Bull bought at 10 and Fizzco closed at 21: about +110% less fees.
    const bullRow = board.json.rows.find((r: { nickname: string }) => r.nickname === bull.nickname);
    expect(bullRow.return_pct).toBeGreaterThan(100);
    expect(board.json.you).toMatchObject({ nickname: bear.nickname, me: true });
    expect(board.json.completed).toBe("2026-10-16");
  });
});

describe("plumbing", () => {
  it("sends CORS headers only to the site's own origins", async () => {
    const ok = await call("GET", "/health", { origin: "https://cdp312-hash.github.io" });
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe("https://cdp312-hash.github.io");
    const other = await call("GET", "/health", { origin: "https://evil.example" });
    expect(other.headers.get("Access-Control-Allow-Origin")).toBeNull();
    const pre = await SELF.fetch(`${BASE}/cup/plan`, { method: "OPTIONS", headers: { Origin: "http://localhost:5174" } });
    expect(pre.status).toBe(204);
  });

  it("answers unknown routes and bad JSON clearly", async () => {
    expect((await call("GET", "/nowhere")).status).toBe(404);
    const res = await SELF.fetch(`${BASE}/players`, { method: "POST", body: "not json" });
    expect(res.status).toBe(400);
  });
});
