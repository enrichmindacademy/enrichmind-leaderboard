// A hero metric strip — the "4-6 key numbers up top" pattern from
// Stripe/Linear-style dashboards, replacing a loose row of labeled text
// with a proper bordered grid so the numbers read as the answer to
// "where do I stand," not just more copy on the page.
export default function KpiStrip({ items }) {
  return (
    <div className="kpi-grid">
      {items.map((item) => (
        <div className="kpi-cell" key={item.label}>
          <div className="kpi-label">{item.label}</div>
          <div className="kpi-value">{item.value}</div>
        </div>
      ))}
    </div>
  );
}
