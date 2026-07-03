# Build plan for the tab groups MVP extension

This plan implements `spec_MVP.md` in small, independently testable
phases.  Each phase is meant to be finished, tested, and committed before
moving on, so that an interruption never leaves us far from a working
state.

Throughout, follow red/green: write a failing test first, then the code
that makes it pass.

Conventions and tooling come from `../menu_extension` (see its
`CLAUDE.md` for how to run `make`, `git`, `npm`, and Playwright on this
machine).


## Progress overview

  - [x] Phase 0 -- Prerequisites / one-time setup
  - [x] Phase 1 -- Skeleton extension: shortcut opens a static page
  - [ ] Phase 2 -- Persistent data model (storage layer)
  - [ ] Phase 3 -- Archive the current window
  - [ ] Phase 4 -- Display real tab groups on the list page
  - [ ] Phase 5 -- Recall a tab group
  - [ ] Phase 6 -- Export the list to a file
  - [ ] Phase 7 -- Import a list from a file
  - [ ] Phase 8 -- Polish: styling, README, edge cases


## Phase 0 -- Prerequisites / one-time setup

Goal: the repo can build and run an (empty) Playwright suite.

  - [x] Create `package.json` and `playwright.config.js` mirroring the
        menu extension.
  - [x] Create `.gitignore` (ignore `node_modules/`, `test-results/`,
        `local-config.json`, and `*~` temp files).
  - [x] Install dependencies: `npm install`.
  - [x] Install the Playwright Chromium browser (one-time):
        `npx playwright install chromium`.
  - [x] `npx playwright test` runs (zero tests is fine).

Done when: the test runner launches with no configuration errors.


## Phase 1 -- Skeleton extension: shortcut opens a static page

Goal: pressing the open-list shortcut opens the `file:///` list page,
which displays static placeholder text and has a content script running
on it.  This proves the key architecture end to end.

Files: `manifest.json`, `src/background.js`, `src/content.js`,
`src/tab_groups_list_page.html`, `src/tab_groups_styles.css`,
`setup.bat`, `setup-required.html`.

  - [x] `setup.bat` writes `local-config.json` with
        `LIST_PAGE_URL` -> `file:///.../src/tab_groups_list_page.html`
        (parallel to the menu extension's `MENU_PAGE_URL`).
  - [x] Run `setup.bat` so `local-config.json` exists locally.
  - [x] `manifest.json`: MV3, background service worker, a `commands`
        entry `open-list` bound to `Ctrl+Shift+L`, and a
        `content_scripts` match on `file:///*tab_groups_list_page.html*`.
  - [x] `background.js`: load `LIST_PAGE_URL` from `local-config.json`;
        on the `open-list` command open that URL in a new tab; if the
        config is missing, open `setup-required.html`.
  - [x] `tab_groups_list_page.html`: a root element with placeholder
        text (e.g., `Tab Groups`).
  - [x] `content.js`: find the root element and confirm it runs (e.g.,
        set a known marker in the page).
  - [x] Test fixtures (`tests/fixtures.js`) adapted from the menu
        extension: launch persistent context with the extension loaded,
        grab the service worker, helper to open the list page.
  - [x] RED/GREEN test: invoking the open-list command opens the list
        page and the content script marker is present.

Done when: the shortcut opens the page and the content script proves it
ran; the test passes.


## Phase 2 -- Persistent data model (storage layer)

Goal: a small, tested storage layer for the tab groups list in
`chrome.storage.local`.

  - [ ] Decide the storage key (e.g., `tabGroups`) and shape:
        `[{ created: <epoch ms>, tabs: [{ title, url }, ...] }, ...]`.
  - [ ] `background.js` helpers: `getGroups()`, `saveGroups(groups)`,
        `prependGroup(group)`, `removeGroup(created)` (or by index).
  - [ ] RED/GREEN test: write groups, read them back, confirm they
        survive a service-worker reload / new context (persistence).

Done when: groups round-trip through storage and persist; test passes.


## Phase 3 -- Archive the current window

Goal: the archive shortcut records the current window's tabs as a new
group and closes the window.

  - [ ] `manifest.json`: add `commands` entry `archive-window` bound to
        `Ctrl+Shift+E`; add any needed permissions (`tabs`, `windows`,
        `storage`).
  - [ ] `background.js`: on `archive-window`, collect the window's tabs
        in order (title + url), skipping this extension's own pages (the
        list page and setup page), prepend a new group, then close the
        window.
  - [ ] If it is the only browser window, open the list page in a new
        window first, then close the old one (so Chrome does not quit).
  - [ ] Do nothing if there are no tabs to record after skipping our
        own pages.
  - [ ] RED/GREEN test: open a window with known tabs, archive it,
        assert the window closed and a matching group was stored in
        order.
  - [ ] Test the last-window case opens the list page in a new window.

