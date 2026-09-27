(() => {
  const key = 'direct-theme';
  let current = 'light';
  try {
    current = localStorage.getItem(key) === 'dark' ? 'dark' : 'light';
  } catch (_) {
    current = 'light';
  }

  function apply(theme, persist = false) {
    current = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = current;
    document.documentElement.style.colorScheme = current;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = current === 'dark' ? '#0d1524' : '#07165c';
    if (persist) {
      try { localStorage.setItem(key, current); } catch (_) {}
    }
    const next = current === 'dark' ? 'claro' : 'escuro';
    for (const button of document.querySelectorAll('#theme-toggle, #login-theme-toggle')) {
      button.setAttribute('aria-label', `Ativar tema ${next}`);
      button.title = `Ativar tema ${next}`;
      button.setAttribute('aria-pressed', String(current === 'dark'));
    }
    const label = document.querySelector('.theme-toggle-label');
    if (label) label.textContent = `Tema ${next}`;
  }

  apply(current);
  document.addEventListener('DOMContentLoaded', () => {
    apply(current);
    for (const button of document.querySelectorAll('#theme-toggle, #login-theme-toggle')) {
      button.addEventListener('click', () => apply(current === 'dark' ? 'light' : 'dark', true));
    }
  });
  window.addEventListener('storage', (event) => {
    if (event.key === key) apply(event.newValue === 'dark' ? 'dark' : 'light');
  });
})();
