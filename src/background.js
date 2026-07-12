// Shared pure helpers: time formatting and the import/export text
// format.  importScripts resolves relative to this worker's URL (src/).
importScripts('lib/format.js', 'lib/serialize.js');

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

// Mutations are read-modify-write (get the list, change it, set it), so
// overlapping ones -- e.g., two quick Recall clicks, or an archive
// landing during a recall -- could clobber each other's saves, losing
// or resurrecting groups.  This promise chain serializes them.  It is
// per-service-worker-instance, which suffices: a mutation runs entirely
// within one instance's lifetime.
let storageLock = Promise.resolve();

function withStorageLock(fn) {
  const run = storageLock.then(fn);
  storageLock = run.then(() => {}, () => {}); // keep the chain alive past failures
  return run;
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

function prependGroup(group) {
  return withStorageLock(async () => {
    const groups = await getGroups();
    groups.unshift(group);
    await saveGroups(groups);
    return groups;
  });
}

// Removes the group with the given id.  Returns { groups, removed };
// removed is false when no group had that id (e.g., it was already
// discarded from another list page).
function removeGroup(id) {
  return withStorageLock(async () => {
    const groups = await getGroups();
    const idx = groups.findIndex((g) => g.id === id);
    if (idx !== -1) {
      groups.splice(idx, 1);
      await saveGroups(groups);
    }
    return { groups, removed: idx !== -1 };
  });
}

// ---------------------------------------------------------------------
// Export / import.  The text format itself (serializeGroups /
// parseGroups) lives in lib/serialize.js.
// ---------------------------------------------------------------------

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
//
// The offscreen document (and thus the blob) is kept alive until the
// download reaches a terminal state -- closing it earlier could revoke
// the blob while a large download is still reading it -- and until no
// other export is still running.  Returns { status: 'exported',
// groupCount } or { status: 'canceled' }; failures throw.
let activeExports = 0;

async function exportDownload() {
  const groups = await getGroups();
  const text = serializeGroups(groups);
  activeExports++;
  try {
    const url = await createExportBlobUrl(text);
    let id;
    try {
      // With saveAs:true this settles only once the user has dismissed
      // the Save As dialog.
      id = await chrome.downloads.download({ url, filename: exportFilename(), saveAs: true });
    } catch (e) {
      // Chrome reports a canceled Save As dialog by failing the
      // download() call itself.
      if (/canceled/i.test(String(e?.message ?? e))) return { status: 'canceled' };
      throw e;
    }
    const state = await waitForDownloadCompletion(id);
    if (state !== 'complete') {
      // Edge reports a canceled Save As dialog differently: download()
      // succeeds and the download then ends interrupted with
      // USER_CANCELED.
      const [item] = await chrome.downloads.search({ id });
      if (item?.error === 'USER_CANCELED') return { status: 'canceled' };
      throw new Error(`the download was interrupted (${item?.error || 'unknown reason'})`);
    }
    return { status: 'exported', groupCount: groups.length };
  } finally {
    activeExports--;
    if (activeExports === 0) await closeOffscreenDocument();
  }
}

// Waits for the download to reach a terminal state; resolves to
// 'complete' or 'interrupted'.
function waitForDownloadCompletion(downloadId) {
  return new Promise((resolve) => {
    function settle(state) {
      if (state === 'complete' || state === 'interrupted') {
        chrome.downloads.onChanged.removeListener(onChanged);
        resolve(state);
      }
    }
    function onChanged(delta) {
      if (delta.id === downloadId) settle(delta.state?.current);
    }
    chrome.downloads.onChanged.addListener(onChanged);
    // The download may already have finished before the listener was
    // added; check once.  (Both paths may settle; the second is a no-op.)
    chrome.downloads.search({ id: downloadId }).then((results) => {
      settle(results[0]?.state);
    });
  });
}

// Builds a blob: URL for the export text inside an offscreen document
// (see offscreen.js).  Throws if the offscreen document cannot be used.
async function createExportBlobUrl(text) {
  await ensureOffscreenDocument();
  const res = await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'createBlobUrl',
    text,
  });
  if (!res?.url) throw new Error('could not build a blob: URL for the export');
  return res.url;
}

// Guarded by a cached creation promise: concurrent callers must not
// both call createDocument (Chrome allows only one offscreen document).
let offscreenCreation = null;

