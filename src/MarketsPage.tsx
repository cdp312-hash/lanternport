import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { signed } from "./engine";
import { LineChart, Sparkline } from "./MiniCharts";
import { loadCompany, loadWorld, shortDate, type CompanyPage as Company, type WorldIndex } from "./world";

export function MarketsPage() {
  const [world, setWorld] = useState<WorldIndex | null>(null);
  const [sector, setSector] = useState("All");
  const [sort, setSort] = useState<"name" | "change">("change");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadWorld().then(setWorld).catch((e) => setError(e.message));
  }, []);

  const rows = useMemo(() => {
    if (!world) return [];
    const list = world.companies.filter((c) => sector === "All" || c.sector === sector);
    return [...list].sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.change - a.change));
  }, [world, sector, sort]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!world) return <p className="muted center">Opening the Exchange…</p>;
  const series = world.index_series;
  const last = series.levels[series.levels.length - 1];
  const prev = series.levels[series.levels.length - 2];
  const launchAt = series.dates.indexOf(world.launch);

  return (
    <div className="page-col">
      <header className="page-head">
        <span className="label">The Lanternport Exchange · at yesterday's close</span>
        <h1>Markets</h1>
      </header>

      <section className="card">
        <div className="index-head">
          <div>
            <span className="label">{world.index_name}</span>
            <span className="big mono">{last.toLocaleString(undefined, { minimumFractionDigits: 1 })}</span>
          </div>
          <span className={`mono ${last >= prev ? "up" : "down"}`}>{signed((last / prev - 1) * 100, 2)}% on the day</span>
        </div>
        <LineChart dates={series.dates} values={series.levels} markerIndex={launchAt > 0 ? launchAt : undefined} markerLabel="Ledger launches" height={200} />
      </section>

      <div className="chips" role="group" aria-label="Filter by sector">
        {["All", ...world.sectors].map((s) => (
          <button key={s} type="button" className={`chip ${sector === s ? "on" : ""}`} aria-pressed={sector === s} onClick={() => setSector(s)}>{s}</button>
        ))}
      </div>

      <section className="card flush">
        <table className="quotes">
          <thead>
            <tr>
              <th><button type="button" className="sort" onClick={() => setSort("name")}>Company{sort === "name" ? " ↓" : ""}</button></th>
              <th className="hide-narrow">Last month</th>
              <th className="num">Price</th>
              <th className="num"><button type="button" className="sort" onClick={() => setSort("change")}>Day{sort === "change" ? " ↓" : ""}</button></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/company/${c.id}`} className="quote-name">{c.name}</Link>
                  <span className="quote-sub mono">{c.ticker} · {c.sector}</span>
                </td>
                <td className="hide-narrow"><Sparkline values={c.spark} /></td>
                <td className="num mono">{c.price.toFixed(2)}</td>
                <td className={`num mono ${c.change >= 0 ? "up" : "down"}`}>{signed(c.change, 1)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function CompanyPage() {
  const { id } = useParams();
  const [company, setCompany] = useState<Company | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!id) return;
    setCompany(null);
    setError(null);
    loadCompany(id).then(setCompany).catch(() => setError("We couldn't find that company on the Exchange."));
  }, [id]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!company) return <p className="muted center">Looking up the company…</p>;
  const closes = company.closes;
  const last = closes[closes.length - 1];
  const change = (last / closes[closes.length - 2] - 1) * 100;
  const sinceLaunch = (last / closes[company.launch_index] - 1) * 100;

  return (
    <div className="page-col">
      <header className="page-head">
        <span className="label">{company.sector} · {company.district}</span>
        <h1>{company.name} <span className="mono muted">{company.ticker}</span></h1>
      </header>

      <section className="card">
        <div className="index-head">
          <div>
            <span className="label">Last close</span>
            <span className="big mono">{last.toFixed(2)}</span>
          </div>
          <div className="right">
            <span className={`mono ${change >= 0 ? "up" : "down"}`}>{signed(change, 2)}% on the day</span>
            <span className={`mono small ${sinceLaunch >= 0 ? "up" : "down"}`}>{signed(sinceLaunch, 1)}% since the Ledger launched</span>
          </div>
        </div>
        <LineChart dates={company.dates} values={closes} markerIndex={company.launch_index} markerLabel="Ledger launches" />
        <Link className="secondary add-cup" to={`/cup?add=${company.id}`}>+ Add to my Lantern Cup plan</Link>
      </section>

      <section className="card">
        <dl className="profile">
          <div><dt>What they do</dt><dd>{company.what}</dd></div>
          <div><dt>Best known for</dt><dd>{company.product}</dd></div>
          <div><dt>Boss</dt><dd>{company.boss}, who {company.trait}</dd></div>
          {company.rival && company.rival_id && <div><dt>Arch-rival</dt><dd><Link to={`/company/${company.rival_id}`}>{company.rival}</Link></dd></div>}
        </dl>
      </section>

      <section className="card">
        <h2 className="card-title">In the Ledger</h2>
        {company.news.length === 0 ? (
          <p className="muted">No news about {company.name} since the Ledger launched. Quiet times.</p>
        ) : (
          <ul className="company-news">
            {company.news.map((n, i) => (
              <li key={i}>
                <Link to={`/ledger/${n.date}`} className="mono small">{shortDate(n.date)}</Link>
                <span>{n.headline}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
