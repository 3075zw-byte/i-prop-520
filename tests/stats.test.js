'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Stats = require('../stats.js');

const req = (name, start, end, types, status = '待審核') => ({
  employee_name: name, leave_start: start, leave_end: end, leave_types: types, status,
});

test('counts_only_working_hours_within_a_day_excluding_lunch', () => {
  const r = req('甲', '2026-11-03T08:00:00', '2026-11-03T17:00:00', ['事假']);
  assert.equal(Stats.hoursInMonth(r, 2026, 11), 8);
});

test('splits_multi_day_leave_into_daily_working_hours', () => {
  const r = req('甲', '2026-11-03T14:00:00', '2026-11-05T12:00:00', ['病假']);
  // 週二 3 + 週三 8 + 週四 4
  assert.equal(Stats.hoursInMonth(r, 2026, 11), 15);
});

test('splits_cross_month_leave_by_month', () => {
  const r = req('甲', '2026-11-30T08:00:00', '2026-12-01T17:00:00', ['特休']);
  assert.equal(Stats.hoursInMonth(r, 2026, 11), 8);
  assert.equal(Stats.hoursInMonth(r, 2026, 12), 8);
  assert.equal(Stats.overlapsMonth(r, 2026, 10), false);
});

test('month_range_wraps_december_to_next_year', () => {
  assert.deepEqual(Stats.monthRange(2026, 12), { start: '2026-12-01T00:00:00', end: '2027-01-01T00:00:00' });
});

test('summarizes_by_employee_with_totals', () => {
  const rows = [
    req('虛構員工乙', '2026-11-02T09:00:00', '2026-11-02T13:00:00', ['事假', '病假'], '已核准'),
    req('虛構員工甲', '2026-11-04T08:00:00', '2026-11-04T17:00:00', ['特休'], '已退回'),
    req('虛構員工乙', '2026-11-10T08:00:00', '2026-11-10T17:00:00', ['病假']),
    req('虛構員工甲', '2026-10-04T08:00:00', '2026-10-04T17:00:00', ['特休']),
  ];
  const summary = Stats.summarizeMonth(rows, 2026, 11);
  assert.equal(summary.rows.length, 2);
  const b = summary.rows.find((row) => row.name === '虛構員工乙');
  assert.equal(b.count, 2);
  assert.deepEqual(b.types, { 事假: 1, 病假: 2, 特休: 0 });
  // 11-02 週一 09:00–13:00 只計 3 小時（午休不計），11-10 週二 8 小時
  assert.equal(b.hours, 11);
  assert.equal(b.approvedHours, 3);
  assert.deepEqual(b.statuses, { 待審核: 1, 已核准: 1, 已退回: 0 });
  assert.equal(summary.total.count, 3);
  assert.equal(summary.total.hours, 19);
  assert.equal(summary.details.length, 3);
  assert.deepEqual(Stats.rowValues(summary.total), ['合計', 3, 1, 2, 1, 19, 3, 1, 1, 1]);
});

test('empty_month_has_no_rows', () => {
  const summary = Stats.summarizeMonth([], 2026, 11);
  assert.equal(summary.rows.length, 0);
  assert.equal(summary.total.count, 0);
});

test('excludes_weekends', () => {
  // 2026-11-20 週五 → 11-23 週一，週六、週日不計
  const r = req('甲', '2026-11-20T08:00:00', '2026-11-23T17:00:00', ['事假']);
  assert.equal(Stats.leaveMinutes(r) / 60, 16);
  assert.equal(Stats.leaveMinutes(req('甲', '2026-11-21T08:00:00', '2026-11-22T17:00:00', ['事假'])), 0);
});

test('applies_holidays_and_makeup_workdays_from_calendar', () => {
  globalThis.LEAVE_CALENDAR = {
    workPeriods: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
    hoursPerDay: 8,
    holidays: ['2026-11-23'],
    makeupWorkdays: ['2026-11-21'],
  };
  try {
    // 週五 8 + 週六補班 8 + 週日 0 + 週一國定假日 0
    const r = req('甲', '2026-11-20T08:00:00', '2026-11-23T17:00:00', ['事假']);
    assert.equal(Stats.leaveMinutes(r) / 60, 16);
    assert.equal(Stats.hoursInMonth(r, 2026, 11), 16);
  } finally {
    delete globalThis.LEAVE_CALENDAR;
  }
});

test('rejects_invalid_period_values', () => {
  assert.ok(Number.isNaN(Stats.leaveMinutes(req('甲', 'bad', '2026-11-20T17:00:00', ['事假']))));
});

test('formats_hours_to_one_decimal', () => {
  assert.equal(Stats.formatHours(9), '9');
  assert.equal(Stats.formatHours(1.25), '1.3');
});

test('counts_work_hours_from_0800_to_1700_with_lunch_break', () => {
  // 07:00–18:00 只計 08:00–12:00 與 13:00–17:00，共 8 小時
  const r = req('甲', '2026-11-03T07:00:00', '2026-11-03T18:00:00', ['事假']);
  assert.equal(Stats.leaveMinutes(r) / 60, 8);
  // 17:00 之後不計
  assert.equal(Stats.leaveMinutes(req('甲', '2026-11-03T17:00:00', '2026-11-03T18:00:00', ['事假'])), 0);
});
