# Specification for tab groups MVP browser extension

## Overview

This is a Chrome manifest version 3 extension.  It allows the user to
"archive" a Chrome browser window's tabs for possible recall later.

That is, the user can archive a browser window, creating a tab group in
the extension that contains a list of all the tabs that were in that
browser window.  As part of this the browser window is closed.  Later
the user can go to a tab groups list page and click on one of the tab
groups to "unarchive" that window; this creates a new browser window
containing the tabs in the tab group and removes the tab group from the
extension's tab group list.  The ordering of the tabs is preserved.

A key feature here is that all the pages the extension uses to interact
with the user, except for a static setup page, are normal non-extension
pages that content scripts run on.  This allows other extensions to
interact with those pages as well.  In particular, accessibility
extensions like Click-by-Voice can run on the UI pages this extension
creates.

The list of tab groups is persistent so that browser restart or crashes
do not lose data.  The data is not synchronized across machines.  It is
possible to export and import the list as a file so the user can back up
the state.


## Architecture

Take the architecture and repository conventions from ../menu_extension;
it gives an example of how to achieve the key feature.

In particular:

  * The UI page ("tab groups list page") is a static HTML file served
    from a `file:///` URL.  The absolute path is machine specific and is
    written to `local-config.json` by `setup.bat`, exactly as in the
    menu extension.  A content script matches that `file:///` URL and
    does all of the UI work.

  * The content script communicates with the background service worker
    via `chrome.runtime.sendMessage`; the service worker performs all
    privileged operations (querying tabs/windows, closing windows,
    creating windows, reading/writing storage).  Every message gets a
    response: `{ ok: true, ... }` on success, `{ ok: false, error }` on
    refusal or failure.  The worker refuses messages whose sender is not
    the configured list page (or one of the extension's own pages).

  * If `local-config.json` has not been generated yet, the global
    commands open a static `setup-required.html` extension page instead,
    as in the menu extension.


## Extension data

We have a list of tab groups.  Each tab group contains:

  * a unique internal id, used to identify the group for recall/removal
    (creation times are not unique -- e.g., undated imported groups all
    share the import time -- so they cannot serve as the key); the id is
    not written to export files,
  * a creation time, and
  * an ordered list of tabs, each of which has a title and a URL.

The list is stored in `chrome.storage.local` (persistent, not synced).
Mutations of the stored list are read-modify-write, so the service
worker serializes them (a promise-chain lock); otherwise overlapping
operations -- e.g., two quick recalls, or an archive landing during a
recall -- could lose or resurrect groups.

Notes:

  * Favicons are intentionally not stored in the MVP.  They may be added
    in a future iteration; the design for that will be done then.

  * The creation time is stored as epoch milliseconds internally.  It is
    shown on the list page in local 12-hour form
    (`MM/DD/YYYY H:MM:SS AM/PM`) and written to export files in local
    24-hour form (`MM/DD/YYYY HH:MM:SS`).


## Global commands

There are global keyboard shortcuts to:

  * open the tab groups list page -- `Ctrl+Shift+L`
  * archive the current browser window -- `Ctrl+Shift+E`

(The menu extension already uses `Ctrl+Shift+Y` and `Ctrl+Shift+X`, so
those are avoided here.  `Ctrl+Shift+G` is avoided because it is a
reserved browser accelerator -- Chrome's Find Previous -- which Chrome
will not bind to an extension.  As with any Chrome command, the user can
rebind these on the browser's extension shortcuts page.)


## Archiving behavior

Archiving the current browser window:

  1. Collects every tab in that window, in order, recording each tab's
     title and URL.

  2. Skips only this extension's own UI pages -- i.e., the tab groups
     list page (`file:///...`) and, if present, the setup page.  All
     other tabs are recorded regardless of URL scheme (including, e.g.,
     `chrome://` pages); no assumption is made about whether a given URL
     can be reopened later.

  3. Prepends a new tab group (with the collected tabs and the current
     time) to the stored list, then closes the window.

  4. If the window being archived is the only browser window open, a new
     window showing the tab groups list page is opened first, before the
     old window is closed, so that Chrome does not quit.

If, after skipping this extension's own pages, there are no tabs to
record, no tab group is created -- but the window is still closed (and,
if it was the last one, the list page is opened in a new window),
for consistency.


## Recall behavior

Clicking a tab group's recall link:

  1. Opens a new browser window containing the group's tabs, in the
     stored order, and focuses it.

  2. Removes that tab group from the stored list.

The window is seeded with the first tab; the remaining tabs are added one
at a time as background tabs (`active: false`) -- never a single bulk
create of the whole list.  Background tabs that are never brought to the
foreground have their media suspended by the browser, so a group of,
e.g., video pages does not all start playing at once, while each tab
still loads its real title and icon.  This follows OneTab's approach.

Recall is best effort: if some URLs cannot be opened (e.g., a
`chrome://` page a new tab is not allowed to navigate to), those tabs
are skipped, but recall does not fail and the group is still removed.


## Tab groups list page

Most basically this is a linear list of tab groups, newest first.

For each tab group the page shows:

  * its creation time and the number of tabs it contains,
  * a link for recalling it, and
  * the list of its tabs beneath it, each showing the tab's title; the
    URL is not shown inline but appears as a tooltip when the mouse
    hovers over the title.

There are no editable group names, and no per-group delete/discard link
in the MVP.  (A per-group discard is planned for the iteration after the
MVP.)

At the top there are links for exporting the list to a file and
importing the list from a file.

  * Export opens a native "save file" dialog so the user chooses where
    to write the file, then writes the current list there as text (see
    format below).  The dialog is pre-filled with a suggested name like
    `tab-groups-07-03-2026.txt`.  The status line then reports
    "Exported N groups.", "Export canceled." (the dialog was dismissed),
    or the error if the download failed.  Both cancel signatures are
    recognized: Chrome fails the `download()` call itself, while Edge
    lets it succeed and ends the download interrupted with
    `USER_CANCELED`.

  * Import opens a native "open file" dialog for the user to choose a
    file, then replaces the entire current list with its contents,
    sorted newest-first (regardless of the file's order).  The file is
    parsed first, so the confirmation dialog shows real numbers -- e.g.,
    "Replace the current 12 tab groups with the imported 43 groups (317
    tabs)?" -- along with any parser warnings (see below).  Confirmation
    is asked whenever the current list is non-empty or there are
    warnings.  Importing a file with zero groups is allowed (it clears
    the list; restoring a backup is the primary use of import).  After a
    successful import the status line reports "Imported N groups (M
    tabs)." (warnings are not repeated there: whenever there are any,
    the confirmation already showed them and was approved).

