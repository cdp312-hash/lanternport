// A tiny published world: two companies, trading days 1-16 October 2026.
// Latest edition Friday 16 Oct; its close is published (a weekend build).
const dates = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
  "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"];

export const WORLD = {
  today: "2026-10-16",
  completed: "2026-10-16",
  companies: [{ id: "fizzco", name: "Fizzco Drinks" }, { id: "thimble", name: "Thimble Bank" }],
  prices: {
    dates,
    index: dates.map((_, i) => 1000 + i * 5),
    closes: {
      fizzco: dates.map((_, i) => 10 + i), // rises steadily: 10 -> 21
      thimble: dates.map((_, i) => 100 - i * 2), // falls steadily: 100 -> 78
    },
  },
};
