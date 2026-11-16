'use strict';

(() => {
  const form = document.querySelector('#leave-form');
  const fields = document.querySelector('#form-fields');
  const submitButton = document.querySelector('#submit-button');
  const refreshButton = document.querySelector('#refresh-button');
  const formMessage = document.querySelector('#form-message');
  const listMessage = document.querySelector('#list-message');
  const list = document.querySelector('#request-list');
  const networkMessage = document.querySelector('#network-message');
  const periodHint = document.querySelector('#duration-hint');
  const signoffForm = document.querySelector('#signoff-form');
  const signoffFields = document.querySelector('#signoff-fields');
  const signoffButton = document.querySelector('#signoff-button');
  const signoffMessage = document.querySelector('#signoff-message');
  const signoffSelect = document.querySelector('#signoff_request');
  const applicationDate = document.querySelector('#application_date');
  const leaveTypeBoxes = form.querySelectorAll('input[name="leave_types"]');
  const LEAVE_TYPES = ['事假', '病假', '特休'];
  const TEXT_FIELDS = ['employee_name', 'reason'];
  const PERIOD_FIELDS = ['start_date', 'start_time', 'end_date', 'end_time'];
  let hasLoaded = false;
  let client;
  let saving = false;
  let signing = false;
  let loading = false;
  let pendingLoad = Promise.resolve();
  // 已載入清單中待審核申請的顯示文字，供簽核成功訊息使用。
  const pendingLabels = new Map();

  function showMessage(element, text, kind = '') {
    element.textContent = text;
    element.className = `message ${kind}`;
    element.hidden = !text;
  }

  // 以純文字建立清單，避免將申請內容解讀為 HTML。
  function appendText(parent, tag, text, className = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  // 日期 "YYYY-MM-DD" 與時間 "HH:MM" 組成不含時區的當地時間 "YYYY-MM-DDTHH:MM"；不完整時回傳空字串。
  function combine(date, time) {
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? `${date}T${time}` : '';
  }

  // 資料庫回傳 "YYYY-MM-DDTHH:MM:SS"，顯示為 "YYYY-MM-DD HH:MM"；不經時區換算。
  function formatLocal(value) {
    return (value || '').slice(0, 16).replace('T', ' ');
  }

  function readPeriod() {
    const values = Object.fromEntries(PERIOD_FIELDS.map((name) => [name, form.elements[name].value]));
    return {
      start: combine(values.start_date, values.start_time),
      end: combine(values.end_date, values.end_time),
    };
  }

  // ---- 請假天數：扣除週六、週日、國定假日與非上班時段（設定見 holidays.js）。
  const CALENDAR = window.LEAVE_CALENDAR || {};
  const HOLIDAYS = new Set(CALENDAR.holidays || []);
  const MAKEUP_WORKDAYS = new Set(CALENDAR.makeupWorkdays || []);
  const HOURS_PER_DAY = Number(CALENDAR.hoursPerDay) > 0 ? Number(CALENDAR.hoursPerDay) : 8;
  const MAX_DAYS = 366;
  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
  const WORK_PERIODS = (CALENDAR.workPeriods || [{ start: '09:00', end: '12:00' }, { start: '13:00', end: '18:00' }])
    .map((period) => [toMinutes(period.start), toMinutes(period.end)]);

  function isWorkday(dateString) {
    if (MAKEUP_WORKDAYS.has(dateString)) return true;
    if (HOLIDAYS.has(dateString)) return false;
    const day = new Date(`${dateString}T00:00:00Z`).getUTCDay();
    return day !== 0 && day !== 6;
  }

  // start、end 為 "YYYY-MM-DDTHH:MM"（可帶秒）；回傳請假分鐘數，期間過長或格式不符回傳 null。
  // 以 UTC 逐日計算，只用來推算日期，不受裝置時區或日光節約時間影響。
  function leaveMinutes(start, end) {
    const match = (value) => /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value || '');
    const s = match(start);
    const e = match(end);
    if (!s || !e) return null;
    const first = Date.parse(`${s[1]}T00:00:00Z`);
    const last = Date.parse(`${e[1]}T00:00:00Z`);
    if (Number.isNaN(first) || Number.isNaN(last) || (last - first) / 86400000 > MAX_DAYS) return null;
    let total = 0;
    for (let day = first; day <= last; day += 86400000) {
      const dateString = new Date(day).toISOString().slice(0, 10);
      if (!isWorkday(dateString)) continue;
      const from = day === first ? toMinutes(s[2]) : 0;
      const to = day === last ? toMinutes(e[2]) : 1440;
      for (const [workStart, workEnd] of WORK_PERIODS) {
        total += Math.max(0, Math.min(to, workEnd) - Math.max(from, workStart));
      }
    }
    return total;
  }

  function formatLeave(minutes) {
    const hours = minutes / 60;
    const days = Math.round((hours / HOURS_PER_DAY) * 100) / 100;
    const hourText = Number.isInteger(hours) ? hours : hours.toFixed(1);
    return `${days} 天（${hourText} 小時）`;
  }

  function updatePeriodHint() {
    const { start, end } = readPeriod();
    if (!start || !end) {
      periodHint.textContent = '';
      return;
    }
    if (end <= start) {
      periodHint.textContent = '請假結束須晚於開始。';
      return;
    }
    const minutes = leaveMinutes(start, end);
    if (minutes === null) {
      periodHint.textContent = `請假期間：${formatLocal(start)} 至 ${formatLocal(end)}。期間超過一年，無法計算天數。`;
    } else if (minutes === 0) {
      periodHint.textContent = `請假期間：${formatLocal(start)} 至 ${formatLocal(end)}。此期間都是例假日或非上班時間，不需請假。`;
    } else {
      periodHint.textContent = `請假期間：${formatLocal(start)} 至 ${formatLocal(end)}，扣除例假日後共 ${formatLeave(minutes)}。`;
    }
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '時間不明' : date.toLocaleString('zh-TW', { hour12: false });
  }

  // 申請日期以裝置當地日期顯示；送出時不傳送，資料庫自動記錄申請時間。
  function setApplicationDate() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    applicationDate.value = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  function describe(request) {
    const minutes = leaveMinutes(request.leave_start, request.leave_end);
    const days = minutes ? `｜${formatLeave(minutes)}` : '';
    return `${request.employee_name}｜${formatLocal(request.leave_start)} 至 ${formatLocal(request.leave_end)}${days}`;
  }

  // 待審核下拉選單只列出已載入清單中「待審核」的申請，並盡量保留目前選取。
  function renderSignoffOptions(requests) {
    const selected = signoffSelect.value;
    const pending = requests.filter((request) => request.status === '待審核');
    pendingLabels.clear();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = pending.length ? '請選擇要簽核的申請' : '目前沒有待審核的申請';
    const options = pending.map((request) => {
      pendingLabels.set(request.id, describe(request));
      const option = document.createElement('option');
      option.value = request.id;
      option.textContent = describe(request);
      return option;
    });
    signoffSelect.replaceChildren(placeholder, ...options);
    if (pendingLabels.has(selected)) signoffSelect.value = selected;
  }

  function renderRequests(requests) {
    const fragment = document.createDocumentFragment();
    for (const request of requests) {
      const card = document.createElement('li');
      card.className = 'request-card';
      const top = appendText(card, 'div', '', 'card-top');
      appendText(top, 'span', `${formatLocal(request.leave_start)} 至 ${formatLocal(request.leave_end)}`, 'badge');
      const minutes = leaveMinutes(request.leave_start, request.leave_end);
      if (minutes !== null) appendText(top, 'span', formatLeave(minutes), 'badge leave-days');
      for (const type of Array.isArray(request.leave_types) ? request.leave_types : []) {
        appendText(top, 'span', type, 'badge leave-type');
      }
      appendText(top, 'span', request.status, `badge status ${request.status === '已退回' ? 'status-rejected' : ''}`);
      appendText(card, 'strong', request.employee_name);
      appendText(card, 'p', request.reason, 'request-description');
      appendText(card, 'p', `申請時間：${formatTimestamp(request.created_at)}`, 'request-meta');
      if (request.signed_at) {
        const comment = request.approver_comment ? `；意見：${request.approver_comment}` : '';
        appendText(card, 'p', `主管簽核：${request.approver_name}・${request.status}・${formatTimestamp(request.signed_at)}${comment}`, 'signoff-info');
      } else if (request.status === '待審核') {
        const actions = appendText(card, 'div', '', 'card-actions');
        const button = appendText(actions, 'button', '簽核此筆', 'secondary');
        button.type = 'button';
        button.setAttribute('aria-label', `簽核此筆：${describe(request)}`);
        button.addEventListener('click', () => {
          signoffSelect.value = request.id;
          showMessage(signoffMessage, '');
          signoffForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
          signoffForm.elements.approver_name.focus({ preventScroll: true });
        });
      }
      fragment.append(card);
    }
    list.replaceChildren(fragment);
  }

  // 只讀取畫面需要的欄位；由資料庫排序並限制最近 20 筆。
  async function loadRequests() {
    if (loading) return;
    if (!navigator.onLine) {
      showMessage(listMessage, '目前離線，無法讀取最新清單。' + (hasLoaded ? '以下為本頁上次讀取的資料。' : ''), 'error');
      return;
    }
    loading = true;
    refreshButton.disabled = true;
    list.setAttribute('aria-busy', 'true');
    showMessage(listMessage, '正在載入清單…');
    try {
      const { data, error } = await client.from('leave_requests')
        .select('id,created_at,employee_name,leave_start,leave_end,reason,leave_types,status,approver_name,approver_comment,signed_at')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20);
      if (error) throw error;
      const rows = data || [];
      hasLoaded = true;
      renderRequests(rows);
      renderSignoffOptions(rows);
      showMessage(listMessage, rows.length ? '' : '目前還沒有請假申請紀錄。');
    } catch {
      const retained = hasLoaded ? '以下保留上次載入的資料。' : '';
      showMessage(listMessage, `無法載入清單，請稍後按「重新整理」再試。${retained}`, 'error');
    } finally {
      loading = false;
      refreshButton.disabled = !navigator.onLine;
      list.setAttribute('aria-busy', 'false');
    }
  }

  // 沿用無登入示範的 anon 權限，不儲存或接收登入工作階段。
  try {
    const config = window.APP_CONFIG;
    if (!window.supabase || !config?.supabaseUrl || !config?.supabasePublishableKey) {
      throw new Error('missing configuration');
    }
    client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    fields.disabled = false;
    signoffFields.disabled = false;
    refreshButton.disabled = false;
  } catch {
    showMessage(formMessage, '系統初始化失敗，請確認網路連線後重新載入頁面。', 'error');
    showMessage(listMessage, '目前無法連線，清單尚未載入。', 'error');
    return;
  }

  // 離線時不送出、不排入佇列，避免將未傳送的申請誤報為成功。
  function updateNetworkState() {
    submitButton.disabled = saving || !navigator.onLine;
    signoffButton.disabled = signing || !navigator.onLine;
    refreshButton.disabled = loading || !navigator.onLine;
    showMessage(networkMessage, navigator.onLine ? '' : '目前離線，無法送出申請或取得最新清單。可先填寫，恢復連線後再自行送出；輸入內容只保留在本頁，重新載入或關閉後會消失。', 'error');
    if (!navigator.onLine && !loading) {
      showMessage(listMessage, '目前離線，無法讀取最新清單。' + (hasLoaded ? '以下為本頁上次讀取的資料。' : ''), 'error');
    }
  }
  window.addEventListener('offline', updateNetworkState);
  window.addEventListener('online', () => {
    updateNetworkState();
    pendingLoad = loadRequests();
  });
  updateNetworkState();

  for (const name of TEXT_FIELDS) {
    form.elements[name].addEventListener('input', (event) => event.target.setCustomValidity(''));
  }
  // 選了開始日期而結束日期尚未填寫時，預設為同一天。
  form.elements.start_date.addEventListener('change', () => {
    if (!form.elements.end_date.value) form.elements.end_date.value = form.elements.start_date.value;
    updatePeriodHint();
  });
  for (const name of PERIOD_FIELDS) {
    form.elements[name].addEventListener('input', () => {
      form.elements.end_time.setCustomValidity('');
      updatePeriodHint();
    });
  }
  form.addEventListener('reset', () => setTimeout(() => { updatePeriodHint(); setApplicationDate(); }));
  for (const box of leaveTypeBoxes) {
    box.addEventListener('change', () => leaveTypeBoxes[0].setCustomValidity(''));
  }
  setApplicationDate();

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!navigator.onLine) {
      updateNetworkState();
      showMessage(formMessage, '目前離線，尚未送出申請。請恢復連線後再按送出。', 'error');
      return;
    }
    for (const name of TEXT_FIELDS) {
      const input = form.elements[name];
      input.setCustomValidity(input.value.trim() ? '' : '請填寫內容，不能只有空白。');
    }
    const leaveTypes = LEAVE_TYPES.filter((type) => form.querySelector(`input[name="leave_types"][value="${type}"]`).checked);
    leaveTypeBoxes[0].setCustomValidity(leaveTypes.length ? '' : '請至少勾選一種假別。');
    const { start, end } = readPeriod();
    const minutes = start && end && end > start ? leaveMinutes(start, end) : null;
    form.elements.end_time.setCustomValidity(
      start && end && end <= start ? '請假結束須晚於開始。'
        : minutes === 0 ? '此期間都是例假日或非上班時間，不需請假。'
          : start && end && minutes === null ? '請假期間不可超過一年。' : '',
    );
    if (!form.reportValidity()) return;

    // 僅送出五個可新增欄位；不送 status、id 或 created_at，使用資料庫預設值。
    const payload = {
      employee_name: form.elements.employee_name.value.trim(),
      leave_start: start,
      leave_end: end,
      leave_types: leaveTypes,
      reason: form.elements.reason.value.trim(),
    };
    saving = true;
    fields.disabled = true;
    submitButton.textContent = '正在送出…';
    showMessage(formMessage, '正在送出，請稍候…');
    try {
      const { error } = await client.from('leave_requests').insert(payload);
      if (error) throw error;
      form.reset();
      showMessage(formMessage, '請假申請已送出，狀態為「待審核」。', 'success');
      // 若使用者正在更新清單，等待該次請求完成，再取得新增後的結果。
      if (loading) await pendingLoad;
      pendingLoad = loadRequests();
      await pendingLoad;
    } catch {
      showMessage(formMessage, '送出未完成確認。請先重新整理清單，確認是否已送出，再決定是否重試；表單內容已保留。', 'error');
    } finally {
      saving = false;
      fields.disabled = false;
      submitButton.textContent = '送出申請';
      updateNetworkState();
    }
  });

  signoffForm.elements.approver_name.addEventListener('input', (event) => event.target.setCustomValidity(''));

  // 主管簽核：呼叫資料庫函式，由資料庫檢查簽核碼並只允許簽核「待審核」的申請。
  signoffForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (signing) return;
    if (!navigator.onLine) {
      updateNetworkState();
      showMessage(signoffMessage, '目前離線，尚未送出簽核。請恢復連線後再按送出。', 'error');
      return;
    }
    const approver = signoffForm.elements.approver_name;
    approver.setCustomValidity(approver.value.trim() ? '' : '請填寫內容，不能只有空白。');
    if (!signoffForm.reportValidity()) return;

    const label = pendingLabels.get(signoffSelect.value) || '';
    const params = {
      p_request_id: signoffSelect.value,
      p_decision: signoffForm.elements.decision.value,
      p_approver_name: approver.value.trim(),
      p_comment: signoffForm.elements.approver_comment.value.trim(),
      p_code: signoffForm.elements.signoff_code.value,
    };
    signing = true;
    signoffFields.disabled = true;
    signoffButton.textContent = '正在送出…';
    showMessage(signoffMessage, '正在送出簽核，請稍候…');
    try {
      const { error } = await client.rpc('sign_leave_request', params);
      if (error) throw error;
      signoffForm.reset();
      showMessage(signoffMessage, `簽核完成：${label}，狀態為「${params.p_decision}」。`, 'success');
    } catch (error) {
      const text = String(error?.message || '');
      const reason = text.includes('invalid supervisor code')
        ? '簽核碼不正確，請向管理者確認。'
        : text.includes('already signed')
          ? '這筆申請已被簽核或不存在，請重新整理清單。'
          : '簽核未完成確認。請先重新整理清單，確認狀態後再決定是否重試。';
      showMessage(signoffMessage, reason, 'error');
      // 不保留簽核碼於畫面，避免他人使用同一裝置時看到或重送。
      signoffForm.elements.signoff_code.value = '';
    } finally {
      signing = false;
      signoffFields.disabled = false;
      signoffButton.textContent = '送出簽核';
      updateNetworkState();
    }
    if (loading) await pendingLoad;
    pendingLoad = loadRequests();
  });

  pendingLoad = loadRequests();
  refreshButton.addEventListener('click', () => { pendingLoad = loadRequests(); });
})();
