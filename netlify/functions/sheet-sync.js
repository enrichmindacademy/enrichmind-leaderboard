// netlify/functions/sheet-sync.js
//
// Receives a push from a small Google Apps Script trigger living inside the
// registration Google Sheet (see README for the script + setup steps).
// Whenever a new registration comes in, the sheet pushes its *entire*
// current data range here -- not just the new row -- so this stays
// self-healing: if one push is ever missed, the next one catches it up
// automatically, since matching students are always skipped, never
// duplicated (same guarantee as the manual paste-import in Roster).
//
// This intentionally duplicates the course-name -> Level-name matching
// rules from src/lib/importRoster.js rather than importing it, since this
// function runs as CommonJS under Node and the app source is an ES module
// bundled by Vite -- two different module systems that don't share code
// cleanly without extra build tooling. If the course catalog's naming
// convention ever changes, update both places.

const { createClient } = require("@supabase/supabase-js");

const MULTI_SESSION_BASES = new Set(["Level 3", "Level 4", "Level 5", "Level 6", "Algebra 1", "Geometry"]);
const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function normalizeDashes(s) {
  return s.replace(/[\u2012\u2013\u2014\u2015]/g, "-");
}

function courseBaseName(courseText) {
  const normalized = normalizeDashes(courseText.trim());
  const dashIdx = normalized.indexOf(" - ");
  const prefix = dashIdx === -1 ? normalized : normalized.slice(0, dashIdx);
  return prefix.trim();
}

function sectionDay(sectionText) {
  const match = normalizeDashes(sectionText.trim()).match(/^([A-Za-z]{3})/);
  const abbr = match ? match[1] : null;
  return abbr && DAY_ABBR.includes(abbr) ? abbr : null;
}

function resolveLevelName(courseText, sectionText) {
  const base = courseBaseName(courseText);
  if (MULTI_SESSION_BASES.has(base)) {
    const day = sectionDay(sectionText || "");
    return day ? `${base} ${day}` : base;
  }
  return base;
}

// `values` is the raw 2D array Apps Script sends via getDataRange().getValues()
// -- values[0] is the header row, everything after is data.
function rowsFromValues(values) {
  if (!values || values.length < 2) return [];
  const headers = values[0].map((h) => String(h || "").trim());
  return values.slice(1).map((cells) => {
    const row = {};
    headers.forEach((h, i) => {
      row[h] = String(cells[i] ?? "").trim();
    });
    return row;
  });
}

