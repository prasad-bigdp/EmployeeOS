const metrics = [
  ["Health", "84/100"],
  ["Revenue", "+18.2%"],
  ["Retention", "91%"],
  ["Lead Quality", "78/100"]
];

const memory = [
  "Company Memory",
  "Historical Memory",
  "Pattern Memory",
  "Relationship Memory"
];

export default function App() {
  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">EmployeeOS Desktop</p>
        <h1>Persistent company brain for local-first operations.</h1>
        <p className="lede">
          The desktop shell shares the same local runtime as the terminal app. It shows health,
          memory, reports, and approvals from one place.
        </p>
      </section>

      <section className="grid">
        {metrics.map(([label, value]) => (
          <article className="card" key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>Memory layers</h2>
        <ul>
          {memory.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
