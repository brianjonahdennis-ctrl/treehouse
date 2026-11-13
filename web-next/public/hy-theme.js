// Apply the saved theme before first paint (no flash). Kept separate: the page's security policy blocks inline scripts.
try { var t = JSON.parse(localStorage.getItem('hy-theme') || '"system"'); if (t !== 'system') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
