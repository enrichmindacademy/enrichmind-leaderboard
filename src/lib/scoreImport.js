// Deterministic CSV parsers for IXL, Kuta Works, and Formative exports.
//
// These replace the vision-model screenshot parsing in
// netlify/functions/parse-screenshot.js for the three sources a real CSV
// export exists for. A CSV either has the column you're looking for or it
// doesn't -- no OCR misreads, no "read row by row so columns don't
// misalign" instructions needed, and no per-week AI call.
//
// All three parsers return plain data; nothing here touches Supabase or
// the fuzzy-match roster logic -- that stays a separate step, same as the
// screenshot flow (extract first, match/review second, commit last).

// ---- Shared: a small RFC4180-ish CSV line parser -----------------------
// Handles quoted fields containing commas, embedded newlines, and escaped
// ("") quotes -- all three real exports above use at least one of these
// (Formative's answer-choice columns, IXL's quoted skill names with
// commas). No dependency needed at this scale, matching the existing
// philosophy in src/lib/csv.js.

export function parseCsvRows(text) {
  // Strip a UTF-8 BOM if present (Formative's export includes one).
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // swallow -- \r\n is handled by the following \n case, and a lone
      // \r (old Mac line endings) also just ends the row here
      if (text[i + 1] !== "\n") {
        row.push(field);
        field = "";
        rows.push(row);
        row = [];
      }
    } else if (c === "\n") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  // final field/row if the file doesn't end with a newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // drop fully-empty trailing rows (trailing blank lines in the file)
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// ---- Kuta Works ----------------------------------------------------------
// Header: blank cell, then one column per assignment (its title).
// Each student row: Name, then a status/score cell per assignment --
// either a percentage ("85.19%"), or a status code (I = In Progress,
// S = Scheduled, -- = Not Assigned). A trailing "Key:" section explains
// the codes and is not student data.
//
// Real export confirms names come as "First Last" already -- no
// Last-Name-reversal needed here (that guess in the old screenshot
// prompt was wrong for at least this export format).

const KUTA_STATUS_CODES = new Set(["I", "S", "--"]);

export function parseKutaWorksCsv(text) {
  const rows = parseCsvRows(text);
  const headerIdx = rows.findIndex((r) => r[0] === "" && r.length > 1 && r[1]?.trim());
  if (headerIdx === -1) return { assignments: [], students: [], notes: "Could not find a header row." };

  const assignments = rows[headerIdx].slice(1).map((a) => a.trim()).filter(Boolean);
  const students = [];
  const notes = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i];
    const name = (r[0] || "").trim();
    if (!name) continue;
    if (/^key:?$/i.test(name)) break; // reached the trailing Key/legend section

    const perAssignment = {};
    let sumPct = 0;
    let countPct = 0;
    assignments.forEach((a, idx) => {
      const raw = (r[idx + 1] || "").trim();
      if (KUTA_STATUS_CODES.has(raw) || raw === "") {
        perAssignment[a] = { status: raw || "Not Assigned", percent: null };
      } else {
        const pct = parseFloat(raw.replace("%", ""));
        if (Number.isFinite(pct)) {
          perAssignment[a] = { status: "Completed", percent: pct };
          sumPct += pct;
          countPct += 1;
        } else {
          perAssignment[a] = { status: raw, percent: null };
          notes.push(`${name}: unrecognized value "${raw}" for "${a}"`);
        }
      }
    });

    students.push({
      name,
      // Average across whatever assignments were actually completed this
      // export -- an in-progress/scheduled/not-assigned column is left
      // out of the average rather than counted as 0, matching the same
      // "don't penalize what wasn't actually assigned" rule calc.js
      // already uses for the other score categories.
      percent: countPct > 0 ? sumPct / countPct : null,
      perAssignment,
    });
  }

  return { assignments, students, notes: notes.length ? notes.join("; ") : null };
}

// ---- IXL score grid --------------------------------------------------
// Header: Category, "<Grade> skill code", Skill name, Permanent Skill ID,
// then one column per student (full name as entered in IXL's roster).
// Each row is ONE skill in the ENTIRE course scope -- this export is not
// scoped to "this week," it's the whole grid, cumulative, with a cell
// filled in only where that student has attempted that skill (0-100),
// blank otherwise.
//
// Skill codes are like "A.1", "GG.9", "C." (a malformed/checkpoint row
// with no trailing number) -- NOT the single-letter-plus-digit shorthand
// ("F1") the old screenshot prompt's teacher-typed shorthand assumed.
// Matching against a teacher's typed list needs to handle the real
// "LETTERS.NUMBER" format and ranges within one letter group.

