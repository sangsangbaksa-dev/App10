// Apply the saved theme before first paint under a script-src 'self' policy.
try {
  const theme = localStorage.getItem('pv-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch { /* Storage can be disabled; the system theme still works. */ }
