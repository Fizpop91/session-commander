export default function DirectoryTree({ title, items = [], onRefresh }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <button onClick={onRefresh}>Refresh</button>
      </div>
      <ul className="tree-list">
        {items.map((item) => (
          <li key={`${item.kind}-${item.name}`}>{item.kind === 'directory' ? '📁' : '📄'} {item.name}</li>
        ))}
      </ul>
    </section>
  );
}
