import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { AD_SLOTS, AdSlot } from "./AdSlot";
import { Chart } from "./Chart";
import {
  DAYS, FEE, LEVELS, START, bestPossible, buyAndHold, mulberry32, pctChange, percentile, play, randomFinals,
  shareText, signed,
} from "./engine";
import { loadIndex, loadPuzzle, msUntilTomorrow, todaysNumber, type NewsItem, type Puzzle } from "./puzzles";
import { loadProgress, loadStats, markHelpSeen, recordResult, saveProgress, seenHelp, type Stats } from "./storage";

export const TITLE = "Daily Trade";
const LEVEL_LABELS = ["Cash", "25%", "50%", "75%", "All in"];
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

interface Mode {
  n: number;
  practice: boolean;
}

function subjectOf(p: Puzzle): string {
  return p.mode === "history" ? `${p.company.name} ${p.company.sector}` : p.company.name;
}

/** News at bar i came out after that day's close. Day 0 is the last day before the game starts. */
function newsWhen(i: number, contextLen: number): string {
  const day = i - (contextLen - 1);
  if (day === 0) return "Before day 1";
  return day > 0 ? `After day ${day}` : `${-day} day${day === -1 ? "" : "s"} before`;
}

function NewsFeed({ news, visibleBars, contextLen }: { news: NewsItem[]; visibleBars: number; contextLen: number }) {
  const [open, setOpen] = useState(false);
  const seen = news.filter((n) => n.i < visibleBars).sort((a, b) => b.i - a.i);
  const latest = seen[0];
  const fresh = latest && latest.i === visibleBars - 1;
  if (!seen.length) return null;
  return (
    <section className="news" aria-live="polite">
      <div className={`headline ${fresh ? "fresh" : ""}`}>
        <span className="label">{fresh ? "Breaking" : "Latest news"} · {newsWhen(latest.i, contextLen)}</span>
        <p>{latest.text}</p>
      </div>
      {seen.length > 1 && (
        <>
          <button type="button" className="link small" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? "Hide earlier news" : `Earlier news (${seen.length - 1})`}
          </button>
          {open && (
            <ul className="news-list">
              {seen.slice(1).map((n) => <li key={n.i}><span className="label">{newsWhen(n.i, contextLen)}</span> {n.text}</li>)}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function Countdown() {
  const [ms, setMs] = useState(msUntilTomorrow());
  useEffect(() => {
    const t = setInterval(() => setMs(msUntilTomorrow()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return <span className="mono">{hh}:{mm}:{ss}</span>;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>{title}</h2>
          <button type="button" className="icon" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <ol className="rules">
        <li>Every day there's a new company and its last few months of trading. The companies and their news are made up, but the market follows rules you can learn.</li>
        <li>You start with <strong>{money.format(START)}</strong>. Before each of the next <strong>{DAYS} days</strong>, choose how much of it to have invested, from cash to all in.</li>
        <li>Your choice trades at the <strong>next day's opening price</strong>, with a {FEE * 100}% fee on the amount traded. Then the day is revealed.</li>
        <li><strong>Read the news.</strong> Headlines come out after the close. Some matter, some don't; the amber dots on the chart show how earlier news played out.</li>
        <li>Try to beat <strong>buy and hold</strong>: going all in on day 1 and doing nothing. It's harder than it looks.</li>
        <li>At the end, see what each headline did to the price, and what happened next.</li>
      </ol>
      <p className="small muted">Keyboard: 1–5 to choose, Enter for the next day. A new puzzle every day at midnight.</p>
      <button type="button" className="primary wide" onClick={onClose}>Play</button>
    </Modal>
  );
}

function StatsPanel({ stats, onClose }: { stats: Stats; onClose: () => void }) {
  const records = Object.entries(stats.history).sort(([a], [b]) => Number(b) - Number(a));
  const avg = records.length ? records.reduce((s, [, r]) => s + r.ret, 0) / records.length : 0;
  return (
    <Modal title="Your stats" onClose={onClose}>
      <div className="stat-grid">
        <div><strong>{stats.played}</strong><span>Played</span></div>
        <div><strong>{stats.played ? Math.round((stats.beat / stats.played) * 100) : 0}%</strong><span>Beat buy &amp; hold</span></div>
        <div><strong>{signed(avg)}%</strong><span>Average return</span></div>
        <div><strong>{stats.streak}</strong><span>Streak</span></div>
        <div><strong>{stats.maxStreak}</strong><span>Best streak</span></div>
      </div>
      {records.length > 0 && (
        <table className="history">
          <thead><tr><th>#</th><th>You</th><th>Buy &amp; hold</th><th>Beat</th></tr></thead>
          <tbody>
            {records.slice(0, 10).map(([n, r]) => (
              <tr key={n}>
                <td>{n}</td>
                <td className={r.ret >= 0 ? "up" : "down"}>{signed(r.ret)}%</td>
                <td>{signed(r.bh)}%</td>
                <td>{Math.round(r.pct)}% of traders</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small muted">Saved in this browser only.</p>
    </Modal>
  );
}

export function TradeGame() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [count, setCount] = useState(0);
  const [today, setToday] = useState(0);
  const [mode, setMode] = useState<Mode | null>(null);
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [allocs, setAllocs] = useState<number[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [help, setHelp] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [stats, setStats] = useState<Stats>(loadStats());
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    loadIndex().then((index) => {
      const n = todaysNumber(index);
      setCount(index.count);
      setToday(n);
      const asked = Number(params.get("n"));
      const practice = params.has("autoplay") || (asked >= 1 && asked <= index.count && asked !== n);
      setMode({ n: practice ? (asked >= 1 && asked <= index.count ? asked : ((n % index.count) + 1)) : n, practice });
      if (!seenHelp() && !params.has("autoplay") && !params.has("skiphelp")) setHelp(true);
    }).catch((e) => setError(e.message));
  }, [params]);

  useEffect(() => {
    if (!mode) return;
    setPuzzle(null);
    loadPuzzle(mode.n).then((p) => {
      setPuzzle(p);
      const saved = mode.practice ? [] : loadProgress(mode.n);
      if (params.has("autoplay")) {
        const rand = mulberry32(mode.n * 7919);
        const days = Number(params.get("autoplay")) || p.game.length; // ?autoplay=15 stops after 15 days
        setAllocs(p.game.slice(0, days).map(() => LEVELS[Math.floor(rand() * LEVELS.length)]));
      } else {
        setAllocs(saved);
      }
      setPending(saved.length ? saved[saved.length - 1] : 0);
    }).catch((e) => setError(e.message));
  }, [mode, params]);

  const done = puzzle !== null && allocs.length >= puzzle.game.length;
  const result = useMemo(() => (puzzle ? play(puzzle.game, allocs) : null), [puzzle, allocs]);
  const bhSoFar = useMemo(() => (puzzle && allocs.length ? buyAndHold(puzzle.game, allocs.length) : START), [puzzle, allocs.length]);
  const finals = useMemo(() => (puzzle && done ? randomFinals(puzzle.game, 1000, puzzle.n) : []), [puzzle, done]);
  const bh = puzzle ? buyAndHold(puzzle.game) : START;
  const best = puzzle ? bestPossible(puzzle.game) : START;
  const pct = result && done ? percentile(result.final, finals) : 0;

  // Record a finished daily round once.
  useEffect(() => {
    if (!puzzle || !mode || mode.practice || !done || !result) return;
    setStats(recordResult(mode.n, { ret: pctChange(result.final), bh: pctChange(bh), pct }));
  }, [done, puzzle, mode, result, bh, pct]);

  const next = useCallback(() => {
    if (!puzzle || !mode || done) return;
    const updated = [...allocs, pending];
    setAllocs(updated);
    if (!mode.practice) saveProgress(mode.n, updated);
  }, [puzzle, mode, done, allocs, pending]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (help || statsOpen || done) return;
      if (e.key >= "1" && e.key <= "5") setPending(LEVELS[Number(e.key) - 1]);
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) next();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [help, statsOpen, done, next]);

  const closeHelp = () => {
    markHelpSeen();
    setHelp(false);
  };

  const share = async () => {
    if (!result || !mode) return;
    const url = window.location.origin + window.location.pathname;
    const text = shareText({ title: TITLE, n: mode.n, practice: mode.practice, subject: subjectOf(puzzle!), result, bh, url });
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setToast("Result copied. Paste it anywhere.");
      }
    } catch {
      setToast("Couldn't share automatically. Select the text above to copy it.");
    }
    setTimeout(() => setToast(null), 3000);
  };

  const practiceAnother = () => {
    if (!count) return;
    let n = today;
    while (n === today && count > 1) n = 1 + Math.floor(Math.random() * count);
    setMode({ n, practice: true });
    window.scrollTo({ top: 0 });
  };

  const value = result?.final ?? START;
  const day = allocs.length;

  return (
    <div className="game">
      <header className="game-head">
        <div className="brand">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <line x1="6" y1="3" x2="6" y2="21" /><rect x="3.5" y="8" width="5" height="9" className="b-up" />
            <line x1="15" y1="2" x2="15" y2="16" /><rect x="12.5" y="5" width="5" height="7" className="b-down" />
          </svg>
          <h1>{TITLE}</h1>
          {mode && <span className="badge">{mode.practice ? `Practice #${mode.n}` : `#${mode.n}`}</span>}
        </div>
        <nav>
          <button type="button" className="icon" aria-label="How to play" title="How to play" onClick={() => setHelp(true)}>?</button>
          <button type="button" className="icon" aria-label="Your stats" title="Your stats" onClick={() => setStatsOpen(true)}>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="10" width="3" height="7" /><rect x="8.5" y="5" width="3" height="12" /><rect x="14" y="8" width="3" height="9" /></svg>
          </button>
        </nav>
      </header>

      {error && <p className="error" role="alert">{error}</p>}
      {!puzzle && !error && <p className="muted center">Loading today's chart…</p>}

      {puzzle && result && (
        <main>
          <section className="subject">
            <div>
              {puzzle.company.archive && <span className="label">From the Ledger archive · {puzzle.company.archive}</span>}
              <h2>{puzzle.company.name} {puzzle.company.ticker && <span className="mono muted">{puzzle.company.ticker}</span>}</h2>
              <p>{puzzle.company.what}{puzzle.company.boss ? `, run by ${puzzle.company.boss}` : ""}</p>
            </div>
            <span className={`year ${puzzle.mode === "history" ? "mono" : ""}`} title={puzzle.mode === "history" ? "Exact dates are revealed at the end" : "Sector"}>
              {puzzle.company.sector}
            </span>
          </section>

          <section className="scoreline" aria-live="polite">
            <div>
              <span className="label">{done ? "Final" : `Day ${Math.min(day + 1, DAYS)} of ${DAYS}`}</span>
              <span className="big mono">{money.format(value)}</span>
              <span className={`mono ${value >= START ? "up" : "down"}`}>{signed(pctChange(value))}%</span>
            </div>
            <div className="right">
              <span className="label">Buy &amp; hold</span>
              <span className="mono">{money.format(bhSoFar)}</span>
              <span className={`mono ${bhSoFar >= START ? "up" : "down"}`}>{signed(pctChange(bhSoFar))}%</span>
            </div>
          </section>

          <div className="chart-card">
            <Chart context={puzzle.context} game={puzzle.game.slice(0, day)} after={done ? puzzle.after : []}
              allocs={allocs} totalDays={puzzle.game.length}
              news={puzzle.news.filter((n) => n.i < puzzle.context.length + day).map((n) => n.i)} />
            <div className="progress" aria-hidden="true">
              {puzzle.game.map((_, i) => <span key={i} className={i < day ? (result.days[i].alloc === 0 ? "cash" : result.days[i].pnl >= 0 ? "gain" : "loss") : i === day ? "now" : ""} />)}
            </div>
          </div>

          <NewsFeed news={puzzle.news} visibleBars={puzzle.context.length + day} contextLen={puzzle.context.length} />

          {!done ? (
            <section className="controls">
              <p className="prompt">How much do you want invested for day {day + 1}?</p>
              <div className="levels" role="radiogroup" aria-label="Amount invested">
                {LEVELS.map((lv, i) => (
                  <button key={lv} type="button" role="radio" aria-checked={pending === lv} className={`level ${pending === lv ? "on" : ""}`} onClick={() => setPending(lv)}>
                    <span className="meter" aria-hidden="true"><span style={{ height: `${lv * 100}%` }} /></span>
                    <span>{LEVEL_LABELS[i]}</span>
                  </button>
                ))}
              </div>
              <button type="button" className="primary wide" onClick={next}>
                {day === 0 ? "Start trading" : day === DAYS - 1 ? "Final day" : "Next day"} <span aria-hidden="true">→</span>
              </button>
              <p className="small muted center">Fills at the next open · {FEE * 100}% fee on trades{allocs.length ? ` · now ${Math.round(allocs[allocs.length - 1] * 100)}% invested` : ""}</p>
            </section>
          ) : (
            <section className="result">
              <div className="verdict">
                <span className={`huge mono ${value >= START ? "up" : "down"}`}>{signed(pctChange(value))}%</span>
                <p>
                  {value > bh ? "You beat buy and hold" : value < bh ? "Buy and hold beat you" : "You matched buy and hold"}
                  {value !== bh && <> by <strong className="mono">{Math.abs(pctChange(value) - pctChange(bh)).toFixed(1)} pts</strong></>}.
                  {" "}You finished ahead of <strong>{Math.round(pct)}%</strong> of 1,000 random traders.
                </p>
              </div>
              <dl className="facts">
                <div><dt>Buy &amp; hold</dt><dd className="mono">{signed(pctChange(bh))}%</dd></div>
                <div><dt>Perfect hindsight</dt><dd className="mono">{signed(pctChange(best))}%</dd></div>
                <div><dt>Fees paid</dt><dd className="mono">{money.format(result.fees)}</dd></div>
              </dl>
              {puzzle.mode !== "history" ? (
                <div className="reveal">
                  <span className="label">What the news did</span>
                  <ul className="recap">
                    {puzzle.reveal.recap.map((r) => (
                      <li key={r.i}>
                        <span className="recap-when">{newsWhen(r.i, puzzle.context.length)}</span>
                        <strong>{r.text}</strong>
                        <span className="recap-move">
                          Next {r.days} day{r.days === 1 ? "" : "s"} from the open:{" "}
                          <b className={`mono ${r.move >= 0 ? "up" : "down"}`}>{signed(r.move)}%</b>
                        </span>
                        <em>{r.lesson}</em>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
              <div className="reveal">
                <span className="label">The exact dates</span>
                <h2 className="mono">{formatDate(puzzle.reveal.start)} – {formatDate(puzzle.reveal.end)}</h2>
                <p>{puzzle.reveal.name} ({puzzle.reveal.ticker}), {puzzle.reveal.what}</p>
                {puzzle.after.length > 0 && (
                  <p className="small">In the following {puzzle.after.length} trading days it moved a further{" "}
                    <strong className={`mono ${puzzle.after[puzzle.after.length - 1][3] >= puzzle.game[puzzle.game.length - 1][3] ? "up" : "down"}`}>
                      {signed((puzzle.after[puzzle.after.length - 1][3] / puzzle.game[puzzle.game.length - 1][3] - 1) * 100)}%
                    </strong>.
                  </p>
                )}
              </div>
              )}
              {puzzle.company.id && (
                <Link className="company-link" to={`/company/${puzzle.company.id}`}>See how {puzzle.company.name} is doing today →</Link>
              )}
              <pre className="share-preview" aria-label="Your shareable result">{shareText({ title: TITLE, n: mode!.n, practice: mode!.practice, subject: subjectOf(puzzle), result, bh, url: "" })}</pre>
              <button type="button" className="primary wide" onClick={share}>Share result</button>
              <div className="after-actions">
                {!mode!.practice ? <span className="small muted">Next puzzle in <Countdown /></span> : <button type="button" className="link" onClick={() => setMode({ n: today, practice: false })}>Back to today's puzzle</button>}
                <button type="button" className="secondary" onClick={practiceAnother}>Practise a past puzzle</button>
              </div>
              <AdSlot slot={AD_SLOTS.result} name="under the results" />
            </section>
          )}
        </main>
      )}

      {puzzle && (
        <footer className="foot">
          <AdSlot slot={AD_SLOTS.footer} name="page footer" />
          <p>{puzzle.mode !== "history"
            ? "Made-up companies, news and prices; any resemblance to real companies is coincidental."
            : "Real historical prices, rescaled so the last price before day 1 is 100. Not affiliated with any company shown."}
            {" "}A game, not investment advice.</p>
          <p><a href={`${import.meta.env.BASE_URL}privacy.html`}>Privacy</a></p>
        </footer>
      )}

      {help && <Help onClose={closeHelp} />}
      {statsOpen && <StatsPanel stats={stats} onClose={() => setStatsOpen(false)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
