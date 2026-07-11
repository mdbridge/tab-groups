// Import / export text format (pure; no Chrome APIs).  Loaded by the
// background service worker via importScripts, after format.js (it
// uses formatCreated).
//
// Each group is a "Time created:" line followed by one line per tab
// (URL, a tab, then an optional title), with a blank line between
// groups.  See spec_MVP.md.

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
//
// Returns { groups, warnings }.  The warnings (strings, possibly none)
// describe input that is discarded (empty groups) or looks wrong but is
// kept (tab lines whose URL has no scheme, e.g., a pasted bare hostname
// or a non-export file imported by mistake).  Each cites the 1-based
// file line of the first offender.  The wording is future tense
// because warnings are shown in the confirmation dialog, before
// anything has been imported.
function parseGroups(text) {
  const importTime = Date.now();
  const groups = [];
  const groupStartLines = []; // parallel to groups: 1-based first line
  let current = null;
  let schemelessTabs = 0;
  let firstSchemelessLine = 0;
  let lineNo = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    lineNo++;
    const line = rawLine.trim();

    const header = line.match(/^Time created:(.*)$/);
    if (header) {
      const ms = Date.parse(header[1].trim());
      current = { created: Number.isNaN(ms) ? importTime : ms, tabs: [] };
      groups.push(current);
      groupStartLines.push(lineNo);
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
      groupStartLines.push(lineNo);
    }
    const ws = line.search(/\s/);
    const url = ws === -1 ? line : line.slice(0, ws);
    const title = ws === -1 ? '' : line.slice(ws).trim();
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) {
      schemelessTabs++;
      if (firstSchemelessLine === 0) firstSchemelessLine = lineNo;
    }
    current.tabs.push({ title, url });
  }

  const kept = [];
  let emptyGroups = 0;
  let firstEmptyGroupLine = 0;
  groups.forEach((g, i) => {
    if (g.tabs.length > 0) {
      kept.push(g);
    } else {
      emptyGroups++;
      if (firstEmptyGroupLine === 0) firstEmptyGroupLine = groupStartLines[i];
    }
  });

  // "(line 7)" for a single offender, "(first: line 7)" for several.
  const at = (count, line) => (count === 1 ? `(line ${line})` : `(first: line ${line})`);

  const warnings = [];
  if (emptyGroups > 0) {
    const it = emptyGroups === 1 ? 'it' : 'they';
    warnings.push(
      `${emptyGroups} group${emptyGroups === 1 ? '' : 's'} with no tabs ` +
      `${at(emptyGroups, firstEmptyGroupLine)}; ${it} will be ignored`,
    );
  }
  if (schemelessTabs > 0) {
    const it = schemelessTabs === 1 ? 'it' : 'they';
    warnings.push(
      `${schemelessTabs} line${schemelessTabs === 1 ? '' : 's'} ` +
      `${at(schemelessTabs, firstSchemelessLine)} ` +
      `${schemelessTabs === 1 ? 'does' : 'do'} not look like a URL ` +
      `(no scheme, e.g., "https:"); ${it} will be kept, but may not reopen`,
    );
  }
  return { groups: kept, warnings };
}
