// ---------------------------------------------------------------------
// Persistent storage of the tab groups list.
//
// A group is { created: <epoch ms>, tabs: [{ title, url }, ...] }.  The
// list is stored newest-first in chrome.storage.local (persistent, not
// synced across machines).
// ---------------------------------------------------------------------
const STORAGE_KEY = 'tabGroups';

async function getGroups() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || [];
}

async function saveGroups(groups) {
  // Every group needs a stable unique id: creation times are not unique
  // (e.g., undated imported groups all share the import time), so they
  // cannot identify a group for recall/remove.
  for (const g of groups) {
    if (!g.id) g.id = crypto.randomUUID();
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: groups });
}

async function prependGroup(group) {
  const groups = await getGroups();
  groups.unshift(group);
  await saveGroups(groups);
  return groups;
}

// Removes the group with the given id.
async function removeGroup(id) {
  const groups = await getGroups();
  const idx = groups.findIndex((g) => g.id === id);
  if (idx !== -1) {
    groups.splice(idx, 1);
    await saveGroups(groups);
  }
  return groups;
}

// ---------------------------------------------------------------------
// Import / export text format.
//
// Each group is a "Time created:" line followed by one line per tab
// (URL, a tab, then an optional title), with a blank line between
// groups.  See spec_MVP.md.
// ---------------------------------------------------------------------
function pad2(n) {
  return String(n).padStart(2, '0');
}

// Formats an epoch-ms time as local "MM/DD/YYYY HH:MM:SS".
function formatCreated(ms) {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Default export filename: tab-groups-MM-DD-YYYY.txt (year last; dashes,
// since filenames cannot contain slashes).
function exportFilename() {
  const d = new Date();
  return `tab-groups-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${d.getFullYear()}.txt`;
}

// Downloads the serialized list.  saveAs shows a native "Save As" dialog
// in both Chrome and Edge.  The list is downloaded from a blob: URL built
// in an offscreen document rather than a data: URL: a service worker
// cannot call URL.createObjectURL, and a data: URL of the whole list
// overflows Chrome's ~2 MB URL-length limit for large lists.
async function exportDownload() {
  const text = serializeGroups(await getGroups());
  const url = await createExportBlobUrl(text);
  if (!url) return; // offscreen document unavailable; nothing to download
  try {
    // With saveAs:true this resolves only once the user has dismissed the
    // Save As dialog and the download has begun reading the blob, so it is
    // safe to free the blob (closeOffscreenDocument) afterwards.
    await chrome.downloads.download({ url, filename: exportFilename(), saveAs: true });
  } catch {
    // The user canceled the Save As dialog, or the download failed.
  } finally {
    await closeOffscreenDocument();
  }
}

// Builds a blob: URL for the export text inside an offscreen document (see
// offscreen.js).  Returns null if the offscreen document cannot be used.
async function createExportBlobUrl(text) {
  await ensureOffscreenDocument();
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'createBlobUrl',
    text,
  });
  return res?.url || null;
}

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'src/offscreen.html',
    reasons: ['BLOBS'],
    justification: 'Build a blob: URL so large exports are not capped by data: URL length.',
  });
}

async function closeOffscreenDocument() {
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch {
    // Best effort: a lingering offscreen document only wastes a little memory.
  }
}

function serializeGroups(groups) {
  if (groups.length === 0) return '';
  const blocks = groups.map((group) => {
    const lines = [`Time created: ${formatCreated(group.created)}`];
    for (const tab of group.tabs) {
      lines.push(tab.title ? `${tab.url}\t${tab.title}` : tab.url);
    }
    return lines.join('\n');
  });
  return blocks.join('\n\n') + '\n';
}

// Parses the export text format back into groups.  Lenient, so a
// hand-edited file survives: a "Time created:" line starts a group; each
// following non-blank line is a tab (URL = first whitespace-delimited
// token, title = the rest); a blank line ends a group; an unparseable or
// missing timestamp falls back to the import time.  Groups with no tabs
// are dropped.
function parseGroups(text) {
  const importTime = Date.now();
  const groups = [];
  let current = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();

    const header = line.match(/^Time created:(.*)$/);
    if (header) {
      const ms = Date.parse(header[1].trim());
      current = { created: Number.isNaN(ms) ? importTime : ms, tabs: [] };
      groups.push(current);
      continue;
    }

    if (line === '') {
      current = null; // a blank line ends the current group's tab list
      continue;
    }

    // A tab line with no preceding "Time created:" header starts an
    // implicit group at the import time, so pasted URLs are not lost.
    if (current === null) {
      current = { created: importTime, tabs: [] };
      groups.push(current);
    }
    const ws = line.search(/\s/);
    const url = ws === -1 ? line : line.slice(0, ws);
    const title = ws === -1 ? '' : line.slice(ws).trim();
    current.tabs.push({ title, url });
  }

  return groups.filter((g) => g.tabs.length > 0);
}

// Parses import text and replaces the stored list, sorted newest-first
// (the same order archiving maintains), regardless of the file's order.
async function importGroups(text) {
  const groups = parseGroups(text).sort((a, b) => b.created - a.created);
  await saveGroups(groups);
  return groups;
}

