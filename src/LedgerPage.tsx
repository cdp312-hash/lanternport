import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { signed } from "./engine";
import { currentCup, seasonReturn } from "./cupStore";
import { Sparkline } from "./MiniCharts";
import { SKY_ICON, loadEdition, loadWorld, longDate, shortDate, type Edition, type Story, type WorldIndex } from "./world";

function Companies({ items }: { items: Story["companies"] }) {
  if (!items.length) return null;
  return (
    <p className="story-links">
      {items.map((c) => <Link key={c.id} to={`/company/${c.id}`}>{c.name} →</Link>)}
    </p>
  );
}

function Developing({ items }: { items: Edition["developing"] }) {
  if (!items.length) return null;
  return (
    <section className="developing">
      <h4>Developing stories</h4>
      <ul>
        {items.map((s, i) => (
          <li key={i}>
            <span className="tag">{s.tag} · since {shortDate(s.since)}</span>
            <strong>{s.headline}</strong>
            <span className="small muted">More to come.</span>
            <Companies items={s.companies} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Spotlight({ s }: { s: Edition["spotlight"] }) {
  return (
    <section className="box spotlight">
      <span className="box-title">Company of the day</span>
      <Link to={`/company/${s.id}`} className="spot-name">{s.name} <span className="mono muted">{s.ticker}</span></Link>
      <p className="small">{s.what} from {s.district}, best known for {s.product}. Run by {s.boss}, who {s.trait}.</p>
      <div className="spot-chart">
        <Sparkline values={s.spark} width={150} height={36} />
        <span className={`mono small ${s.month >= 0 ? "up" : "down"}`}>{signed(s.month, 1)}% this month</span>
      </div>
    </section>
  );
}

function Gossip({ lines, author }: { lines: string[]; author: string }) {
  if (!lines.length) return null;
  return (
    <section className="box gossip">
      <span className="box-title">Overheard · {author}</span>
      {lines.map((g, i) => <p key={i}>{g}</p>)}
      <p className="small muted">Gossip, not news. Don't trade on it.</p>
    </section>
  );
}

function CupBox({ world }: { world: WorldIndex }) {
  const { season } = currentCup(world);
  const ret = season ? seasonReturn(season) : 0;
  return (
    <Link to="/cup" className="box cup-box">
      <span className="box-title">The Lantern Cup</span>
      {season ? (
        <>
          <strong className="mono">£{Math.round(season.value).toLocaleString("en-GB")} <span className={ret >= 0 ? "up" : "down"}>{signed(ret, 1)}%</span></strong>
          <span className="small">{season.pending ? "Your plan fills at today's close." : "Adjust your portfolio for today's close →"}</span>
        </>
      ) : (
        <>
          <strong>This month's trading season</strong>
          <span className="small">Start with £10,000 and trade on the news. Join any time →</span>
        </>
      )}
    </Link>
  );
}

export function LedgerPage() {
  const { date } = useParams();
  const [world, setWorld] = useState<WorldIndex | null>(null);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadWorld().then(setWorld).catch((e) => setError(e.message));
  }, []);

  const day = date ?? world?.today;
  useEffect(() => {
    if (!day) return;
    setEdition(null);
    loadEdition(day).then(setEdition).catch(() => setError(`There's no Ledger for ${day}.`));
  }, [day]);

  if (error) return <p className="error" role="alert">{error}</p>;
  if (!world || !edition) return <p className="muted center">Fetching this morning's paper…</p>;

  const idx = world.editions.indexOf(edition.date);
  const prev = idx > 0 ? world.editions[idx - 1] : null;
  const next = idx >= 0 && idx < world.editions.length - 1 ? world.editions[idx + 1] : null;
  const { markets, weather } = edition;
  const gossipAuthor = world.characters.find((c) => c.about.includes("gossip"))?.name ?? "Our gossip columnist";
  // On quiet news days the extra sections move into the main column, so neither column runs short.
  const quiet = edition.stories.length < 2;

  return (
    <article className="ledger">
      <header className="masthead">
        <p className="mast-meta"><span>{longDate(edition.date)}</span><span>No. {edition.edition}</span></p>
        <h1>{world.newspaper}</h1>
        <p className="motto">“{world.motto}”</p>
      </header>

      <div className="ledger-top">
        <div className="ledger-main">
          <section className="lead">
            {edition.lead ? (
              <>
                <span className="tag">{edition.lead.tag}</span>
                <h2>{edition.lead.headline}</h2>
                {edition.lead.body && <p className="standfirst">{edition.lead.body}</p>}
                <Companies items={edition.lead.companies} />
              </>
            ) : (
              <>
                <span className="tag">Lanternport</span>
                <h2>A quiet night in Lanternport</h2>
                <p className="standfirst">No business news broke after yesterday's close. The seagulls, as ever, were busy.</p>
              </>
            )}
          </section>

          {edition.stories.length > 0 && (
            <section className="stories">
              {edition.stories.map((s, i) => (
                <div className="story" key={i}>
                  <span className="tag">{s.tag}</span>
                  <h3>{s.headline}</h3>
                  {s.body && <p>{s.body}</p>}
                  <Companies items={s.companies} />
                </div>
              ))}
            </section>
          )}

          <Developing items={edition.developing} />
          {quiet && (
            <div className="main-extras">
              <Spotlight s={edition.spotlight} />
              <Gossip lines={edition.gossip} author={gossipAuthor} />
            </div>
          )}
        </div>

        <aside className="ledger-side">
          <section className="box weather">
            <span className="box-title">Weather</span>
            <p className="wx"><span aria-hidden="true">{SKY_ICON[weather.sky]}</span> <strong>{weather.temp}°C</strong></p>
            <p className="small">“{weather.forecast}” <span className="muted">{weather.presenter}</span></p>
          </section>
          <section className="box markets">
            <span className="box-title">Markets at the close</span>
            <p className="index-line">
              <strong>{world.index_name}</strong>
              <span className="mono">{markets.index.toLocaleString(undefined, { minimumFractionDigits: 1 })}</span>
              <span className={`mono ${markets.change >= 0 ? "up" : "down"}`}>{signed(markets.change, 2)}%</span>
            </p>
            <table className="movers">
              <tbody>
                {[...markets.gainers, ...markets.losers].map((m) => (
                  <tr key={m.id}>
                    <td><Link to={`/company/${m.id}`}>{m.name}</Link></td>
                    <td className={`mono ${m.change >= 0 ? "up" : "down"}`}>{signed(m.change, 1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Link className="small" to="/markets">All 60 companies →</Link>
          </section>
          <Link to="/trade" className="box play">
            <span className="box-title">Today's game</span>
            <strong>Daily Trade</strong>
            <span className="small">Trade a company from the Ledger archive. 30 days, one decision a day.</span>
            <span className="play-cta">Play →</span>
          </Link>
          <CupBox world={world} />
          {!quiet && <Spotlight s={edition.spotlight} />}
          {!quiet && <Gossip lines={edition.gossip} author={gossipAuthor} />}
        </aside>
      </div>

      {(edition.briefs.length > 0 || edition.features.length > 0) && (
        <div className="ledger-bottom">
          {edition.briefs.length > 0 && (
            <section>
              <h4>In brief</h4>
              <ul>{edition.briefs.map((b) => <li key={b}>{b}</li>)}</ul>
            </section>
          )}
          {edition.features.length > 0 && (
            <section>
              <h4>Around town</h4>
              <ul>{edition.features.map((f) => <li key={f}>{f}</li>)}</ul>
            </section>
          )}
        </div>
      )}

      <nav className="edition-nav" aria-label="Other editions">
        {prev ? <Link to={`/ledger/${prev}`}>← Previous edition</Link> : <span />}
        {next ? <Link to={next === world.today ? "/" : `/ledger/${next}`}>Next edition →</Link> : <span className="muted small">Tomorrow's paper lands at midnight</span>}
      </nav>
    </article>
  );
}
