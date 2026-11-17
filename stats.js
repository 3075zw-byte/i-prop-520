'use strict';

// 每月請假統計：純計算函式，不接觸畫面或資料庫，可在瀏覽器與 Node 測試中共用。
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeaveStats = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, (root) => {
  const LEAVE_TYPES = ['事假', '病假', '特休'];
  const STATUSES = ['待審核', '已核准', '已退回'];
  // 上班時段、國定假日與補班日來自 holidays.js 的 LEAVE_CALENDAR；未載入時使用下列預設。
  // 請假時數只計算工作日上班時段內的部分：不計週六、週日、國定假日與午休，補班日照常計算。
  const DEFAULT_PERIODS = [['08:00', '12:00'], ['13:00', '17:00']];
  const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  const pad = (n) => String(n).padStart(2, '0');

  // 將不含時區的 "YYYY-MM-DDTHH:MM[:SS]" 視為 UTC 毫秒做純日曆運算，避免裝置時區與日光節約影響。
  function parseLocal(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value || '');
    if (!match) return NaN;
    const [, y, mo, d, h, mi] = match.map(Number);
    return Date.UTC(y, mo - 1, d, h, mi);
  }

  // 該月第一天 00:00 與下個月第一天 00:00，格式與資料庫 timestamp 相同。
  function monthRange(year, month) {
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return {
      start: `${year}-${pad(month)}-01T00:00:00`,
      end: `${nextYear}-${pad(nextMonth)}-01T00:00:00`,
    };
  }

  // 每次計算時讀取設定，讓測試或管理者更新 holidays.js 後立即生效。
  function calendar() {
    const config = (root && root.LEAVE_CALENDAR) || {};
    const periods = Array.isArray(config.workPeriods) && config.workPeriods.length
      ? config.workPeriods.map((period) => [toMin(period.start), toMin(period.end)])
      : DEFAULT_PERIODS.map(([from, to]) => [toMin(from), toMin(to)]);
    const hoursPerDay = Number(config.hoursPerDay) > 0 ? Number(config.hoursPerDay) : 8;
    return { periods, hoursPerDay, holidays: new Set(config.holidays || []), makeup: new Set(config.makeupWorkdays || []) };
  }

  // day 為某日 00:00 的 UTC 毫秒；補班日優先，其次排除國定假日與週六、週日。
  function isWorkday(day, cal = calendar()) {
    const date = new Date(day).toISOString().slice(0, 10);
    if (cal.makeup.has(date)) return true;
    if (cal.holidays.has(date)) return false;
    const weekday = new Date(day).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  }

  // 計算 [start, end) 期間內、落在工作日上班時段的分鐘數。
  function workMinutes(start, end) {
    if (!(end > start)) return 0;
    const cal = calendar();
    let total = 0;
    for (let day = Math.floor(start / DAY) * DAY; day < end; day += DAY) {
      if (!isWorkday(day, cal)) continue;
      for (const [periodStart, periodEnd] of cal.periods) {
        const from = Math.max(start, day + periodStart * MINUTE);
        const to = Math.min(end, day + periodEnd * MINUTE);
        if (to > from) total += (to - from) / MINUTE;
      }
    }
    return total;
  }

  // 單筆申請的請假分鐘數（不分月份），供表單與清單顯示天數；格式不符回傳 NaN。
  function leaveMinutes(request) {
    const start = parseLocal(request.leave_start);
    const end = parseLocal(request.leave_end);
    if (Number.isNaN(start) || Number.isNaN(end)) return NaN;
    return workMinutes(start, end);
  }

  function hoursPerDay() {
    return calendar().hoursPerDay;
  }

  // 單筆申請在指定月份內的請假時數（小時）；跨月申請依日期分別計入各月。
  function hoursInMonth(request, year, month) {
    const range = monthRange(year, month);
    const start = Math.max(parseLocal(request.leave_start), parseLocal(range.start));
    const end = Math.min(parseLocal(request.leave_end), parseLocal(range.end));
    return workMinutes(start, end) / 60;
  }

  function overlapsMonth(request, year, month) {
    const range = monthRange(year, month);
    const start = parseLocal(request.leave_start);
    const end = parseLocal(request.leave_end);
    return start < parseLocal(range.end) && end > parseLocal(range.start);
  }

  function emptyRow(name) {
    return {
      name,
      count: 0,
      types: Object.fromEntries(LEAVE_TYPES.map((type) => [type, 0])),
      hours: 0,
      approvedHours: 0,
      statuses: Object.fromEntries(STATUSES.map((status) => [status, 0])),
    };
  }

  function addTo(row, request, hours) {
    row.count += 1;
    for (const type of Array.isArray(request.leave_types) ? request.leave_types : []) {
      if (type in row.types) row.types[type] += 1;
    }
    row.hours += hours;
    if (request.status === '已核准') row.approvedHours += hours;
    if (request.status in row.statuses) row.statuses[request.status] += 1;
  }

  // 依員工彙總指定月份：申請筆數、各假別筆數（複選時各自計入）、請假時數、已核准時數與各狀態筆數。
  function summarizeMonth(requests, year, month) {
    const byName = new Map();
    const total = emptyRow('合計');
    const details = [];
    for (const request of requests || []) {
      if (!overlapsMonth(request, year, month)) continue;
      const hours = hoursInMonth(request, year, month);
      const name = request.employee_name || '（未填）';
      if (!byName.has(name)) byName.set(name, emptyRow(name));
      addTo(byName.get(name), request, hours);
      addTo(total, request, hours);
      details.push({ ...request, monthHours: hours });
    }
    const rows = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    details.sort((a, b) => (a.leave_start < b.leave_start ? -1 : a.leave_start > b.leave_start ? 1 : 0));
    return { year, month, rows, total, details };
  }

  // 時數顯示到小數一位，整數不帶小數點。
  function formatHours(hours) {
    const rounded = Math.round(hours * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  }

  const HEADERS = ['員工姓名', '申請筆數', ...LEAVE_TYPES, '請假時數', '已核准時數', ...STATUSES];

  function rowValues(row) {
    return [
      row.name,
      row.count,
      ...LEAVE_TYPES.map((type) => row.types[type]),
      Math.round(row.hours * 10) / 10,
      Math.round(row.approvedHours * 10) / 10,
      ...STATUSES.map((status) => row.statuses[status]),
    ];
  }

  return {
    LEAVE_TYPES, STATUSES, HEADERS,
    parseLocal, monthRange, isWorkday, workMinutes, leaveMinutes, hoursPerDay, hoursInMonth, overlapsMonth,
    summarizeMonth, formatHours, rowValues,
  };
});
