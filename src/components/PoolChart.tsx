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
      return () => { window.removeEventListener('resize', handleResize); };
    }
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || data.length === 0) return;
    const series = seriesRef.current;
    if (lastLenRef.current === 0) {
      series.setData(data);
    } else {
      for (let i = lastLenRef.current; i < data.length; i++) {
        series.update(data[i]);
      }
    }
    lastLenRef.current = data.length;
  }, [data]);

  return <div ref={chartRef} style={{ height }} />;
}