Export is performed by the background service worker via
`chrome.downloads.download` with `saveAs: true`, which shows a native
"Save As" dialog reliably in both Chrome and Edge (this needs the
`downloads` permission).  Because a service worker cannot call
`URL.createObjectURL`, and packing the whole list into a `data:` URL
overflows Chrome's ~2 MB URL-length limit for large lists (a 10,000-tab
list is ~1.3x over), the file is handed to the download as a short
`blob:` URL built in an offscreen document (this needs the `offscreen`
permission).  The offscreen document -- whose lifetime is the blob's
lifetime -- is closed only once the download reaches a terminal state
(complete or interrupted) and no other export is still running, since
closing it earlier could revoke the blob while a large download is
still reading it.  Import uses a plain `<input type="file">` picker in the
content script.  The File System Access API (`showSaveFilePicker` /
`showOpenFilePicker`) is deliberately avoided: it is not dependable from
a content script and silently fails in Edge.

A status line under the toolbar reports errors -- e.g., a failed recall
or import, or the extension not answering because it was reloaded out
from under the page -- and the result of an import.  It is cleared when
a new action starts, so it always refers to the most recent action, and
is empty when there is nothing to report.

Typing Escape closes this page.


## Import / export file format

The file is plain, human-editable UTF-8 text -- deliberately not JSON so
the user can easily read and manipulate it by hand.  Titles may contain
non-ASCII characters, so the file is UTF-8 rather than strictly ASCII.

Layout: each tab group starts with a `Time created:` line, followed by
one line per tab, followed by a blank line.  Each tab line is the URL,
then whitespace, then an optional title (the title is the remainder of
the line).

Example with two tab groups:

```
Time created: 07/03/2026 16:15:23
https://github.com/me/repo	GitHub - me/repo
https://stackoverflow.com/q/12345	How do I parse this

Time created: 07/02/2026 09:30:00
https://mail.google.com/	Gmail
https://news.ycombinator.com/	Hacker News
```

Parsing rules (lenient, to survive hand editing):

  * A line beginning with `Time created:` starts a new group; the rest
    of the line is the timestamp.  If the timestamp is missing or cannot
    be parsed, the import time is used.

  * Each following non-blank line is one tab.  The URL is the first
    whitespace-delimited token; the title is the remainder of the line
    (trimmed), which may be empty.

  * One or more blank lines separate groups.  Leading and trailing
    whitespace on lines is ignored.

  * Tab lines with no preceding `Time created:` header (e.g., URLs pasted
    without one) form an implicit group at the import time, so they are
    not lost.

Parsing also produces warnings for input that is discarded or looks
wrong, shown in the import confirmation (which is always presented when
there are warnings).  Each warning cites the file line of the first
offender (e.g., "(line 7)", or "(first: line 7)" when there are
several), and is worded in the future tense since it is shown before
anything has been imported:

  * groups with no tabs are ignored (with a warning), and

  * tab lines whose URL has no scheme (e.g., a bare hostname, or a
    non-export file imported by mistake) are kept anyway -- they may
    simply fail to reopen on recall -- but draw a warning.

The imported list is stored newest-first.  Because every group with a
missing or unparseable timestamp takes the same import time, such groups
sort above the dated groups (as though just imported) while keeping their
relative order from the file.

Titles are informational only; on recall the browser fetches each page's
real title.  A hand-edited file may therefore list bare URLs with no
titles.


## Non-goals / future iterations

The following are explicitly out of scope for the MVP but noted for
later:

  * Editable group names -- not planned (the user does not want these).
  * Per-group discard/delete without recalling -- planned for the next
    iteration.
  * Storing and displaying favicons -- possible future iteration.


## Testing

There should be tests using Playwright (see the menu extension for
examples) covering at least the basic functionality: archiving a window,
recall creating a window with the tabs in order and removing the group,
persistence across reloads, and export/import round-tripping.

Use red/green: make sure new tests fail before you write the code that
makes them pass.
