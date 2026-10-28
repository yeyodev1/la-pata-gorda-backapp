/** Fechas en hora de Ecuador (America/Guayaquil, sin horario de verano: UTC-5). */
const EC_OFFSET_MS = -5 * 60 * 60 * 1000;

export function ecuadorDateString(date = new Date()): string {
  return new Date(date.getTime() + EC_OFFSET_MS).toISOString().slice(0, 10);
}

/** 0 = domingo … 6 = sábado, en hora de Ecuador. */
export function ecuadorWeekday(date = new Date()): number {
  return new Date(date.getTime() + EC_OFFSET_MS).getUTCDay();
}

export function monthKey(date = new Date()): string {
  return ecuadorDateString(date).slice(0, 7);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86400000);
}

/** YYYY-MM-DD + n días. */
export function addDaysStr(day: string, days: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(day: string): number {
  return new Date(`${day}T12:00:00Z`).getUTCDay();
}

export const WEEKDAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
