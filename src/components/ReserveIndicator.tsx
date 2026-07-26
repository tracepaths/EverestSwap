interface ReserveIndicatorProps {
  value: string;
  label: string;
}

export default function ReserveIndicator({ value, label }: ReserveIndicatorProps) {
  const empty = Number(value) === 0 || value === '0' || value === '';
  return (
    <div className="bg-[var(--app-panel-soft)] rounded-xl p-3 text-center border border-[var(--app-border-soft)]">
      <div className="text-[10px] text-[var(--app-muted)] uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-mono text-sm font-bold ${empty ? 'text-green-400' : 'text-[var(--app-text)]'}`}>{empty ? '0 ✓' : value}</div>
      {empty && <div className="text-[10px] text-green-400/60 mt-0.5">drained</div>}
    </div>
  );
}
