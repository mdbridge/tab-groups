# Implementation plan for tab groups version 2

This plan implements spec_v2.md as five items, one feature per item,
one commit per item.  Items are ordered so that later ones build on
earlier ones (archive all's window-collection code is reused by export
including live; favicons, the largest item, come last).

The extension is now at version 1.1.17.


## Status (as of 2026-07-20): COMPLETE

All five items are DONE -- implemented, tested, reviewed, manually
verified by Mark, committed one per item, and pushed to origin/master.
The full suite is 59 passing, and manifest.json is at 1.1.17.

  * Item 1 (action button, 1.1.13, commit 4fe0934).
  * Item 2 (Discard, 1.1.14, commit b9df3cc).
  * Item 3 (Archive all, 1.1.15, commit 31d7299).
  * Item 4 (Export including live plus a Playwright timeout bump
    10s -> 30s, 1.1.16, commit 3521a70).
  * Item 5 (Favicons, 1.1.17, commit 33406ec).

Decisions made during implementation, all reflected in spec_v2.md
(kept in sync per workflow):

  * Item 3's confirmation became "Archive all N windows, saving M tabs
    in G groups?" with completion "Saved G groups containing M tabs.";
    item 4's spec intro was softened to "the same groups as if"
    (live-group ordering may differ from archive all's).

  * Item 5 diverged from this plan's draft below: icons ALWAYS come
    from Chrome's local _favicon cache (requested at 32px for HiDPI
    sharpness, displayed at 16px); the tab's own favIconUrl is never
    read or stored, even when it is already a data: URL, because it is
    page-controlled and unbounded.  captureIcons runs at the two
    archive sites (archiveWindow, archiveAll) but NOT on export
    including live, is batched (concurrency 16) with a 2s per-fetch
    timeout so an icon problem can never cost an archive, and the
    render wrapper/CSS are ported from ../menu_extension.  Chrome's
    _favicon serves a default globe even for unknown pages, so
    archive.test.js's two exact-tab assertions stub self.fetch to
    reject ONLY /_favicon/ reads (leaving getListPageUrl's
    local-config.json read working, preserving the skip-own-pages
    intent).  Render cost at ~10,000 tabs was consciously deferred by
    Mark to a possible later item.

  * Adversarial reviews: all findings through item 5 are resolved, or,
    for the two spec-open questions item 5's review raised (data:-icon
    capping, 10k render cost), decided by Mark.


## Per-item workflow

Every item follows the same steps, in order:

 1. **Red**: write the item's new Playwright tests first and run them
    to confirm they fail (and that the rest of the suite still
    passes).

 2. **Green**: implement the feature; run the full test suite until
    everything passes.

 3. **Version bump**: bump the extension version's rightmost component
    in manifest.json (1.1.12 -> 1.1.13 for the first item, and so on).

 4. **Adversarial review**: spin off a subagent and ask it for an
    adversarial code review of the change.  Take its report into
    account and make any needed changes (keeping tests green); repeat
    with a fresh review until things are in a good state.  If a
    finding cannot be confidently resolved, or raises a question the
    spec does not answer, pause and ask Mark instead of guessing.

 5. **Summarize and hand over**: summarize what was done and give Mark
    a list of suggested manual checks; wait for him to test.

 6. **Commit**: only after Mark approves, commit the item (including
    its version bump) and continue to the next item.


## Item 1: Toolbar action button that archives the window  (-> 1.1.13)

Spec section: "Add an extension activation button that archives that
window".

Changes:

  * Generate the icon: an archive-box-with-down-arrow glyph, legible
    at 16px, as icons/icon{16,32,48,128}.png.  Tooling: author it as a
    small SVG and render the PNGs with Playwright's bundled Chromium
    (screenshot at each size), so no new dependencies are needed.

  * manifest.json: add "icons" and an "action" entry with
    "default_icon" (no popup).

  * background.js: add a chrome.action.onClicked listener that runs
    the exact same code path as the archive-window command -- same
    setup-required fallback, same last-window behavior.

Tests (red first):

  * Clicking the action (triggered from the test via the service
    worker, since Playwright cannot click the real toolbar) archives
    the active window, matching the existing archive.test.js
    expectations.
  * The manifest declares the action and all four icon files exist.

Manual checks for Mark: pin the button; click it on a normal window;
click it on the last window; check the icon looks right at toolbar
size and on chrome://extensions.


## Item 2: Discard link on each tab group  (-> 1.1.14)

Spec section: "Discard function for tab groups".

Changes:

  * background.js: a 'discard' message that removes the group by id
    (removeGroup already exists) and returns the updated list.

  * content.js: a Discard link after Recall in each group header.  On
    click: confirm "Discard the group from <time> (N tabs)?"; on OK,
    send 'discard', re-render, status line "Discarded 1 group (N
    tabs)."; on cancel, do nothing.

Tests (red first):

  * Discard (confirm accepted) removes the group from the page and
    from storage; other groups are untouched.
  * Confirm canceled leaves list and storage unchanged.
  * Status line text after a discard.
  * The 'discard' message is refused for a non-list-page sender
    (matches existing messaging.test.js pattern).

