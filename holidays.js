// 請假天數計算用的上班時間與國定假日設定；可隨靜態網頁上傳，不含任何金鑰。
// 週六、週日一律視為例假日，不計入請假天數。
// holidays：週一至週五中放假的日期（國定假日、補假），格式 YYYY-MM-DD。
// makeupWorkdays：週六、週日中需上班的補班日，格式 YYYY-MM-DD。
// 請依行政院人事行政總處公布的當年度「政府行政機關辦公日曆表」填寫並定期更新；
// 修改後請同步增加 sw.js 的快取版本，讓已安裝的裝置取得新設定。
window.LEAVE_CALENDAR = Object.freeze({
  // 每日上班時段（24 小時制）；午休時間不在時段內，不計入請假時數。
  workPeriods: Object.freeze([
    Object.freeze({ start: '09:00', end: '12:00' }),
    Object.freeze({ start: '13:00', end: '18:00' }),
  ]),
  // 一天的上班時數，用來把請假時數換算成天數。
  hoursPerDay: 8,
  holidays: Object.freeze([
    // 例：'2027-01-01',
  ]),
  makeupWorkdays: Object.freeze([
    // 例：'2027-02-20',
  ]),
});
