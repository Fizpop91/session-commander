export default function StatusBadge({ ok, label }) {
  return <span className={ok ? 'badge ok' : 'badge warn'}>{label}</span>;
}
