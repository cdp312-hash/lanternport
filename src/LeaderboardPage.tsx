import { useEffect, useState } from "react";
import { Link } from "react-router";
import { apiEnabled, leaderboard, type Leaderboard } from "./api";
import { signed } from "./engine";

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });

export function monthName(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
}

function prevMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

/** The leaderboard table, shared by the Cup page (top few) and the full page. */
export function LeaderTable({ board, limit }: { board: Leaderboard; limit?: number }) {
  const rows = limit ? board.rows.slice(0, limit) : board.rows;
  const youShown = rows.some((r) => r.me);
  if (!board.players) return <p className="muted">Nobody has joined this season yet. Be the first.</p>;
  return (
    <table className="quotes leaders">
      <thead><tr><th className="num">#</th><th>Trader</th><th className="num">Portfolio</th><th className="num">Return</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.rank} className={r.me ? "me" : ""}>
            <td className="num mono">{r.rank}</td>
            <td>{r.nickname}{r.me && <span className="you-tag">you</span>}</td>
            <td className="num mono">{money.format(r.value)}</td>
            <td className={`num mono ${r.return_pct > 0 ? "up" : r.return_pct < 0 ? "down" : ""}`}>{signed(r.return_pct, 2)}%</td>
          </tr>
        ))}
        {board.you && !youShown && (
          <tr className="me">
            <td className="num mono">{board.you.rank}</td>
            <td>{board.you.nickname}<span className="you-tag">you</span></td>
            <td className="num mono">{money.format(board.you.value)}</td>
            <td className={`num mono ${board.you.return_pct > 0 ? "up" : board.you.return_pct < 0 ? "down" : ""}`}>{signed(board.you.return_pct, 2)}%</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

export function LeaderboardPage() {
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiEnabled()) return;
    setBoard(null);
    leaderboard(month).then(setBoard).catch((e) => setError(e.message));
  }, [month]);

  if (!apiEnabled()) {
    return (
      <div className="page-col">
        <header className="page-head"><h1>Leaderboard</h1></header>
        <p className="muted">Leaderboards aren't switched on yet. <Link to="/cup">Play the Lantern Cup</Link> in the meantime.</p>
      </div>
    );
  }
  if (error) return <p className="error" role="alert">{error}</p>;
  if (!board) return <p className="muted center">Counting up the portfolios…</p>;

  const shown = board.month;
  return (
    <div className="page-col">
      <header className="page-head">
        <span className="label">The Lantern Cup · prices at {new Date(`${board.completed}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} close</span>
        <h1>Leaderboard: {monthName(shown)}</h1>
      </header>
      <div className="chips" role="group" aria-label="Season">
        <button type="button" className={`chip ${month === undefined ? "on" : ""}`} aria-pressed={month === undefined} onClick={() => setMonth(undefined)}>This season</button>
        <button type="button" className={`chip ${month !== undefined ? "on" : ""}`} aria-pressed={month !== undefined} onClick={() => setMonth(prevMonth(month ?? shown))}>Previous season</button>
      </div>
      <section className="card flush">
        <LeaderTable board={board} />
      </section>
      <p className="small muted center">{board.players} trader{board.players === 1 ? "" : "s"} this season. Everyone starts with £10,000. <Link to="/cup">Your portfolio →</Link></p>
    </div>
  );
}
