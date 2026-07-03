// Content script for the tab groups list page.  It runs on the
// file:/// list page so that other extensions (e.g., Click-by-Voice)
// can also operate on it.
const root = document.getElementById('__tab_groups_root__');

if (root) {
  // Marks that the content script has run on this page.
  root.setAttribute('data-content-script', 'ready');
}
