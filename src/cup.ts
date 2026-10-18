// The Lantern Cup: a monthly trading season on the live world.
//
// Each month every player starts with £10,000. On any day they can set a plan: up to MAX_HOLDINGS
// companies with a target % of the portfolio each, the rest in cash. A plan fills at the close of its
// fill day; the latest plan placed for a day wins. Prices for a day are published the next morning,
// so results appear then. Everything here is a pure function of the published prices and the plans.

export const CUP_START = 10_000;
export const CUP_FEE = 0.001;
export const MAX_HOLDINGS = 5;

export interface Plan {
  placed: string; // ISO timestamp
  fill: string; // YYYY-MM-DD: trading day whose close it fills at
  targets: Record<string, number>; // company id -> % of portfolio (0-100)
}

export interface PriceBook {
  dates: string[]; // trading days, ascending; the last is the latest finished day
  index: number[];
  closes: Record<string, number[]>;
}

export interface Trade {
  id: string;
  shares: number; // + bought, - sold
  price: number;
  value: number;
}

export interface Execution {
  date: string;
  trades: Trade[];
  fee: number;
  value: number; // portfolio value after the trades, at that close
}

export interface SeasonState {
  month: string; // YYYY-MM
  joined: string; // first trading day counted
  holdings: Record<string, number>; // shares
  cash: number;
  value: number; // at the latest finished close
  series: { date: string; value: number; index: number }[];
  executions: Execution[];
  pending: Plan | null; // a plan waiting for a close that hasn't been published yet
  finished: boolean; // the month's last trading day has been published
}

const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The first trading day (Monday-Friday) on or after the given date. */
export function tradingDayOnOrAfter(iso: string): string {
  let day = iso;
  while (isWeekend(new Date(`${day}T00:00:00Z`))) day = addDays(day, 1);
  return day;
}

/** The trading day a plan placed now fills at: today's close (or Monday's at a weekend).
 * Never earlier than the latest edition, so a device clock set to the past can't buy at a known price. */
export function fillDayFor(localDate: string, latestEdition: string): string {
  return tradingDayOnOrAfter(localDate > latestEdition ? localDate : latestEdition);
}

export function lastTradingDayOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  let day = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); // last calendar day
  while (isWeekend(new Date(`${day}T00:00:00Z`))) day = addDays(day, -1);
  return day;
}

export function validateTargets(targets: Record<string, number>): string | null {
  const entries = Object.entries(targets).filter(([, v]) => v > 0);
  if (entries.length > MAX_HOLDINGS) return `Pick at most ${MAX_HOLDINGS} companies.`;
  if (entries.some(([, v]) => !Number.isFinite(v) || v < 0 || v > 100)) return "Each holding must be between 0% and 100%.";
  const total = entries.reduce((s, [, v]) => s + v, 0);
  if (total > 100.0001) return `Your plan adds up to ${Math.round(total)}%. Keep it at 100% or less; the rest stays in cash.`;
  return null;
}

/** Score a season from the published prices and the player's plans. */
export function runSeason(book: PriceBook, plans: Plan[], month: string, joined: string): SeasonState {
  const latest = new Map<string, Plan>();
  for (const p of [...plans].sort((a, b) => a.placed.localeCompare(b.placed))) {
    if (p.fill.slice(0, 7) === month && p.fill >= joined) latest.set(p.fill, p);
  }
  let cash = CUP_START;
  const holdings: Record<string, number> = {};
  const executions: Execution[] = [];
  const series: SeasonState["series"] = [];
  let baseIndex: number | null = null;
  const priceOn = (id: string, i: number) => book.closes[id]?.[i];

  book.dates.forEach((date, i) => {
    if (date < joined || date.slice(0, 7) !== month) return;
    const plan = latest.get(date);
    if (plan) {
      const valueNow = cash + Object.entries(holdings).reduce((s, [id, sh]) => s + sh * (priceOn(id, i) ?? 0), 0);
      const ids = new Set([...Object.keys(holdings), ...Object.keys(plan.targets)]);
      const trades: Trade[] = [];
      let fee = 0;
      // Sell first so the cash is there for buying.
      const wanted = (id: string) => ((plan.targets[id] ?? 0) / 100) * valueNow;
      for (const id of ids) {
        const price = priceOn(id, i);
        if (!price) continue;
        const delta = wanted(id) - (holdings[id] ?? 0) * price;
        if (delta < -0.005) {
          const shares = delta / price;
          holdings[id] = (holdings[id] ?? 0) + shares;
          fee += -delta * CUP_FEE;
          cash += -delta * (1 - CUP_FEE);
          trades.push({ id, shares, price, value: delta });
        }
      }
      for (const id of ids) {
        const price = priceOn(id, i);
        if (!price) continue;
        const delta = wanted(id) - (holdings[id] ?? 0) * price;
        if (delta > 0.005) {
          const spend = Math.min(delta, cash / (1 + CUP_FEE));
          if (spend <= 0) continue;
          const shares = spend / price;
          holdings[id] = (holdings[id] ?? 0) + shares;
          fee += spend * CUP_FEE;
          cash -= spend * (1 + CUP_FEE);
          trades.push({ id, shares, price, value: spend });
        }
      }
      for (const id of Object.keys(holdings)) if (Math.abs(holdings[id]) < 1e-9) delete holdings[id];
      const after = cash + Object.entries(holdings).reduce((s, [id, sh]) => s + sh * (priceOn(id, i) ?? 0), 0);
      if (trades.length) executions.push({ date, trades, fee, value: after });
    }
    const value = cash + Object.entries(holdings).reduce((s, [id, sh]) => s + sh * (priceOn(id, i) ?? 0), 0);
    if (baseIndex === null) baseIndex = book.index[i];
    series.push({ date, value, index: (book.index[i] / baseIndex) * CUP_START });
  });

  const lastPublished = book.dates[book.dates.length - 1] ?? "";
  const pending = [...latest.values()].filter((p) => p.fill > lastPublished).sort((a, b) => a.fill.localeCompare(b.fill))[0] ?? null;
  return {
    month,
    joined,
    holdings,
    cash,
    value: series.length ? series[series.length - 1].value : CUP_START,
    series,
    executions,
    pending,
    finished: lastPublished >= lastTradingDayOfMonth(month),
  };
}
