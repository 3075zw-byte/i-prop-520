'use strict';

(() => {
  const form = document.querySelector('#repair-form');
  const fields = document.querySelector('#form-fields');
  const submitButton = document.querySelector('#submit-button');
  const refreshButton = document.querySelector('#refresh-button');
  const formMessage = document.querySelector('#form-message');
  const listMessage = document.querySelector('#list-message');
  const list = document.querySelector('#request-list');
  const filterButtons = document.querySelectorAll('.filter-button');
  const filterSummary = document.querySelector('#filter-summary');
  const networkMessage = document.querySelector('#network-message');
  let cachedRequests = [];
  let selectedUrgency = '全部';
  let hasLoaded = false;
  let client;
  let saving = false;
  let loading = false;

  function showMessage(element, text, kind = '') {
    element.textContent = text;
    element.className = `message ${kind}`;
    element.hidden = !text;
  }

  // 以純文字建立清單，避免將報修內容解讀為 HTML。
  function appendText(parent, tag, text, className = '') {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    parent.append(element);
    return element;
  }

  function renderRequests(requests) {
    const fragment = document.createDocumentFragment();
    for (const request of requests) {
      const card = document.createElement('li');
      card.className = 'request-card';
      const top = appendText(card, 'div', '', 'card-top');
      appendText(top, 'span', request.category, 'badge');
      appendText(top, 'span', `${request.urgency}緊急程度`, `badge ${request.urgency === '高' ? 'urgency-high' : ''}`);
      appendText(top, 'span', request.status, 'badge status');
      appendText(card, 'strong', request.location);
      appendText(card, 'p', request.description, 'request-description');
      const date = new Date(request.created_at);
      const time = Number.isNaN(date.getTime()) ? '時間不明' : date.toLocaleString('zh-TW', { hour12: false });
      appendText(card, 'p', `${request.reporter_name} · ${time}`, 'request-meta');
      fragment.append(card);
    }
    list.replaceChildren(fragment);
  }

  // 篩選只處理已讀取的最近 20 筆，不發出額外資料庫請求，也不改變排序。
  function applyUrgencyFilter() {
    for (const button of filterButtons) {
      button.setAttribute('aria-pressed', String(button.dataset.urgency === selectedUrgency));
    }
    if (!hasLoaded) return;
    const visible = selectedUrgency === '全部'
      ? cachedRequests
      : cachedRequests.filter((request) => request.urgency === selectedUrgency);
    renderRequests(visible);
    filterSummary.hidden = false;
    filterSummary.textContent = visible.length
      ? `目前顯示 ${visible.length} 筆（${selectedUrgency}）；篩選範圍為已載入的最近 20 筆。`
      : selectedUrgency === '全部'
        ? '目前還沒有報修紀錄。'
        : `已載入的清單中沒有緊急程度為「${selectedUrgency}」的報修。`;
  }

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      selectedUrgency = button.dataset.urgency;
      applyUrgencyFilter();
    });
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
      const { data, error } = await client.from('repair_requests')
        .select('id,created_at,reporter_name,location,category,description,urgency,status')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(20);
      if (error) throw error;
      cachedRequests = data || [];
      hasLoaded = true;
      applyUrgencyFilter();
      showMessage(listMessage, '');
    } catch {
      const retained = hasLoaded ? '保留上次載入的資料，仍可切換篩選。' : '';
      showMessage(listMessage, `無法載入清單，請稍後按「重新整理」再試。${retained}`, 'error');
    } finally {
      loading = false;
      refreshButton.disabled = !navigator.onLine;
      list.setAttribute('aria-busy', 'false');
    }
  }

  // 沿用無登入示範的 anon 權限，不儲存或接收登入工作階段。
  try {
    const config = window.REPAIR_CONFIG;
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

  // 離線時不送出、不排入佇列，避免將未傳送的報修誤報為成功。
  function updateNetworkState() {
    submitButton.disabled = saving || !navigator.onLine;
    refreshButton.disabled = loading || !navigator.onLine;
    showMessage(networkMessage, navigator.onLine ? '' : '目前離線，無法送出報修或取得最新清單。可先填寫，恢復連線後再自行送出；輸入內容只保留在本頁，重新載入或關閉後會消失。', 'error');
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

  // 拒絕只有空白的必填欄位；使用者編輯後清除上次的驗證訊息。
  for (const name of ['reporter_name', 'location', 'description']) {
    form.elements[name].addEventListener('input', (event) => event.target.setCustomValidity(''));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
    if (!navigator.onLine) {
      updateNetworkState();
      showMessage(formMessage, '目前離線，尚未送出報修。請恢復連線後再按送出。', 'error');
      return;
    }
    for (const name of ['reporter_name', 'location', 'description']) {
      const input = form.elements[name];
      input.setCustomValidity(input.value.trim() ? '' : '請填寫內容，不能只有空白。');
    }
    if (!form.reportValidity()) return;

    const values = new FormData(form);
    // 僅送出五個可新增欄位；不送 status、id 或 created_at，使用資料庫預設值。
    const payload = {
      reporter_name: values.get('reporter_name').trim(),
      location: values.get('location').trim(),
      category: values.get('category'),
      description: values.get('description').trim(),
      urgency: values.get('urgency'),
    };
    saving = true;
    fields.disabled = true;
    submitButton.textContent = '正在送出…';
    showMessage(formMessage, '正在送出，請稍候…');
    try {
      const { error } = await client.from('repair_requests').insert(payload);
      if (error) throw error;
      form.reset();
      showMessage(formMessage, '報修已成功登記，狀態為「待處理」。', 'success');
      // 若使用者正在更新清單，等待該次請求完成，再取得新增後的結果。
      if (loading) await pendingLoad;
      pendingLoad = loadRequests();
      await pendingLoad;
    } catch {
      showMessage(formMessage, '送出未完成確認。請先重新整理清單，確認是否已登記，再決定是否重試；表單內容已保留。', 'error');
    } finally {
      saving = false;
      fields.disabled = false;
      submitButton.textContent = '送出報修';
      updateNetworkState();
    }
  });

  let pendingLoad = loadRequests();
  refreshButton.addEventListener('click', () => { pendingLoad = loadRequests(); });
})();
