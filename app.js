'use strict';

(() => {
  const form = document.querySelector('#overtime-form');
  const fields = document.querySelector('#form-fields');
  const submitButton = document.querySelector('#submit-button');
  const refreshButton = document.querySelector('#refresh-button');
  const formMessage = document.querySelector('#form-message');
  const listMessage = document.querySelector('#list-message');
  const list = document.querySelector('#request-list');
  const networkMessage = document.querySelector('#network-message');
  const durationHint = document.querySelector('#duration-hint');
  const TEXT_FIELDS = ['employee_name', 'reason'];
  let hasLoaded = false;
  let client;
  let saving = false;
  let loading = false;
  let pendingLoad = Promise.resolve();

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

  // "HH:MM" 或 "HH:MM:SS" 轉為當日分鐘數；格式不符回傳 NaN。
  function toMinutes(value) {
    const match = /^(\d{2}):(\d{2})/.exec(value || '');
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  }

  function formatDuration(minutes) {
    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;
    return rest ? `${hours} 小時 ${rest} 分` : `${hours} 小時`;
  }

  function updateDurationHint() {
    const start = toMinutes(form.elements.start_time.value);
    const end = toMinutes(form.elements.end_time.value);
    if (Number.isNaN(start) || Number.isNaN(end)) {
      durationHint.textContent = '';
    } else if (end <= start) {
      durationHint.textContent = '結束時間須晚於開始時間。';
    } else {
      durationHint.textContent = `預計加班 ${formatDuration(end - start)}。`;
    }
  }

  function renderRequests(requests) {
    const fragment = document.createDocumentFragment();
    for (const request of requests) {
      const card = document.createElement('li');
      card.className = 'request-card';
      const top = appendText(card, 'div', '', 'card-top');
      const start = (request.start_time || '').slice(0, 5);
      const end = (request.end_time || '').slice(0, 5);
      appendText(top, 'span', request.overtime_date, 'badge');
      appendText(top, 'span', `${start}–${end}`, 'badge');
      const minutes = toMinutes(end) - toMinutes(start);
      if (minutes > 0) appendText(top, 'span', formatDuration(minutes), 'badge');
      appendText(top, 'span', request.status, 'badge status');
      appendText(card, 'strong', request.employee_name);
      appendText(card, 'p', request.reason, 'request-description');
      const date = new Date(request.created_at);
      const time = Number.isNaN(date.getTime()) ? '時間不明' : date.toLocaleString('zh-TW', { hour12: false });
      appendText(card, 'p', `申請時間：${time}`, 'request-meta');
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
      const { data, error } = await client.from('overtime_requests')
        .select('id,created_at,employee_name,overtime_date,start_time,end_time,reason,status')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20);
      if (error) throw error;
      const rows = data || [];
      hasLoaded = true;
      renderRequests(rows);
      showMessage(listMessage, rows.length ? '' : '目前還沒有加班申請紀錄。');
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
    refreshButton.disabled = false;
  } catch {
    showMessage(formMessage, '系統初始化失敗，請確認網路連線後重新載入頁面。', 'error');
    showMessage(listMessage, '目前無法連線，清單尚未載入。', 'error');
    return;
  }

  // 離線時不送出、不排入佇列，避免將未傳送的申請誤報為成功。
  function updateNetworkState() {
    submitButton.disabled = saving || !navigator.onLine;
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

  // 使用者編輯後清除上次的驗證訊息。
  for (const name of [...TEXT_FIELDS, 'start_time', 'end_time']) {
    form.elements[name].addEventListener('input', (event) => {
      event.target.setCustomValidity('');
      if (name.endsWith('_time')) {
        form.elements.end_time.setCustomValidity('');
        updateDurationHint();
      }
    });
  }

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
    const start = toMinutes(form.elements.start_time.value);
    const end = toMinutes(form.elements.end_time.value);
    form.elements.end_time.setCustomValidity(
      !Number.isNaN(start) && !Number.isNaN(end) && end <= start ? '結束時間須晚於開始時間。' : '',
    );
    if (!form.reportValidity()) return;

    const values = new FormData(form);
    // 僅送出五個可新增欄位；不送 status、id 或 created_at，使用資料庫預設值。
    const payload = {
      employee_name: values.get('employee_name').trim(),
      overtime_date: values.get('overtime_date'),
      start_time: values.get('start_time'),
      end_time: values.get('end_time'),
      reason: values.get('reason').trim(),
    };
    saving = true;
    fields.disabled = true;
    submitButton.textContent = '正在送出…';
    showMessage(formMessage, '正在送出，請稍候…');
    try {
      const { error } = await client.from('overtime_requests').insert(payload);
      if (error) throw error;
      form.reset();
      updateDurationHint();
      showMessage(formMessage, '加班申請已送出，狀態為「待審核」。', 'success');
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

  pendingLoad = loadRequests();
  refreshButton.addEventListener('click', () => { pendingLoad = loadRequests(); });
})();
