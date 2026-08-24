import { Fragment, useEffect, useState } from "react";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";
import { PROGRAM_CATALOG } from "../lib/programCatalog";
import { parseRegistrationSheet, matchToGroups } from "../lib/importRoster";
import { downloadCsv } from "../lib/csv";
import RowMenu from "../components/RowMenu";

const DAY_ORDER = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Prefers the real `meets_day` field (set by "Load My Programs," or by
// hand in Group Settings) so single-session courses with no day in their
// name (Level 7, Algebra 2, ...) sort correctly too -- only falls back to
// reading the name's day suffix for an older Level created before this
// field existed.
function dayOf(group) {
  const day = group.meets_day || (group.name.trim().match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/) || [])[1];
  return day ? DAY_ORDER[day] : 8; // no day found sorts last
}

function sortGroups(groups, mode) {
  const copy = [...groups];
  if (mode === "name") {
    copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } else if (mode === "day") {
    copy.sort((a, b) => dayOf(a) - dayOf(b) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  }
  // "created" = leave as-is (already ordered by created_at from the query)
  return copy;
}

export default function Roster() {
  const { students, sessions, groups, groupId, reload, reloadGroups, selectGroup } = useGroup();
  const group = groups.find((g) => g.id === groupId);

  const [name, setName] = useState("");
  const [team, setTeam] = useState("A");
  const [sessionId, setSessionId] = useState("");
  const [newGroupName, setNewGroupName] = useState("");
  const [newSessionLabel, setNewSessionLabel] = useState("");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editingName, setEditingName] = useState("");
  const [movingId, setMovingId] = useState(null);
  const [moveTarget, setMoveTarget] = useState("");
  const [moveBusy, setMoveBusy] = useState(false);
  const [pinBusyId, setPinBusyId] = useState(null);
  const [loadingPrograms, setLoadingPrograms] = useState(false);
  const [levelCounts, setLevelCounts] = useState({}); // { [groupId]: activeStudentCount }

  // Counts every active student per Level, across the whole business --
  // separate from `students` (which context scopes to just the currently
  // selected Level) so these numbers show up next to every Level button
  // at once, for cross-checking an import against the source sheet.
  useEffect(() => {
    if (groups.length === 0) return;
    supabase
      .from("students")
      .select("group_id, active")
      .in("group_id", groups.map((g) => g.id))
      .then(({ data }) => {
        const counts = {};
        (data || []).forEach((s) => {
          if (!s.active) return;
          counts[s.group_id] = (counts[s.group_id] || 0) + 1;
        });
        setLevelCounts(counts);
      });
  }, [groups, students]);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importResult, setImportResult] = useState(null); // { added, skippedExisting, unmatchedLevels, skippedInactive }
  const [levelSort, setLevelSort] = useState("name"); // "name" | "day" | "created"
  const [error, setError] = useState("");

  const [goalLabel, setGoalLabel] = useState("");
  const [levelName, setLevelName] = useState("");
  const [meetsDay, setMeetsDay] = useState("");
  const [goalPoints, setGoalPoints] = useState(1000);
  const [teacherContact, setTeacherContact] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);

  useEffect(() => {
    if (group) {
      setLevelName(group.name || "");
      setMeetsDay(group.meets_day || "");
      setGoalLabel(group.goal_label || "Class Goal");
      setGoalPoints(group.goal_points || 1000);
      setTeacherContact(group.teacher_contact || "");
    }
  }, [group?.id]);

  async function addStudent(e) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const duplicate = students.find(
      (s) => s.active && s.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      const proceed = confirm(
        `"${trimmed}" is already on the active roster. Add another student with the same name anyway?`
      );
      if (!proceed) return;
    }

    const { error } = await supabase
      .from("students")
      .insert({ group_id: groupId, name: trimmed, team, session_id: sessionId || null });
    if (error) setError(error.message);
    else {
      setName("");
      await reload();
    }
  }

  async function toggleActive(student) {
    await supabase.from("students").update({ active: !student.active }).eq("id", student.id);
    await reload();
  }

  async function changeTeam(student, newTeam) {
    await supabase.from("students").update({ team: newTeam }).eq("id", student.id);
    await reload();
  }

  async function changeSession(student, newSessionId) {
    await supabase.from("students").update({ session_id: newSessionId || null }).eq("id", student.id);
    await reload();
  }

  function startEdit(student) {
    setEditingId(student.id);
    setEditingName(student.name);
  }

  async function saveEdit(student) {
    if (editingName.trim() && editingName.trim() !== student.name) {
      await supabase.from("students").update({ name: editingName.trim() }).eq("id", student.id);
      await reload();
    }
    setEditingId(null);
  }

  async function deleteStudent(student) {
    if (
      !confirm(
        `Permanently delete ${student.name}? This also removes their saved weekly scores. Archiving is usually safer — use that if you just want to hide them.`
      )
    ) {
      return;
    }
    await supabase.from("students").delete().eq("id", student.id);
    await reload();
  }

  function startMove(student) {
    setMovingId(student.id);
    setMoveTarget("");
  }

  function cancelMove() {
    setMovingId(null);
    setMoveTarget("");
  }

  // Reassigns a student to a different Level. Their scoring history stays
  // exactly where it is (tied to the old Level's weeks) -- it just stops
  // showing up anywhere once they've moved, since every view only ever
  // looks at entries belonging to the currently selected Level's weeks.
  // Nothing is deleted, so nothing is lost if this turns out to be the
  // wrong call -- moving them back restores the same clean-break behavior
  // in reverse. Their parent/student links and interests move with them
  // (those live on the student record itself, not tied to a Level).
  async function confirmMove(student) {
    if (!moveTarget) return;
    setMoveBusy(true);
    try {
      await supabase.from("students").update({ group_id: moveTarget, session_id: null }).eq("id", student.id);
      await reload();
      setMovingId(null);
      setMoveTarget("");
    } finally {
      setMoveBusy(false);
    }
  }

  async function copyParentLink(student) {
    setError("");
    try {
      const res = await fetch("/.netlify/functions/get-parent-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not fetch parent link.");
      const url = `${window.location.origin}/parent/${data.token}`;
      try {
        await navigator.clipboard.writeText(url);
        alert(`Parent link copied for ${student.name}.`);
      } catch {
        prompt("Copy this link:", url);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  // "Click a button and it's basically sent" without standing up a real
  // email-sending service: this fetches both tokens, then hands off to
  // whatever email program is already set up on this computer via a
  // mailto: link, pre-addressed and pre-filled -- one more click (the
  // Send button in that program) finishes it. No new account, no API
  // key, no per-email cost or sending limit to think about. A real
  // one-click *send* (no second click in another program) would need an
  // actual transactional email service wired up server-side -- a bigger,
  // separate piece of infrastructure, happy to build that instead if
  // the extra click is ever the part that bothers you.
  async function sendLinksByEmail(student) {
    if (!student.parent_email) {
      alert(`No parent email on file for ${student.name} yet. Add one in "Edit Student", or re-paste the registration sheet if it has one for them.`);
      return;
    }
    setError("");
    try {
      const [studentRes, parentRes] = await Promise.all([
        fetch("/.netlify/functions/get-student-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: student.id }),
        }),
        fetch("/.netlify/functions/get-parent-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentId: student.id }),
        }),
      ]);
      const studentData = await studentRes.json();
      const parentData = await parentRes.json();
      if (!studentRes.ok) throw new Error(studentData.error || "Could not fetch student link.");
      if (!parentRes.ok) throw new Error(parentData.error || "Could not fetch parent link.");

      const origin = window.location.origin;
      const studentUrl = `${origin}/student/${studentData.token}`;
      const parentUrl = `${origin}/parent/${parentData.token}`;
      const subject = `EnrichMind links for ${student.name}`;
      const body =
        `Hi!\n\nHere are ${student.name}'s links for tracking progress and approving tasks:\n\n` +
        `${student.name}'s own progress page: ${studentUrl}\n\n` +
        `Your parent page (you'll set up a 4-digit PIN the first time you open it): ${parentUrl}\n\n` +
        `Thanks!`;
      window.location.href = `mailto:${student.parent_email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    } catch (e) {
      setError(e.message);
    }
  }

  async function copyStudentLink(student) {
    setError("");
    try {
      const res = await fetch("/.netlify/functions/get-student-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not fetch student link.");
      const url = `${window.location.origin}/student/${data.token}`;
      try {
        await navigator.clipboard.writeText(url);
        alert(`Student link copied for ${student.name}.`);
      } catch {
        prompt("Copy this link:", url);
      }
    } catch (e) {
      setError(e.message);
    }
  }

  async function resetStudentAccess(student) {
    if (!confirm(`Generate a new link for ${student.name}? Their old student link will stop working immediately.`)) return;
    setPinBusyId(student.id);
    setError("");
    try {
      const res = await fetch("/.netlify/functions/get-student-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, resetAccess: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reset student link.");
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setPinBusyId(null);
    }
  }

  async function resetParentAccess(student) {
    const already = student.parent_pin_set;
    const msg = already
      ? `Reset parent access for ${student.name}? Their current PIN stops working immediately, and the link will prompt for a brand-new one on next visit.`
      : `${student.name}'s parent hasn't set up their PIN yet — this just re-confirms the link is ready for them to do that. Continue?`;
    if (!confirm(msg)) return;
    setPinBusyId(student.id);
    setError("");
    try {
      const res = await fetch("/.netlify/functions/get-parent-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: student.id, resetAccess: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not reset parent access.");
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setPinBusyId(null);
    }
  }

  async function addGroup(e) {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    const { data, error } = await supabase
      .from("groups")
      .insert({ name: newGroupName.trim() })
      .select()
      .single();
    if (error) setError(error.message);
    else {
      setNewGroupName("");
      await reloadGroups();
      selectGroup(data.id);
    }
  }

  const [exportingLinks, setExportingLinks] = useState(false);

  // Bulk-generates every student's and parent's link at once, alongside
  // whatever parent email came through on import -- ready to drop into
  // a mail-merge tool instead of copying and sending 100+ links one at a
  // time via Roster's per-student "⋮" menu.
  async function exportAllLinks(scopeToCurrentLevel) {
    setExportingLinks(true);
    setError("");
    try {
      const res = await fetch("/.netlify/functions/bulk-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scopeToCurrentLevel ? { groupId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong.");

      const groupNameById = new Map(groups.map((g) => [g.id, g.name]));
      const origin = window.location.origin;
      const rows = data.students.map((s) => [
        s.name,
        groupNameById.get(s.group_id) || "",
        s.parent_email || "",
        `${origin}/student/${s.student_token}`,
        `${origin}/parent/${s.parent_token}`,
      ]);

      downloadCsv(
        scopeToCurrentLevel ? `${group?.name?.replace(/[^a-z0-9]+/gi, "_") || "level"}_links.csv` : "all_student_parent_links.csv",
        ["Student Name", "Level", "Parent Email", "Student Link", "Parent Link"],
        rows
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setExportingLinks(false);
    }
  }

  async function backfillMeetsDay() {
    setLoadingPrograms(true);
    setError("");
    try {
      const catalogByName = new Map(PROGRAM_CATALOG.map((p) => [p.name, p.day]));
      const toFix = groups.filter((g) => !g.meets_day && catalogByName.has(g.name));
      if (toFix.length === 0) {
        alert(
          "Nothing to fix — every Level either already has a day set, or has a custom name that doesn't match the known course catalog (set those by hand in that Level's Group Settings)."
        );
        return;
      }
      await Promise.all(
        toFix.map((g) => supabase.from("groups").update({ meets_day: catalogByName.get(g.name) }).eq("id", g.id))
      );
      await reloadGroups();
      alert(`Set the meeting day for ${toFix.length} Level${toFix.length === 1 ? "" : "s"}.`);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingPrograms(false);
    }
  }

  async function loadPrograms() {
    setLoadingPrograms(true);
    setError("");
    try {
      const existingNames = new Set(groups.map((g) => g.name));
      const toCreate = PROGRAM_CATALOG.filter((p) => !existingNames.has(p.name));
      if (toCreate.length === 0) {
        alert("All programs from enrichmindacademy.com/programs are already set up.");
        return;
      }
      const { error: groupErr } = await supabase
        .from("groups")
        .insert(toCreate.map((p) => ({ name: p.name, meets_day: p.day })));
      if (groupErr) throw groupErr;
      await reloadGroups();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingPrograms(false);
    }
  }

  // Bulk-adds students from a pasted copy of the registration Google
  // Sheet -- splits multi-course registrations across each Level they
  // belong to, skips anyone already rostered (safe to paste the same
  // sheet again after new signups come in), and reports back any Level
  // name it couldn't match so you know what to fix or create first.
  async function importFromSheet() {
    setImportBusy(true);
    setImportResult(null);
    setError("");
    try {
      const { students: parsedStudents, skippedInactive } = parseRegistrationSheet(importText);
      const { matched, unmatchedLevels } = matchToGroups(parsedStudents, groups);

      if (matched.length === 0) {
        setImportResult({ added: 0, skippedExisting: 0, unmatchedLevels, skippedInactive, total: 0 });
        return;
      }

      // Fetch existing students across EVERY Level, not just the ones
      // this batch is importing into -- a name match in some other,
      // unrelated Level is exactly the signal that a student switched
      // classes since they first registered, and needs to be caught
      // here specifically. Checking only the target Levels (like this
      // used to) would miss that entirely and silently create a
      // duplicate student in the new Level while a stale one sat
      // untouched in the old one.
      const { data: existing, error: existingErr } = await supabase
        .from("students")
        .select("id, group_id, name, parent_email, active");
      if (existingErr) throw existingErr;

      const existingByKey = new Map(
        (existing || []).map((s) => [`${s.group_id}::${s.name.trim().toLowerCase()}`, s])
      );
      const byNameAnywhere = new Map(); // name (lowercase) -> [students, possibly in several groups]
      (existing || []).forEach((s) => {
        const k = s.name.trim().toLowerCase();
        byNameAnywhere.set(k, [...(byNameAnywhere.get(k) || []), s]);
      });
      const groupNameById = new Map(groups.map((g) => [g.id, g.name]));

      // A student enrolled in more than one course at once (e.g. a Level
      // AND Competition Math, or a Level AND SAT Prep) shows up as
      // multiple separate entries in `matched` -- one per course. If
      // just ONE of those courses changes (they switch which Level 5
      // session they attend, say), their OTHER still-current enrollment
      // must not be mistaken for "a stale old class" just because it's
      // a different group than the one being checked -- it's confirmed
      // current by this very sheet. So: every group a name maps to
      // ANYWHERE in this import is that student's current set, and gets
      // excluded before asking "does this name exist somewhere stale?"
      const currentGroupsByName = new Map(); // name (lowercase) -> Set<groupId>
      matched.forEach(({ studentName, groupId: gId }) => {
        const k = studentName.trim().toLowerCase();
        if (!currentGroupsByName.has(k)) currentGroupsByName.set(k, new Set());
        currentGroupsByName.get(k).add(gId);
      });

      const seenThisImport = new Set();
      const toInsert = [];
      const emailBackfills = []; // { id, parent_email } -- already-rostered students missing an email
      const possibleChanges = []; // { studentId, name, oldGroupId, oldGroupName, newGroupId, newGroupName }
      const ambiguousNames = new Set(); // same name in 2+ other Levels -- can't safely guess which one moved

      matched.forEach(({ studentName, groupId: gId, parentEmail }) => {
        const key = `${gId}::${studentName.trim().toLowerCase()}`;
        const existingStudent = existingByKey.get(key);
        if (existingStudent) {
          // Already correctly rostered here -- leave everything else
          // about them alone, but if the sheet has an email and they
          // don't have one on file yet, this is the one field worth
          // catching up. Never overwrites an email that's already set,
          // in case it was corrected by hand since the last import.
          if (parentEmail && !existingStudent.parent_email) {
            emailBackfills.push({ id: existingStudent.id, parent_email: parentEmail });
          }
          return;
        }
        if (seenThisImport.has(key)) return;

        // Not rostered in the target Level under this exact name -- but
        // does that name already exist somewhere genuinely stale (not
        // one of their OTHER current, still-valid concurrent
        // enrollments per this same sheet)? If so, this is very likely
        // the same student having switched just this one class, not a
        // brand-new enrollment.
        const nameKey = studentName.trim().toLowerCase();
        const currentGroups = currentGroupsByName.get(nameKey) || new Set();
        const elsewhere = (byNameAnywhere.get(nameKey) || []).filter(
          (s) => s.active && !currentGroups.has(s.group_id)
        );
        if (elsewhere.length === 1) {
          possibleChanges.push({
            studentId: elsewhere[0].id,
            name: studentName,
            oldGroupId: elsewhere[0].group_id,
            oldGroupName: groupNameById.get(elsewhere[0].group_id) || "Unknown Level",
            newGroupId: gId,
            newGroupName: groupNameById.get(gId) || "Unknown Level",
          });
          return;
        }
        if (elsewhere.length > 1) {
          // Same name active in more than one other Level already --
          // too ambiguous to guess which one is the real match, so this
          // falls through to being added as a new student below rather
          // than risk moving the wrong one. Flagged in the results so
          // it doesn't pass unnoticed.
          ambiguousNames.add(studentName);
        }

        seenThisImport.add(key);
        toInsert.push({ group_id: gId, name: studentName.trim(), team: "A", active: true, parent_email: parentEmail || null });
      });

      if (toInsert.length > 0) {
        const { error: insertErr } = await supabase.from("students").insert(toInsert);
        if (insertErr) throw insertErr;
      }

      if (emailBackfills.length > 0) {
        await Promise.all(
          emailBackfills.map((b) => supabase.from("students").update({ parent_email: b.parent_email }).eq("id", b.id))
        );
      }

      await reload();
      setImportResult({
        added: toInsert.length,
        skippedExisting: matched.length - toInsert.length - emailBackfills.length - possibleChanges.length,
        emailsBackfilled: emailBackfills.length,
        possibleChanges,
        ambiguousNames: Array.from(ambiguousNames),
        unmatchedLevels,
        skippedInactive,
        total: matched.length,
      });
      setImportText("");
    } catch (e) {
      setError(e.message);
    } finally {
      setImportBusy(false);
    }
  }

  // Applies one detected "this looks like a class change, not a new
  // student" from the import results -- same underlying action as
  // "Move to Another Level" elsewhere in Roster, just triggered from the
  // review list instead of a student's own row.
  async function confirmLevelChange(change) {
    await supabase.from("students").update({ group_id: change.newGroupId, session_id: null }).eq("id", change.studentId);
    await reload();
    setImportResult((prev) =>
      prev ? { ...prev, possibleChanges: prev.possibleChanges.filter((c) => c.studentId !== change.studentId) } : prev
    );
  }

  function dismissLevelChange(change) {
    // "No, that's actually a different student with the same name" --
    // leaves both students exactly where they are, just removes this
    // one from the review list.
    setImportResult((prev) =>
      prev ? { ...prev, possibleChanges: prev.possibleChanges.filter((c) => c.studentId !== change.studentId) } : prev
    );
  }

  async function deleteLevel() {
    if (!group) return;
    if (
      !confirm(
        `Permanently delete "${group.name}"? This removes its roster, weeks, scores, tasks — everything under this level. This cannot be undone.`
      )
    )
      return;
    if (!confirm(`Really delete "${group.name}" and all its data? Last check.`)) return;
    const { error } = await supabase.from("groups").delete().eq("id", group.id);
    if (error) setError(error.message);
    else {
      await reloadGroups();
      selectGroup(groups.find((g) => g.id !== group.id)?.id || "");
    }
  }

  async function addSession(e) {
    e.preventDefault();
    if (!newSessionLabel.trim()) return;
    const { error } = await supabase.from("sessions").insert({ group_id: groupId, label: newSessionLabel.trim() });
    if (error) setError(error.message);
    else {
      setNewSessionLabel("");
      await reload();
    }
  }

  async function deleteSession(session) {
    if (
      !confirm(
        `Remove the "${session.label}" session? Students assigned to it will just lose that label — they stay on the roster.`
      )
    )
      return;
    await supabase.from("sessions").delete().eq("id", session.id);
    await reload();
  }

  async function saveSettings(e) {
    e.preventDefault();
    const trimmedName = levelName.trim();
    if (!trimmedName) {
      setError("Level name can't be empty.");
      return;
    }
    setSettingsSaving(true);
    setSettingsSaved(false);
    setError("");
    const { error } = await supabase
      .from("groups")
      .update({
        name: trimmedName,
        meets_day: meetsDay || null,
        goal_label: goalLabel,
        goal_points: Number(goalPoints),
        teacher_contact: teacherContact,
      })
      .eq("id", groupId);
    if (error) setError(error.message);
    else {
      await reloadGroups();
      setSettingsSaved(true);
    }
    setSettingsSaving(false);
  }

  const filtered = students
    .filter((s) => s.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));

  return (
    <>
      <div className="card">
        <div className="card-title">Levels</div>
        {groups.length === 0 && (
          <p className="muted" style={{ marginBottom: 12 }}>
            No levels yet. Load your real course catalog in one click, or add one manually below.
          </p>
        )}
        <div className="row" style={{ marginBottom: 14 }}>
          <button className="btn secondary" onClick={loadPrograms} disabled={loadingPrograms}>
            {loadingPrograms ? "Loading…" : "Load My Programs"}
          </button>
          {groups.length > 0 && (
            <button className="btn secondary" onClick={backfillMeetsDay} disabled={loadingPrograms}>
              Fix Missing Days
            </button>
          )}
          <span className="muted" style={{ fontSize: 12 }}>
            Pulls your real course catalog from enrichmindacademy.com/programs — creates
            each as a Level. A course that meets twice a week (e.g. Level 5) becomes two
            fully separate Levels, one per day (e.g. "Level 5 Mon" and "Level 5 Fri").
            {groups.length > 0 && (
              <> "Fix Missing Days" sets the meeting day on any existing Level that's missing
              one but matches a known course name — a one-time cleanup if you loaded your
              Levels before this feature existed.</>
            )}
          </span>
        </div>
        {groups.length > 0 && (
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn secondary" onClick={() => exportAllLinks(false)} disabled={exportingLinks}>
              {exportingLinks ? "Exporting…" : "Export All Links (every Level)"}
            </button>
            <button className="btn secondary" onClick={() => exportAllLinks(true)} disabled={exportingLinks || !groupId}>
              {exportingLinks ? "Exporting…" : `Export Links (${group?.name || "this Level"} only)`}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              Downloads a CSV -- Student Name, Level, Parent Email (if captured during import),
              Student Link, Parent Link -- ready for a mail-merge tool instead of copying each
              student's link one at a time from their "⋮" menu below.
            </span>
          </div>
        )}
        {groups.length > 0 && (
          <>
            <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
              <span className="muted" style={{ fontSize: 12 }}>Sort by</span>
              <nav className="tabs">
                {[
                  { key: "name", label: "Name" },
                  { key: "day", label: "Day" },
                  { key: "created", label: "Date Added" },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    className={levelSort === opt.key ? "active" : ""}
                    onClick={() => setLevelSort(opt.key)}
                  >
                    {opt.label}
                  </button>
                ))}
              </nav>
            </div>
            <div className="row" style={{ marginBottom: 10, justifyContent: "space-between" }}>
              <span className="muted" style={{ fontSize: 12 }}>
                Total across every Level:{" "}
                <strong style={{ color: "var(--text-hi)" }}>
                  {Object.values(levelCounts).reduce((a, b) => a + b, 0)} students
                </strong>
              </span>
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              {sortGroups(groups, levelSort).map((g) => (
                <button
                  key={g.id}
                  className={`btn ${g.id === groupId ? "" : "secondary"}`}
                  onClick={() => selectGroup(g.id)}
                >
                  {g.name} <span style={{ opacity: 0.7 }}>({levelCounts[g.id] || 0})</span>
                </button>
              ))}
            </div>
          </>
        )}
        <form onSubmit={addGroup} className="row">
          <input
            placeholder="Add one manually (e.g. Level 3)"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
          />
          <button className="btn secondary" type="submit">
            + Add Level
          </button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="card">
        <div className="card-title">Import Students from Registration Sheet</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Copy the rows from your registration Google Sheet (including the header row) and
          paste them below — needs at least the <strong>Student Name</strong>,{" "}
          <strong>Courses</strong>, <strong>Sections</strong>, and <strong>Status</strong>{" "}
          columns. A student signed up for more than one course (Courses/Sections joined with
          "+") gets added to each matching Level. Safe to paste the same sheet again later —
          anyone already rostered is skipped (except if the sheet has a parent email they're
          currently missing on file, which gets filled in — nothing else about an existing
          student is ever touched by re-pasting). Levels must already exist (use{" "}
          <strong>Load My Programs</strong> above first) — a name that doesn't match an existing
          Level is reported back, not silently dropped. Want this to happen automatically
          whenever someone new registers, with no copy-paste at all? See the "Automatic sync"
          setup in the README (`netlify/functions/sheet-sync.js`) — this manual box still works
          fine either way, e.g. for a one-time backfill or if you'd rather stay in control of
          when it runs.
        </p>
        <textarea
          rows={5}
          style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
          placeholder="Paste rows copied from the registration sheet here…"
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={importFromSheet} disabled={importBusy || !importText.trim()}>
            {importBusy ? "Importing…" : "Import Students"}
          </button>
        </div>
        {importResult && (
          <div style={{ marginTop: 12 }}>
            <p style={{ margin: 0 }}>
              ✅ Added <strong>{importResult.added}</strong> student
              {importResult.added === 1 ? "" : "s"}
              {importResult.emailsBackfilled > 0 &&
                ` — filled in a missing parent email for ${importResult.emailsBackfilled} existing student${importResult.emailsBackfilled === 1 ? "" : "s"}`}
              {importResult.skippedExisting > 0 && ` (${importResult.skippedExisting} already rostered, skipped)`}
              {importResult.skippedInactive > 0 && ` — ${importResult.skippedInactive} inactive registration${importResult.skippedInactive === 1 ? "" : "s"} skipped`}
              .
            </p>
            {importResult.possibleChanges && importResult.possibleChanges.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <span className="match-badge match-unsure">Possible class changes — review these</span>
                <p className="muted" style={{ marginTop: 4, marginBottom: 8 }}>
                  These names weren't found in the Level the sheet now lists, but the same name
                  already exists in a different Level — most likely the same student switched
                  classes, rather than a new enrollment. Nothing has been changed yet.
                </p>
                {importResult.possibleChanges.map((c) => (
                  <div key={c.studentId} className="leader-row" style={{ marginBottom: 6 }}>
                    <div className="leader-name">
                      {c.name}: {c.oldGroupName} → {c.newGroupName}
                    </div>
                    <button className="btn secondary" onClick={() => confirmLevelChange(c)}>
                      Move
                    </button>
                    <button className="btn secondary" onClick={() => dismissLevelChange(c)}>
                      Not the same student
                    </button>
                  </div>
                ))}
              </div>
            )}
            {importResult.ambiguousNames && importResult.ambiguousNames.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <span className="match-badge match-unsure">Needs a manual look</span>
                <p className="muted" style={{ marginTop: 4 }}>
                  These names already exist active in more than one other Level, so it wasn't
                  safe to guess which one really moved — they were added as new students
                  instead. Check Roster for possible duplicates: {importResult.ambiguousNames.join(", ")}
                </p>
              </div>
            )}
            {importResult.unmatchedLevels.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <span className="match-badge match-unsure">Needs attention</span>
                <p className="muted" style={{ marginTop: 4 }}>
                  These Level names from the sheet didn't match anything in your Levels list —
                  create them (check spelling against "Load My Programs") and re-paste to pick
                  up just those students:
                </p>
                <ul style={{ margin: "4px 0 0 18px", fontSize: 13 }}>
                  {importResult.unmatchedLevels.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {group && (
        <div className="card">
          <div className="card-title">Sessions in {group.name}</div>
          <p className="muted" style={{ marginBottom: 10 }}>
            If this level meets more than once a week, add each meeting time here.
            Students can attend either session — the leaderboard always stays one
            combined ranking for the whole level.
          </p>
          <div className="row" style={{ marginBottom: 10, flexWrap: "wrap" }}>
            {sessions.length === 0 && <span className="muted">No sessions added — single session.</span>}
            {sessions.map((s) => (
              <span key={s.id} className="pill" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {s.label}
                <button className="btn danger" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => deleteSession(s)}>
                  ×
                </button>
              </span>
            ))}
          </div>
          <form onSubmit={addSession} className="row">
            <input placeholder="e.g. Tue 4:00pm" value={newSessionLabel} onChange={(e) => setNewSessionLabel(e.target.value)} />
            <button className="btn secondary" type="submit">
              + Add Session
            </button>
          </form>
        </div>
      )}

      {group && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {group.name} Settings
            </div>
            <button className="btn danger" style={{ fontSize: 12, padding: "6px 12px" }} onClick={deleteLevel}>
              Delete This Level
            </button>
          </div>
          <form onSubmit={saveSettings} className="row" style={{ flexWrap: "wrap" }}>
            <div>
              <label className="muted">Level name</label>
              <br />
              <input value={levelName} onChange={(e) => setLevelName(e.target.value)} style={{ width: 180 }} />
            </div>
            <div>
              <label className="muted">Meets on</label>
              <br />
              <select value={meetsDay} onChange={(e) => setMeetsDay(e.target.value)}>
                <option value="">— not set —</option>
                <option value="Mon">Monday</option>
                <option value="Tue">Tuesday</option>
                <option value="Wed">Wednesday</option>
                <option value="Thu">Thursday</option>
                <option value="Fri">Friday</option>
                <option value="Sat">Saturday</option>
                <option value="Sun">Sunday</option>
              </select>
            </div>
            <div>
              <label className="muted">Goal label</label>
              <br />
              <input value={goalLabel} onChange={(e) => setGoalLabel(e.target.value)} />
            </div>
            <div>
              <label className="muted">Goal points (per team)</label>
              <br />
              <input type="number" value={goalPoints} onChange={(e) => setGoalPoints(e.target.value)} style={{ width: 100 }} />
            </div>
            <div>
              <label className="muted">Your contact (shown if a parent forgets their PIN)</label>
              <br />
              <input
                placeholder="e.g. support@enrichmindacademy.com"
                value={teacherContact}
                onChange={(e) => setTeacherContact(e.target.value)}
                style={{ width: 220 }}
              />
            </div>
            <div style={{ alignSelf: "flex-end" }}>
              <button className="btn" type="submit" disabled={settingsSaving}>
                {settingsSaving ? "Saving…" : "Save Settings"}
              </button>
            </div>
          </form>
          {settingsSaved && <p className="muted" style={{ marginTop: 8 }}>Saved.</p>}
        </div>
      )}

      {group && (
        <div className="card">
          <div className="card-title">Add Student</div>
          <form onSubmit={addStudent} className="row">
            <input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
            <select value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="A">Team A</option>
              <option value="B">Team B</option>
            </select>
            {sessions.length > 0 && (
              <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                <option value="">No usual session</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            )}
            <button className="btn" type="submit">
              + Add
            </button>
          </form>
        </div>
      )}

      {group && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {group.name} Roster ({students.filter((s) => s.active).length} active)
            </div>
            <input placeholder="Search students…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {filtered.map((s) => (
            <Fragment key={s.id}>
              <div className="leader-row">
                {editingId === s.id ? (
                  <input
                    className="leader-name"
                    value={editingName}
                    autoFocus
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => saveEdit(s)}
                    onKeyDown={(e) => e.key === "Enter" && saveEdit(s)}
                  />
                ) : (
                  <div
                    className="leader-name"
                    style={{ opacity: s.active ? 1 : 0.5, cursor: "pointer" }}
                    onClick={() => startEdit(s)}
                    title="Click to rename"
                  >
                    {s.name} {!s.active && "(archived)"}
                  </div>
                )}
                {sessions.length > 0 && (
                  <select value={s.session_id || ""} onChange={(e) => changeSession(s, e.target.value)}>
                    <option value="">No usual session</option>
                    {sessions.map((sess) => (
                      <option key={sess.id} value={sess.id}>
                        {sess.label}
                      </option>
                    ))}
                  </select>
                )}
                <select value={s.team} onChange={(e) => changeTeam(s, e.target.value)}>
                  <option value="A">Team A</option>
                  <option value="B">Team B</option>
                </select>
                <span
                  className="pill"
                  title={
                    s.parent_pin_set
                      ? "The parent has already set up their own PIN"
                      : "This student's link will prompt whoever opens it to create a PIN — no need to share one yourself"
                  }
                >
                  {s.parent_pin_set ? "Parent set up" : "Parent pending"}
                </span>
                <button className="btn secondary" onClick={() => toggleActive(s)}>
                  {s.active ? "Archive" : "Restore"}
                </button>
                <RowMenu
                  items={[
                    { label: "Copy Student Link", onClick: () => copyStudentLink(s) },
                    { label: "Reset Student Link", onClick: () => resetStudentAccess(s), disabled: pinBusyId === s.id },
                    { label: "Copy Parent Link", onClick: () => copyParentLink(s) },
                    { label: "Reset Parent Access", onClick: () => resetParentAccess(s), disabled: pinBusyId === s.id },
                    { label: "Send Both Links by Email", onClick: () => sendLinksByEmail(s) },
                    { label: "Move to Another Level", onClick: () => startMove(s) },
                    { label: "Delete Student", onClick: () => deleteStudent(s), danger: true },
                  ]}
                />
              </div>
              {movingId === s.id && (
                <div className="reason-picker" style={{ marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                    Move <strong>{s.name}</strong> to a different Level. Their scores and
                    history stay attached to {group?.name} and simply stop showing up once
                    they've moved — nothing is deleted, and moving them back undoes it the
                    same way.
                  </div>
                  <div className="row" style={{ gap: 8 }}>
                    <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
                      <option value="">Choose a Level…</option>
                      {groups
                        .filter((g) => g.id !== s.group_id)
                        .map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                    </select>
                    <button className="btn" disabled={!moveTarget || moveBusy} onClick={() => confirmMove(s)}>
                      {moveBusy ? "Moving…" : "Move"}
                    </button>
                    <button className="btn secondary" onClick={cancelMove}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Fragment>
          ))}
          {filtered.length === 0 && <p className="muted">No students match "{search}".</p>}
        </div>
      )}
    </>
  );
}
