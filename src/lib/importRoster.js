// Parses pasted rows from the EnrichMind registration Google Sheet and
// figures out which Level(s) each student belongs to, so Roster's
// "Import Students" tool can bulk-create them instead of typing each one
// in by hand.
//
// A registration row's "Courses" and "Sections" columns can each hold
// more than one entry, joined with " + ", when a student signed up for
// more than one course (e.g. a Level + a Competition Math class). The two
// columns line up by position: Courses[i] pairs with Sections[i].

const MULTI_SESSION_BASES = new Set([
  "Level 3",
  "Level 4",
  "Level 5",
  "Level 6",
  "Algebra 1",
  "Geometry",
]);

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function normalizeDashes(s) {
  return s.replace(/[\u2012\u2013\u2014\u2015]/g, "-");
}

// "Level 5 — Variables & Real-World Modeling" -> "Level 5"
// "Competition Math 5–6 — MATHCOUNTS & AMC 8" -> "Competition Math 5-6"
// "Digital SAT Math Prep" -> "Digital SAT Math Prep" (no dash to split on)
function courseBaseName(courseText) {
  const normalized = normalizeDashes(courseText.trim());
  const dashIdx = normalized.indexOf(" - ");
  const prefix = dashIdx === -1 ? normalized : normalized.slice(0, dashIdx);
  return prefix.trim();
}

// "Fri 5-6 PM ET" -> "Fri"
function sectionDay(sectionText) {
  const match = normalizeDashes(sectionText.trim()).match(/^([A-Za-z]{3})/);
  const abbr = match ? match[1] : null;
  return abbr && DAY_ABBR.includes(abbr) ? abbr : null;
}

function resolveLevelName(courseText, sectionText) {
  const base = courseBaseName(courseText);
  if (MULTI_SESSION_BASES.has(base)) {
    const day = sectionDay(sectionText || "");
    return day ? `${base} ${day}` : base; // fall back to base if day unclear
  }
  return base;
}

// Splits a header row + data rows (tab-separated, as pasted from Google
// Sheets, or comma-separated as a CSV fallback) into row objects keyed by
// header name.
function parseRows(rawText) {
  const lines = rawText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const headers = lines[0].split(delimiter).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(delimiter);
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] || "").trim();
    });
    return row;
  });
}

// Main entry point. Returns:
//   students: [{ studentName, levelNames: string[] }]
//   skippedInactive: number
export function parseRegistrationSheet(rawText) {
  const rows = parseRows(rawText);
  const students = [];
  let skippedInactive = 0;

  // A row's own registration (Student Name / Courses / Sections), or a
  // sibling riding along on the same registration (Sibling Name /
  // Sibling Course / Sibling Time) -- same shape, same parsing rules,
  // just different column names, so this one function handles both.
  // Both a primary student and their sibling share the same "Parent
  // Email" cell, since it's one family's registration either way.
  function extractStudent(name, coursesText, sectionsText, parentEmail) {
    if (!name) return;
    const courses = (coursesText || "").split(" + ").map((s) => s.trim()).filter(Boolean);
    const sections = (sectionsText || "").split(" + ").map((s) => s.trim()).filter(Boolean);
    const levelNames = courses.map((course, i) => resolveLevelName(course, sections[i])).filter(Boolean);
    if (levelNames.length > 0) {
      students.push({ studentName: name, levelNames, parentEmail: parentEmail || null });
    }
  }

  rows.forEach((row) => {
    const status = row["Status"] || "Active";
    if (status && status.trim().toLowerCase() !== "active") {
      if (row["Student Name"]) skippedInactive++;
      return;
    }

    const parentEmail = row["Parent Email"] || null;
    extractStudent(row["Student Name"], row["Courses"], row["Sections"], parentEmail);
    // A sibling registered on the same row -- easy to miss since it's
    // tucked into its own columns rather than getting its own row, but
    // it's a real second student who needs their own roster spot.
    extractStudent(row["Sibling Name"], row["Sibling Course"], row["Sibling Section"], parentEmail);
  });

  return { students, skippedInactive };
}

// Matches parsed students against the teacher's actual Levels (groups),
// separating what can be imported now from Level names that don't exist
// yet (so the teacher can run "Load My Programs" first, or fix a naming
// mismatch, before retrying).
export function matchToGroups(students, groups) {
  const byName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g]));
  const matched = []; // { studentName, groupId, groupName, parentEmail }
  const unmatchedLevels = new Set();

  students.forEach(({ studentName, levelNames, parentEmail }) => {
    levelNames.forEach((levelName) => {
      const group = byName.get(levelName.trim().toLowerCase());
      if (group) {
        matched.push({ studentName, groupId: group.id, groupName: group.name, parentEmail });
      } else {
        unmatchedLevels.add(levelName);
      }
    });
  });

  return { matched, unmatchedLevels: Array.from(unmatchedLevels).sort() };
}
