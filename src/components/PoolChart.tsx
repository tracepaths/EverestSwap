import { useRef, useEffect } from 'react';
import { createChart, AreaSeries, type IChartApi, type LineData } from 'lightweight-charts';

interface PoolChartProps {
  data: LineData[];
  height?: number;
}

export function PoolChart({ data, height = 250 }: PoolChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<ReturnType<typeof createChart>['addSeries']> | null>(null);
  const lastLenRef = useRef(0);
  // [SECURITY] FM-4: Track the time of the last data point to detect out-of-order replacements
  const lastTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;
    if (!chartApiRef.current) {
      const chart = createChart(chartRef.current, {
        layout: { textColor: '#9CA3AF', background: { color: 'transparent' } },
        grid: { vertLines: { color: '#1B2A4A' }, horzLines: { color: '#1B2A4A' } },
        width: chartRef.current.clientWidth,
        height,
        timeScale: { borderColor: '#1B2A4A' },
        rightPriceScale: { borderColor: '#1B2A4A' },
      });
      const series = chart.addSeries(AreaSeries, {
        lineColor: '#3B82F6', topColor: '#3B82F6', bottomColor: '#3B82F600', lineWidth: 2,
      });
      chartApiRef.current = chart;
      seriesRef.current = series;
      chart.timeScale().fitContent();

      const handleResize = () => {
        if (chartRef.current && chartApiRef.current) {
          chartApiRef.current.applyOptions({ width: chartRef.current.clientWidth });
        }
      };
      window.addEventListener('resize', handleResize);
      return () => {
        window.removeEventListener('resize', handleResize);
        if (chartApiRef.current) {
          chartApiRef.current.remove();
          chartApiRef.current = null;
          seriesRef.current = null;
        }
      };
    }
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    const series = seriesRef.current;
    // [SECURITY] FM-4: Reset chart if data is a full replacement (first time, length
    // dropped, or first timestamp went backward — out-of-order replacement)
    const firstTime = data[0]?.time as number | undefined;
    const isReplacement = lastLenRef.current === 0
      || data.length < lastLenRef.current
      || (firstTime != null && lastTimeRef.current != null && firstTime < lastTimeRef.current);
    if (isReplacement) {
      series.setData(data);
    } else {
      for (let i = lastLenRef.current; i < data.length; i++) {
        series.update(data[i]);
      }
    }
    lastLenRef.current = data.length;
    if (firstTime != null) lastTimeRef.current = firstTime;
  }, [data]);

  return <div ref={chartRef} style={{ height }} />;
}
