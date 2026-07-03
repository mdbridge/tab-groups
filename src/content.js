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

// Date stamp for the default export filename: MM-DD-YYYY (year last;
// dashes, since filenames cannot contain slashes).
function todayStamp() {
  const d = new Date();
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`;
}

// Exports the list to a user-chosen file.  Primary path is the File
// System Access API, which shows a native save dialog; falls back to a
// normal download where that API is unavailable.
async function doExport() {
  const response = await chrome.runtime.sendMessage({ action: 'exportText' });
  const text = response?.text ?? '';
  const filename = `tab-groups-${todayStamp()}.txt`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled the dialog
      // Otherwise fall through to the download fallback.
    }
  }
  downloadTextFile(filename, text);
}

// Imports a list from a user-chosen file, replacing the current list.
// If the current list is non-empty, the user is asked to confirm first.
async function doImport() {
  let text;
  try {
    text = await pickFileText();
  } catch (e) {
    if (e.name === 'AbortError') return; // user cancelled the dialog
    return;
  }
  if (text == null) return;

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

// Reads a text file the user picks, via the File System Access API where
// available, otherwise a plain file input.
async function pickFileText() {
  if (window.showOpenFilePicker) {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Text file', accept: { 'text/plain': ['.txt'] } }],
    });
    const file = await handle.getFile();
    return file.text();
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt,text/plain';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      resolve(file ? file.text() : null);
    });
    input.click();
  });
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
