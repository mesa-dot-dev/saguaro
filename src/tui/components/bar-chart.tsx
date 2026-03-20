import { theme } from '../lib/theme.js';

export interface BarChartItem {
  label: string;
  value: number;
  suffix?: string;
}

interface BarChartProps {
  items: BarChartItem[];
  maxBarWidth?: number;
  fillColor?: string;
  emptyColor?: string;
}

export function BarChart({
  items,
  maxBarWidth = 20,
  fillColor = theme.info,
  emptyColor = theme.border,
}: BarChartProps) {
  if (items.length === 0) return null;

  const maxValue = Math.max(...items.map((i) => i.value));
  const maxLabelLen = Math.max(...items.map((i) => i.label.length));

  return (
    <box flexDirection="column">
      {items.map((item) => {
        const filled = maxValue > 0 ? Math.round((item.value / maxValue) * maxBarWidth) : 0;
        const empty = maxBarWidth - filled;
        const label = item.label.padEnd(maxLabelLen);

        return (
          <box key={item.label} flexDirection="row">
            <text fg={theme.textDim}>{label} </text>
            <text fg={fillColor}>{'\u2588'.repeat(filled)}</text>
            <text fg={emptyColor}>{'\u2591'.repeat(empty)}</text>
            <text fg={theme.text}> {item.suffix ?? item.value}</text>
          </box>
        );
      })}
    </box>
  );
}
