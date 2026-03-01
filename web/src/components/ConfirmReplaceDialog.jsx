export default function ConfirmReplaceDialog({ source, destination }) {
  return (
    <section className="panel">
      <h3>Destination already exists</h3>
      <p>Choose whether to replace the destination folder completely or skip the transfer.</p>
      <div className="compare-grid">
        <div>
          <strong>Source</strong>
          <div>Size: {source?.sizeBytes ?? 0}</div>
          <div>Modified: {source?.modifiedEpoch ?? 0}</div>
        </div>
        <div>
          <strong>Destination</strong>
          <div>Size: {destination?.sizeBytes ?? 0}</div>
          <div>Modified: {destination?.modifiedEpoch ?? 0}</div>
        </div>
      </div>
      <div className="button-row">
        <button>Replace</button>
        <button>Skip</button>
      </div>
    </section>
  );
}
