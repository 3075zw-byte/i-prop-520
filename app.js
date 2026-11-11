'use strict';

(() => {
  const form = document.querySelector('#repair-form');
  const fields = document.querySelector('#form-fields');
  const submitButton = document.querySelector('#submit-button');
  const refreshButton = document.querySelector('#refresh-button');
  const formMessage = document.querySelector('#form-message');
  const listMessage = document.querySelector('#list-message');
  const list = document.querySelector('#request-list');
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

  // 只讀取畫面需要的欄位；由資料庫排序並限制最近 20 筆。
  async function loadRequests() {
    if (loading) return;
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
      renderRequests(data || []);
      showMessage(listMessage, data?.length ? '' : '目前還沒有報修紀錄。');
    } catch {
      const retained = list.children.length ? '以下保留上次載入的資料。' : '';
      showMessage(listMessage, `無法載入清單，請稍後按「重新整理」再試。${retained}`, 'error');
    } finally {
      loading = false;
      refreshButton.disabled = false;
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

  // 拒絕只有空白的必填欄位；使用者編輯後清除上次的驗證訊息。
  for (const name of ['reporter_name', 'location', 'description']) {
    form.elements[name].addEventListener('input', (event) => event.target.setCustomValidity(''));
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving) return;
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
    }
  });

  let pendingLoad = loadRequests();
  refreshButton.addEventListener('click', () => { pendingLoad = loadRequests(); });
})();
