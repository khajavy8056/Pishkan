/* Apply the saved theme before the first paint. Kept external for the CSP. */
(function () {
  try {
    var stored = window.localStorage.getItem('pishkan.theme');
    var mode = stored === 'light' || stored === 'dark' ? stored : 'system';
    var dark = mode === 'dark' || (mode === 'system' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
    var root = document.documentElement;
    root.classList.toggle('dark', dark);
    root.dataset.theme = dark ? 'dark' : 'light';
    root.style.colorScheme = dark ? 'dark' : 'light';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#060c17' : '#f2f6fc');
  } catch (error) { /* private mode / blocked storage */ }
})();
