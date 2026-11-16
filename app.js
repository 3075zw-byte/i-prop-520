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
  const signoffTarget = document.querySelector('#signoff-target');
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
  // 目前選定要簽核的申請（只記錄 id 與顯示文字）。
  let signoffRequest = null;

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

  function updatePeriodHint() {
    const { start, end } = readPeriod();
    if (!start || !end) {
      periodHint.textContent = '';
    } else if (end <= start) {
      periodHint.textContent = '請假結束須晚於開始。';
    } else {
      periodHint.textContent = `請假期間：${formatLocal(start)} 至 ${formatLocal(end)}。`;
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
    return `${request.employee_name}｜${formatLocal(request.leave_start)} 至 ${formatLocal(request.leave_end)}`;
  }

  function setSignoffTarget(request) {
    signoffRequest = request ? { id: request.id, label: describe(request) } : null;
    signoffTarget.textContent = signoffRequest
      ? `簽核對象：${signoffRequest.label}`
      : '簽核對象：尚未選擇，請在上方清單按「簽核此筆」。';
    signoffTarget.classList.toggle('selected', Boolean(signoffRequest));
  }

  // 重新載入後，若選定的申請已不是待審核，清除選取。
  function syncSignoffTarget(requests) {
    if (!signoffRequest) return;
    const current = requests.find((request) => request.id === signoffRequest.id);
    if (!current || current.status !== '待審核') setSignoffTarget(null);
  }

  function renderRequests(requests) {
    const fragment = document.createDocumentFragment();
    for (const request of requests) {
      const card = document.createElement('li');
      card.className = 'request-card';
      const top = appendText(card, 'div', '', 'card-top');
      appendText(top, 'span', `${formatLocal(request.leave_start)} 至 ${formatLocal(request.leave_end)}`, 'badge');
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
          setSignoffTarget(request);
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
      syncSignoffTarget(rows);
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
    showMessage(document.querySelector('#stats-message'), '目前無法連線，統計尚未載入。', 'error');
    document.querySelector('#live-text').textContent = '未連線';
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
    form.elements.end_time.setCustomValidity(start && end && end <= start ? '請假結束須晚於開始。' : '');
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
      loadStats();
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
    if (!signoffRequest) {
      showMessage(signoffMessage, '請先在上方清單的待審核申請按「簽核此筆」。', 'error');
      return;
    }
    if (!signoffForm.reportValidity()) return;

    const params = {
      p_request_id: signoffRequest.id,
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
      showMessage(signoffMessage, `簽核完成：${signoffRequest.label}，狀態為「${params.p_decision}」。`, 'success');
      setSignoffTarget(null);
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
    loadStats();
    if (loading) await pendingLoad;
    pendingLoad = loadRequests();
  });

  // ===== 每月請假統計表（即時更新、可下載 Excel） =====
  const Stats = window.LeaveStats;
  const statsMonth = document.querySelector('#stats-month');
  const statsDownload = document.querySelector('#stats-download');
  const statsMessage = document.querySelector('#stats-message');
  const statsHead = document.querySelector('#stats-head');
  const statsBody = document.querySelector('#stats-body');
  const statsFoot = document.querySelector('#stats-foot');
  const statsCaption = document.querySelector('#stats-caption');
  const statsUpdated = document.querySelector('#stats-updated');
  const liveIndicator = document.querySelector('#live-indicator');
  const liveText = document.querySelector('#live-text');
  // 固定版本的 SheetJS，只在按下載時才載入，不影響頁面開啟速度。
  const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
  const POLL_MS = 30000;
  const STATS_LIMIT = 1000;
  let statsSummary = null;
  let statsLoading = false;
  let statsQueued = false;
  let realtimeOk = false;
  let realtimeTimer;
  let xlsxPromise;

  function selectedMonth() {
    const [year, month] = statsMonth.value.split('-').map(Number);
    return { year, month };
  }

  // 月份選單：今天往前 24 個月、往後 3 個月，預設本月。
  function fillMonthOptions() {
    const now = new Date();
    const fragment = document.createDocumentFragment();
    for (let offset = 3; offset >= -24; offset -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
      const value = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const option = new Option(`${date.getFullYear()} 年 ${date.getMonth() + 1} 月`, value);
      option.selected = offset === 0;
      fragment.append(option);
    }
    statsMonth.replaceChildren(fragment);
  }

  function appendCell(row, tag, value, className = '') {
    const cell = appendText(row, tag, String(value), className);
    if (tag === 'th') cell.scope = 'row';
    return cell;
  }

  function renderStats(summary) {
    const headRow = document.createDocumentFragment();
    Stats.HEADERS.forEach((header, index) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = header;
      if (index > 0) th.className = 'num';
      headRow.append(th);
    });
    statsHead.replaceChildren(headRow);
    statsCaption.textContent = `${summary.year} 年 ${summary.month} 月請假統計`;

    const body = document.createDocumentFragment();
    for (const row of summary.rows) {
      const tr = document.createElement('tr');
      Stats.rowValues(row).forEach((value, index) => {
        if (index === 0) appendCell(tr, 'th', value);
        else appendCell(tr, 'td', typeof value === 'number' ? Stats.formatHours(value) : value, value === 0 ? 'num zero' : 'num');
      });
      body.append(tr);
    }
    statsBody.replaceChildren(body);

    const foot = document.createElement('tr');
    if (summary.rows.length) {
      Stats.rowValues(summary.total).forEach((value, index) => {
        if (index === 0) appendCell(foot, 'th', value);
        else appendCell(foot, 'td', Stats.formatHours(value), 'num');
      });
    }
    statsFoot.replaceChildren(...(summary.rows.length ? [foot] : []));
  }

  // 讀取與所選月份重疊的所有申請（起始早於月底、結束晚於月初），在前端彙總。
  async function loadStats() {
    if (statsLoading) {
      statsQueued = true;
      return;
    }
    if (!navigator.onLine) {
      showMessage(statsMessage, '目前離線，無法更新統計。' + (statsSummary ? '以下為上次讀取的資料。' : ''), 'error');
      return;
    }
    const { year, month } = selectedMonth();
    const range = Stats.monthRange(year, month);
    statsLoading = true;
    statsMonth.setAttribute('aria-busy', 'true');
    try {
      const { data, error } = await client.from('leave_requests')
        .select('id,created_at,employee_name,leave_start,leave_end,leave_types,status,approver_name,signed_at')
        .lt('leave_start', range.end)
        .gt('leave_end', range.start)
        .order('leave_start', { ascending: true })
        .limit(STATS_LIMIT);
      if (error) throw error;
      const current = selectedMonth();
      // 讀取期間使用者已切換月份時，捨棄舊結果並改讀新月份。
      if (current.year !== year || current.month !== month) {
        statsQueued = true;
        return;
      }
      statsSummary = Stats.summarizeMonth(data || [], year, month);
      renderStats(statsSummary);
      statsDownload.disabled = false;
      const truncated = (data || []).length >= STATS_LIMIT ? `資料超過 ${STATS_LIMIT} 筆，僅統計前 ${STATS_LIMIT} 筆。` : '';
      showMessage(statsMessage, statsSummary.rows.length ? truncated : `${year} 年 ${month} 月沒有請假申請。`, truncated ? 'error' : '');
      statsUpdated.textContent = ` 最後更新：${new Date().toLocaleTimeString('zh-TW', { hour12: false })}。`;
    } catch {
      showMessage(statsMessage, '無法載入統計，系統會自動再試。' + (statsSummary ? '以下保留上次載入的資料。' : ''), 'error');
    } finally {
      statsLoading = false;
      statsMonth.removeAttribute('aria-busy');
      if (statsQueued) {
        statsQueued = false;
        loadStats();
      }
    }
  }

  function setLive(state) {
    liveIndicator.dataset.state = state;
    liveText.textContent = state === 'live' ? '即時更新中' : state === 'offline' ? '離線' : `每 ${POLL_MS / 1000} 秒自動更新`;
  }

  // 資料表有新增或簽核時重新讀取清單與統計；短時間內多筆變更合併為一次。
  function onRemoteChange() {
    clearTimeout(realtimeTimer);
    realtimeTimer = setTimeout(() => {
      loadStats();
      if (!saving && !signing && !loading) pendingLoad = loadRequests();
    }, 400);
  }

  // Supabase Realtime：須先執行 supabase/migrations/20261116_enable_leave_realtime.sql；
  // 未啟用或連線中斷時，改以定時重新讀取作為備援。
  function subscribeRealtime() {
    try {
      client.channel('leave-requests-stats')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leave_requests' }, onRemoteChange)
        .subscribe((status) => {
          realtimeOk = status === 'SUBSCRIBED';
          setLive(!navigator.onLine ? 'offline' : realtimeOk ? 'live' : 'poll');
          if (realtimeOk) loadStats();
        });
    } catch {
      realtimeOk = false;
    }
  }

  setInterval(() => {
    if (document.visibilityState === 'visible' && navigator.onLine && !realtimeOk) onRemoteChange();
  }, POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine) loadStats();
  });
  window.addEventListener('online', () => { setLive(realtimeOk ? 'live' : 'poll'); loadStats(); });
  window.addEventListener('offline', () => setLive('offline'));

  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    xlsxPromise ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = XLSX_URL;
      script.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('xlsx missing')));
      script.onerror = () => { xlsxPromise = null; reject(new Error('xlsx load failed')); };
      document.head.append(script);
    });
    return xlsxPromise;
  }

  // 產生兩個工作表：「月統計」為依員工彙總，「明細」為該月每筆申請。
  async function downloadExcel() {
    if (!statsSummary) return;
    const summary = statsSummary;
    statsDownload.disabled = true;
    statsDownload.textContent = '正在產生…';
    try {
      const XLSX = await loadXlsx();
      const title = `${summary.year} 年 ${summary.month} 月請假統計`;
      const summarySheet = XLSX.utils.aoa_to_sheet([
        [title],
        [`產生時間：${new Date().toLocaleString('zh-TW', { hour12: false })}；時數只計每日 09:00–18:00`],
        Stats.HEADERS,
        ...summary.rows.map(Stats.rowValues),
        ...(summary.rows.length ? [Stats.rowValues(summary.total)] : []),
      ]);
      summarySheet['!cols'] = Stats.HEADERS.map((_, index) => ({ wch: index === 0 ? 18 : 11 }));
      summarySheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: Stats.HEADERS.length - 1 } }];

      const detailHeaders = ['員工姓名', '請假開始', '請假結束', '假別', '當月時數', '狀態', '簽核主管', '申請時間'];
      const detailSheet = XLSX.utils.aoa_to_sheet([
        detailHeaders,
        ...summary.details.map((request) => [
          request.employee_name,
          formatLocal(request.leave_start),
          formatLocal(request.leave_end),
          (Array.isArray(request.leave_types) ? request.leave_types : []).join('、'),
          Math.round(request.monthHours * 10) / 10,
          request.status,
          request.approver_name || '',
          formatTimestamp(request.created_at),
        ]),
      ]);
      detailSheet['!cols'] = [18, 17, 17, 14, 10, 8, 14, 20].map((wch) => ({ wch }));

      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, summarySheet, '月統計');
      XLSX.utils.book_append_sheet(book, detailSheet, '明細');
      XLSX.writeFile(book, `請假統計_${summary.year}-${String(summary.month).padStart(2, '0')}.xlsx`);
    } catch {
      showMessage(statsMessage, '無法產生 Excel，請確認網路連線後再試。', 'error');
    } finally {
      statsDownload.disabled = false;
      statsDownload.textContent = '下載 Excel';
    }
  }

  fillMonthOptions();
  statsMonth.disabled = false;
  statsMonth.addEventListener('change', () => {
    statsDownload.disabled = true;
    showMessage(statsMessage, '正在載入統計…');
    loadStats();
  });
  statsDownload.addEventListener('click', downloadExcel);
  setLive(navigator.onLine ? 'poll' : 'offline');

  pendingLoad = loadRequests();
  loadStats();
  subscribeRealtime();
  refreshButton.addEventListener('click', () => { pendingLoad = loadRequests(); loadStats(); });
})();
