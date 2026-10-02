export type SparklineChartColor = 1 | 2 | 3 | 4 | 5;

export function Sparkline({
  values,
  width = 140,
  height = 34,
  className = '',
  chartColor = 1,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  chartColor?: SparklineChartColor;
}) {
  const safe = values.length ? values : [0];
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const span = Math.max(1e-9, max - min);
  const token = `var(--chart-${chartColor})`;
  const gradientId = `sparkFill-${chartColor}-${width}-${height}`;

  const stepX = safe.length === 1 ? 0 : width / (safe.length - 1);
  const points = safe.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / span) * height;
    return [x, y] as const;
  });

  const d = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(' ');

  const area = `${d} L ${width.toFixed(2)} ${height.toFixed(2)} L 0 ${height.toFixed(2)} Z`;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={`color-mix(in oklch, ${token} 35%, transparent)`} />
          <stop offset="1" stopColor={`color-mix(in oklch, ${token} 0%, transparent)`} />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={d}
        fill="none"
        stroke={`color-mix(in oklch, ${token} 90%, transparent)`}
        strokeWidth="2"
        strokeLinejoin="round"
      />
    </svg>
  );
}
