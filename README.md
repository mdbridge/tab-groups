# Tab Groups

A Chrome/Edge (Manifest V3) extension for archiving a browser window's
tabs so you can recall them later.  Archiving a window records all of its
tabs as a "tab group" and closes the window; recalling a group reopens
those tabs in a new window and removes the group from the list.

The tab groups list is a normal `file:///` page (not an extension page),
so other extensions -- in particular accessibility extensions like
Click-by-Voice -- can run on it too.


## How to use it

- Press **Ctrl+Shift+E** to archive the current window.  Its tabs are
  saved as a tab group and the window closes.  (If it was your only
  window, the tab groups list opens in a new window so the browser does
  not quit.)
- Press **Ctrl+Shift+L** to open the tab groups list.  Each group shows
  its creation time, tab count, and the tabs it contains.
- Click **Recall** on a group to reopen its tabs in a new window; the
  group is then removed from the list.
- Use **Export** / **Import** at the top of the list to save the list to
  a file or load it back (see below).
- Press **Esc** to close the list page.

The list is stored persistently, so it survives browser restarts and
crashes.  It is not synchronized across machines; use Export/Import to
back it up or move it.


## Keyboard commands

| Key | Action |
|-----|--------|
| Ctrl+Shift+E | Archive the current window |
| Ctrl+Shift+L | Open the tab groups list |
| Esc | Close the list page |

These are the suggested shortcuts.  You can change them on the browser's
extension shortcuts page (`chrome://extensions/shortcuts` or
`edge://extensions/shortcuts`).  Note that after reloading an unpacked
extension a shortcut can revert to "Not set" -- re-bind it there if a key
stops working.


## Export / import file format

The export file is plain, human-editable UTF-8 text (deliberately not
JSON).  Each group is a `Time created:` line followed by one line per
tab -- the URL, then optional whitespace and a title:

```
Time created: 07/03/2026 16:15:23
https://github.com/me/repo	GitHub - me/repo
https://news.ycombinator.com/	Hacker News

Time created: 07/02/2026 09:30:00
https://mail.google.com/	Gmail
```

A blank line separates groups.  Parsing is lenient so a hand-edited file
still imports: the title is optional, extra whitespace is ignored, and a
missing or unreadable timestamp is treated as the import time.  Importing
replaces the current list (with a confirmation prompt) and sorts it
newest-first.


## Installation

1. Clone or download this repository.
2. Run **`setup.bat`** once from the extension folder.  This generates
   `local-config.json` with the correct `file:///` path for the list
   page on your machine.
3. Open the extensions page in your browser:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the extension folder.
6. On Edge, you may need to set the keyboard shortcuts manually.

If you move the extension folder, run `setup.bat` again and reload the
extension.


## Development

[Node.js](https://nodejs.org) is required to run the tests.

Install dependencies:
```
npm install
```

Install the Playwright browser (one-time):
```
npx playwright install chromium
```

Run the test suite:
```
npx playwright test
```


## Authorship and licensing

This extension was vibe coded by Mark Lillibridge using the Claude Code
CLI; he places it in the public domain.
