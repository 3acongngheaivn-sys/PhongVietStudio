'use strict';

(() => {
  const quit = document.getElementById('quit-local');
  const status = document.getElementById('local-status');

  function pulse() {
    fetch('/_studio/heartbeat', { cache: 'no-store' }).catch(() => {});
  }

  const timer = setInterval(pulse, 20000);
  pulse();

  quit.addEventListener('click', async () => {
    if (!window.confirm('Thoát Studio? Chỉnh sửa chưa tải về trong tab này sẽ mất.')) return;
    quit.disabled = true;
    status.hidden = true;
    try {
      const response = await fetch('/_studio/quit', { method: 'POST' });
      if (!response.ok) throw new Error();
      clearInterval(timer);
      document.querySelector('main').hidden = true;
      quit.hidden = true;
      status.textContent = 'Studio đã tắt. Bạn có thể đóng tab này.';
    } catch {
      status.textContent = 'Không kết nối được với Studio. Nếu ứng dụng đã tắt, bạn có thể đóng tab.';
      quit.disabled = false;
    }
    status.hidden = false;
  });
})();
