export interface DateRange {
  from: string;
  to: string;
}

/**
 * Formats a date as YYYY-MM-DD in UTC.
 * @param date Date instance.
 * @returns ISO day string.
 */
export function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Returns the YYYY-MM month key for a day string.
 * @param day Day in YYYY-MM-DD format.
 * @returns Month key.
 */
export function monthKey(day: string): string {
  return day.slice(0, 7);
}

/**
 * Returns all days in an inclusive date range.
 * @param range Inclusive date range.
 * @returns Day strings.
 */
export function daysInRange(range: DateRange): string[] {
  const days: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (cursor <= end) {
    days.push(formatDay(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * Builds a range ending today and covering a number of days.
 * @param days Number of days to include.
 * @returns Inclusive date range.
 */
export function rangeFromDays(days: number): DateRange {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - Math.max(days - 1, 0));
  return { from: formatDay(from), to: formatDay(to) };
}

/**
 * Returns the first and last day of a month.
 * @param key Month key in YYYY-MM format.
 * @returns Inclusive date range.
 */
export function monthRange(key: string): DateRange {
  const [yearValue, monthValue] = key.split('-');
  const year = Number.parseInt(yearValue ?? '', 10);
  const month = Number.parseInt(monthValue ?? '', 10);
  if (!Number.isInteger(year) || !Number.isInteger(month)) {
    throw new Error(`Invalid month key: ${key}`);
  }
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: formatDay(from), to: formatDay(to) };
}

/**
 * Returns the default hot months for daily refresh.
 * @param refreshPreviousThroughDay Include previous month until this day of month.
 * @returns Month keys.
 */
export function defaultRefreshMonths(refreshPreviousThroughDay: number): string[] {
  const now = new Date();
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const months = [current];
  if (now.getUTCDate() <= refreshPreviousThroughDay) {
    const previous = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    months.push(`${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}