Manual checks for Mark: discard a group by voice; cancel a discard;
discard the last group (empty-list rendering).


## Item 3: Archive all  (-> 1.1.15)

Spec section: "Archive all".

Changes:

  * background.js: two messages, following the import preview
    pattern:
      - 'archiveAllPreview': counts the normal windows and their
        recordable tabs (MVP skip rules) without changing anything,
        so the confirmation can show real numbers.
      - 'archiveAll': archives every normal window in enumeration
        order.  The sender's window is special-cased: its other tabs
        are archived into its group and closed, but the list-page tab
        and window survive.  Other windows are archived and closed
        whole.  Popup/DevTools/app windows are untouched.
  * content.js: an "Archive all" link on the toolbar next to Export
    and Import.  On click: fetch the preview, confirm "Archive all N
    windows, saving M tabs in G groups?", then send 'archiveAll' and
    show "Saved G groups containing M tabs.".  The page re-renders
    via the existing storage-change listener.

Tests (red first):

  * With several windows open, archive all creates one group per
    window with the right tabs in order, closes the other windows,
    and leaves the list-page window with only the list page.
  * A window with nothing recordable is closed without a group.
  * Confirm canceled changes nothing.
  * Confirmation text contains the correct window and tab counts.

Manual checks for Mark: archive all with 2-3 windows including one
with the list page plus extra tabs; check group order and the
surviving window.


## Item 4: Export including live  (-> 1.1.16)

Spec section: "Export including live".

Changes:

  * background.js: factor the collect-tabs-for-a-window logic (shared
    with archive all) into a helper that does not close anything.
    A new 'exportIncludingLive' message builds groups for all live
    normal windows (export-time timestamps, same skip rules, windows
    with nothing recordable contribute nothing), prepends them to the
    stored groups, serializes, and reuses the existing download path
    (offscreen blob, saveAs dialog, cancel detection).  Stored list
    and windows are not modified.
  * content.js: an "Export including live" link on the toolbar.
    Status on success: "Exported N groups (including M live)."; the
    cancel and failure reporting matches plain export.

Tests (red first):

  * The written file contains the live windows' groups first (export
    timestamp), then the stored groups, in the MVP text format.
  * The stored list and the live windows are unchanged afterwards.
  * Cancel and failure paths match the existing export tests.

Manual checks for Mark: export including live with a couple of live
windows; open the file; confirm live groups on top and nothing
changed in the browser; also try canceling the Save As dialog.


## Item 5: Favicons  (-> 1.1.17)

Spec section: "Adding favicons to tab groups list".

NOTE: the draft below was superseded during implementation -- icons
come only from the _favicon cache (at 32px), never from the tab's own
favIconUrl.  See the Status block above and spec_v2.md for what was
actually built; the steps here are kept as the original plan of record.

Changes:

  * manifest.json: add the "favicon" and "unlimitedStorage"
    permissions.

  * background.js, at archive time (all paths: single archive,
    archive all -- but not export including live, since exports never
    contain icons): for each recorded tab, capture its icon as a
    data: URL into an `icon` field next to `title` and `url`.  If
    tab.favIconUrl is already a data: URL, use it as-is; otherwise
    fetch chrome-extension://<id>/_favicon/?pageUrl=<url>&size=16
    from the worker (local favicon cache, no network) and convert the
    bytes to a data: URL.  Best-effort: any failure just leaves the
    tab without an icon.  No dedup, no separate table, no GC -- the
    icon lives and dies with its tab (see the spec for the benchmark
    that justified this).

  * lib/serialize.js: confirm exports simply omit the icon field and
    imports produce tabs without one (should already hold; lock it in
    with tests).

  * content.js + tab_groups_styles.css: render each tab with the menu
    extension's treatment -- a 24px wrapper div (white background;
    dark gray in dark mode) around a 16px <img>; wrapper turns
    transparent when there is no icon or the image fails to load.

Tests (red first):

  * Archiving a tab whose favIconUrl is a data: URL persists it in
    the group's `icon` field, and the list page renders the <img>
    with that src.
  * A tab with no icon renders the transparent-wrapper fallback.
  * Export of a group with icons produces a file without them;
    re-import yields tabs with no icon field.
  * The _favicon fetch path is best-effort and not driven end-to-end
    (the cache cannot be populated deterministically in a test).

Manual checks for Mark: archive real windows and eyeball the icons,
including a light-colored icon in dark mode; check offline rendering;
export and re-import to confirm icons are absent after import.


## Notes

  * Repository conventions apply throughout: ASCII, `--` for dashes,
    two spaces after sentence-ending periods, lines under 100
    characters, Windows command rules from CLAUDE.md.
  * Playwright rules from CLAUDE.md apply (close-listener-before-
    action, keyboard.down for closing keys).
  * If any item's review or implementation surfaces a question the
    spec does not answer, stop and ask Mark rather than deciding
    unilaterally.
