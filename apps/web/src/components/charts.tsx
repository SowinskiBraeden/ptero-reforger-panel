import { useId, useRef, useState } from 'react';

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
 *
 * Unlike a plain sparkline this is readable: it carries a gridline, an axis
 * maximum, and a hover crosshair that reports the value under the pointer —
 * previously there was no way to get a number off these graphs at all.
 */
export function TimeSeriesChart({
  series,
  max,
  height = 56,
  className = '',
  format = (value: number) => value.toFixed(0),
}: {
  series: ChartSeries[];
  max?: number | null;
  height?: number;
  className?: string;
  format?: (value: number) => string;
}) {
  const clipId = useId();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<{ ratio: number } | null>(null);

  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length < 2) {
    return (
      <div
        style={{ height }}
        className={`flex items-center justify-center rounded-xs border border-graphite-800 bg-graphite-950 text-2xs text-slate-faint ${className}`}
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

  /** Nearest sample to the hovered x position, per series. */
  const hovered =
    hover === null
      ? null
      : series.map((s) => {
          const target = tMin + hover.ratio * tSpan;
          let best = s.points[0]!;
          for (const point of s.points) {
            if (Math.abs(point.t - target) < Math.abs(best.t - target)) best = point;
          }
          return { series: s, point: best };
        });

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    setHover({ ratio: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) });
  };

  return (
    <div className={`relative ${className}`}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ height }}
        className="w-full touch-none"
        role="img"
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x="0" y="0" width={W} height={H} />
          </clipPath>
        </defs>
        {/* Quarter gridlines give the eye a scale without adding clutter. */}
        {[0.25, 0.5, 0.75].map((fraction) => (
          <line
            key={fraction}
            x1="0"
            y1={H * fraction}
            x2={W}
            y2={H * fraction}
            stroke="currentColor"
            strokeOpacity={fraction === 0.5 ? 0.12 : 0.06}
            strokeWidth="0.5"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <g clipPath={`url(#${clipId})`}>
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
                {s.fill !== false && <path d={area} fill={s.color} fillOpacity="0.1" />}
                <path
                  d={line}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            );
          })}
          {hovered && (
            <>
              <line
                x1={hover!.ratio * W}
                y1="0"
                x2={hover!.ratio * W}
                y2={H}
                stroke="currentColor"
                strokeOpacity="0.35"
                strokeWidth="0.5"
                vectorEffect="non-scaling-stroke"
              />
              {hovered.map(({ series: s, point }, index) => (
                <circle
                  key={s.label ?? index}
                  cx={x(point.t)}
                  cy={y(point.v)}
                  r="1.5"
                  fill={s.color}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
            </>
          )}
        </g>
      </svg>

      {/* Axis maximum, so the shape has a magnitude attached to it. */}
      <span className="numeric pointer-events-none absolute right-0 top-0 text-2xs leading-none text-slate-faint">
        {format(scale)}
      </span>

      {hovered && (
        <div
          className="numeric pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-xs border border-graphite-600 bg-graphite-850 px-1.5 py-1 text-2xs text-zinc-100 shadow-lg shadow-black/40"
          style={{
            left: `${hover!.ratio * 100}%`,
            transform: `translate(${hover!.ratio > 0.6 ? '-100%' : '0'}, -100%)`,
          }}
        >
          {hovered.map(({ series: s, point }, index) => (
            <div key={s.label ?? index} className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: s.color }} />
              {s.label && <span className="text-slate-dim">{s.label}</span>}
              <span>{format(point.v)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
