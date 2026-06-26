export function StatusItem({ label, value, highlight = false, warning = false }: { label: string; value: string; highlight?: boolean; warning?: boolean }) {
  return (
    <div className={highlight ? 'status-item highlight' : warning ? 'status-item warning' : 'status-item'}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

export function ChartHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="chart-header">
      <h2>{title}</h2>
      <span>{subtitle}</span>
    </div>
  );
}

export function Metric({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <b className={valueClass}>{value}</b>
    </div>
  );
}
