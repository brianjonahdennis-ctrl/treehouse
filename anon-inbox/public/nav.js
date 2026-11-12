// Bottom tab bar for signed-in members: 💌 Inbox (/link) · 🔍 Browse (/date?view=browse) · 💘 Dating (/date?view=chats)
// · ⚙️ Settings (/link?view=settings).
// Pages call appTabs.show(active) / appTabs.hide() and appTabs.badge(name, count).
window.appTabs = (() => {
  const TABS = [
    { name: 'inbox', icon: '💌', label: 'Inbox', href: '/link' },
    { name: 'browse', icon: '🔍', label: 'Browse', href: '/date?view=browse' },
    { name: 'dating', icon: '💘', label: 'Dating', href: '/date?view=chats' },
    { name: 'settings', icon: '⚙️', label: 'Settings', href: '/link?view=settings' },
  ];
  const nav = document.createElement('nav');
  nav.className = 'app-tabs hidden';
  nav.setAttribute('aria-label', 'Tell Hydra');
  const links = {};
  for (const t of TABS) {
    const a = document.createElement('a');
    a.href = t.href;
    a.dataset.tab = t.name;
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.textContent = t.icon;
    const label = document.createElement('span');
    label.textContent = t.label;
    const badge = document.createElement('b');
    badge.className = 'tab-badge hidden';
    a.append(icon, label, badge);
    nav.append(a);
    links[t.name] = a;
  }
  document.body.append(nav);

  return {
    // Same-page tabs can be handled by the page instead of reloading.
    onSelect(name, fn) { links[name].addEventListener('click', (e) => { e.preventDefault(); fn(); }); },
    show(active) {
      nav.classList.remove('hidden');
      document.body.classList.add('with-tabs');
      for (const [name, a] of Object.entries(links)) {
        a.classList.toggle('on', name === active);
        if (name === active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      }
    },
    hide() { nav.classList.add('hidden'); document.body.classList.remove('with-tabs'); },
    badge(name, count) {
      const b = links[name] && links[name].querySelector('.tab-badge');
      if (!b) return;
      b.textContent = count > 99 ? '99+' : String(count || '');
      b.classList.toggle('hidden', !count);
    },
  };
})();