Done when: archiving stores the correct group and closes the window;
tests pass.


## Phase 4 -- Display real tab groups on the list page

Goal: the list page renders the stored groups.

  - [ ] `content.js` asks the background for the groups
        (`chrome.runtime.sendMessage`), newest first.
  - [ ] Render each group: creation time (formatted local
        `YYYY-MM-DD HH:MM:SS`), tab count, and the list of its tabs
        (title + url) beneath it.
  - [ ] Include a placeholder recall link per group (wired up in
        Phase 5) and placeholder Export/Import links at the top (wired
        up in Phases 6--7).
  - [ ] Escape closes the page.
  - [ ] RED/GREEN test: seed storage with groups, open the list page,
        assert the groups, counts, tabs, and order are shown; assert
        Escape closes the page.

Done when: the list page faithfully shows stored groups; tests pass.


## Phase 5 -- Recall a tab group

Goal: clicking a group's recall link reopens its window and removes the
group.

  - [ ] `background.js`: `recallGroup(created)` opens a new window with
        the group's tabs in order, focuses it, and removes the group
        from storage.
  - [ ] Best effort: skip URLs that fail to open; do not abort; still
        remove the group.
  - [ ] `content.js`: wire the recall link to send the recall message.
  - [ ] RED/GREEN test: seed a group, recall it, assert a new window
        with the tabs (in order) opened and the group was removed from
        storage.

Done when: recall recreates the window and removes the group; tests
pass.


## Phase 6 -- Export the list to a file

Goal: the Export link writes the list to a user-chosen file in the
human-editable text format.

  - [ ] Implement `serialize(groups) -> text` in the format from the
        spec (`Time created:` headers, `url<whitespace>title` lines,
        blank line between groups).
  - [ ] `content.js`: Export uses `showSaveFilePicker` with a suggested
        name like `tab-groups-2026-07-03.txt`, then writes the text.
  - [ ] Fallback when `showSaveFilePicker` is unavailable:
        `chrome.downloads.download` with `saveAs: true` via the service
        worker (add the `downloads` permission if used).
  - [ ] RED/GREEN test on the pure `serialize` function (the native save
        dialog itself is out of scope for automated tests -- note this
        in the test file).

Done when: `serialize` produces the specified format and is tested;
Export writes a file interactively.


## Phase 7 -- Import a list from a file

Goal: the Import link replaces the list from a user-chosen file.

  - [ ] Implement `parse(text) -> groups`, lenient per the spec (missing
        or unparseable `Time created:` -> import time; url is the first
        token, title is the remainder; blank lines separate groups).
  - [ ] `content.js`: Import uses `showOpenFilePicker` (fallback:
        `<input type="file">`), reads the file, and if the current list
        is non-empty asks the user to confirm before replacing it.
  - [ ] Replace the stored list with the parsed groups.
  - [ ] RED/GREEN test: `parse(serialize(groups))` round-trips; test
        lenient parsing of a hand-edited (bare-URL, odd-whitespace)
        sample.

Done when: `parse` round-trips with `serialize` and handles hand edits;
Import replaces the list with confirmation.


## Phase 8 -- Polish: styling, README, edge cases

Goal: make it pleasant and documented.

  - [ ] Style `tab_groups_styles.css` (light/dark, readable list),
        drawing on the menu extension's stylesheet.
  - [ ] `README.md`: what it is, install (Load unpacked + `setup.bat`),
        shortcuts, usage, dependencies, authorship/public-domain note.
  - [ ] Review edge cases: empty list message on the list page; groups
        with many tabs; very long titles/URLs.
  - [ ] Final full test run: `npx playwright test` all green.

Done when: the extension looks good, is documented, and the whole suite
passes.


## Notes

  - The native save/open dialogs (File System Access API) cannot be
    driven by Playwright, so automated tests cover the pure
    `serialize`/`parse` functions and the storage effects, not the OS
    dialog itself.
  - Keep source lines under 100 characters.
  - Put temporary files in the repo top directory ending in `~`.
