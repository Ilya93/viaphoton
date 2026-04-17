import { describe, expect, it } from 'vitest';
import { computeX, formatResults, processInput } from './computeX.js';

describe('computeX — multi-stage shuttle', () => {
  // Two shuttle stages + one final trip.
  // Stage 1: k=3, rate=5, segLen=200 → 3000 kg at 200 km.
  // Stage 2: k=2, rate=3, segLen=1000/3 → 2000 kg → 1000 kg at 200+1000/3 km.
  // Final:   1000 − (1000 − 200 − 1000/3)  =  1600/3 ≈ 533.3333…
  it('D=1000 N=3000 F=1 C=1000 → exactly 1600/3', () => {
    expect(computeX(1000, 3000, 1, 1000)).toBeCloseTo(1600 / 3, 10);
  });

  // Hint case: D·F > C but N > C. Same two shuttle stages; longer final leg.
  // Final: 1000 − (1500 − 200 − 1000/3)  =  100/3 ≈ 33.3333…
  it('D=1500 N=3000 F=1 C=1000 → exactly 100/3 (hint case)', () => {
    expect(computeX(1500, 3000, 1, 1000)).toBeCloseTo(100 / 3, 10);
  });

  // Three shuttle stages (k = 4 → 3 → 2 → 1).
  // Seg lengths: (4000−3000)/7 = 1000/7;  1000/5 = 200;  1000/3.
  // Remaining distance after shuttles: 1000 − 1000/7 − 200 − 1000/3
  //   = 1000·(1 − 1/7 − 1/3) − 200
  //   = 1000·(21/21 − 3/21 − 7/21) − 200 = 1000·11/21 − 200
  //   = 11000/21 − 200 = 6800/21
  // Final deposit: 1000 − 6800/21 = (21000 − 6800)/21 = 14200/21.
  it('D=1000 N=4000 F=1 C=1000 → exactly 14200/21', () => {
    expect(computeX(1000, 4000, 1, 1000)).toBeCloseTo(14200 / 21, 10);
  });

  it('single trip when N ≤ C', () => {
    expect(computeX(100, 500, 1, 1000)).toBe(400);
  });

  it('returns 0 when a single trip cannot make it and N ≤ C', () => {
    expect(computeX(1000, 500, 1, 1000)).toBe(0);
  });
});

describe('computeX — edge cases', () => {
  it('supports decimal-valued inputs in the transport math', () => {
    expect(computeX(2.5, 10.5, 1.5, 4.25)).toBeCloseTo(2.3166666666666664, 10);
    expect(computeX(1.25, 5.5, 0.5, 3.5)).toBeCloseTo(3.625, 10);
  });

  it('F = 0 delivers the full pile (no fuel burn)', () => {
    expect(computeX(100, 500, 0, 100)).toBe(500);
    expect(computeX(10, 10, 0, 10)).toBe(10);
    expect(computeX(1000, 3000, 0, 1000)).toBe(3000);
  });

  it('D = 0 delivers the full pile', () => {
    expect(computeX(0, 100, 1, 10)).toBe(100);
  });

  it('invalid inputs return 0', () => {
    expect(computeX(10, 0, 1, 10)).toBe(0);
    expect(computeX(10, -1, 1, 10)).toBe(0);
    expect(computeX(10, 10, -1, 10)).toBe(0);
    expect(computeX(10, 10, 1, 0)).toBe(0);
    expect(computeX(-1, 10, 1, 10)).toBe(0);
  });
});

describe('processInput / formatResults', () => {
  it('emits exactly one entry per input line, blanks preserved', () => {
    const out = processInput('1000,3000,1,1000\n\n100,500,1,1000');
    expect(out).toHaveLength(3);
    expect(out[0].X).toBeCloseTo(1600 / 3, 10);
    expect(out[1].blank).toBe(true);
    expect(out[2].X).toBe(400);
  });

  it('flags malformed lines without dropping them', () => {
    const out = processInput('bad,line\n1,2,3\n1,2,3,4');
    expect(out).toHaveLength(3);
    expect(out[0].error).toBe('invalid input');
    expect(out[1].error).toBe('invalid input');
    expect(out[2].X).toBeDefined();
  });

  it('accepts decimal-valued D,N,F,C lines from batch input', () => {
    const out = processInput('2.5,10.5,1.5,4.25\n1.25,5.5,0.5,3.5');
    expect(out).toHaveLength(2);
    expect(out[0].X).toBeCloseTo(2.3166666666666664, 10);
    expect(out[1].X).toBeCloseTo(3.625, 10);
  });

  it('rejects non-decimal numeric notations in text input', () => {
    const out = processInput('1e3,3000,1,1000\nInfinity,3000,1,1000\n0x10,3000,1,1000');
    expect(out).toHaveLength(3);
    expect(out.every((row) => row.error === 'invalid input')).toBe(true);
  });

  it('formatResults preserves blank lines in output', () => {
    const results = processInput('100,500,1,1000\n\n100,500,1,1000');
    const text = formatResults(results);
    expect(text.split('\n')).toHaveLength(3);
    expect(text.split('\n')[1]).toBe('');
  });

  it('ignores the trailing split sentinel from a terminal newline', () => {
    const out = processInput('100,500,1,1000\n');
    expect(out).toHaveLength(1);
    expect(out[0].X).toBe(400);
    expect(formatResults(out)).toBe('100,500,1,1000 -> 400');
  });

  it('returns no rows for empty input', () => {
    expect(processInput('')).toEqual([]);
    expect(formatResults([])).toBe('');
  });
});
