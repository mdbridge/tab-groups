# Specification for tab groups browser extension version 2

This specification extends that of spec_MVP.md, adding features.  The
list of features follows:


## Archive all

Add a link on the tab groups page next to export and import for "archive
all".

Activating this link archives all the browser windows as if the user had
manually archived each window.  This would normally result in no windows
open but a window is left at the end containing just the tab groups
list.

Details:

  * Scope: all *normal* browser windows in the current profile.  Popup
    windows, DevTools windows, and installed-app (PWA) windows are left
    alone.

  * Each window becomes its own tab group, following exactly the MVP
    archiving rules: the extension's own pages are skipped, a tab whose
    navigation has not committed is recorded by its `pendingUrl`, and a
    window with nothing recordable is closed without creating a group.

  * A confirmation dialog is shown first, with real counts gathered
    before anything closes: "Archive all N windows (M tabs)?"

  * Windows are archived one at a time in Chrome's enumeration order;
    the resulting groups stack at the top of the list like any other
    archives.

  * The window containing the list page the user activated the link
    from survives: the other tabs in that window are archived into its
    group and closed, but the list-page tab and its window stay open,
    so the page simply updates in place with no flicker.  All other
    windows are archived and closed as usual.


## Export including live

Add a link on the tab groups page next to export and import for "export
including live".

Activating this link is like export but also includes tab groups for
live windows that have not been archived.

That is, the file produced by this link has contents as if you had
called archive all then export but no archiving actually occurs: the
live windows are unchanged and the extension's tab groups list is also
unchanged.

This is intended to make backup easier: instead of the user having to do
archive all, export, then manually recall the tab groups they still want
to use, the user can simply just do export including live.

Details:

  * The live windows appear as one group per window at the top of the
    file, timestamped with the export time, using the same window scope
    and tab-skipping rules as archive all.  A live window with nothing
    recordable contributes no group.

  * Favicons are not included (exports never include them; see below).

  * The default filename is the same as for a plain export.

  * On success the status line reports "Exported N groups (including M
    live)."; the cancel and failure reporting matches plain export.


## Discard function for tab groups

Add a link next to the Recall link on each tab group called Discard;
when clicked, this removes that tab group from the tab group list.

The tab group list, both the displayed version and the persistent
version, are updated accordingly.

Details:

  * Discard is irreversible, so a confirmation dialog is shown first:
    "Discard the group from <time> (N tabs)?"

  * After a discard the status line shows "Discarded 1 group (N
    tabs)." and the list re-renders.


## Adding favicons to tab groups list

When tabs are archived, their favicons, if any, are also captured and
persisted.  They are shown next to the tabs in the tab group list in a
manner similar to how menu extension does it -- note that there is some
tricky UI handling to get the background of the icons correct.

Favicons are not included when an export is done or retrieved when import
is done.  (Import results in tabs without accompanying icons.)

Capture:

  * Capture happens in the background service worker at archive time,
    with no network fetches: if `tab.favIconUrl` is already a `data:`
    URL it is stored as-is; otherwise the worker reads Chrome's local
    favicon cache via the `_favicon` API (this needs the `favicon`
    permission) at 16px.  Tabs with no icon available simply get none.

  * Only the worker touches `_favicon`; the file:/// list page needs no
    new privileges.

Storage:

  * Each archived tab simply carries its own icon as a `data:` URL in
    an `icon` field next to `title` and `url`.  There is no separate
    icon table, no deduplication, and no garbage collection: an icon
    lives and dies with its tab, so recall, discard, and import need
    no icon-specific code and no cross-references can dangle.

  * Deduplication was considered and rejected: benchmarking a
    synthetic 10,000-tab list showed the whole-list payload grows from
    ~1.5 MB to ~15 MB inline, but serializing even the 15 MB list
    takes ~11 ms (structured clone ~14 ms) -- imperceptible next to
    rendering 10,000 DOM rows -- so deduplication's only real benefit
    would be disk space that does not matter.

  * Space check for 10,000 tabs: a typical 16x16 favicon is ~0.5-2 KB,
    ~1.4x that as a base64 `data:` URL, so ~15 MB worst case -- over
    chrome.storage.local's 10 MB quota.  The extension therefore takes
    the `unlimitedStorage` permission, which removes the quota (local
    storage is then limited only by disk space) and adds no install
    warning.

Display:

  * The list page copies the menu extension's treatment: a 24px wrapper
    with a white background (dark gray in dark mode) behind the 16px
    icon, so light-on-transparent icons stay visible in both themes.
    The wrapper turns transparent when there is no icon or the image
    fails to load.


## Add an extension activation button that archives that window

Clicking the extension's toolbar (action) button archives the window
the button was clicked in, running the exact same code path as the
`Ctrl+Shift+E` command -- including opening the setup page instead if
`local-config.json` has not been generated, and opening the list page
in a new window first when archiving the last window.  There is no
popup.

Icon: a simple archive-box-with-down-arrow glyph, legible at 16px,
generated as PNGs at 16/32/48/128.  The same images serve as the action
icon and as the manifest `icons` (the extension currently has neither).


## Testing

As with the MVP, each feature gets Playwright tests, written red/green
(new tests must fail before the code that makes them pass is written).

One caveat: the `_favicon` cache is hard to populate deterministically
in a test, so favicon tests exercise the `data:`-URL capture path, the
persistence of the per-tab `icon` field, and the rendering; the
`_favicon` fetch itself is treated as best-effort.