// The list page path is machine-specific and stored in local-config.json,
// generated by setup.bat.  It is read fresh on each invocation so that
// running setup.bat takes effect without reloading the extension.
async function getListPageUrl() {
  try {
    const r = await fetch(chrome.runtime.getURL('local-config.json'));
    if (!r.ok) return null;
    const cfg = await r.json();
    return cfg.LIST_PAGE_URL || null;
  } catch {
    return null;
  }
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  // Nothing works until setup.bat has generated local-config.json, so open
  // the setup page instead of doing part of a command -- e.g., archiving
  // and closing a window with nowhere to show the result, or (if it was
  // the last window) quitting the browser.
  const listPageUrl = await getListPageUrl();
  if (!listPageUrl) {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup-required.html') });
    return;
  }
  if (command === 'open-list') openList();
  // tab is the active tab when the shortcut fired; its window is the one
  // to archive.  getLastFocused (the fallback) can pick the wrong window
  // when several are open.
  if (command === 'archive-window') archiveWindow(tab?.windowId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Responses are always async (the sender is validated via a storage
  // read), so keep the port open and reply once routeMessage settles.
  // Every message gets a response -- { ok: true, ... } on success,
  // { ok: false, error } on refusal or failure -- so a sender never
  // hangs waiting on a silently-dropped port.
  routeMessage(message, sender)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: String(e?.message ?? e) }));
  return true;
});

// Verifies the message came from our own list page (or one of our own
// extension pages) and dispatches it.  The content script matches any
// file:// path ending in the list-page name, so a stray or malicious
// local file with a matching name would get our content script injected;
// this guard stops such a page from reading or replacing the user's tab
// groups.  Returns a response object: { ok: true, ... } on success,
// { ok: false, error } on refusal.
async function routeMessage(message, sender) {
  const listPageUrl = await getListPageUrl();
  if (!isOwnUrl(sender.url, listPageUrl)) {
    return { ok: false, error: 'sender is not the tab groups list page' };
  }

  if (message.action === 'getGroups') {
    return { ok: true, groups: await getGroups() };
  }
  if (message.action === 'export') {
    await exportDownload();
    return { ok: true };
  }
  if (message.action === 'importText') {
    return { ok: true, groups: await importGroups(message.text) };
  }
  if (message.action === 'recall') {
    await recallGroup(message.id);
    return { ok: true, groups: await getGroups() };
  }
  if (message.action === 'closeList') {
    // The tab may already be closing; that is fine.
    if (sender.tab?.id != null) await chrome.tabs.remove(sender.tab.id).catch(() => {});
    return { ok: true };
  }
  return { ok: false, error: `unknown action: ${message.action}` };
}

// Recalls a group: opens a new focused window containing its tabs, in
// order, and removes the group from storage.  Following OneTab, the
// window is seeded with the first tab that opens (active), and the rest
// are added one at a time as background tabs (active: false) -- never a
// bulk windows.create of the whole array.  Background tabs load but
// Chrome suspends their media, so a group of video pages does not all
// start playing, while each tab still gets its real title and icon.
// Best effort -- URLs that cannot be opened are skipped.
async function recallGroup(id) {
  const groups = await getGroups();
  const group = groups.find((g) => g.id === id);
  if (!group) return;

  const urls = group.tabs.map((t) => t.url);

  // Seed the window with the first URL that opens, so there is no
  // leftover new-tab page.
  let win = null;
  let next = 0;
  for (let i = 0; i < urls.length; i++) {
    try {
      win = await chrome.windows.create({ url: urls[i], focused: true });
      next = i + 1;
      break;
    } catch {
      // Skip URLs that cannot be opened.
    }
  }

  // Add the rest as background tabs.
  for (let i = next; win && i < urls.length; i++) {
    try {
      await chrome.tabs.create({ windowId: win.id, url: urls[i], active: false });
    } catch {
      // Skip URLs that cannot be opened.
    }
  }

  await removeGroup(id);
}

async function openList() {
  const listPageUrl = await getListPageUrl();
  if (!listPageUrl) {
    chrome.tabs.create({ url: chrome.runtime.getURL('setup-required.html') });
    return;
  }
  chrome.tabs.create({ url: listPageUrl });
}

// True for pages this extension itself owns -- its list page and any of
// its chrome-extension:// pages (e.g., setup-required.html) -- which
// should never be archived.
function isOwnUrl(url, listPageUrl) {
  if (!url) return false;
  if (url.startsWith(chrome.runtime.getURL(''))) return true;
  if (listPageUrl) {
    const base = url.split('#')[0].split('?')[0];
    if (base === listPageUrl) return true;
  }
  return false;
}

// Archives a window: records its tabs (in order, skipping this
// extension's own pages) as a new group, then closes the window.  If it
// is the only browser window, the list page is opened in a new window
// first so that Chrome does not quit.  windowId should be the window the
// user is in; it falls back to the last-focused window when omitted.
async function archiveWindow(windowId) {
  const win = windowId == null
    ? await chrome.windows.getLastFocused({ populate: true })
    : await chrome.windows.get(windowId, { populate: true });

  const listPageUrl = await getListPageUrl();
  const tabs = (win.tabs || [])
    .filter((t) => !isOwnUrl(t.url, listPageUrl))
    .map((t) => ({ title: t.title, url: t.url }));

  // A window of only our own pages has nothing to record, but is still
  // closed below for consistency.
  if (tabs.length > 0) {
    await prependGroup({ created: Date.now(), tabs });
  }

  const normalWindows = (await chrome.windows.getAll()).filter((w) => w.type === 'normal');
  if (normalWindows.length <= 1 && listPageUrl) {
    await chrome.windows.create({ url: listPageUrl });
  }

  await chrome.windows.remove(win.id);
}
