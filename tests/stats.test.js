'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Stats = require('../stats.js');

const req = (name, start, end, types, status = '待審核') => ({
  employee_name: name, leave_start: start, leave_end: end, leave_types: types, status,
});

test('counts_only_working_hours_within_a_day', () => {
  const r = req('甲', '2026-11-03T09:00:00', '2026-11-03T18:00:00', ['事假']);
  assert.equal(Stats.hoursInMonth(r, 2026, 11), 9);
});

test('splits_multi_day_leave_into_daily_working_hours', () => {
  const r = req('甲', '2026-11-03T14:00:00', '2026-11-05T12:00:00', ['病假']);
  // 4 + 9 + 3
  assert.equal(Stats.hoursInMonth(r, 2026, 11), 16);
});

test('splits_cross_month_leave_by_month', () => {
  const r = req('甲', '2026-11-30T09:00:00', '2026-12-01T18:00:00', ['特休']);
  assert.equal(Stats.hoursInMonth(r, 2026, 11), 9);
  assert.equal(Stats.hoursInMonth(r, 2026, 12), 9);
  assert.equal(Stats.overlapsMonth(r, 2026, 10), false);
});

test('month_range_wraps_december_to_next_year', () => {
  assert.deepEqual(Stats.monthRange(2026, 12), { start: '2026-12-01T00:00:00', end: '2027-01-01T00:00:00' });
});

test('summarizes_by_employee_with_totals', () => {
  const rows = [
    req('虛構員工乙', '2026-11-02T09:00:00', '2026-11-02T13:00:00', ['事假', '病假'], '已核准'),
    req('虛構員工甲', '2026-11-04T09:00:00', '2026-11-04T18:00:00', ['特休'], '已退回'),
    req('虛構員工乙', '2026-11-10T09:00:00', '2026-11-10T18:00:00', ['病假']),
    req('虛構員工甲', '2026-10-04T09:00:00', '2026-10-04T18:00:00', ['特休']),
  ];
  const summary = Stats.summarizeMonth(rows, 2026, 11);
  assert.equal(summary.rows.length, 2);
  const b = summary.rows.find((row) => row.name === '虛構員工乙');
  assert.equal(b.count, 2);
  assert.deepEqual(b.types, { 事假: 1, 病假: 2, 特休: 0 });
  assert.equal(b.hours, 13);
  assert.equal(b.approvedHours, 4);
  assert.deepEqual(b.statuses, { 待審核: 1, 已核准: 1, 已退回: 0 });
  assert.equal(summary.total.count, 3);
  assert.equal(summary.total.hours, 22);
  assert.equal(summary.details.length, 3);
  assert.deepEqual(Stats.rowValues(summary.total), ['合計', 3, 1, 2, 1, 22, 4, 1, 1, 1]);
});

test('empty_month_has_no_rows', () => {
  const summary = Stats.summarizeMonth([], 2026, 11);
  assert.equal(summary.rows.length, 0);
  assert.equal(summary.total.count, 0);
});

test('formats_hours_to_one_decimal', () => {
  assert.equal(Stats.formatHours(9), '9');
  assert.equal(Stats.formatHours(1.25), '1.3');
});
