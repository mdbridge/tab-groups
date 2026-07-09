// Offscreen document script.  This is the one context in this MV3
// extension with a DOM, so it can call URL.createObjectURL -- which a
// service worker cannot.  It turns export text into a blob: URL that the
// service worker hands to chrome.downloads.download, avoiding the ~2 MB
// URL-length limit that a data: URL of the whole list would hit.
//
// The blob (and thus the URL) lives as long as this document does; the
// service worker frees it by closing the offscreen document after the
// download has started.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'offscreen') return; // not addressed to us
  if (message.type === 'createBlobUrl') {
    const blob = new Blob([message.text], { type: 'text/plain;charset=utf-8' });
    sendResponse({ url: URL.createObjectURL(blob) });
  }
});
