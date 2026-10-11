/** 48213 -> "48.2K", the way profile stats are shortened. */
export function compact(n: number): string {
  if (n < 10_000) return n.toLocaleString('en-US');
  const trim = (v: number) => v.toFixed(1).replace(/\.0$/, '');
  if (n < 1_000_000) return `${trim(Math.floor(n / 100) / 10)}K`;
  if (n < 1_000_000_000) return `${trim(Math.floor(n / 100_000) / 10)}M`;
  return `${trim(Math.floor(n / 100_000_000) / 10)}B`;
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

/** "Oct 14, 3:00 PM", with the year added when it is not this year. */
export function dateTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "Oct 14" for grid chips. */
export function shortDate(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** "October 14, 2026" for the open post. */
export function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/** How long ago a post went live, as a visitor on `now` would read it. */
export function ago(ms: number, now: number): string {
  const mins = Math.max(0, Math.floor((now - ms) / 60_000));
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins} ${plural(mins, 'minute')} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} ${plural(hours, 'hour')} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${plural(days, 'day')} ago`;
  return longDate(ms);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ms -> the value a datetime-local input expects, in the creator's own time zone. */
export function toInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromInput(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isNaN(t) ? null : t;
}
