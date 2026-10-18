// Small line charts drawn to scale in SVG, coloured from the theme.

export function Sparkline({ values, width = 90, height = 26 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - lo) / span) * (height - 4)).toFixed(1)}`);
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className={`spark ${up ? "up" : "down"}`} viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
      <polyline points={pts.join(" ")} />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="2" />
    </svg>
  );
}

interface LineProps {
  dates: string[];
  values: number[];
  markerIndex?: number; // e.g. where the live world began
  markerLabel?: string;
  height?: number;
}

const W = 640;
const PAD = { l: 8, r: 52, t: 14, b: 24 };

function niceStep(range: number): number {
  const raw = range / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  return [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? pow * 10;
}

export function LineChart({ dates, values, markerIndex, markerLabel, height = 240 }: LineProps) {
  if (values.length < 2) return null;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const x = (i: number) => PAD.l + (i / (values.length - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + ((hi - v) / (hi - lo)) * (height - PAD.t - PAD.b);
  const step = niceStep(hi - lo);
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) ticks.push(v);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(values.length - 1).toFixed(1)} ${height - PAD.b}L${x(0).toFixed(1)} ${height - PAD.b}Z`;
  const up = values[values.length - 1] >= values[0];
  const months = dates.map((d, i) => [d, i] as const).filter(([d], i) => i === 0 || d.slice(5, 7) !== dates[i - 1].slice(5, 7));
  return (
    <svg className={`line-chart ${up ? "up" : "down"}`} viewBox={`0 0 ${W} ${height}`} role="img"
      aria-label={`Price from ${dates[0]} to ${dates[dates.length - 1]}: ${values[0].toFixed(2)} to ${values[values.length - 1].toFixed(2)}`}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={W - PAD.r + 6} y={y(v) + 4} className="tick">{v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(step < 1 ? 2 : 0)}</text>
        </g>
      ))}
      {months.slice(1).map(([d, i]) => (
        <text key={d} x={x(i)} y={height - 6} className="tick" textAnchor="middle">
          {new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { month: "short" })}
        </text>
      ))}
      <path d={area} className="area" />
      <path d={line} className="stroke" />
      {markerIndex !== undefined && markerIndex > 0 && markerIndex < values.length && (
        <g>
          <line x1={x(markerIndex)} x2={x(markerIndex)} y1={PAD.t} y2={height - PAD.b} className="marker" />
          {markerLabel && <text x={x(markerIndex) + 4} y={PAD.t + 10} className="marker-label">{markerLabel}</text>}
        </g>
      )}
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="3.5" className="end" />
    </svg>
  );
}
