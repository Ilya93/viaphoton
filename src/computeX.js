// Classic jeep / "bananas across the desert" variant.
//
// To move n kg forward by dx km when n > C, the horse makes
// k = ceil(n / C) forward trips plus (k - 1) returns, burning
// F * (2k - 1) kg per km of forward progress.
//
// Greedy rule: travel forward just far enough for remaining nuts
// to drop to (k - 1) * C, then repeat with one fewer round trip.
// Once nuts <= C, take a single final trip to the town.

const DECIMAL_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

function parseDecimalLiteral(token) {
  const trimmed = token.trim();
  if (!DECIMAL_LITERAL.test(trimmed)) return Number.NaN;
  return Number(trimmed);
}

export function computeX(D, N, F, C) {
  if (![D, N, F, C].every(Number.isFinite)) return 0;
  if (!(D >= 0) || !(N > 0) || !(F >= 0) || !(C > 0)) return 0;

  // F = 0: no fuel cost, so every nut reaches the town.
  if (F === 0) return N;

  let nuts = N;
  let distance = D;

  while (nuts > C && distance > 0) {
    const k = Math.ceil(nuts / C);
    const rate = F * (2 * k - 1);
    const segLen = (nuts - (k - 1) * C) / rate;

    if (segLen >= distance) {
      nuts -= rate * distance;
      distance = 0;
    } else {
      nuts = (k - 1) * C;
      distance -= segLen;
    }
  }

  if (distance > 0 && nuts > 0) {
    nuts = Math.min(nuts, C) - F * distance;
  }

  return Math.max(0, nuts);
}

// Parse "D,N,F,C" lines. One result per input line (blanks preserved)
// so the caller can emit exactly as many output lines as input lines.
// Each entry is one of:
//   { line: '', blank: true }
//   { line, error: 'invalid input' }
//   { line, D, N, F, C, X }
export function processInput(text) {
  const lines = text.split(/\r?\n/);

  // String split leaves a trailing empty token when the text ends with a
  // newline. Drop only that sentinel so intentional blank lines are preserved.
  if (lines.length === 1 && lines[0] === '') return [];
  if (lines.at(-1) === '') lines.pop();

  return lines.map((raw) => {
    const line = raw.trim();
    if (line === '') return { line: '', blank: true };

    const parts = line.split(',').map(parseDecimalLiteral);
    if (parts.length !== 4 || parts.some(Number.isNaN)) {
      return { line, error: 'invalid input' };
    }
    const [D, N, F, C] = parts;
    return { line, D, N, F, C, X: computeX(D, N, F, C) };
  });
}

export function formatResults(results) {
  return results
    .map((r) => {
      if (r.blank) return '';
      if (r.error) return `${r.line} -> ${r.error}`;
      return `${r.line} -> ${r.X}`;
    })
    .join('\n');
}
