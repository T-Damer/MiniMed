/** Hour/minute pair as the time field edits it; either part may still be missing while typing. */
export interface TimeParts {
  readonly hour?: number | undefined;
  readonly minute?: number | undefined;
}

export interface CompleteTime {
  readonly hour: number;
  readonly minute: number;
}

const TIME_PATTERN = /^(\d{1,2}):(\d{2})$/;

function inRange(value: number | undefined, max: number): value is number {
  return value !== undefined && Number.isInteger(value) && value >= 0 && value <= max;
}

/** «08:05» → `{ hour: 8, minute: 5 }`; anything that is not a valid 24-hour «HH:MM» → `undefined`. */
export function parseTimeValue(value: string): CompleteTime | undefined {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!inRange(hour, 23) || !inRange(minute, 59)) return undefined;
  return { hour, minute };
}

/** `{ hour: 8, minute: 5 }` → «08:05»; incomplete or out-of-range parts → `undefined`. */
export function formatTimeValue(time: TimeParts): string | undefined {
  const { hour, minute } = time;
  if (!inRange(hour, 23) || !inRange(minute, 59)) return undefined;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
