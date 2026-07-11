// Shared pure time-formatting helpers.  Loaded by the background
// service worker (importScripts) and by the list page content script
// (as a preceding entry in the manifest's content_scripts js list), so
// only plain top-level function declarations -- no modules.

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Formats an epoch-ms time as local 24-hour "MM/DD/YYYY HH:MM:SS" (the
// export-file format).
function formatCreated(ms) {
  const d = new Date(ms);
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()} ` +
         `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

// Formats an epoch-ms time for display as local 12-hour
// "MM/DD/YYYY H:MM:SS AM/PM" (the list page format).
function formatDisplayTime(ms) {
  const d = new Date(ms);
  let h = d.getHours();
  const ampm = h < 12 ? 'AM' : 'PM';
  h = h % 12 || 12;
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()} ` +
         `${h}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())} ${ampm}`;
}