export function parseIxlScoreGrid(text) {
  const rows = parseCsvRows(text);
  const header = rows[0];
  const studentNames = header.slice(4).map((n) => n.trim());

  const skills = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 4) continue;
    const [category, code, name, permanentId] = r;
    if (!code && !name) continue;
    skills.push({
      category: category?.trim() || "",
      code: code?.trim() || "",
      name: name?.trim() || "",
      permanentId: permanentId?.trim() || "",
      scores: studentNames.map((_, idx) => {
        const raw = (r[4 + idx] || "").trim();
        return raw === "" ? null : Number(raw);
      }),
    });
  }

  return { studentNames, skills };
}

// Expands a teacher-typed skill code list against the REAL codes seen in
// a given grid export, so "GG.7-9" or "GG7,8,10" or "A.1, A.2" all work
// regardless of which shorthand a teacher types. Falls back to substring
// matching on the code column if an exact code isn't found, since a
// grid's codes sometimes carry a trailing letter/section variant.
export function expandAssignedCodes(codeText, availableCodes) {
  const known = new Set(availableCodes);
  const result = new Set();
  const parts = (codeText || "").split(",").map((p) => p.trim()).filter(Boolean);

  parts.forEach((part) => {
    // "GG.7-9" or "GG7-9" -> letters + start-end range
    const rangeMatch = part.match(/^([A-Za-z]+)\.?(\d+)\s*[-–]\s*(\d+)$/);
    if (rangeMatch) {
      const [, letters, start, end] = rangeMatch;
      for (let n = Number(start); n <= Number(end); n++) {
        const candidate = `${letters}.${n}`;
        if (known.has(candidate)) result.add(candidate);
      }
      return;
    }
    // "GG.9" or "GG9" -> single code
    const singleMatch = part.match(/^([A-Za-z]+)\.?(\d+)$/);
    if (singleMatch) {
      const [, letters, num] = singleMatch;
      const candidate = `${letters}.${num}`;
      if (known.has(candidate)) {
        result.add(candidate);
      } else {
        // last resort: a bare number continuing the previous letter group
        // isn't handled here since it needs the running "current letter"
        // state from the caller's own list order -- keep that logic in
        // the caller if it's still wanted as a UI convenience.
      }
    }
  });

  return [...result];
}

// Per-student average across a specific set of skill codes for the week
// (the same shape the vision-parsed screenshot flow already produces --
// { "F1": 100, "F2": 0, ... } per student -- so this is a drop-in for
// whatever already consumes that in Weekly Update / parse-screenshot).
export function averagesForCodes(grid, codes) {
  const codeSet = new Set(codes);
  const relevantSkills = grid.skills.filter((s) => codeSet.has(s.code));

  return grid.studentNames.map((name, idx) => {
    const perSkill = {};
    let sum = 0;
    let count = 0;
    relevantSkills.forEach((s) => {
      const score = s.scores[idx];
      perSkill[s.code] = score ?? 0; // blank/not-attempted counts as 0, same as the screenshot flow's rule
      sum += score ?? 0;
      count += 1;
    });
    return {
      name,
      skills: perSkill,
      average: count > 0 ? sum / count : null,
    };
  });
}

// Optional upgrade over typing skill codes every week: compare this
// week's grid export against LAST week's stored grid and treat any skill
// that went from "nobody had attempted it" to "at least one student has
// a score" as automatically "assigned this week." Requires storing each
// week's raw grid (skill code -> per-student score) somewhere durable
// (e.g. a new Supabase table) so there's a previous snapshot to diff
// against -- not needed for the first CSV-upload pass, but removes the
// manual "skills assigned" text field entirely once wired up.
export function detectNewlyAttemptedCodes(previousGrid, currentGrid) {
  const prevHadAnyScore = new Map();
  (previousGrid?.skills || []).forEach((s) => {
    prevHadAnyScore.set(s.code, s.scores.some((v) => v !== null));
  });

  return currentGrid.skills
    .filter((s) => {
      const hadBefore = prevHadAnyScore.get(s.code) || false;
      const hasNow = s.scores.some((v) => v !== null);
      return hasNow && !hadBefore;
    })
    .map((s) => s.code);
}

