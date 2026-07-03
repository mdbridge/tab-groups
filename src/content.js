// Content script for the tab groups list page.  It runs on the
// file:/// list page so that other extensions (e.g., Click-by-Voice)
// can also operate on it.
const root = document.getElementById('__tab_groups_root__');

if (root) {
  // Marks that the content script has run on this page.
  root.setAttribute('data-content-script', 'ready');

  // Escape closes the list page.  The background service worker removes
  // the tab, since a normal page cannot close its own tab.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: 'closeList' });
    }
  });

  chrome.runtime.sendMessage({ action: 'getGroups' }, (response) => {
    render(response?.groups || []);
  });
}

function pad(n) {
  return String(n).padStart(2, '0');
}

// Formats an epoch-ms time as local "YYYY-MM-DD HH:MM:SS".
function formatTime(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function render(groups) {
  root.innerHTML = '';

  const h1 = document.createElement('h1');
  h1.textContent = 'Tab Groups';
  root.appendChild(h1);

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  toolbar.appendChild(makeToolbarLink('export-link', 'Export'));
  toolbar.appendChild(makeToolbarLink('import-link', 'Import'));
  root.appendChild(toolbar);

  if (groups.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No archived tab groups.';
    root.appendChild(empty);
    return;
  }

  for (const group of groups) {
    root.appendChild(renderGroup(group));
  }
}

// Export and Import are wired up in later phases.
function makeToolbarLink(id, text) {
  const a = document.createElement('a');
  a.id = id;
  a.href = '#';
  a.textContent = text;
  a.addEventListener('click', (e) => e.preventDefault());
  return a;
}

function renderGroup(group) {
  const section = document.createElement('section');
  section.className = 'tab-group';
  section.dataset.created = group.created;

  const header = document.createElement('div');
  header.className = 'group-header';

  const time = document.createElement('span');
  time.className = 'group-time';
  time.textContent = formatTime(group.created);
  header.appendChild(time);

  const count = document.createElement('span');
  count.className = 'group-count';
  const n = group.tabs.length;
  count.textContent = `(${n} ${n === 1 ? 'tab' : 'tabs'})`;
  header.appendChild(count);

  const recall = document.createElement('a');
  recall.className = 'recall';
  recall.href = '#';
  recall.textContent = 'Recall';
  recall.addEventListener('click', (e) => e.preventDefault()); // wired in Phase 5
  header.appendChild(recall);

  section.appendChild(header);

  const ul = document.createElement('ul');
  ul.className = 'group-tabs';
  for (const tab of group.tabs) {
    ul.appendChild(renderTab(tab));
  }
  section.appendChild(ul);

  return section;
}

function renderTab(tab) {
  const li = document.createElement('li');
  li.className = 'tab';

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || '(untitled)';
  li.appendChild(title);

  const url = document.createElement('div');
  url.className = 'tab-url';
  url.textContent = tab.url;
  li.appendChild(url);

  return li;
}
