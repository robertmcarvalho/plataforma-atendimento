import type { CSSProperties } from 'react';

/** Tokens compartilhados para Recharts, sparklines e SVG inline. */

export const chartColors = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
] as const;

export function chartColor(index: number): string {
  return chartColors[index % chartColors.length]!;
}

export const chartAxisStroke = 'var(--muted-foreground)';
export const chartGridStroke = 'var(--border)';
export const chartForeground = 'var(--foreground)';

export const chartTooltipStyle: CSSProperties = {
  background: 'var(--popover)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 11,
  color: 'var(--foreground)',
};

export const chartLegendStyle: CSSProperties = {
  fontSize: 11,
  color: 'var(--muted-foreground)',
};

export const chartTickProps = {
  fill: chartAxisStroke,
  fontSize: 10,
} as const;

export function chartGradientStops(color: string, opacity = 0.35) {
  return [
    { offset: '0%', color, opacity },
    { offset: '100%', color, opacity: 0 },
  ] as const;
}

/** Cores semânticas para séries comuns. */
export const chartSeries = {
  primary: 'var(--chart-1)',
  secondary: 'var(--chart-2)',
  success: 'var(--success)',
  destructive: 'var(--destructive)',
  warning: 'var(--warning)',
} as const;
