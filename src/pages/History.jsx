import { useState, useEffect } from "react";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";
import { downloadCsv } from "../lib/csv";
import ClassWeeklyGrid from "../components/ClassWeeklyGrid";

const MULTIPLIER_OPTIONS = [1, 1.5, 2];

export default function History() {
  const { weeks, students, entriesByWeek, reload, groups, groupId } = useGroup();
  const group = groups.find((g) => g.id === groupId);
  const sortedWeeks = [...weeks].sort((a, b) => new Date(b.date) - new Date(a.date));
  const [weekId, setWeekId] = useState(sortedWeeks[0]?.id || "");
  const activeWeekId = weekId || sortedWeeks[0]?.id;
  const week = weeks.find((w) => w.id === activeWeekId);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(null); // { skills_assigned, bonus_multiplier, entries: { [studentId]: {...} } }
  const [addStudentId, setAddStudentId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [gridView, setGridView] = useState(false); // false = single week (existing), true = all-weeks grid

  const [catchUpStudentId, setCatchUpStudentId] = useState("");
  const [catchUpDrafts, setCatchUpDrafts] = useState({}); // { [weekId]: {stars, ixl_avg, ...} }
  const [catchUpSaving, setCatchUpSaving] = useState(false);
  const [catchUpSaved, setCatchUpSaved] = useState(false);
  const catchUpWeeks = [...weeks].sort((a, b) => new Date(a.date) - new Date(b.date));

  const [editLog, setEditLog] = useState([]);
  const [editLogLoading, setEditLogLoading] = useState(false);

  useEffect(() => {
    if (!activeWeekId) {
      setEditLog([]);
      return;
    }
    setEditLogLoading(true);
    supabase
      .from("entry_edit_log")
      .select("*")
      .eq("week_id", activeWeekId)
      .order("changed_at", { ascending: false })
      .then(({ data }) => {
        setEditLog(data || []);
        setEditLogLoading(false);
      });
  }, [activeWeekId]);

  const FIELD_LABELS = {
    classpoint_stars: "Participation",
    ixl_avg: "Assignments",
    notebooking_score: "Notebooking",
    study_guide_score: "Study Guide",
    exam_score: "Exams",
    exam_corrections_score: "Exam Corrections",
    bonus: "Bonus",
    bonus_note: "Bonus Note",
  };

  // Only the fields a parent or you would actually recognize as "the
  // score" get compared -- id/created_at/total (a generated column) are
  // skipped since they either never meaningfully change or change as a
  // side effect of something already shown in the diff.
  function diffEntry(oldVals, newVals) {
    return Object.keys(FIELD_LABELS)
      .filter((key) => JSON.stringify(oldVals?.[key]) !== JSON.stringify(newVals?.[key]))
      .map((key) => ({
        label: FIELD_LABELS[key],
        from: oldVals?.[key],
        to: newVals?.[key],
      }));
  }

  function startCatchUp(studentId) {
    setCatchUpStudentId(studentId);
    setCatchUpSaved(false);
    const drafts = {};
    catchUpWeeks.forEach((w) => {
      const e = entriesByWeek[w.id]?.[studentId];
      drafts[w.id] = {
        stars: e?.classpoint_stars ?? 0,
        ixl_avg: e?.ixl_avg ?? 0,
        notebooking_score: e?.notebooking_score ?? 0,
        study_guide_score: e?.study_guide_score ?? 0,
        exam_score: e?.exam_score ?? 0,
        exam_corrections_score: e?.exam_corrections_score ?? 0,
        bonus: e?.bonus ?? 0,
      };
    });
    setCatchUpDrafts(drafts);
  }

  function updateCatchUp(weekId, field, value) {
    setCatchUpDrafts((prev) => ({
      ...prev,
      [weekId]: { ...prev[weekId], [field]: Number(value) },
    }));
  }

  async function saveCatchUp() {
    if (!catchUpStudentId) return;
    setCatchUpSaving(true);
    setError("");
    try {
      // Same targeted-upsert approach as everywhere else scores are saved:
      // only the six score columns are included per row, so a catch-up
      // update never touches that week's bonus note, goal, or anything
      // belonging to a different student.
      const upserts = catchUpWeeks.map((w) => ({
        week_id: w.id,
        student_id: catchUpStudentId,
        ...catchUpDrafts[w.id],
      }));
      const { error: upsertErr } = await supabase
        .from("entries")
        .upsert(upserts, { onConflict: "week_id,student_id" });
      if (upsertErr) throw upsertErr;
      await reload();
      setCatchUpSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setCatchUpSaving(false);
    }
  }

  const rows = students
    .map((s) => ({ student: s, entry: entriesByWeek[activeWeekId]?.[s.id] }))
    .filter((r) => r.entry)
    .sort((a, b) => Number(b.entry.total) - Number(a.entry.total));

  const studentsWithoutEntry = students.filter((s) => s.active && !entriesByWeek[activeWeekId]?.[s.id]);

  function startEdit() {
    const entryDraft = {};
    rows.forEach((r) => {
      entryDraft[r.student.id] = {
        stars: r.entry.classpoint_stars,
        ixl_avg: r.entry.ixl_avg,
        notebooking_score: r.entry.notebooking_score || 0,
        study_guide_score: r.entry.study_guide_score || 0,
        exam_score: r.entry.exam_score || 0,
        exam_corrections_score: r.entry.exam_corrections_score || 0,
        bonus: r.entry.bonus,
        note: r.entry.bonus_note || "",
      };
    });
    setDraft({
      skills_assigned: week?.skills_assigned || "",
      bonus_multiplier: Number(week?.bonus_multiplier) || 1,
      entries: entryDraft,
    });
    setEditing(true);
  }

  function updateDraftEntry(studentId, field, value) {
    setDraft((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [studentId]: { ...prev.entries[studentId], [field]: Number(value) },
      },
    }));
  }

  function updateDraftNote(studentId, value) {
    setDraft((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [studentId]: { ...prev.entries[studentId], note: value },
      },
    }));
  }

  function addRowToDraft() {
    if (!addStudentId) return;
    setDraft((prev) => ({
      ...prev,
      entries: {
        ...prev.entries,
        [addStudentId]: {
          stars: 0,
          ixl_avg: 0,
          notebooking_score: 0,
          study_guide_score: 0,
          exam_score: 0,
          exam_corrections_score: 0,
          bonus: 0,
          note: "",
        },
      },
    }));
    setAddStudentId("");
  }

  async function saveEdits() {
    setSaving(true);
    setError("");
    try {
      await supabase
        .from("weeks")
        .update({
          skills_assigned: draft.skills_assigned,
          bonus_multiplier: draft.bonus_multiplier,
        })
        .eq("id", activeWeekId);

      const upserts = Object.entries(draft.entries).map(([studentId, v]) => ({
        week_id: activeWeekId,
        student_id: studentId,
        classpoint_stars: v.stars,
        ixl_avg: v.ixl_avg,
        notebooking_score: v.notebooking_score,
        study_guide_score: v.study_guide_score,
        exam_score: v.exam_score,
        exam_corrections_score: v.exam_corrections_score,
        bonus: v.bonus,
        bonus_note: v.note?.trim() || null,
      }));

      const { error: upsertErr } = await supabase
        .from("entries")
        .upsert(upserts, { onConflict: "week_id,student_id" });
      if (upsertErr) throw upsertErr;

      setEditing(false);
      setDraft(null);
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function exportWeekCsv() {
    downloadCsv(
      `${week.label.replace(/[^a-z0-9]+/gi, "_")}.csv`,
      ["Student", "Participation Stars", "Assignments", "Notebooking", "Study Guide", "Exams", "Exam Corrections", "Bonus", "Total"],
      rows.map((r) => [
        r.student.name,
        r.entry.classpoint_stars,
        Number(r.entry.ixl_avg).toFixed(1),
        Number(r.entry.notebooking_score || 0).toFixed(1),
        Number(r.entry.study_guide_score || 0).toFixed(1),
        Number(r.entry.exam_score || 0).toFixed(1),
        Number(r.entry.exam_corrections_score || 0).toFixed(1),
        Number(r.entry.bonus).toFixed(1),
        Number(r.entry.total).toFixed(1),
      ])
    );
  }

  function exportAllHistoryCsv() {
    const allRows = [];
    weeks.forEach((w) => {
      students.forEach((s) => {
        const e = entriesByWeek[w.id]?.[s.id];
        if (!e) return;
        allRows.push([
          w.label,
          w.date,
          s.name,
          e.classpoint_stars,
          Number(e.ixl_avg).toFixed(1),
          Number(e.notebooking_score || 0).toFixed(1),
          Number(e.study_guide_score || 0).toFixed(1),
          Number(e.exam_score || 0).toFixed(1),
          Number(e.exam_corrections_score || 0).toFixed(1),
          Number(e.bonus).toFixed(1),
          Number(e.total).toFixed(1),
          w.bonus_multiplier || 1,
        ]);
      });
    });
    downloadCsv(
      `${group?.name?.replace(/[^a-z0-9]+/gi, "_") || "class"}_full_history.csv`,
      ["Week", "Date", "Student", "Participation Stars", "Assignments", "Notebooking", "Study Guide", "Exams", "Exam Corrections", "Bonus", "Total", "Bonus Multiplier"],
      allRows
    );
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <div className="card-title" style={{ marginBottom: 8 }}>Browse a Past Week</div>
            <div className="row" style={{ gap: 6, marginBottom: 8 }}>
              <button
                type="button"
                className={`btn ${!gridView ? "" : "secondary"}`}
                style={{ padding: "3px 10px", fontSize: 11.5 }}
                onClick={() => setGridView(false)}
              >
                Single Week
              </button>
              <button
                type="button"
                className={`btn ${gridView ? "" : "secondary"}`}
                style={{ padding: "3px 10px", fontSize: 11.5 }}
                onClick={() => setGridView(true)}
              >
                All Weeks (Grid)
              </button>
            </div>
            {!gridView && (
              <select value={activeWeekId} onChange={(e) => { setWeekId(e.target.value); setEditing(false); }}>
                {sortedWeeks.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.label}
                  </option>
                ))}
              </select>
            )}
          </div>
          <button className="btn secondary" onClick={exportAllHistoryCsv}>
            Export Full History (CSV)
          </button>
        </div>
      </div>

      {gridView && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 10 }}>
            Every student, every week — spot a wrong or missing entry at a glance
          </div>
          <ClassWeeklyGrid
            weeks={weeks}
            students={students}
            entriesByWeek={entriesByWeek}
            onSelectWeek={(wid) => {
              setWeekId(wid);
              setGridView(false);
              setEditing(false);
            }}
          />
        </div>
      )}

      {!gridView && week && !editing && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {week.label} {week.skills_assigned && `— Skills: ${week.skills_assigned}`}
              {Number(week.bonus_multiplier) > 1 && ` — ⚡ ${week.bonus_multiplier}x week`}
            </div>
            <div className="row">
              <button className="btn secondary" onClick={exportWeekCsv}>
                Export This Week (CSV)
              </button>
              <button className="btn" onClick={startEdit}>
                Edit This Week
              </button>
            </div>
          </div>
          <table className="review-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Student</th>
                <th>⭐ Participation</th>
                <th>Assignments</th>
                <th>Notebooking</th>
                <th>Study Guide</th>
                <th>Exams</th>
                <th>Exam Corr.</th>
                <th>Bonus</th>
                <th>Bonus Note</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.student.id}>
                  <td>{i + 1}</td>
                  <td>{r.student.name}</td>
                  <td>{r.entry.classpoint_stars}</td>
                  <td>{Number(r.entry.ixl_avg).toFixed(1)}</td>
                  <td>{Number(r.entry.notebooking_score || 0).toFixed(1)}</td>
                  <td>{Number(r.entry.study_guide_score || 0).toFixed(1)}</td>
                  <td>{Number(r.entry.exam_score || 0).toFixed(1)}</td>
                  <td>{Number(r.entry.exam_corrections_score || 0).toFixed(1)}</td>
                  <td>{Number(r.entry.bonus).toFixed(1)}</td>
                  <td style={{ whiteSpace: "pre-line", fontSize: 12 }} className="muted">
                    {r.entry.bonus_note || "—"}
                  </td>
                  <td>{Number(r.entry.total).toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!gridView && week && editing && draft && (
        <div className="card">
          <div className="card-title">Editing {week.label}</div>
          <div className="row" style={{ marginBottom: 12 }}>
            <div>
              <label className="muted">Skills assigned</label>
              <br />
              <input
                value={draft.skills_assigned}
                onChange={(e) => setDraft((p) => ({ ...p, skills_assigned: e.target.value }))}
              />
            </div>
            <div>
              <label className="muted">Bonus multiplier</label>
              <br />
              <div className="row" style={{ marginTop: 6 }}>
                {MULTIPLIER_OPTIONS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`btn ${draft.bonus_multiplier === m ? "" : "secondary"}`}
                    onClick={() => setDraft((p) => ({ ...p, bonus_multiplier: m }))}
                  >
                    {m}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          <table className="review-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>⭐ Participation</th>
                <th>Assignments</th>
                <th>Notebooking</th>
                <th>Study Guide</th>
                <th>Exams</th>
                <th>Exam Corr.</th>
                <th>Bonus</th>
                <th>Bonus Note</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(draft.entries).map(([studentId, v]) => {
                const s = students.find((st) => st.id === studentId);
                const total =
                  v.stars * 5 +
                  v.ixl_avg +
                  Number(v.notebooking_score) +
                  Number(v.study_guide_score) +
                  Number(v.exam_score) +
                  Number(v.exam_corrections_score) +
                  v.bonus;
                return (
                  <tr key={studentId}>
                    <td>{s?.name || "Unknown"}</td>
                    <td>
                      <input
                        type="number"
                        value={v.stars}
                        onChange={(e) => updateDraftEntry(studentId, "stars", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={v.ixl_avg}
                        onChange={(e) => updateDraftEntry(studentId, "ixl_avg", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={v.notebooking_score}
                        onChange={(e) => updateDraftEntry(studentId, "notebooking_score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={v.study_guide_score}
                        onChange={(e) => updateDraftEntry(studentId, "study_guide_score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={v.exam_score}
                        onChange={(e) => updateDraftEntry(studentId, "exam_score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={v.exam_corrections_score}
                        onChange={(e) => updateDraftEntry(studentId, "exam_corrections_score", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.1"
                        value={v.bonus}
                        onChange={(e) => updateDraftEntry(studentId, "bonus", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        style={{ width: 180 }}
                        placeholder="Why these bonus points?"
                        value={v.note}
                        onChange={(e) => updateDraftNote(studentId, e.target.value)}
                      />
                    </td>
                    <td>{total.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {studentsWithoutEntry.length > 0 && (
            <div className="row" style={{ marginTop: 12 }}>
              <select value={addStudentId} onChange={(e) => setAddStudentId(e.target.value)}>
                <option value="">Add a student missing from this week…</option>
                {studentsWithoutEntry
                  .filter((s) => !draft.entries[s.id])
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
              <button className="btn secondary" onClick={addRowToDraft} type="button">
                + Add Row
              </button>
            </div>
          )}

          {error && <div className="error-text">{error}</div>}

          <div className="row" style={{ marginTop: 16 }}>
            <button className="btn" onClick={saveEdits} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                setEditing(false);
                setDraft(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {!gridView && (
        <div className="card">
          <div className="card-title">Edit History — {week?.label || "This Week"}</div>
        <p className="muted" style={{ marginBottom: 12 }}>
          Every change to any saved score in this week, automatically logged the moment it's
          saved — from any of the ways scores get edited (Weekly Update, Quick Update, this
          page, or Catch-Up). Useful for "wait, why did this change" later. This log is
          write-once — nothing in the app can edit or delete an entry here, including this
          page, so it stays a reliable record even of edits made by mistake.
        </p>
        {editLogLoading && <p className="muted">Loading…</p>}
        {!editLogLoading && editLog.length === 0 && (
          <p className="muted">No edits logged yet for this week.</p>
        )}
        {!editLogLoading &&
          editLog.map((log) => {
            const s = students.find((st) => st.id === log.student_id);
            const changes = diffEntry(log.old_values, log.new_values);
            if (changes.length === 0) return null;
            return (
              <div key={log.id} className="leader-row" style={{ flexDirection: "column", alignItems: "stretch" }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong style={{ fontSize: 13.5 }}>{s?.name || "Unknown student"}</strong>
                  <span className="muted" style={{ fontSize: 11.5 }}>
                    {new Date(log.changed_at).toLocaleString()}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                  {changes
                    .map((c) => `${c.label}: ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`)
                    .join(" · ")}
                </div>
              </div>
            );
          })}
      </div>
      )}

      <div className="card">
        <div className="card-title">Catch-Up — One Student, Every Week</div>
        <p className="muted" style={{ marginBottom: 12 }}>
          For exactly the "I finally finished all my old IXLs" situation — pick a student, see
          every week they've been in this Level in one table, fix as many as apply, save them
          all at once. Nothing about any other student, or any other part of a week (bonus
          notes, goals), gets touched.
        </p>
        <select value={catchUpStudentId} onChange={(e) => startCatchUp(e.target.value)} style={{ marginBottom: 14 }}>
          <option value="">Choose a student…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {catchUpStudentId && catchUpWeeks.length === 0 && (
          <p className="muted">No weeks logged yet for this Level.</p>
        )}

        {catchUpStudentId && catchUpWeeks.length > 0 && (
          <>
            <div style={{ overflowX: "auto" }}>
              <table className="review-table">
                <thead>
                  <tr>
                    <th>Week</th>
                    <th>⭐ Participation</th>
                    <th>Assignments</th>
                    <th>Notebooking</th>
                    <th>Study Guide</th>
                    <th>Exams</th>
                    <th>Exam Corr.</th>
                    <th>Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {catchUpWeeks.map((w) => {
                    const d = catchUpDrafts[w.id];
                    if (!d) return null;
                    return (
                      <tr key={w.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{w.label}</td>
                        <td>
                          <input
                            type="number"
                            style={{ width: 60 }}
                            value={d.stars}
                            onChange={(e) => updateCatchUp(w.id, "stars", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: 65 }}
                            value={d.ixl_avg}
                            onChange={(e) => updateCatchUp(w.id, "ixl_avg", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: 65 }}
                            value={d.notebooking_score}
                            onChange={(e) => updateCatchUp(w.id, "notebooking_score", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: 65 }}
                            value={d.study_guide_score}
                            onChange={(e) => updateCatchUp(w.id, "study_guide_score", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: 65 }}
                            value={d.exam_score}
                            onChange={(e) => updateCatchUp(w.id, "exam_score", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: 65 }}
                            value={d.exam_corrections_score}
                            onChange={(e) => updateCatchUp(w.id, "exam_corrections_score", e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.1"
                            style={{ width: 60 }}
                            value={d.bonus}
                            onChange={(e) => updateCatchUp(w.id, "bonus", e.target.value)}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn" onClick={saveCatchUp} disabled={catchUpSaving}>
                {catchUpSaving ? "Saving…" : "Save All Changes"}
              </button>
              {catchUpSaved && <span className="muted">✅ Saved.</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}
