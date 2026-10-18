import type { Bar } from "./engine";

interface Props {
  context: Bar[];
  game: Bar[]; // revealed game days only
  after: Bar[]; // shown once the round is over
  allocs: number[];
  totalDays: number;
  news?: number[]; // bar indices with a headline after their close
  startLabel?: string;
}

const W = 640;
const H = 300;
const PAD = { l: 8, r: 44, t: 14, b: 22 };
const STRIP = 26; // allocation strip below the price area

function niceStep(range: number): number {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
}

export function Chart({ context, game, after, allocs, totalDays, news = [], startLabel }: Props) {
  // Keep the x-scale fixed for the whole round so candles don't jump as days are revealed.
  const slots = context.length + totalDays + (after.length ? after.length : 0);
  const visible = [...context, ...game, ...after];
  const lows = visible.map((b) => b[2]);
  const highs = visible.map((b) => b[1]);
  let lo = Math.min(...lows);
  let hi = Math.max(...highs);
  const pad = (hi - lo) * 0.06 || 1;
  lo -= pad;
  hi += pad;

  const plotW = W - PAD.l - PAD.r;
  const priceH = H - PAD.t - PAD.b - STRIP;
  const slot = plotW / slots;
  const body = Math.max(1.2, slot * 0.62);
  const x = (i: number) => PAD.l + slot * (i + 0.5);
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * priceH;
  const step = niceStep(hi - lo);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);

  const gameStart = context.length;
  const afterStart = context.length + totalDays;
  const stripTop = PAD.t + priceH + 6;

  const candle = (b: Bar, i: number, cls: string) => {
    const [o, h, l, c] = b;
    const up = c >= o;
    const top = y(Math.max(o, c));
    const bh = Math.max(1, Math.abs(y(o) - y(c)));
    return (
      <g key={i} className={`${cls} ${up ? "up" : "down"}`}>
        <line x1={x(i)} x2={x(i)} y1={y(h)} y2={y(l)} className="wick" />
        <rect x={x(i) - body / 2} y={top} width={body} height={bh} className="body" />
      </g>
    );
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img"
      aria-label={`Price chart: ${context.length} days of history${game.length ? `, ${game.length} of ${totalDays} game days revealed` : ""}${after.length ? ", plus what happened next" : ""}`}>
      <rect x={x(gameStart) - slot / 2} y={PAD.t} width={slot * totalDays} height={priceH} className="game-zone" />
      {after.length > 0 && <rect x={x(afterStart) - slot / 2} y={PAD.t} width={slot * after.length} height={priceH} className="after-zone" />}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={W - PAD.r + 6} y={y(v) + 4} className="tick">{v.toFixed(step < 1 ? 1 : 0)}</text>
        </g>
      ))}
      {context.map((b, i) => candle(b, i, "ctx"))}
      {game.map((b, i) => candle(b, gameStart + i, "live"))}
      {after.map((b, i) => candle(b, afterStart + i, "aft"))}
      {news.map((i) => {
        const bar = visible[i];
        if (!bar) return null;
        const latest = i === Math.max(...news);
        return <circle key={`n${i}`} cx={x(i)} cy={Math.max(PAD.t + 4, y(bar[1]) - 7)} r={latest ? 4.5 : 3} className={`news-dot ${latest ? "latest" : ""}`} />;
      })}
      <line x1={x(gameStart) - slot / 2} x2={x(gameStart) - slot / 2} y1={PAD.t} y2={stripTop + STRIP - 6} className="divider" />
      <text x={x(gameStart) - slot / 2 + 4} y={PAD.t + 11} className="zone-label">{startLabel ?? "Day 1"}</text>
      {after.length > 0 && <text x={x(afterStart) - slot / 2 + 4} y={PAD.t + 11} className="zone-label">Next {after.length} days</text>}

      <text x={PAD.l} y={stripTop + STRIP - 9} className="strip-label">Invested</text>
      {allocs.map((a, i) => {
        const hgt = a * (STRIP - 8);
        return <rect key={i} x={x(gameStart + i) - body / 2} y={stripTop + (STRIP - 8) - hgt} width={body} height={Math.max(hgt, 0.8)} className={a ? "alloc" : "alloc none"} />;
      })}
    </svg>
  );
}
