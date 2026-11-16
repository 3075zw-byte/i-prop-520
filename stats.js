'use strict';

// 每月請假統計：純計算函式，不接觸畫面或資料庫，可在瀏覽器與 Node 測試中共用。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LeaveStats = api;
})(typeof self !== 'undefined' ? self : this, () => {
  const LEAVE_TYPES = ['事假', '病假', '特休'];
  const STATUSES = ['待審核', '已核准', '已退回'];
  // 每日上班時段 09:00–18:00（與表單預設時間一致），請假時數只計算落在此時段內的部分。
  const WORK_START_MIN = 9 * 60;
  const WORK_END_MIN = 18 * 60;
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

  // 計算 [start, end) 期間內、落在每日上班時段的分鐘數。
  function workMinutes(start, end) {
    if (!(end > start)) return 0;
    let total = 0;
    for (let day = Math.floor(start / DAY) * DAY; day < end; day += DAY) {
      const from = Math.max(start, day + WORK_START_MIN * MINUTE);
      const to = Math.min(end, day + WORK_END_MIN * MINUTE);
      if (to > from) total += (to - from) / MINUTE;
    }
    return total;
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
    parseLocal, monthRange, workMinutes, hoursInMonth, overlapsMonth,
    summarizeMonth, formatHours, rowValues,
  };
});
