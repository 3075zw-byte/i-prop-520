'use strict';

(() => {
  const installButton = document.querySelector('#install-button');
  const help = document.querySelector('#install-help');
  const message = document.querySelector('#pwa-message');
  let installPrompt;
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (standalone) help.hidden = true;

  // 僅在瀏覽器提供安裝事件時顯示按鈕，其餘裝置可查看手動安裝說明。
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    installButton.hidden = true;
    try {
      await prompt.prompt();
      await prompt.userChoice;
    } catch {
      help.hidden = false;
    }
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    installButton.hidden = true;
    help.hidden = true;
  });

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    message.textContent = '目前瀏覽器無法啟用離線功能，仍可連網使用報修網頁。';
    return;
  }
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      const updateMessage = () => {
        message.textContent = registration.waiting
          ? '新版已備妥。請先完成操作，關閉此網站的所有分頁與視窗，再重新開啟更新。'
          : '離線介面已準備完成。送出報修與讀取最新清單仍需要網路。';
      };
      navigator.serviceWorker.ready.then(updateMessage);
      if (registration.waiting) updateMessage();
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) updateMessage();
        });
      });
    } catch {
      message.textContent = '離線功能未能準備完成，請連網重新開啟；報修網頁仍可連網使用。';
    }
  });
})();
