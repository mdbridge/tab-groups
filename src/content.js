// Content script for the tab groups list page.  It runs on the
// file:/// list page so that other extensions (e.g., Click-by-Voice)
// can also operate on it.  lib/format.js is loaded before this file
// (see the manifest) and provides formatDisplayTime.
const root = document.getElementById('__tab_groups_root__');

// The status line under the toolbar; recreated by each render().
let statusEl = null;

if (root) {
  // Marks that the content script has run on this page.
  root.setAttribute('data-content-script', 'ready');

  // Escape closes the list page.  The background service worker removes
  // the tab, since a normal page cannot close its own tab.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      // If this succeeds the page is gone; if not there is no one to tell.
      sendToBackground({ action: 'closeList' }).catch(() => {});
    }
  });

  sendToBackground({ action: 'getGroups' })
    .then((response) => render(response.groups))
    .catch((e) => {
      render(null);
      showError(`Cannot load tab groups: ${e.message}`);
    });

  // Re-render when the stored list changes (e.g., a window is archived
  // while this page is open, or another list page made a change).  The
  // change payload itself is never rendered: this content script also
  // runs on unauthorized copies of the list page (the match pattern is
  // name-based), and anything rendered into a page's DOM is readable by
  // that page's own scripts.  Re-fetching through the validated
  // getGroups message keeps such pages empty-handed.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('tabGroups' in changes)) return;
    sendToBackground({ action: 'getGroups' })
      .then((response) => render(response.groups))
      .catch(() => {
        // Unauthorized or orphaned page: leave it as it is.
      });
  });
}

// Sends a message to the background service worker and returns its
// response.  Rejects if the extension did not answer (e.g., it was
// reloaded and this page is orphaned) or refused ({ ok: false }, e.g.,
// this page is not the configured list page).
function sendToBackground(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (!response || response.ok !== true) {
        reject(new Error(response?.error || 'no response from the extension'));
      } else {
        resolve(response);
      }
    });
  });
}

// The status message is kept as state (not just in the DOM) so that it
// survives re-renders -- e.g., the storage-change re-render arriving
// just after an import shows "Imported ...".
let statusText = '';
let statusIsError = false;

function applyStatus() {
  if (!statusEl) return;
  statusEl.textContent = statusText;
  statusEl.classList.toggle('error', statusIsError);
}

// Shows an informational message in the status line.
function showStatus(text) {
  statusText = text;
  statusIsError = false;
  applyStatus();
}

// Shows an error message in the status line.
function showError(text) {
  statusText = text;
  statusIsError = true;
  applyStatus();
}

// Clears the status line.  Called when a new action starts, so that a
// shown message always refers to the most recent action.
function clearStatus() {
  statusText = '';
  statusIsError = false;
  applyStatus();
}

// Renders the page: header, toolbar, status line, and the group list.
// Pass null to render only the frame with no list (e.g., when the
// groups could not be loaded); the caller then reports why via
// showError.
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

  statusEl = document.createElement('div');
  statusEl.className = 'status';
  root.appendChild(statusEl);
  applyStatus();

  if (groups === null) return;

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
  section.dataset.id = group.id;

  const header = document.createElement('div');
  header.className = 'group-header';

  const time = document.createElement('span');
  time.className = 'group-time';
  time.textContent = formatDisplayTime(group.created);
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
    clearStatus();
    sendToBackground({ action: 'recall', id: group.id })
      .then((response) => render(response.groups))
      .catch((err) => showError(`Recall failed: ${err.message}`));
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
  clearStatus();
  sendToBackground({ action: 'export' })
    .then((response) => {
      if (response.status === 'exported') {
        showStatus(`Exported ${response.groupCount} group${plural(response.groupCount)}.`);
      } else {
        showStatus('Export canceled.');
      }
    })
    .catch((e) => showError(`Export failed: ${e.message}`));
}

// Imports a list from a user-chosen file, replacing the current list.
// The file is parsed first so the confirmation can show real numbers
// and any parser warnings; confirmation is asked whenever the current
// list is non-empty or there are warnings.  An import of zero groups
// is allowed (it clears the list).
async function doImport() {
  clearStatus();
  const text = await pickFileText();
  if (text == null) return; // no file chosen

  try {
    const parsed = await sendToBackground({ action: 'parseText', text });
    const existing = await sendToBackground({ action: 'getGroups' });
    const count = existing.groups.length;

    const what = `${parsed.groupCount} group${plural(parsed.groupCount)} ` +
                 `(${parsed.tabCount} tab${plural(parsed.tabCount)})`;
    let question = count > 0
      ? `Replace the current ${count} tab group${plural(count)} with the imported ${what}?`
      : `Import ${what}?`;
    for (const warning of parsed.warnings) {
      question += `\n\nWarning: ${warning}.`;
    }
    if ((count > 0 || parsed.warnings.length > 0) && !window.confirm(question)) {
      return;
    }

    // Warnings are not repeated here: whenever there are any, the
    // confirmation above already showed them and was approved.
    const response = await sendToBackground({ action: 'importText', text });
    render(response.groups);
    showStatus(`Imported ${what}.`);
  } catch (e) {
    showError(`Import failed: ${e.message}`);
  }
}

function plural(n) {
  return n === 1 ? '' : 's';
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
