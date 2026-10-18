import { describe, expect, it } from "vitest";
import { FEE, START, bestPossible, buyAndHold, pctChange, percentile, play, randomFinals, shareText, squares, type Bar } from "./engine";

const bar = (open: number, close: number): Bar => [open, Math.max(open, close), Math.min(open, close), close];

describe("play", () => {
  it("staying in cash keeps the starting value", () => {
    const r = play([bar(100, 110), bar(110, 90)], [0, 0]);
    expect(r.final).toBe(START);
    expect(r.fees).toBe(0);
  });

  it("buying all in at the open pays the fee and tracks the close", () => {
    const r = play([bar(100, 110)], [1]);
    const buy = START / (1 + FEE);
    expect(r.days[0].fee).toBeCloseTo(buy * FEE, 6);
    expect(r.final).toBeCloseTo((buy / 100) * 110, 6);
  });

  it("rebalances to the chosen fraction at each open", () => {
    const game = [bar(100, 100), bar(100, 120)];
    const r = play(game, [1, 0.5]);
    // Day 1: all in at 100, flat day. Day 2: sell half the position at 100, then the other half gains 20%.
    const shares = START / (1 + FEE) / 100;
    const value = shares * 100;
    const sell = value / 2;
    const cash = sell * (1 - FEE);
    expect(r.final).toBeCloseTo(cash + (shares / 2) * 120, 6);
    expect(r.days[1].alloc).toBe(0.5);
  });

  it("never spends more cash than it has", () => {
    const r = play([bar(100, 50), bar(50, 50)], [1, 1]);
    expect(r.days.every((d) => d.value > 0)).toBe(true);
  });
});

describe("benchmarks", () => {
  const game = [bar(100, 105), bar(104, 102), bar(103, 110), bar(111, 108)];

  it("buy and hold is all in from day one", () => {
    expect(buyAndHold(game)).toBeCloseTo(play(game, [1, 1, 1, 1]).final, 9);
  });

  it("perfect hindsight beats buy and hold and random traders", () => {
    const best = bestPossible(game);
    expect(best).toBeGreaterThan(buyAndHold(game));
    expect(Math.max(...randomFinals(game, 300, 1))).toBeLessThanOrEqual(best + 1e-9);
  });

  it("random traders are deterministic per seed and sorted", () => {
    const a = randomFinals(game, 50, 42);
    expect(a).toEqual(randomFinals(game, 50, 42));
    expect([...a].sort((x, y) => x - y)).toEqual(a);
    expect(a).not.toEqual(randomFinals(game, 50, 43));
  });

  it("percentile counts values strictly below", () => {
    expect(percentile(5, [1, 2, 5, 6])).toBe(50);
    expect(percentile(100, [1, 2])).toBe(100);
    expect(percentile(0, [1, 2])).toBe(0);
  });
});

describe("sharing", () => {
  it("one square per day: cash, gain or loss", () => {
    const r = play([bar(100, 110), bar(110, 100), bar(100, 120)], [1, 1, 0]);
    expect(squares(r.days)).toBe("🟩🟥⬜");
  });

  it("share text is a short headline, the comparison and the link", () => {
    const game = Array.from({ length: 30 }, (_, i) => bar(100 + i, 101 + i));
    const cash = play(game, Array(30).fill(0)); // stayed in cash while it rose
    const text = shareText({ title: "Daily Trade", n: 71, practice: false, subject: "Moderna 2020", result: cash, bh: buyAndHold(game), url: "https://example.com" });
    expect(text.split("\n")).toEqual([
      "Daily Trade #71 · Moderna 2020",
      `📈 0.0% vs buy & hold +${pctChange(buyAndHold(game)).toFixed(1)}% ❌`,
      "https://example.com",
    ]);
  });

  it("marks a win and omits an empty link", () => {
    const game = [bar(100, 90), bar(90, 80)];
    const out = play(game, [0, 0]);
    const lines = shareText({ title: "T", n: 1, practice: true, subject: "Boeing 2020", result: out, bh: buyAndHold(game), url: "" }).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("T practice #1 · Boeing 2020");
    expect(lines[1].endsWith("✅")).toBe(true);
  });
});
