export type ChartSeries = {
  points: { t: number; v: number }[];
  /** Any CSS color; used for the line and (when filled) the area. */
  color: string;
  fill?: boolean;
  label?: string;
};

/**
 * Dependency-free SVG time-series chart. Series share the x (time) axis and a
 * single y scale (`max` fixes it, e.g. 100 for CPU%; otherwise it fits data).
 */
export function TimeSeriesChart({
  series,
  max,
  height = 64,
  className = '',
}: {
  series: ChartSeries[];
  max?: number | null;
  height?: number;
  className?: string;
}) {
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length < 2) {
    return (
      <div
        style={{ height }}
        className={`flex items-center justify-center rounded bg-graphite-850 text-xs text-slate-dim ${className}`}
      >
        collecting data…
      </div>
    );
  }

  const tMin = Math.min(...allPoints.map((p) => p.t));
  const tMax = Math.max(...allPoints.map((p) => p.t));
  const dataMax = Math.max(...allPoints.map((p) => p.v), 0);
  const scale = max && max > 0 ? max : dataMax > 0 ? dataMax * 1.15 : 1;
  const tSpan = Math.max(1, tMax - tMin);

  const W = 100;
  const H = 40;
  const x = (t: number) => ((t - tMin) / tSpan) * W;
  const y = (v: number) => H - Math.min(1, Math.max(0, v / scale)) * H;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ height }}
      className={`w-full ${className}`}
      role="img"
    >
      {/* 50% guide line */}
      <line x1="0" y1={H / 2} x2={W} y2={H / 2} stroke="currentColor" strokeOpacity="0.08" />
      {series.map((s, index) => {
        if (s.points.length < 2) return null;
        const line = s.points
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`)
          .join(' ');
        const first = s.points[0]!;
        const last = s.points[s.points.length - 1]!;
        const area = `${line} L${x(last.t).toFixed(2)},${H} L${x(first.t).toFixed(2)},${H} Z`;
        return (
          <g key={s.label ?? index}>
            {s.fill !== false && <path d={area} fill={s.color} fillOpacity="0.12" />}
            <path
              d={line}
              fill="none"
              stroke={s.color}
              strokeWidth="1.1"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        );
      })}
    </svg>
  );
}
