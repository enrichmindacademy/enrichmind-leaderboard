import { useState, useEffect } from "react";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";

// You're usually catching up on last week's scores, not literally
// today's, so the default week label reflects that instead of always
// landing on today's date -- one less thing to notice and fix before
// every entry session.
function lastWeekLabel() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return `Week of ${d.toLocaleDateString()}`;
}
import { fuzzyMatchName } from "../lib/fuzzyMatch";
import { buildAutoAssignments } from "../lib/autoAssign";
import PasteZone from "../components/PasteZone";
import CsvDropZone from "../components/CsvDropZone";
import {
  parseKutaWorksCsv,
  parseIxlScoreGrid,
  expandAssignedCodes,
  averagesForCodes,
  parseFormativeCsv,
  adaptFormativeRowsForReview,
} from "../lib/scoreImport";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64 = result.split(",")[1];
      resolve({ base64, mediaType: file.type || "image/png" });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function callParseFunction(payload) {
  const res = await fetch("/.netlify/functions/parse-screenshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Failed to parse screenshot.");
  return data;
}

const MULTIPLIER_OPTIONS = [1, 1.5, 2];
const NO_SESSION_KEY = "__main__";

export default function WeeklyUpdate() {
  const { students, sessions, weeks, tasks, assignments, submissions, entriesByWeek, reload, groupId, groups } =
    useGroup();
  const activeStudents = students.filter((s) => s.active);
  const currentGroupName = groups?.find((g) => g.id === groupId)?.name || "";

  // One ClassPoint upload slot per session (or a single slot if this level
  // has no separate sessions). A student can attend either session, so
  // whichever session's screenshot mentions them contributes their stars —
  // the leaderboard itself never splits by session.
  const classpointSlots =
    sessions.length > 0
      ? sessions.map((s) => ({ key: s.id, label: s.label }))
      : [{ key: NO_SESSION_KEY, label: null }];

  const [weekLabel, setWeekLabel] = useState(lastWeekLabel());
  const [skillsAssigned, setSkillsAssigned] = useState("");
  const [multiplier, setMultiplier] = useState(1);
  const [classpointFiles, setClasspointFiles] = useState({}); // { [slotKey]: File }
  const [ixlFile, setIxlFile] = useState(null);
  const [ixlCsvFile, setIxlCsvFile] = useState(null);
  const [ixlMode, setIxlMode] = useState("csv"); // "csv" (recommended) or "screenshot"
  const [ixlDestination, setIxlDestination] = useState("ixl_avg"); // "ixl_avg" (Assignments) or "exam_score" (Exams)
  const [formativeFile, setFormativeFile] = useState(null);
  const [formativeCsvFile, setFormativeCsvFile] = useState(null);
  const [formativeMode, setFormativeMode] = useState("csv");
  const [formativeDestination, setFormativeDestination] = useState("ixl_avg");
  const [classmarkerFile, setClassmarkerFile] = useState(null);
  const [classmarkerDestination, setClassmarkerDestination] = useState("exam_score");
  const [kutaworksFile, setKutaworksFile] = useState(null);
  const [kutaworksCsvFile, setKutaworksCsvFile] = useState(null);
  const [kutaworksMode, setKutaworksMode] = useState("csv");
  const [kutaworksDestination, setKutaworksDestination] = useState("exam_score");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [rows, setRows] = useState(null); // review rows, one per active student
  const [rawClasspoint, setRawClasspoint] = useState([]);
  const [rawIxl, setRawIxl] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nameAliases, setNameAliases] = useState({}); // { normalizedRawName: studentId }
  const [externalAliases, setExternalAliases] = useState({}); // { "source::externalId": studentId }
  const [unmatchedNames, setUnmatchedNames] = useState([]); // [{ source, rawName, candidates, externalSource?, externalId? }]
  const [lastParsedData, setLastParsedData] = useState(null);
  const [resolvingAlias, setResolvingAlias] = useState(false);

  // Once a teacher manually resolves a name a screenshot/CSV tool didn't
  // match to anyone on the roster (a Formative account under a parent's
  // name instead of the student's, say), that fix is remembered here so
  // it's a one-time correction, not something to redo every week the
  // same mismatch shows up. Two lookup paths come out of the same table:
  // raw_name (the original, for screenshot sources and as a fallback),
  // and source+external_id (for CSV sources with a stable account ID --
  // currently Formative's Student ID) -- the ID path wins when present,
  // since it survives a display-name change that would break raw_name
  // matching.
  useEffect(() => {
    if (!groupId) return;
    supabase
      .from("name_aliases")
      .select("raw_name, student_id, source, external_id")
      .eq("group_id", groupId)
      .then(({ data }) => {
        const nameMap = {};
        const externalMap = {};
        (data || []).forEach((a) => {
          nameMap[a.raw_name] = a.student_id;
          if (a.source && a.external_id) {
            externalMap[`${a.source}::${a.external_id}`] = a.student_id;
          }
        });
        setNameAliases(nameMap);
        setExternalAliases(externalMap);
      });
  }, [groupId]);

  function normalizeAliasKey(s) {
    return (s || "").toLowerCase().trim();
  }

  function resolveMatch(rawName, roster, aliasesMap = nameAliases, externalMap = externalAliases, externalKey = null) {
    if (externalKey && externalMap[externalKey]) {
      const student = roster.find((r) => r.id === externalMap[externalKey]);
      if (student) return { match: student, ambiguous: false, candidates: [] };
    }
    const key = normalizeAliasKey(rawName);
    const aliasedId = aliasesMap[key];
    if (aliasedId) {
      const student = roster.find((r) => r.id === aliasedId);
      if (student) return { match: student, ambiguous: false, candidates: [] };
    }
    return fuzzyMatchName(rawName, roster);
  }

  // `identity` is optional -- { source, externalId } -- present only when
  // resolving a CSV row that carries a stable account ID (Formative).
  // When given, the alias is saved keyed on that ID (surviving a future
  // display-name change) in addition to the raw name; screenshot-sourced
  // corrections keep working exactly as before with no identity at all.
  async function saveAlias(rawName, studentId, identity) {
    if (!studentId) return;
    setResolvingAlias(true);
    try {
      const key = normalizeAliasKey(rawName);
      const payload = { group_id: groupId, raw_name: key, student_id: studentId };
      let conflictTarget = "group_id,raw_name";
      if (identity?.source && identity?.externalId) {
        payload.source = identity.source;
        payload.external_id = identity.externalId;
        conflictTarget = "group_id,source,external_id";
      }
      await supabase.from("name_aliases").upsert(payload, { onConflict: conflictTarget });

      const nextAliases = { ...nameAliases, [key]: studentId };
      setNameAliases(nextAliases);
      let nextExternal = externalAliases;
      if (identity?.source && identity?.externalId) {
        nextExternal = { ...externalAliases, [`${identity.source}::${identity.externalId}`]: studentId };
        setExternalAliases(nextExternal);
      }
      // Re-run the same parse now that this name/identity resolves --
      // picks up the fix without needing separate re-application logic
      // per source.
      if (lastParsedData) buildReviewRows(lastParsedData, nextAliases, nextExternal);
    } catch (e) {
      setError(e.message);
    } finally {
      setResolvingAlias(false);
    }
  }

  const CATEGORY_OPTIONS = [
    { key: "classpoint_stars", label: "⭐ Class Participation (stars — ×5 in Total)", step: 1 },
    { key: "ixl_avg", label: "📘 Assignments", step: 0.1 },
    { key: "notebooking_score", label: "📝 Notebooking", step: 0.1 },
    { key: "study_guide_score", label: "📗 Study Guide", step: 0.1 },
    { key: "exam_score", label: "🧪 Exams", step: 0.1 },
    { key: "exam_corrections_score", label: "✏️ Exam Corrections", step: 0.1 },
    { key: "bonus", label: "🎁 Bonus", step: 0.1 },
  ];
  const [quickCategory, setQuickCategory] = useState("notebooking_score");
  const [quickValues, setQuickValues] = useState({}); // { [studentId]: value }
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickSaved, setQuickSaved] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);

  // Whenever the week or category being quick-updated changes, pull
  // whatever's already saved for that one field so the boxes show real
  // current values (not just blank/zero) -- same protection as the fix
  // above, applied to this simpler single-column flow.
  function loadQuickValues(weekLbl, category) {
    const week = weeks.find((w) => w.label === weekLbl);
    const entries = week ? entriesByWeek[week.id] || {} : {};
    const values = {};
    activeStudents.forEach((s) => {
      values[s.id] = entries[s.id]?.[category] ?? 0;
    });
    setQuickValues(values);
  }

  function onWeekLabelChange(v) {
    setWeekLabel(v);
    setQuickSaved(false);
    loadQuickValues(v, quickCategory);
    // If this matches an existing week, load its own saved multiplier and
    // skills-assigned text too -- otherwise clicking Save Week here would
    // silently overwrite that past week's multiplier back to 1x, since
    // the UI would still be showing whatever was last selected on screen,
    // not what's actually saved for the week you just switched to.
    const existing = weeks.find((w) => w.label === v);
    setMultiplier(existing ? Number(existing.bonus_multiplier) || 1 : 1);
    setSkillsAssigned(existing ? existing.skills_assigned || "" : "");
  }

  function onQuickCategoryChange(v) {
    setQuickCategory(v);
    setQuickSaved(false);
    loadQuickValues(weekLabel, v);
  }

  async function saveQuickUpdate() {
    setQuickBusy(true);
    setError("");
    try {
      let week = weeks.find((w) => w.label === weekLabel);
      let weekId = week?.id;
      if (!weekId) {
        const { data, error } = await supabase
          .from("weeks")
          .insert({ group_id: groupId, label: weekLabel })
          .select()
          .single();
        if (error) throw error;
        weekId = data.id;
      }

      // Only week_id, student_id, and this one category go in the
      // payload -- Postgres upsert only overwrites the columns actually
      // provided, so every other field (whatever another session already
      // saved for this week) is left completely untouched.
      const payload = activeStudents.map((s) => ({
        week_id: weekId,
        student_id: s.id,
        [quickCategory]: Number(quickValues[s.id]) || 0,
      }));

      const { error: upsertErr } = await supabase
        .from("entries")
        .upsert(payload, { onConflict: "week_id,student_id" });
      if (upsertErr) throw upsertErr;

      await reload();
      setQuickSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setQuickBusy(false);
    }
  }

  // For testing: clears every score in a given week back to zero (doesn't
  // delete the week itself, or any bonus notes/goals attached to it) so
  // you can re-test entering values without piling up junk weeks.
  async function resetWeekScores() {
    const week = weeks.find((w) => w.label === weekLabel);
    if (!week) {
      alert(`No week named "${weekLabel}" exists yet — nothing to reset.`);
      return;
    }
    if (!confirm(`Reset every score in "${weekLabel}" back to zero? This can't be undone.`)) return;
    setResetBusy(true);
    try {
      await supabase
        .from("entries")
        .update({
          classpoint_stars: 0,
          ixl_avg: 0,
          notebooking_score: 0,
          study_guide_score: 0,
          exam_score: 0,
          exam_corrections_score: 0,
          bonus: 0,
        })
        .eq("week_id", week.id);
      await reload();
      loadQuickValues(weekLabel, quickCategory);
      setRows(null); // clear any open big-table review so it doesn't show stale numbers
    } catch (e) {
      setError(e.message);
    } finally {
      setResetBusy(false);
    }
  }

  useEffect(() => {
    loadQuickValues(weekLabel, quickCategory);
    const existing = weeks.find((w) => w.label === weekLabel);
    if (existing) {
      setMultiplier(Number(existing.bonus_multiplier) || 1);
      setSkillsAssigned(existing.skills_assigned || "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, weeks, entriesByWeek]);

  function setClasspointFile(slotKey, file) {
    setClasspointFiles((prev) => ({ ...prev, [slotKey]: file }));
  }

  async function handleParse() {
    setError("");
    setBusy(true);
    setSaved(false);
    try {
      const rosterNames = activeStudents.map((s) => s.name);
      const combinedClasspoint = [];

      for (const slot of classpointSlots) {
        const file = classpointFiles[slot.key];
        if (!file) continue;
        const classpointImage = await fileToBase64(file);
        const data = await callParseFunction({ classpointImage, skillsAssigned, rosterNames });
        (data.classpoint || []).forEach((row) => {
          combinedClasspoint.push({ ...row, sessionLabel: slot.label });
        });
      }

      // IXL: CSV mode parses the real Score Grid export deterministically
      // (no vision model, no per-week AI call) -- the skills-assigned text
      // box above is reused as-is, just matched against the export's own
      // real codes ("GG.9") instead of the shorthand a screenshot forced
      // us to invent. Screenshot mode stays available as a fallback.
      let ixlRows = [];
      if (ixlMode === "csv" && ixlCsvFile) {
        const text = await fileToText(ixlCsvFile);
        const grid = parseIxlScoreGrid(text);
        const availableCodes = grid.skills.map((s) => s.code);
        const codes = expandAssignedCodes(skillsAssigned, availableCodes);
        if (codes.length === 0) {
          throw new Error(
            `No skill codes from "${skillsAssigned}" were found in this IXL export. Double-check the codes ` +
              `against the export (e.g. "GG.7-9, GG.10") -- CSV mode needs the real codes, not the old screenshot shorthand.`
          );
        }
        ixlRows = averagesForCodes(grid, codes);
      } else if (ixlFile) {
        const ixlImage = await fileToBase64(ixlFile);
        const data = await callParseFunction({ ixlImage, skillsAssigned, rosterNames });
        ixlRows = data.ixl || [];
      }

      // Formative: CSV mode carries the account's stable Student ID/email
      // through so a mismatch only ever needs resolving once, even if the
      // display name is a parent's and changes between exports -- see
      // adaptFormativeRowsForReview() and the externalId handling below.
      let formativeRows = [];
      if (formativeMode === "csv" && formativeCsvFile) {
        const text = await fileToText(formativeCsvFile);
        const parsed = parseFormativeCsv(text);
        formativeRows = adaptFormativeRowsForReview(parsed, currentGroupName);
      } else if (formativeFile) {
        const formativeImage = await fileToBase64(formativeFile);
        const data = await callParseFunction({ formativeImage, rosterNames });
        formativeRows = data.formative || [];
      }

      let classmarkerRows = [];
      if (classmarkerFile) {
        const classmarkerImage = await fileToBase64(classmarkerFile);
        const data = await callParseFunction({ classmarkerImage, rosterNames });
        classmarkerRows = data.classmarker || [];
      }

      // Kuta Works: CSV mode reads the real export directly -- names come
      // through as "First Last" already (the screenshot prompt's assumed
      // reversal was wrong for this export), and an in-progress/scheduled
      // column is excluded from that student's row entirely rather than
      // parsed as a 0.
      let kutaworksRows = [];
      if (kutaworksMode === "csv" && kutaworksCsvFile) {
        const text = await fileToText(kutaworksCsvFile);
        const parsed = parseKutaWorksCsv(text);
        kutaworksRows = parsed.students
          .filter((s) => s.percent !== null)
          .map((s) => ({ name: s.name, percent: s.percent }));
      } else if (kutaworksFile) {
        const kutaworksImage = await fileToBase64(kutaworksFile);
        const data = await callParseFunction({ kutaworksImage, rosterNames });
        kutaworksRows = data.kutaworks || [];
      }

      if (
        combinedClasspoint.length === 0 &&
        ixlRows.length === 0 &&
        formativeRows.length === 0 &&
        classmarkerRows.length === 0 &&
        kutaworksRows.length === 0
      ) {
        setError("Attach at least one screenshot.");
        setBusy(false);
        return;
      }

      buildReviewRows({
        classpoint: combinedClasspoint,
        ixl: ixlRows,
        formative: formativeRows,
        classmarker: classmarkerRows,
        kutaworks: kutaworksRows,
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  function buildReviewRows(data, aliasesOverride, externalAliasesOverride) {
    const aliasesMap = aliasesOverride || nameAliases;
    const externalMap = externalAliasesOverride || externalAliases;
    setLastParsedData(data);
    const roster = activeStudents.map((s) => ({ id: s.id, name: s.name }));
    const classpoint = data.classpoint || [];
    const ixl = data.ixl || [];
    const formative = data.formative || [];
    const classmarker = data.classmarker || [];
    const kutaworks = data.kutaworks || [];
    setRawClasspoint(classpoint);
    setRawIxl(ixl);

    const byStudent = {};
    const unmatched = [];

    classpoint.forEach((row, idx) => {
      const { match, ambiguous, candidates } = resolveMatch(row.name, roster, aliasesMap);
      if (!match) {
        unmatched.push({ source: "ClassPoint", rawName: row.name, candidates: candidates || [] });
        return;
      }
      const existing = byStudent[match.id] || {};
      // A student should only appear in one session's screenshot per week;
      // if they somehow show up in two, add the stars together rather than
      // silently overwriting (edge case — always double-check in review).
      byStudent[match.id] = {
        ...existing,
        stars: (existing.stars ?? 0) + (row.stars ?? 0),
        starsAmbiguous: existing.starsAmbiguous || ambiguous,
        starsSourceIdx: idx,
      };
    });

    ixl.forEach((row, idx) => {
      const { match, ambiguous, candidates } = resolveMatch(row.name, roster, aliasesMap);
      if (!match) {
        unmatched.push({ source: "IXL", rawName: row.name, candidates: candidates || [] });
        return;
      }
      const skills = row.skills || {};
      const values = Object.values(skills).map((v) => Number(v) || 0);
      const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
      byStudent[match.id] = byStudent[match.id] || {};
      // IXL can feed either Assignments or Exams, whichever the teacher
      // picked for this upload — same read, same math, just a different
      // destination column depending on what this particular IXL report
      // actually was this week.
      byStudent[match.id][ixlDestination] = Math.round(avg * 10) / 10;
      byStudent[match.id].ixlSkills = skills;
      byStudent[match.id].ixlAmbiguous = ambiguous;
      byStudent[match.id].ixlSourceIdx = idx;
    });

    // Formative, ClassMarker, and Kuta Works each have their OWN
    // destination toggle now (formativeDestination/classmarkerDestination/
    // kutaworksDestination) -- previously these were hardcoded ("Kuta
    // Works is an alternate source for Exams"), which silently overwrote
    // exam_score even for a teacher using Kuta Works for regular
    // Assignments practice. Same read, same math -- just goes wherever
    // this particular upload actually belongs this week.
    formative.forEach((row) => {
      const externalKey = row.externalId ? `formative::${row.externalId}` : null;
      const { match, candidates } = resolveMatch(row.name, roster, aliasesMap, externalMap, externalKey);
      if (!match) {
        unmatched.push({
          source: "Formative",
          rawName: row.name,
          candidates: candidates || [],
          externalSource: row.externalId ? "formative" : null,
          externalId: row.externalId || null,
          hint: row.externalId
            ? "Logged into Formative under this name/email — confirm which real student this is."
            : null,
        });
        return;
      }
      byStudent[match.id] = byStudent[match.id] || {};
      byStudent[match.id][formativeDestination] = Math.round((Number(row.percent) || 0) * 10) / 10;
    });
    classmarker.forEach((row) => {
      const { match, candidates } = resolveMatch(row.name, roster, aliasesMap);
      if (!match) {
        unmatched.push({ source: "ClassMarker", rawName: row.name, candidates: candidates || [] });
        return;
      }
      byStudent[match.id] = byStudent[match.id] || {};
      byStudent[match.id][classmarkerDestination] = Math.round((Number(row.percent) || 0) * 10) / 10;
    });

    kutaworks.forEach((row) => {
      const { match, candidates } = resolveMatch(row.name, roster, aliasesMap);
      if (!match) {
        unmatched.push({ source: "Kuta Works", rawName: row.name, candidates: candidates || [] });
        return;
      }
      byStudent[match.id] = byStudent[match.id] || {};
      byStudent[match.id][kutaworksDestination] = Math.round((Number(row.percent) || 0) * 10) / 10;
    });

    setUnmatchedNames(unmatched);

    // If this week already exists and already has saved scores (e.g. you
    // logged Notebooking earlier in the week and are now back to add
    // Exams), those saved values are the starting point for every field --
    // fresh screenshot data only overlays stars/IXL on top of that. Without
    // this, re-saving the same week would silently zero out whatever was
    // entered in an earlier session, since the four manual fields had no
    // way to know what was already there.
    const existingWeek = weeks.find((w) => w.label === weekLabel);
    const existingEntries = existingWeek ? entriesByWeek[existingWeek.id] || {} : {};

    const reviewRows = activeStudents.map((s) => {
      const d = byStudent[s.id] || {};
      const saved = existingEntries[s.id] || {};
      return {
        studentId: s.id,
        name: s.name,
        stars: d.stars ?? saved.classpoint_stars ?? 0,
        ixl_avg: d.ixl_avg ?? saved.ixl_avg ?? 0,
        ixlSkills: d.ixlSkills || null,
        notebooking_score: saved.notebooking_score ?? 0,
        study_guide_score: saved.study_guide_score ?? 0,
        exam_score: d.exam_score ?? saved.exam_score ?? 0,
        exam_corrections_score: saved.exam_corrections_score ?? 0,
        bonus: saved.bonus ?? 0,
        starsAmbiguous: !!d.starsAmbiguous,
        ixlAmbiguous: !!d.ixlAmbiguous,
        starsSourceIdx: d.starsSourceIdx ?? "",
        ixlSourceIdx: d.ixlSourceIdx ?? "",
        matched: d.stars !== undefined || d.ixl_avg !== undefined || d.exam_score !== undefined,
      };
    });

    setRows(reviewRows);
  }

  function updateRow(studentId, field, value) {
    setRows((prev) =>
      prev.map((r) => (r.studentId === studentId ? { ...r, [field]: Number(value) } : r))
    );
  }

  function reassignStarsSource(studentId, idxStr) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.studentId !== studentId) return r;
        if (idxStr === "") return { ...r, starsSourceIdx: "", starsAmbiguous: false };
        const idx = Number(idxStr);
        const raw = rawClasspoint[idx];
        return {
          ...r,
          stars: raw?.stars ?? 0,
          starsSourceIdx: idx,
          starsAmbiguous: false,
          matched: true,
        };
      })
    );
  }

  function reassignIxlSource(studentId, idxStr) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.studentId !== studentId) return r;
        if (idxStr === "") return { ...r, ixlSourceIdx: "", ixlAmbiguous: false };
        const idx = Number(idxStr);
        const raw = rawIxl[idx];
        const skills = raw?.skills || {};
        const values = Object.values(skills).map((v) => Number(v) || 0);
        const avg = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        return {
          ...r,
          ixl_avg: Math.round(avg * 10) / 10,
          ixlSkills: skills,
          ixlSourceIdx: idx,
          ixlAmbiguous: false,
          matched: true,
        };
      })
    );
  }

  async function handleSave() {
    setSaving(true);
    setError("");
    try {
      const existing = weeks.find((w) => w.label === weekLabel);
      let weekId = existing?.id;

      if (!weekId) {
        const { data, error } = await supabase
          .from("weeks")
          .insert({
            group_id: groupId,
            label: weekLabel,
            skills_assigned: skillsAssigned,
            bonus_multiplier: multiplier,
          })
          .select()
          .single();
        if (error) throw error;
        weekId = data.id;
      } else {
        await supabase
          .from("weeks")
          .update({ skills_assigned: skillsAssigned, bonus_multiplier: multiplier })
          .eq("id", weekId);
      }

      const upserts = rows.map((r) => ({
        week_id: weekId,
        student_id: r.studentId,
        classpoint_stars: r.stars,
        ixl_avg: r.ixl_avg,
        notebooking_score: r.notebooking_score,
        study_guide_score: r.study_guide_score,
        exam_score: r.exam_score,
        exam_corrections_score: r.exam_corrections_score,
        bonus: r.bonus,
      }));

      const { error: upsertErr } = await supabase
        .from("entries")
        .upsert(upserts, { onConflict: "week_id,student_id" });
      if (upsertErr) throw upsertErr;

      // Auto-assign each active student their personalized tasks for this
      // week (one dynamic math task from the skills just entered above,
      // plus habit tasks matched to their own interests) — no extra step
      // for the teacher. Never assigns twice for a week that already has
      // assignments (e.g. re-saving the same week).
      try {
        const weekForAssignment = {
          id: weekId,
          skills_assigned: skillsAssigned,
          date: existing?.date || new Date().toISOString().slice(0, 10),
        };
        // Make sure the week we just saved is present (and up to date) in
        // the list buildAutoAssignments uses to find "the week before this
        // one" for catch-up items — `weeks` from context may not have
        // refreshed yet at this point.
        const weeksById = new Map(weeks.map((w) => [w.id, w]));
        weeksById.set(weekId, weekForAssignment);
        const weeksForAssignment = [...weeksById.values()].sort(
          (a, b) => new Date(a.date) - new Date(b.date)
        );

        const newAssignments = buildAutoAssignments({
          week: weekForAssignment,
          weeks: weeksForAssignment,
          group: { id: groupId },
          students: activeStudents,
          tasks,
          existingAssignments: assignments,
          submissions,
        });
        if (newAssignments.length > 0) {
          await supabase.from("task_assignments").insert(newAssignments);
        }
      } catch (assignErr) {
        // Don't block saving the week's scores if task auto-assignment
        // hiccups — surface it quietly instead.
        // eslint-disable-next-line no-console
        console.warn("Task auto-assignment skipped:", assignErr.message);
      }

      setSaved(true);
      setRows(null);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Quick Update — One Category at a Time</div>
        <p className="muted" style={{ marginBottom: 12 }}>
          For entering just one thing without touching the rest — Notebooking during class,
          Study Guide before an exam, whatever. Pick the week and category, type values for
          whoever needs one, save. Nothing else for that week gets changed, even if this is
          the second or third time you've come back to it.
        </p>
        <div className="row" style={{ marginBottom: 12 }}>
          <div>
            <label className="muted">Week</label>
            <br />
            <input value={weekLabel} onChange={(e) => onWeekLabelChange(e.target.value)} style={{ width: 200 }} />
          </div>
          <div>
            <label className="muted">Category</label>
            <br />
            <select value={quickCategory} onChange={(e) => onQuickCategoryChange(e.target.value)}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 10, marginBottom: 14 }}>
          {activeStudents.map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <span style={{ fontSize: 13.5 }}>{s.name}</span>
              <input
                type="number"
                step={CATEGORY_OPTIONS.find((c) => c.key === quickCategory)?.step || 0.1}
                style={{ width: 80 }}
                value={quickValues[s.id] ?? 0}
                onChange={(e) => setQuickValues((prev) => ({ ...prev, [s.id]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="row">
          <button className="btn" onClick={saveQuickUpdate} disabled={quickBusy}>
            {quickBusy ? "Saving…" : `Save ${CATEGORY_OPTIONS.find((c) => c.key === quickCategory)?.label}`}
          </button>
          <button className="btn secondary" onClick={resetWeekScores} disabled={resetBusy}>
            {resetBusy ? "Resetting…" : "Reset This Week's Scores (testing)"}
          </button>
          {quickSaved && <span className="muted">✅ Saved.</span>}
        </div>
        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="card">
        <div className="card-title">1. Week Details</div>
        <div className="row" style={{ marginBottom: 10, alignItems: "flex-end" }}>
          <div>
            <label className="muted">Pick a week</label>
            <br />
            <select
              value={weeks.some((w) => w.label === weekLabel) ? weekLabel : "__new__"}
              onChange={(e) => {
                if (e.target.value === "__new__") {
                  onWeekLabelChange(lastWeekLabel());
                } else {
                  onWeekLabelChange(e.target.value);
                }
              }}
              style={{ width: 220 }}
            >
              <option value="__new__">➕ New week</option>
              {[...weeks]
                .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
                .map((w) => (
                  <option key={w.id} value={w.label}>
                    {w.label}
                  </option>
                ))}
            </select>
            <div className="muted" style={{ fontSize: 11.5, marginTop: 4 }}>
              Picking a past week loads whatever's already saved for it — anything you add gets
              added to that week, not a new one.
            </div>
          </div>
          <div>
            <label className="muted">Week label</label>
            <br />
            <input value={weekLabel} onChange={(e) => onWeekLabelChange(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="muted">Bonus multiplier (⚡ Double Stars Week etc.)</label>
          <br />
          <div className="row" style={{ marginTop: 6 }}>
            {MULTIPLIER_OPTIONS.map((m) => (
              <button
                key={m}
                className={`btn ${multiplier === m ? "" : "secondary"}`}
                onClick={() => setMultiplier(m)}
                type="button"
              >
                {m}x{m > 1 ? " ⚡" : ""}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">        <div className="card-title">2. Add Screenshots</div>
        {classpointSlots.length > 1 && (
          <p className="muted" style={{ marginBottom: 10 }}>
            This level has {classpointSlots.length} sessions — add each session's ClassPoint
            screenshot below. Whichever session a student attended that week provides their
            stars.
          </p>
        )}
        <p className="muted" style={{ marginBottom: 10 }}>
          No need to save the screenshot as a file first — copy it (e.g. Win+Shift+S / the
          Snipping Tool), click into a box below, and press Ctrl+V.
        </p>
        <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
          {classpointSlots.map((slot) => (
            <PasteZone
              key={slot.key}
              label={`ClassPoint stars${slot.label ? ` — ${slot.label}` : ""}`}
              file={classpointFiles[slot.key] || null}
              onChange={(file) => setClasspointFile(slot.key, file)}
            />
          ))}
        </div>

        <div className="rowlabel" style={{ marginBottom: 8 }}>
          Add this week's scores — each source has its own destination, set below it
        </div>
        <div className="row" style={{ marginBottom: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ minWidth: 260 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>IXL</div>
            <SourceModeToggle mode={ixlMode} onChange={setIxlMode} csvLabel="CSV export (recommended)" />
            {ixlMode === "csv" ? (
              <CsvDropZone label="IXL Score Grid export (.csv)" file={ixlCsvFile} onChange={setIxlCsvFile} />
            ) : (
              <PasteZone label="IXL score report screenshot" file={ixlFile} onChange={setIxlFile} />
            )}
            <label className="muted" style={{ display: "block", marginTop: 8 }}>
              {ixlMode === "csv"
                ? 'Skills assigned this week (e.g. "GG.7-9, GG.10" — the real codes from the export, not shorthand)'
                : 'Skills assigned this week (e.g. "F1, 3, 4, 5, I 1, 7") — only used to read the IXL report correctly'}
            </label>
            <input
              style={{ width: "100%", marginTop: 4 }}
              value={skillsAssigned}
              onChange={(e) => setSkillsAssigned(e.target.value)}
              placeholder={ixlMode === "csv" ? "GG.7-9, GG.10" : "F1, 3, 4, 5, I 1, 7"}
            />
            <DestinationToggle value={ixlDestination} onChange={setIxlDestination} />
          </div>

          <div style={{ minWidth: 260 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Formative</div>
            <SourceModeToggle mode={formativeMode} onChange={setFormativeMode} csvLabel="CSV export (recommended)" />
            {formativeMode === "csv" ? (
              <>
                <CsvDropZone label="Formative export (.csv)" file={formativeCsvFile} onChange={setFormativeCsvFile} />
                <p className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>
                  Matches by the student's Formative account, not the display name — safe even if
                  a parent's name shows up instead of the student's.
                </p>
              </>
            ) : (
              <PasteZone label="Formative results screenshot" file={formativeFile} onChange={setFormativeFile} />
            )}
            <DestinationToggle value={formativeDestination} onChange={setFormativeDestination} />
          </div>

          <div style={{ minWidth: 260 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>ClassMarker</div>
            <PasteZone label="ClassMarker results screenshot" file={classmarkerFile} onChange={setClassmarkerFile} />
            <DestinationToggle value={classmarkerDestination} onChange={setClassmarkerDestination} />
          </div>

          <div style={{ minWidth: 260 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Kuta Works</div>
            <SourceModeToggle mode={kutaworksMode} onChange={setKutaworksMode} csvLabel="CSV export (recommended)" />
            {kutaworksMode === "csv" ? (
              <CsvDropZone
                label="Kuta Works results export (.csv)"
                file={kutaworksCsvFile}
                onChange={setKutaworksCsvFile}
              />
            ) : (
              <PasteZone label="Kuta Works results screenshot" file={kutaworksFile} onChange={setKutaworksFile} />
            )}
            <DestinationToggle value={kutaworksDestination} onChange={setKutaworksDestination} />
          </div>
        </div>

        <button className="btn" onClick={handleParse} disabled={busy}>
          {busy ? "Reading files…" : "Extract Data"}
        </button>
        {error && <div className="error-text">{error}</div>}
      </div>

      {unmatchedNames.length > 0 && (
        <div className="card">
          <div className="card-title">Unmatched Names — Pick Who This Is</div>
          <p className="muted" style={{ marginBottom: 10 }}>
            These names in the screenshots didn't match anyone on the roster — happens when a
            parent's name shows up on a Formative/ClassMarker account instead of the student's,
            or a name is spelled differently than on file. Pick the right student once, and it's
            remembered for every future week — no need to fix the same one again.
          </p>
          {unmatchedNames.map((u, i) => (
            <UnmatchedNameRow
              key={`${u.source}-${u.rawName}-${i}`}
              entry={u}
              students={activeStudents}
              busy={resolvingAlias}
              onResolve={(studentId) =>
                saveAlias(
                  u.rawName,
                  studentId,
                  u.externalSource && u.externalId ? { source: u.externalSource, externalId: u.externalId } : undefined
                )
              }
            />
          ))}
        </div>
      )}

      {rows && (
        <div className="card">
          <div className="card-title">3. Review Before Saving</div>
          <p className="muted" style={{ marginBottom: 10 }}>
            If a name was matched wrong, use the dropdown next to that column to pick the
            correct screenshot row instead. <strong>Notebooking, Study Guide, and Exam
            Corrections</strong> are always entered by hand. Assignments and Exams auto-fill
            from whichever screenshot you attached above — still editable here either way.
            Nothing is saved until you click Save Week.
          </p>
          <table className="review-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Match</th>
                <th title="Total counts this ×5 — e.g. 2 stars becomes 10 points">⭐ Participation (stars, ×5 in Total)</th>
                <th>Source row</th>
                <th>Assignments</th>
                <th>Source row</th>
                <th>Notebooking</th>
                <th>Study Guide</th>
                <th>Exams</th>
                <th>Exam Corr.</th>
                <th>Bonus</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const total =
                  r.stars * 5 +
                  r.ixl_avg +
                  Number(r.notebooking_score) +
                  Number(r.study_guide_score) +
                  Number(r.exam_score) +
                  Number(r.exam_corrections_score) +
                  r.bonus;
                const badge = !r.matched
                  ? { cls: "match-none", label: "No data" }
                  : r.starsAmbiguous || r.ixlAmbiguous
                  ? { cls: "match-unsure", label: "Check name" }
                  : { cls: "match-good", label: "Matched" };
                return (
                  <tr key={r.studentId}>
                    <td>{r.name}</td>
                    <td>
                      <span className={`match-badge ${badge.cls}`}>{badge.label}</span>
                    </td>
                    <td>
                      <input
                        type="number"
                        value={r.stars}
                        onChange={(e) => updateRow(r.studentId, "stars", e.target.value)}
                      />
                    </td>
                    <td>
                      {rawClasspoint.length > 0 && (
                        <select
                          value={r.starsSourceIdx}
                          onChange={(e) => reassignStarsSource(r.studentId, e.target.value)}
                        >
                          <option value="">— manual —</option>
                          {rawClasspoint.map((rc, idx) => (
                            <option key={idx} value={idx}>
                              {rc.name} ({rc.stars}){rc.sessionLabel ? ` — ${rc.sessionLabel}` : ""}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={r.ixl_avg}
                        onChange={(e) => updateRow(r.studentId, "ixl_avg", e.target.value)}
                      />
                      {r.ixlSkills && (
                        <div className="muted" style={{ fontSize: 10, marginTop: 2, whiteSpace: "nowrap" }}>
                          {Object.entries(r.ixlSkills)
                            .map(([code, val]) => `${code}:${val}`)
                            .join(" ")}
                        </div>
                      )}
                    </td>
                    <td>
                      {rawIxl.length > 0 && (
                        <select
                          value={r.ixlSourceIdx}
                          onChange={(e) => reassignIxlSource(r.studentId, e.target.value)}
                        >
                          <option value="">— manual —</option>
                          {rawIxl.map((ri, idx) => {
                            const vals = Object.values(ri.skills || {}).map((v) => Number(v) || 0);
                            const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
                            return (
                              <option key={idx} value={idx}>
                                {ri.name} ({avg.toFixed(1)})
                              </option>
                            );
                          })}
                        </select>
                      )}
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={r.notebooking_score}
                        onChange={(e) => updateRow(r.studentId, "notebooking_score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={r.study_guide_score}
                        onChange={(e) => updateRow(r.studentId, "study_guide_score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={r.exam_score}
                        onChange={(e) => updateRow(r.studentId, "exam_score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={r.exam_corrections_score}
                        onChange={(e) => updateRow(r.studentId, "exam_corrections_score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={r.bonus}
                        onChange={(e) => updateRow(r.studentId, "bonus", e.target.value)}
                      />
                    </td>
                    <td>{total.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 16 }}>
            <button className="btn" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save Week"}
            </button>
          </div>
        </div>
      )}

      {saved && (
        <div className="card">
          <p>✅ Saved. Check the Projector Board for updated rankings.</p>
        </div>
      )}
    </>
  );
}

// Small CSV-vs-screenshot switch shown above a source's input. Defaults
// to CSV wherever a real export exists (IXL, Formative, Kuta Works) --
// deterministic parsing beats a vision model reading a picture, and costs
// nothing per week to run. Screenshot stays one click away for whichever
// week a real export isn't handy.
function SourceModeToggle({ mode, onChange, csvLabel = "CSV export" }) {
  // Same "unselected option gets .secondary" convention the multiplier
  // picker above already uses, rather than introducing a new .active
  // class with no matching CSS rule outside nav tabs/sidebar links.
  return (
    <div className="row" style={{ gap: 6, marginBottom: 6 }}>
      <button
        type="button"
        className={`btn ${mode === "csv" ? "" : "secondary"}`}
        style={{ padding: "3px 10px", fontSize: 11.5 }}
        onClick={() => onChange("csv")}
      >
        {csvLabel}
      </button>
      <button
        type="button"
        className={`btn ${mode === "screenshot" ? "" : "secondary"}`}
        style={{ padding: "3px 10px", fontSize: 11.5 }}
        onClick={() => onChange("screenshot")}
      >
        Screenshot
      </button>
    </div>
  );
}

// Every score source gets its OWN explicit "where does this go" choice --
// no source is hardcoded to Assignments or Exams anymore. This is what a
// Kuta Works upload silently landing in Exams (when it was actually this
// week's Assignments) was actually missing: the destination was assumed
// by the code instead of chosen by the teacher every time.
function DestinationToggle({ value, onChange }) {
  return (
    <div className="row" style={{ gap: 6, marginTop: 8 }}>
      <span className="muted" style={{ fontSize: 11.5, alignSelf: "center" }}>
        Counts toward:
      </span>
      <button
        type="button"
        className={`btn ${value === "ixl_avg" ? "" : "secondary"}`}
        style={{ padding: "3px 10px", fontSize: 11.5 }}
        onClick={() => onChange("ixl_avg")}
      >
        Assignments
      </button>
      <button
        type="button"
        className={`btn ${value === "exam_score" ? "" : "secondary"}`}
        style={{ padding: "3px 10px", fontSize: 11.5 }}
        onClick={() => onChange("exam_score")}
      >
        Exams
      </button>
    </div>
  );
}

function UnmatchedNameRow({ entry, students, busy, onResolve }) {
  const bestCandidateId = entry.candidates?.[0]?.score > 0.4 ? entry.candidates[0].id : "";
  const [pick, setPick] = useState(bestCandidateId);

  return (
    <div style={{ marginBottom: 8 }}>
      <div className="row" style={{ gap: 10 }}>
        <span style={{ fontSize: 13.5, minWidth: 130 }}>
          <span className="muted" style={{ fontSize: 11 }}>{entry.source}:</span> {entry.rawName}
        </span>
        <select value={pick} onChange={(e) => setPick(e.target.value)} style={{ minWidth: 180 }}>
          <option value="">— Not on this roster / skip —</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn secondary" onClick={() => onResolve(pick)} disabled={!pick || busy}>
          {busy ? "Saving…" : "Save & Remember"}
        </button>
      </div>
      {entry.hint && (
        <p className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>
          {entry.hint} This is remembered by their Formative account, not just this name — it'll
          keep matching even if the display name changes later.
        </p>
      )}
    </div>
  );
}
