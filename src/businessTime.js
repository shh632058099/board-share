const WORK_START_HOUR = 9;
const WORK_END_HOUR = 21;
const HOUR_MS = 60 * 60 * 1000;

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid date: ${value}`);
  }
  return date;
}

function atHour(date, hour) {
  const result = new Date(date.getTime());
  result.setHours(hour, 0, 0, 0);
  return result;
}

function nextWorkStart(date) {
  const result = atHour(date, WORK_START_HOUR);
  result.setDate(result.getDate() + 1);
  return result;
}

export function normalizeBusinessStart(value) {
  const date = asDate(value);
  const start = atHour(date, WORK_START_HOUR);
  const end = atHour(date, WORK_END_HOUR);

  if (date < start) {
    return start;
  }

  if (date >= end) {
    return nextWorkStart(date);
  }

  return date;
}

export function addBusinessHours(startValue, hours) {
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new TypeError('hours must be greater than 0');
  }

  let cursor = normalizeBusinessStart(startValue);
  let remainingMs = Math.round(hours * HOUR_MS);

  while (remainingMs > 0) {
    const workEnd = atHour(cursor, WORK_END_HOUR);
    const availableMs = Math.max(0, workEnd.getTime() - cursor.getTime());

    if (remainingMs <= availableMs) {
      return new Date(cursor.getTime() + remainingMs);
    }

    remainingMs -= availableMs;
    cursor = nextWorkStart(cursor);
  }

  return cursor;
}

export function isOverdue(plannedEndAt, now = new Date()) {
  return asDate(now).getTime() > asDate(plannedEndAt).getTime();
}

export function isValidDurationHours(value) {
  return Number.isFinite(value) && value >= 0.5 && Number.isInteger(value * 2);
}
