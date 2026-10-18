import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { CUP_FEE, CUP_START, MAX_HOLDINGS, fillDayFor, lastTradingDayOfMonth, runSeason, validateTargets, type Plan } from "./cup";
import { cancelPlan, currentCup, joinSeason, loadCup, localToday, placePlan, seasonReturn } from "./cupStore";
import { signed } from "./engine";
import { LineChart } from "./MiniCharts";
import { loadWorld, type WorldIndex } from "./world";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function dayName(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
}

function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function nextTradingDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}

function tradingDaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = nextTradingDay(d)) n++;
  return n;
}

interface Row {
  id: string;
  pct: number;
}

export function CupPage() {
  const [world, setWorld] = useState<WorldIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [store, setStore] = useState(loadCup());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [params, setParams] = useSearchParams();

  useEffect(() => {
    loadWorld().then((w) => {
      // Development only: ?demo seeds a season with a few past trades and a pending plan, for checking the page.
      if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("demo") && !loadCup()[w.completed.slice(0, 7)]) {
        const month = w.completed.slice(0, 7);
        const days = w.prices.dates.filter((d) => d.startsWith(month));
        const ids = w.companies.slice(0, 4).map((c) => c.id);
        joinSeason(month, days[0]);
        placePlan(month, { placed: `${days[1]}T09:00:00Z`, fill: days[1], targets: { [ids[0]]: 40, [ids[1]]: 30 } });
        placePlan(month, { placed: `${days[5]}T09:00:00Z`, fill: days[5], targets: { [ids[0]]: 20, [ids[2]]: 50 } });
        placePlan(month, { placed: new Date().toISOString(), fill: fillDayFor(localToday(), w.today), targets: { [ids[2]]: 60, [ids[3]]: 25 } });
        setStore(loadCup());
      }
      setWorld(w);
    }).catch((e) => setError(e.message));
  }, [params]);

  const cup = useMemo(() => (world ? currentCup(world, store) : null), [world, store]);
  const byId = useMemo(() => new Map((world?.companies ?? []).map((c) => [c.id, c])), [world]);
  const latestIdx = world ? world.prices.dates.length - 1 : -1;

  // Current weights, used to start the plan editor (or the pending plan, if there is one).
  const currentWeights = useMemo<Row[]>(() => {
    const s = cup?.season;
    if (!s || !world) return [];
    if (s.pending) return Object.entries(s.pending.targets).map(([id, pct]) => ({ id, pct }));
    return Object.entries(s.holdings).map(([id, shares]) => ({
      id, pct: Math.round(((shares * world.prices.closes[id][latestIdx]) / s.value) * 100),
    })).filter((r) => r.pct > 0);
  }, [cup, world, latestIdx]);

  useEffect(() => {
    if (!cup?.season) return;
    const add = params.get("add");
    const base = rows ?? currentWeights;
    if (add && byId.has(add) && !base.some((r) => r.id === add) && base.length < MAX_HOLDINGS) {
      setRows([...base, { id: add, pct: 0 }]);
      setParams({}, { replace: true });
    } else if (rows === null) {
      setRows(currentWeights);
    }
  }, [cup, currentWeights, params, byId, rows, setParams]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!world || !cup) return <p className="muted center">Opening the trading floor…</p>;

  const { fillDay, month, season } = cup;
  const lastDay = lastTradingDayOfMonth(month);
  const daysLeft = tradingDaysBetween(fillDay, lastDay);
  const resultsDay = nextTradingDay(fillDay);

  // Previous season's final result, if the player took part.
  const prevMonth = Object.keys(store).filter((m) => m < month).sort().pop();
  const prevSeason = prevMonth ? runSeason(world.prices, store[prevMonth].plans, prevMonth, store[prevMonth].joined) : null;

  const join = () => {
    setStore(joinSeason(month, fillDay));
    setRows([]);
  };

  if (!season) {
    return (
      <div className="page-col cup">
        <header className="page-head">
          <span className="label">Monthly trading season · {monthName(month)}</span>
          <h1>The Lantern Cup</h1>
        </header>
        <section className="card cup-intro">
          <p className="lede-text">Start with <strong>{money.format(CUP_START)}</strong> and trade the companies of Lanternport for the rest of {monthName(month).split(" ")[0]}. Read the Ledger each morning, adjust your portfolio, and see how you did in the next day's paper.</p>
          <ul className="cup-rules">
            <li>Hold up to <strong>{MAX_HOLDINGS} companies</strong> at once, plus cash.</li>
            <li>Set your plan any time: how much of your portfolio goes in each company.</li>
            <li>Plans fill at the day's <strong>closing price</strong>. Weekend plans fill on Monday.</li>
            <li>A {CUP_FEE * 100}% fee applies to everything you buy or sell.</li>
            <li>A new season starts every month. Your aim: beat the {world.index_name}.</li>
          </ul>
          <button type="button" className="primary wide" onClick={join}>Join the {monthName(month).split(" ")[0]} season</button>
          <p className="small muted">{daysLeft} trading day{daysLeft === 1 ? "" : "s"} left this season. Your portfolio is saved in this browser.</p>
        </section>
        {prevSeason && <PrevSeason month={prevMonth!} ret={seasonReturn(prevSeason)} />}
      </div>
    );
  }

  const ret = seasonReturn(season);
  const indexRet = season.series.length ? (season.series[season.series.length - 1].index / CUP_START - 1) * 100 : 0;
  const editing = rows ?? currentWeights;
  const targets = Object.fromEntries(editing.filter((r) => r.id && r.pct > 0).map((r) => [r.id, r.pct]));
  const problem = validateTargets(targets);
  const invested = Object.values(targets).reduce((s, v) => s + v, 0);
  const usedIds = new Set(editing.map((r) => r.id));

  const submit = () => {
    if (problem) return setMessage({ tone: "error", text: problem });
    const plan: Plan = { placed: new Date().toISOString(), fill: fillDay, targets };
    try {
      setStore(placePlan(month, plan));
      setMessage({ tone: "ok", text: `Plan placed. It fills at ${dayName(fillDay)}'s close; see how it went in ${dayName(resultsDay)}'s Ledger.` });
    } catch (e) {
      setMessage({ tone: "error", text: (e as Error).message });
    }
  };

  const cancel = () => {
    setStore(cancelPlan(month, fillDay));
    setRows(null);
    setMessage({ tone: "ok", text: "Plan cancelled. Your portfolio stays as it is." });
  };

  const setRow = (i: number, patch: Partial<Row>) => setRows(editing.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const sortedCompanies = [...world.companies].sort((a, b) => a.name.localeCompare(b.name));
  const holdings = Object.entries(season.holdings).map(([id, shares]) => {
    const closes = world.prices.closes[id];
    const price = closes[latestIdx];
    const value = shares * price;
    return { id, shares, price, value, weight: (value / season.value) * 100, change: (price / closes[latestIdx - 1] - 1) * 100 };
  }).sort((a, b) => b.value - a.value);

  return (
    <div className="page-col cup">
      <header className="page-head">
        <span className="label">Monthly trading season · {monthName(month)}</span>
        <h1>The Lantern Cup</h1>
      </header>

      <section className="cup-tiles">
        <div className="tile">
          <span className="label">Your portfolio</span>
          <span className="big mono">{money.format(season.value)}</span>
          <span className={`mono ${ret >= 0 ? "up" : "down"}`}>{signed(ret, 2)}% this season</span>
        </div>
        <div className="tile">
          <span className="label">{world.index_name}, same period</span>
          <span className={`big mono ${indexRet >= 0 ? "up" : "down"}`}>{signed(indexRet, 2)}%</span>
          <span className="small">{ret > indexRet ? "You're beating the market" : ret < indexRet ? "The market is ahead of you" : "Level with the market"}</span>
        </div>
        <div className="tile">
          <span className="label">Season</span>
          <span className="big mono">{season.finished ? "Over" : `${daysLeft} day${daysLeft === 1 ? "" : "s"}`}</span>
          <span className="small">{season.finished ? "Final results are in" : `left · ends ${dayName(lastDay)}`}</span>
        </div>
      </section>

      {season.pending && (
        <div className="cup-pending" role="status">
          <strong>Plan waiting for {dayName(season.pending.fill)}'s close.</strong>{" "}
          <span>Results in {dayName(nextTradingDay(season.pending.fill))}'s Ledger. You can change or cancel it until then.</span>
        </div>
      )}

      {season.series.length > 1 && (
        <section className="card">
          <h2 className="card-title">Your season so far</h2>
          <LineChart dates={season.series.map((p) => p.date)} values={season.series.map((p) => p.value)}
            compare={season.series.map((p) => p.index)} compareLabel={world.index_name} valueLabel="You" height={200} />
        </section>
      )}

      <section className="card">
        <h2 className="card-title">Holdings at {dayName(world.completed)}'s close</h2>
        {holdings.length === 0 ? (
          <p className="muted">All in cash ({money2.format(season.cash)}). Set a plan below to start trading.</p>
        ) : (
          <table className="quotes">
            <thead><tr><th>Company</th><th className="num">Share of portfolio</th><th className="num">Value</th><th className="num">Day</th></tr></thead>
            <tbody>
              {holdings.map((h) => (
                <tr key={h.id}>
                  <td><Link to={`/company/${h.id}`} className="quote-name">{byId.get(h.id)?.name}</Link><span className="quote-sub mono">{byId.get(h.id)?.ticker}</span></td>
                  <td className="num mono">{h.weight.toFixed(0)}%</td>
                  <td className="num mono">{money2.format(h.value)}</td>
                  <td className={`num mono ${h.change >= 0 ? "up" : "down"}`}>{signed(h.change, 1)}%</td>
                </tr>
              ))}
              <tr><td>Cash</td><td className="num mono">{((season.cash / season.value) * 100).toFixed(0)}%</td><td className="num mono">{money2.format(season.cash)}</td><td /></tr>
            </tbody>
          </table>
        )}
      </section>

      {!season.finished && (
        <section className="card plan">
          <h2 className="card-title">Your plan for {dayName(fillDay)}'s close</h2>
          <p className="small muted">Choose how much of your portfolio each company should be. Anything left over stays in cash. Read <Link to="/">today's Ledger</Link> first.</p>
          <div className="plan-rows">
            {editing.map((r, i) => (
              <div className="plan-row" key={i}>
                <select aria-label={`Company ${i + 1}`} value={r.id} onChange={(e) => setRow(i, { id: e.target.value })}>
                  <option value="">Choose a company…</option>
                  {sortedCompanies.map((c) => (
                    <option key={c.id} value={c.id} disabled={usedIds.has(c.id) && c.id !== r.id}>
                      {c.name} ({c.ticker}) · {c.price.toFixed(2)} · {signed(c.change, 1)}%
                    </option>
                  ))}
                </select>
                <input aria-label={`Share of portfolio for company ${i + 1}`} type="range" min={0} max={100} step={5} value={r.pct}
                  onChange={(e) => setRow(i, { pct: Number(e.target.value) })} />
                <span className="mono pct">{r.pct}%</span>
                <button type="button" className="icon" aria-label="Remove" title="Remove" onClick={() => setRows(editing.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
          </div>
          <div className="plan-foot">
            <button type="button" className="secondary" disabled={editing.length >= MAX_HOLDINGS} onClick={() => setRows([...editing, { id: "", pct: 10 }])}>
              + Add a company
            </button>
            <span className={`mono ${invested > 100 ? "down" : ""}`}>Invested {Math.round(invested)}% · cash {Math.max(0, 100 - Math.round(invested))}%</span>
          </div>
          {problem && <p className="error-text">{problem}</p>}
          {message && <p className={message.tone === "error" ? "error-text" : "ok-text"} role="status">{message.text}</p>}
          <div className="plan-actions">
            <button type="button" className="primary" disabled={!!problem} onClick={submit}>
              {season.pending ? "Update plan" : "Place plan"}
            </button>
            {season.pending && <button type="button" className="link" onClick={cancel}>Cancel plan</button>}
          </div>
        </section>
      )}

      {season.executions.length > 0 && (
        <section className="card">
          <h2 className="card-title">Trades this season</h2>
          <ul className="trade-log">
            {[...season.executions].reverse().map((ex) => (
              <li key={ex.date}>
                <span className="mono small">{dayName(ex.date)}</span>
                <span>
                  {ex.trades.map((t) => `${t.shares > 0 ? "Bought" : "Sold"} ${money.format(Math.abs(t.value))} of ${byId.get(t.id)?.name ?? t.id}`).join(" · ")}
                </span>
                <span className="small muted">Fees {money2.format(ex.fee)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {prevSeason && <PrevSeason month={prevMonth!} ret={seasonReturn(prevSeason)} />}
      <p className="disclaimer center">Saved in this browser only (on {localToday()}). Leaderboards are coming.</p>
    </div>
  );
}

function PrevSeason({ month, ret }: { month: string; ret: number }) {
  return (
    <section className="card">
      <span className="label">Last season · {monthName(month)}</span>
      <p className="prev-result"><span className={`big mono ${ret >= 0 ? "up" : "down"}`}>{signed(ret, 2)}%</span> final return</p>
    </section>
  );
}
