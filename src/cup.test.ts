import { describe, expect, it } from "vitest";
import { CUP_FEE, CUP_START, fillDayFor, lastTradingDayOfMonth, runSeason, tradingDayOnOrAfter, validateTargets, type PriceBook } from "./cup";

// Mon 5 Oct to Fri 9 Oct 2026, plus Mon 12 Oct.
const book: PriceBook = {
  dates: ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12"],
  index: [1000, 1010, 1020, 1000, 990, 1000],
  closes: {
    fizz: [10, 11, 12, 12, 9, 10],
    bank: [100, 100, 110, 110, 110, 121],
  },
};
const plan = (fill: string, targets: Record<string, number>, placed = `${fill}T09:00:00Z`) => ({ fill, targets, placed });

describe("calendar", () => {
  it("rolls weekends forward to Monday", () => {
    expect(tradingDayOnOrAfter("2026-10-10")).toBe("2026-10-12"); // Saturday
    expect(tradingDayOnOrAfter("2026-10-09")).toBe("2026-10-09");
  });

  it("never fills before the latest edition, whatever the device clock says", () => {
    expect(fillDayFor("2026-10-07", "2026-10-07")).toBe("2026-10-07");
    expect(fillDayFor("2026-10-05", "2026-10-07")).toBe("2026-10-07"); // clock set back two days
    expect(fillDayFor("2026-10-17", "2026-10-16")).toBe("2026-10-19"); // Saturday -> Monday
  });

  it("knows the last trading day of a month", () => {
    expect(lastTradingDayOfMonth("2026-10")).toBe("2026-10-30"); // 31 Oct 2026 is a Saturday
    expect(lastTradingDayOfMonth("2026-11")).toBe("2026-11-30");
  });
});

describe("validateTargets", () => {
  it("allows up to five holdings adding to at most 100%", () => {
    expect(validateTargets({ a: 50, b: 50 })).toBeNull();
    expect(validateTargets({ a: 60, b: 50 })).toMatch(/110%/);
    expect(validateTargets({ a: 10, b: 10, c: 10, d: 10, e: 10, f: 10 })).toMatch(/at most 5/);
  });
});

describe("runSeason", () => {
  it("stays in cash with no plans", () => {
    const s = runSeason(book, [], "2026-10", "2026-10-05");
    expect(s.value).toBe(CUP_START);
    expect(s.series).toHaveLength(6);
  });

  it("fills at the plan's close and marks to later closes, by hand", () => {
    const s = runSeason(book, [plan("2026-10-06", { fizz: 50 })], "2026-10", "2026-10-05");
    const spend = 5_000; // half of 10,000, bought at 11
    const shares = spend / 11;
    const cash = CUP_START - spend * (1 + CUP_FEE);
    expect(s.executions).toHaveLength(1);
    expect(s.executions[0].trades[0].shares).toBeCloseTo(shares, 9);
    expect(s.series[2].value).toBeCloseTo(cash + shares * 12, 6); // 7 Oct close
    expect(s.value).toBeCloseTo(cash + shares * 10, 6); // 12 Oct close
  });

  it("rebalances, selling before buying", () => {
    const s = runSeason(book, [plan("2026-10-05", { fizz: 100 }), plan("2026-10-07", { bank: 100 })], "2026-10", "2026-10-05");
    const [, second] = s.executions;
    expect(second.trades.map((t) => t.id)).toEqual(["fizz", "bank"]);
    expect(s.holdings.fizz).toBeUndefined();
    expect(s.cash).toBeGreaterThanOrEqual(0);
    expect(s.holdings.bank * 121 + s.cash).toBeCloseTo(s.value, 6);
  });

  it("uses the latest plan placed for a day", () => {
    const s = runSeason(book, [
      plan("2026-10-06", { fizz: 100 }, "2026-10-06T08:00:00Z"),
      plan("2026-10-06", { bank: 40 }, "2026-10-06T15:00:00Z"),
    ], "2026-10", "2026-10-05");
    expect(Object.keys(s.holdings)).toEqual(["bank"]);
  });

  it("reports a plan whose close isn't published yet as pending", () => {
    const s = runSeason(book, [plan("2026-10-13", { fizz: 20 })], "2026-10", "2026-10-05");
    expect(s.pending?.fill).toBe("2026-10-13");
    expect(s.executions).toHaveLength(0);
  });

  it("ignores plans for other months and days before joining", () => {
    const s = runSeason(book, [plan("2026-09-30", { fizz: 100 }), plan("2026-10-05", { fizz: 100 })], "2026-10", "2026-10-06");
    expect(s.executions).toHaveLength(0);
    expect(s.series[0].date).toBe("2026-10-06");
  });

  it("tracks the index from the day you joined", () => {
    const s = runSeason(book, [], "2026-10", "2026-10-06");
    expect(s.series[0].index).toBe(CUP_START);
    expect(s.series[s.series.length - 1].index).toBeCloseTo((1000 / 1010) * CUP_START, 6);
  });
});