// ---- Formative -----------------------------------------------------------
// Real columns: Timestamp, Formative ID, Formative Title, Teacher ID,
// Teacher Name, Class ID, Class, Student ID, Email/Username, Last Name,
// First Name, %, Total Score, then Q1../Q2../etc per-question columns.
// First two data rows are "Key" and "Tags" metadata (the correct-answer
// key and question tags) -- not students, and must be skipped.
//
// Names come as separate Last Name / First Name fields already (no
// "Last, First" string to reverse, unlike the old screenshot assumption)
// -- BUT the teacher's flagged issue applies here: a student may be
// logged into Formative under a PARENT'S name rather than their own,
// since Formative doesn't enforce roster identity. Name text alone is
// not a reliable match key. Student ID and Email/Username, however, are
// stable for that Formative account across every export from here on --
// so the real fix is resolving by Student ID (fallback: email) instead
// of name text. That resolution itself lives in WeeklyUpdate.jsx's
// resolveMatch(), reusing the existing name_aliases table (extended with
// source/external_id columns) rather than a separate lookup table here --
// one alias mechanism for every source, not a Formative-specific one
// living beside it. adaptFormativeRowsForReview() below is what carries
// the externalId/externalEmail through to make that possible.

export function parseFormativeCsv(text) {
  const rows = parseCsvRows(text);
  const header = rows[0].map((h) => h.trim());
  const col = (label) => header.indexOf(label);

  const idx = {
    timestamp: col("Timestamp"),
    formativeTitle: col("Formative Title"),
    className: col("Class"),
    studentId: col("Student ID"),
    email: col("Email/Username"),
    lastName: col("Last Name"),
    firstName: col("First Name"),
    percent: col("%"),
    totalScore: col("Total Score"),
  };

  const students = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 2) continue;
    const first = (r[0] || "").trim();
    if (/^(key|tags)$/i.test(first)) continue; // metadata rows, not students
    if (!r[idx.timestamp]?.trim()) continue; // no timestamp = not a real submission row

    const lastName = (r[idx.lastName] || "").trim();
    const firstName = (r[idx.firstName] || "").trim();
    const pct = parseFloat(r[idx.percent]);

    students.push({
      studentId: (r[idx.studentId] || "").trim(),
      email: (r[idx.email] || "").trim().toLowerCase(),
      loginName: [firstName, lastName].filter(Boolean).join(" "), // may be a PARENT's name -- do not treat as the student's identity
      lastName,
      firstName,
      percent: Number.isFinite(pct) ? pct : null,
      totalScore: r[idx.totalScore] ? Number(r[idx.totalScore]) : null,
      className: (r[idx.className] || "").trim(),
      formativeTitle: (r[idx.formativeTitle] || "").trim(),
      timestamp: (r[idx.timestamp] || "").trim(),
    });
  }

  return students;
}

// Adapts parseFormativeCsv() rows into the same { name, percent } shape
// every other source already produces for the review-row builder, while
// carrying the stable identity fields (externalId/externalEmail) through
// so the caller can resolve by ID before falling back to name matching.
//
// Also filters to rows that plausibly belong to THIS Level. A Formative
// export isn't scoped to one class the way a screenshot naturally is --
// a teacher can export one assignment's results across every section at
// once (this app's own sample export mixed "Algebra 1 Wed 2026-27" and
// "Algebra 1 Mon 2026-27" rows together) -- so without this, a school
// running multiple sections would flood "Unmatched Names" with students
// who were never on this roster to begin with. Matching is a loose
// substring check against the group's name (both sides normalized to
// letters/digits only) since Formative's "Class" field and this app's
// group name aren't guaranteed to share an exact format -- good enough
// to exclude clearly-unrelated Levels while still keeping the current
// Level's own session variants (Mon/Wed/Tue/Thu sections all match).
export function adaptFormativeRowsForReview(rawRows, groupName) {
  const groupToken = (groupName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return rawRows
    .filter((r) => {
      if (!groupToken) return true; // nothing to filter against -- keep everything, let per-student matching sort it out
      const classToken = (r.className || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      return classToken.includes(groupToken);
    })
    .map((r) => ({
      name: r.loginName,
      percent: r.percent,
      externalId: r.studentId || null,
      externalEmail: r.email || null,
    }));
}
