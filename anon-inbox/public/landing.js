// treehouse.ng landing page: mobile menu, sticky header border, and "Open treehouse" for people
// who are already signed in on this device.
(() => {
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.nav-toggle');
  const links = document.getElementById('nav-links');
  if (toggle && links) {
    const set = (open) => { links.classList.toggle('open', open); toggle.setAttribute('aria-expanded', String(open)); };
    toggle.addEventListener('click', () => set(!links.classList.contains('open')));
    links.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') set(false); });
  }
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Already signed in here? Say "Open treehouse" instead of "Join".
  let signedIn = false;
  try { signedIn = Object.keys(localStorage).some((k) => /^sb-.+-auth-token$/.test(k)); } catch {}
  if (signedIn) {
    document.querySelectorAll('[data-open-app]').forEach((a) => {
      if (/join|create/i.test(a.textContent)) a.textContent = 'Open treehouse';
    });
  }

  document.querySelectorAll('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()); });
})();
