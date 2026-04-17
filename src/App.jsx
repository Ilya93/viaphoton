import { useMemo, useState } from 'react';
import { computeX, processInput } from './computeX.js';

// Every line below has been cross-checked against an independent
// re-derivation (see scripts/verify-batch.mjs). Comments show expected X.
const SAMPLE = `1000,3000,1,1000
1500,3000,1,1000
1000,4000,1,1000
500,2000,1,1000
100,500,1,1000
1000,500,1,1000
0,1000,1,1000
1000,10000,0,1000
1000,10000,1,1000
1000,10000,2,1000
2.5,10.5,1.5,4.25
1,1,0.5,1`;

function SingleCalculator() {
  const [D, setD] = useState(1000);
  const [N, setN] = useState(3000);
  const [F, setF] = useState(1);
  const [C, setC] = useState(1000);

  const X = useMemo(
    () => computeX(Number(D), Number(N), Number(F), Number(C)),
    [D, N, F, C]
  );

  const fields = [
    { label: 'D — distance (km)', value: D, set: setD },
    { label: 'N — pile size (kg)', value: N, set: setN },
    { label: 'F — fuel per km (kg)', value: F, set: setF },
    { label: 'C — cart capacity (kg)', value: C, set: setC },
  ];

  return (
    <section className="card">
      <h2>Single run</h2>
      <div className="grid">
        {fields.map((f) => (
          <label key={f.label}>
            <span>{f.label}</span>
            <input
              type="number"
              min="0"
              step="any"
              value={f.value}
              onChange={(e) => f.set(e.target.value)}
            />
          </label>
        ))}
      </div>
      <div className="result">
        <span>X delivered to town</span>
        <strong>{Number.isFinite(X) ? X.toFixed(4) : '—'} kg</strong>
      </div>
    </section>
  );
}

function BatchRunner() {
  const [text, setText] = useState(SAMPLE);

  const results = useMemo(() => processInput(text), [text]);

  return (
    <section className="card">
      <h2>Batch input</h2>
      <p className="hint">
        One line per case: <code>D,N,F,C</code>. Decimal values are supported,
        and blank lines are preserved in the output.
      </p>
      <textarea
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        spellCheck={false}
      />
      <div className="output">
        {results.length === 0 ? (
          <p className="muted">No input yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Input</th>
                <th>X (kg)</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => (
                <tr key={i}>
                  <td>
                    {r.blank ? (
                      <span className="muted">(blank line)</span>
                    ) : (
                      <code>{r.line}</code>
                    )}
                  </td>
                  <td>
                    {r.blank ? (
                      <span className="muted">—</span>
                    ) : r.error ? (
                      <span className="err">{r.error}</span>
                    ) : (
                      r.X.toFixed(4)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

export default function App() {
  return (
    <main>
      <header>
        <h1>Nuts Across the Desert</h1>
        <p>
          Maximum nuts a horse-drawn cart can deliver given distance{' '}
          <code>D</code>, pile <code>N</code>, burn rate <code>F</code>,
          capacity <code>C</code>.
        </p>
      </header>
      <SingleCalculator />
      <BatchRunner />
      <footer>
        <details>
          <summary>Approach</summary>
          <p>
            With <code>n</code> kg of nuts, the horse needs{' '}
            <code>k = ⌈n / C⌉</code> forward trips and <code>k − 1</code>{' '}
            returns, burning <code>F·(2k−1)</code> kg per km of forward
            progress. The optimal strategy travels just far enough to drop the
            remaining load to <code>(k−1)·C</code>, then repeats with one fewer
            round trip. Once <code>n ≤ C</code>, one final dash reaches the
            town.
          </p>
        </details>
      </footer>
    </main>
  );
}