async function ensureOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (!offscreenCreation) {
    offscreenCreation = chrome.offscreen
      .createDocument({
        url: 'src/offscreen.html',
        reasons: ['BLOBS'],
        justification: 'Build a blob: URL so large exports are not capped by data: URL length.',
      })
      .finally(() => {
        offscreenCreation = null;
      });
  }
  await offscreenCreation;
}

async function closeOffscreenDocument() {
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch {
    // Best effort: a lingering offscreen document only wastes a little memory.
  }
}

// Parses import text and replaces the stored list, sorted newest-first
// (the same order archiving maintains), regardless of the file's order.
// Returns { groups, warnings } (see parseGroups).
async function importGroups(text) {
  const { groups, warnings } = parseGroups(text);
  groups.sort((a, b) => b.created - a.created);
  // The replace is not itself read-modify-write, but taking the lock
  // orders it against any in-flight mutation's save.
  await withStorageLock(() => saveGroups(groups));
  return { groups, warnings };
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

chrome.commands.onCommand.addListener(handleCommand);

// Handles a global keyboard command.  Failures -- e.g., the active
// window closing between the keypress and the handler running -- are
// logged rather than left as unhandled rejections; a command has no UI
// surface to report to.
async function handleCommand(command, tab) {
  try {
    // Nothing works until setup.bat has generated local-config.json, so
    // open the setup page instead of doing part of a command -- e.g.,
    // archiving and closing a window with nowhere to show the result,
    // or (if it was the last window) quitting the browser.
    const listPageUrl = await getListPageUrl();
    if (!listPageUrl) {
      await chrome.tabs.create({ url: chrome.runtime.getURL('setup-required.html') });
      return;
    }
    if (command === 'open-list') await openList();
    // tab is the active tab when the shortcut fired; its window is the
    // one to archive.  getLastFocused (the fallback) can pick the wrong
    // window when several are open.
    if (command === 'archive-window') await archiveWindow(tab?.windowId);
  } catch (e) {
    console.error(`command "${command}" failed:`, e);
  }
}

chrome.action.onClicked.addListener(handleActionClick);

// Clicking the toolbar (action) button archives the window it was
// clicked in.  Exactly the archive-window command's code path,
// including the setup-required fallback and the open-the-list-page
// behavior when it is the last window.  tab is the active tab of the
// clicked window, the same shape onCommand supplies.
function handleActionClick(tab) {
  return handleCommand('archive-window', tab);
}

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
// extension pages) and dispatches it.  The content script matches the
// list-page file name in any directory, so a stray or malicious local
// file with that exact name would still get our content script
// injected; this guard stops such a page from reading or replacing the
// user's tab groups.  Returns a response object: { ok: true, ... } on
// success, { ok: false, error } on refusal.
async function routeMessage(message, sender) {
  const listPageUrl = await getListPageUrl();
  if (!isOwnUrl(sender.url, listPageUrl)) {
    return { ok: false, error: 'sender is not the tab groups list page' };
  }

  if (message.action === 'getGroups') {
    return { ok: true, groups: await getGroups() };
  }
  if (message.action === 'export') {
    return { ok: true, ...(await exportDownload()) };
  }
  if (message.action === 'parseText') {
    // Parse-only preview, so the list page can confirm an import with
    // real numbers (and any warnings) before anything is replaced.
    const { groups, warnings } = parseGroups(message.text);
    const tabCount = groups.reduce((n, g) => n + g.tabs.length, 0);
    return { ok: true, groupCount: groups.length, tabCount, warnings };
  }
  if (message.action === 'importText') {
    const { groups, warnings } = await importGroups(message.text);
    return { ok: true, groups, warnings };
  }
  if (message.action === 'recall') {
    await recallGroup(message.id);
    return { ok: true, groups: await getGroups() };
  }
  if (message.action === 'discard') {
    // Removes the group without opening its tabs.  Permanent: unlike
    // recall, nothing of the group survives.  removed tells the page
    // whether anything was actually discarded, so it does not report a
    // discard that had already happened elsewhere.
    const { groups, removed } = await removeGroup(message.id);
    return { ok: true, groups, removed };
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
  // A tab whose navigation has not yet committed has an empty url and
  // the real target in pendingUrl.  A tab with neither (rare) is
  // skipped: a blank URL could not be reopened anyway.
  const tabs = (win.tabs || [])
    .map((t) => ({ title: t.title, url: t.url || t.pendingUrl || '' }))
    .filter((t) => t.url && !isOwnUrl(t.url, listPageUrl));

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
