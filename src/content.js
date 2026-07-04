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

// Formats an epoch-ms time for display as local 12-hour
// "MM/DD/YYYY H:MM:SS AM/PM".
function formatTime(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()} ` +
         `${h}:${pad(d.getMinutes())}:${pad(d.getSeconds())} ${ampm}`;
}

function render(groups) {
  root.innerHTML = '';

  const h1 = document.createElement('h1');
  h1.textContent = 'Tab Groups';
  root.appendChild(h1);

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';

  const exportLink = makeToolbarLink('export-link', 'Export');
  exportLink.addEventListener('click', doExport);
  toolbar.appendChild(exportLink);

  const importLink = makeToolbarLink('import-link', 'Import');
  importLink.addEventListener('click', doImport);
  toolbar.appendChild(importLink);

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
  recall.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.sendMessage({ action: 'recall', created: group.created }, (response) => {
      render(response?.groups || []);
    });
  });
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

// Exports the list.  The background service worker runs the download
// with a "Save As" dialog (chrome.downloads), which works reliably in
// both Chrome and Edge -- the File System Access API is not dependable
// from a content script (e.g., it silently fails in Edge).
function doExport() {
  chrome.runtime.sendMessage({ action: 'export' });
}

// Imports a list from a user-chosen file, replacing the current list.
// If the current list is non-empty, the user is asked to confirm first.
async function doImport() {
  const text = await pickFileText();
  if (text == null) return; // no file chosen

  const existing = await chrome.runtime.sendMessage({ action: 'getGroups' });
  const count = existing?.groups?.length ?? 0;
  if (count > 0) {
    const s = count === 1 ? '' : 's';
    if (!window.confirm(`Replace the current ${count} tab group${s} with the imported file?`)) {
      return;
    }
  }

  const response = await chrome.runtime.sendMessage({ action: 'importText', text });
  render(response?.groups || []);
}

// Reads a text file the user picks, using a plain file input (works in
// all browsers, unlike the File System Access API from a content script).
function pickFileText() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      resolve(file ? file.text() : null);
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

function renderTab(tab) {
  const li = document.createElement('li');
  li.className = 'tab';

  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || '(untitled)';
  title.title = tab.url; // full URL shown as a tooltip on hover
  li.appendChild(title);

  return li;
}