function parseStudents(rows) {
  const students = [];
  let skippedInactive = 0;

  function extractStudent(name, coursesText, sectionsText, parentEmail) {
    if (!name) return;
    const courses = (coursesText || "").split(" + ").map((s) => s.trim()).filter(Boolean);
    const sections = (sectionsText || "").split(" + ").map((s) => s.trim()).filter(Boolean);
    const levelNames = courses.map((c, i) => resolveLevelName(c, sections[i])).filter(Boolean);
    if (levelNames.length > 0) {
      students.push({ studentName: name, levelNames, parentEmail: parentEmail || null });
    }
  }

  rows.forEach((row) => {
    const status = row["Status"] || "Active";
    if (status.trim().toLowerCase() !== "active") {
      if (row["Student Name"]) skippedInactive++;
      return;
    }

    const parentEmail = row["Parent Email"] || null;
    extractStudent(row["Student Name"], row["Courses"], row["Sections"], parentEmail);
    extractStudent(row["Sibling Name"], row["Sibling Course"], row["Sibling Section"], parentEmail);
  });

  return { students, skippedInactive };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }

  const { secret, values } = body;
  if (!process.env.SHEET_SYNC_SECRET || secret !== process.env.SHEET_SYNC_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: "Invalid or missing secret." }) };
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY server environment variables." }),
    };
  }

  try {
    const supabase = createClient(url, serviceKey);
    const rows = rowsFromValues(values);
    const { students, skippedInactive } = parseStudents(rows);

    const { data: groups, error: groupsErr } = await supabase.from("groups").select("id, name");
    if (groupsErr) throw groupsErr;

    const byName = new Map(groups.map((g) => [g.name.trim().toLowerCase(), g]));
    const matched = [];
    const unmatchedLevels = new Set();

    students.forEach(({ studentName, levelNames, parentEmail }) => {
      levelNames.forEach((levelName) => {
        const group = byName.get(levelName.trim().toLowerCase());
        if (group) {
          matched.push({ studentName, groupId: group.id, parentEmail });
        } else {
          unmatchedLevels.add(levelName);
        }
      });
    });

    let added = 0;
    let emailsBackfilled = 0;
    let possibleChangesSkipped = 0;
    if (matched.length > 0) {
      // Fetch existing students across EVERY Level, not just the ones
      // in this batch -- same reasoning as the manual import box: a
      // name match in an unrelated Level usually means a class change,
      // not a new enrollment, and needs to be caught here specifically
      // rather than silently creating a duplicate.
      const { data: existing, error: existingErr } = await supabase
        .from("students")
        .select("id, group_id, name, parent_email, active");
      if (existingErr) throw existingErr;

      const existingByKey = new Map(
        (existing || []).map((s) => [`${s.group_id}::${s.name.trim().toLowerCase()}`, s])
      );
      const byNameAnywhere = new Map();
      (existing || []).forEach((s) => {
        const k = s.name.trim().toLowerCase();
        byNameAnywhere.set(k, [...(byNameAnywhere.get(k) || []), s]);
      });

      // Same reasoning as the manual import box: a student enrolled in
      // more than one course at once must not have their OTHER still-
      // current enrollment mistaken for a stale old class just because
      // it's a different group than the one being checked right now.
      const currentGroupsByName = new Map();
      matched.forEach(({ studentName, groupId: gId }) => {
        const k = studentName.trim().toLowerCase();
        if (!currentGroupsByName.has(k)) currentGroupsByName.set(k, new Set());
        currentGroupsByName.get(k).add(gId);
      });

      const seen = new Set();
      const toInsert = [];
      const emailBackfills = [];
      matched.forEach(({ studentName, groupId, parentEmail }) => {
        const key = `${groupId}::${studentName.trim().toLowerCase()}`;
        const existingStudent = existingByKey.get(key);
        if (existingStudent) {
          if (parentEmail && !existingStudent.parent_email) {
            emailBackfills.push({ id: existingStudent.id, parent_email: parentEmail });
          }
          return;
        }
        if (seen.has(key)) return;

        // A likely class change: this exact name is already active in
        // some genuinely OTHER, stale Level (not one of their other
        // current concurrent enrollments per this same sheet). There's
        // no one present to confirm a move in an automated background
        // sync, so the safe move here is to skip creating a duplicate
        // and leave it for the next manual "Import Students" review on
        // Roster, which surfaces this with a one-click confirm instead
        // of guessing silently either way.
        const nameKey = studentName.trim().toLowerCase();
        const currentGroups = currentGroupsByName.get(nameKey) || new Set();
        const elsewhere = (byNameAnywhere.get(nameKey) || []).filter(
          (s) => s.active && !currentGroups.has(s.group_id)
        );
        if (elsewhere.length > 0) {
          possibleChangesSkipped++;
          return;
        }

        seen.add(key);
        toInsert.push({ group_id: groupId, name: studentName.trim(), team: "A", active: true, parent_email: parentEmail || null });
      });

      if (toInsert.length > 0) {
        const { error: insertErr } = await supabase.from("students").insert(toInsert);
        if (insertErr) throw insertErr;
        added = toInsert.length;
      }

      if (emailBackfills.length > 0) {
        await Promise.all(
          emailBackfills.map((b) => supabase.from("students").update({ parent_email: b.parent_email }).eq("id", b.id))
        );
        emailsBackfilled = emailBackfills.length;
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        added,
        emailsBackfilled,
        possibleChangesSkipped,
        skippedInactive,
        unmatchedLevels: Array.from(unmatchedLevels),
      }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
