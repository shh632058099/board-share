import assert from 'node:assert/strict';
import test from 'node:test';
import { addBusinessHours, isValidDurationHours, normalizeBusinessStart } from '../src/businessTime.js';

function localStamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

test('adds hours within the same business day', () => {
  const result = addBusinessHours(new Date('2026-04-16T10:00:00+08:00'), 2);
  assert.equal(localStamp(result), '2026-04-16 12:00');
});

test('skips the 21:00-09:00 non-business window', () => {
  const result = addBusinessHours(new Date('2026-04-16T20:00:00+08:00'), 2);
  assert.equal(localStamp(result), '2026-04-17 10:00');
});

test('supports half-hour precision across days', () => {
  const result = addBusinessHours(new Date('2026-04-16T20:30:00+08:00'), 1);
  assert.equal(localStamp(result), '2026-04-17 09:30');
});

test('starts from next 09:00 when requested outside business hours', () => {
  const normalized = normalizeBusinessStart(new Date('2026-04-16T22:15:00+08:00'));
  assert.equal(localStamp(normalized), '2026-04-17 09:00');

  const result = addBusinessHours(new Date('2026-04-16T22:15:00+08:00'), 1);
  assert.equal(localStamp(result), '2026-04-17 10:00');
});

test('validates duration granularity', () => {
  assert.equal(isValidDurationHours(0.5), true);
  assert.equal(isValidDurationHours(1), true);
  assert.equal(isValidDurationHours(1.5), true);
  assert.equal(isValidDurationHours(0.25), false);
  assert.equal(isValidDurationHours(0), false);
});
