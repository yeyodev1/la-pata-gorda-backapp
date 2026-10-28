export const round2 = (n: number) => Math.round(n * 100) / 100;
export const round3 = (n: number) => Math.round(n * 1000) / 1000;
export const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Desviación porcentual de un valor real contra el esperado (0 si no hay esperado). */
export function deviationPct(actual: number, expected: number): number {
  if (!expected) return 0;
  return round2(((actual - expected) / expected) * 100);
}
