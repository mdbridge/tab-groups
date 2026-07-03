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
    creating windows, reading/writing storage).

  * If `local-config.json` has not been generated yet, the global
    commands open a static `setup-required.html` extension page instead,
    as in the menu extension.


## Extension data

We have a list of tab groups.  Each tab group contains:

  * a creation time, and
  * an ordered list of tabs, each of which has a title and a URL.

The list is stored in `chrome.storage.local` (persistent, not synced).

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

Recall is best effort: if some URLs cannot be opened (e.g., a
`chrome://` page a new tab is not allowed to navigate to), those tabs
are skipped, but recall does not fail and the group is still removed.


## Tab groups list page

Most basically this is a linear list of tab groups, newest first.

For each tab group the page shows:

  * its creation time and the number of tabs it contains,
  * a link for recalling it, and
  * the list of its tabs (title and URL) beneath it.

There are no editable group names, and no per-group delete/discard link
in the MVP.  (A per-group discard is planned for the iteration after the
MVP.)

At the top there are links for exporting the list to a file and
importing the list from a file.

  * Export opens a native "save file" dialog so the user chooses where
    to write the file, then writes the current list there as text (see
    format below).  The dialog is pre-filled with a suggested name like
    `tab-groups-07-03-2026.txt`.

  * Import opens a native "open file" dialog for the user to choose a
    file, then replaces the entire current list with its contents.  If
    the current list is non-empty, the user is asked to confirm before
    it is replaced.

The save and open dialogs are provided by the File System Access API
(`showSaveFilePicker` and `showOpenFilePicker`), called directly from
the content script on the list page; this needs no extra permission and
keeps the file I/O in the normal page rather than the service worker.
If the API is unavailable, export falls back to a normal download of the
text (a blob URL and a synthesized `<a download>` click, needing no
extra permission) and import falls back to a plain `<input type="file">`
picker.

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
