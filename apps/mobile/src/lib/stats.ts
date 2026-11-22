export interface AccuracyRow { kind: string; correct: number; incorrect: number; unscored: number }
export interface StatRow extends AccuracyRow { label: string; accuracy: string }

const LABELS: Record<string, string> = { at_time: 'At a time', until_when: 'Until when' };
const ORDER = Object.keys(LABELS);

function withAccuracy(r: AccuracyRow, label: string): StatRow {
  const scored = r.correct + r.incorrect;
  return { ...r, label, accuracy: scored ? `${Math.round((r.correct / scored) * 100)}%` : '—' };
}

/** Rows from household_accuracy (known kinds first, then any other) plus an overall row. */
export function accuracyRows(data: AccuracyRow[]): { rows: StatRow[]; overall: StatRow } {
  const idx = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
  const rows = [...data].sort((a, b) => idx(a.kind) - idx(b.kind)).map((r) => withAccuracy(r, LABELS[r.kind] ?? r.kind));
  const sum = (f: (r: AccuracyRow) => number) => data.reduce((n, r) => n + f(r), 0);
  const overall = withAccuracy(
    { kind: 'overall', correct: sum((r) => r.correct), incorrect: sum((r) => r.incorrect), unscored: sum((r) => r.unscored) },
    'Overall',
  );
  return { rows, overall };
}

/** The cached result only counts for the household it was fetched for. */
export const forHousehold = <T extends { id: string }>(s: T | null, id: string | undefined): T | null => (s && s.id === id ? s : null);
