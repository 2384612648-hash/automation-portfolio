(() => {
  const media = matchMedia('(prefers-color-scheme: light)');
  let mode = 'dark';
  try { const value = localStorage.getItem('zero:theme'); if (['dark','light','system'].includes(value)) mode = value; } catch {}
  function apply() {
    const light = mode === 'light' || (mode === 'system' && media.matches);
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]').content = light ? '#f6f1f4' : '#101014';
  }
  apply(); media.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.querySelector('#theme-mode'); select.value = mode;
    select.addEventListener('change', () => {
      mode = select.value; apply();
      try { localStorage.setItem('zero:theme', mode); } catch { select.title = '本次已切换；浏览器未允许保存偏好'; }
    });
  });
})();
