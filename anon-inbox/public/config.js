// Where the pages find the treehouse server.
// On the website this stays empty (same address as the page). A phone app build (Capacitor) loads
// the pages from inside the app, so it replaces this file with the real server address, e.g.
//   window.TH_CONFIG = { apiBase: 'https://tell.brianjonahdennis.com', siteUrl: 'https://tell.brianjonahdennis.com' };
window.TH_CONFIG = window.TH_CONFIG || {};
