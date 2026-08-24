import { useState } from "react";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";
import { DEFAULT_TASK_TEMPLATES, INTEREST_OPTIONS, buildAutoAssignments } from "../lib/autoAssign";

const CATEGORY_LABEL = { math: "📐 Math", habit: "🌱 Habit" };

export default function Tasks() {
  const { groupId, students, weeks, tasks, assignments, submissions, reload } = useGroup();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("habit");
  const [points, setPoints] = useState(5);
  const [interestTags, setInterestTags] = useState([]);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [loadingStarter, setLoadingStarter] = useState(false);
  const [reassigning, setReassigning] = useState(false);

  const studentById = Object.fromEntries(students.map((s) => [s.id, s]));
  const assignmentById = Object.fromEntries(assignments.map((a) => [a.id, a]));
  const weekById = Object.fromEntries(weeks.map((w) => [w.id, w]));
  const latestWeek = weeks[weeks.length - 1];

  const pending = submissions
    .filter((s) => s.status === "pending")
    .sort((a, b) => new Date(a.submitted_at) - new Date(b.submitted_at));

  const reviewed = submissions
    .filter((s) => s.status !== "pending")
    .sort((a, b) => new Date(b.reviewed_at || b.submitted_at) - new Date(a.reviewed_at || a.submitted_at))
    .slice(0, 15);

  function toggleInterest(key) {
    setInterestTags((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  async function addTask(e) {
    e.preventDefault();
    if (!title.trim()) return;
    const { error } = await supabase.from("tasks").insert({
      group_id: groupId,
      title: title.trim(),
      description: description.trim() || null,
      category,
      points: Number(points),
      interest_tags: interestTags,
    });
    if (error) setError(error.message);
    else {
      setTitle("");
      setDescription("");
      setPoints(5);
      setInterestTags([]);
      await reload();
    }
  }

  async function loadStarterLibrary() {
    setLoadingStarter(true);
    setError("");
    try {
      const existingTitles = new Set(tasks.map((t) => t.title));
      const toInsert = DEFAULT_TASK_TEMPLATES.filter((t) => !existingTitles.has(t.title)).map((t) => ({
        group_id: groupId,
        title: t.title,
        description: t.description || null,
        category: t.category,
        points: t.points,
        interest_tags: t.interest_tags || [],
        is_dynamic_math: !!t.is_dynamic_math,
      }));
      if (toInsert.length > 0) {
        const { error } = await supabase.from("tasks").insert(toInsert);
        if (error) throw error;
      }
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoadingStarter(false);
    }
  }

  async function toggleTaskActive(task) {
    await supabase.from("tasks").update({ active: !task.active }).eq("id", task.id);
    await reload();
  }

  async function deleteTask(task) {
    if (!confirm(`Delete "${task.title}"? Past approved points already awarded are not undone.`)) return;
    await supabase.from("tasks").delete().eq("id", task.id);
    await reload();
  }

  async function reassignLatestWeek() {
    if (!latestWeek) return;
    setReassigning(true);
    setError("");
    try {
      const newAssignments = buildAutoAssignments({
        week: latestWeek,
        weeks,
        group: { id: groupId },
        students,
        tasks,
        existingAssignments: assignments,
        submissions,
      });
      if (newAssignments.length > 0) {
        await supabase.from("task_assignments").insert(newAssignments);
      }
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setReassigning(false);
    }
  }

  async function approve(submission) {
    setBusyId(submission.id);
    setError("");
    try {
      const assignment = assignmentById[submission.assignment_id];
      const { data: existing } = await supabase
        .from("entries")
        .select("*")
        .eq("week_id", submission.week_id)
        .eq("student_id", submission.student_id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from("entries")
          .update({ bonus: Number(existing.bonus) + Number(assignment.points) })
          .eq("id", existing.id);
      } else {
        await supabase.from("entries").insert({
          week_id: submission.week_id,
          student_id: submission.student_id,
          classpoint_stars: 0,
          ixl_avg: 0,
          bonus: Number(assignment.points),
        });
      }

      await supabase
        .from("task_submissions")
        .update({ status: "approved", reviewed_at: new Date().toISOString() })
        .eq("id", submission.id);

      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(submission) {
    setBusyId(submission.id);
    await supabase
      .from("task_submissions")
      .update({ status: "rejected", reviewed_at: new Date().toISOString() })
      .eq("id", submission.id);
    await reload();
    setBusyId(null);
  }

  return (
    <>
      <div className="card">
        <div className="card-title">Task Library</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          This is the pool auto-assignment picks from each week — you don't have to assign
          anyone anything by hand. Tag habit tasks with interests so kids get ones that
          actually appeal to them; math stays level-appropriate automatically since the
          "dynamic" math task pulls straight from whatever skills you enter in Weekly Update.
        </p>
        <button className="btn secondary" onClick={loadStarterLibrary} disabled={loadingStarter} style={{ marginBottom: 14 }}>
          {loadingStarter ? "Loading…" : "Load Starter Task Library"}
        </button>

        <form onSubmit={addTask} style={{ marginBottom: 8 }}>
          <div className="row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
            <input
              placeholder="Task title (e.g. Read for 20 minutes)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="habit">🌱 Habit</option>
              <option value="math">📐 Math</option>
            </select>
            <input
              type="number"
              value={points}
              onChange={(e) => setPoints(e.target.value)}
              style={{ width: 80 }}
              title="Bonus points awarded on approval"
            />
            <button className="btn" type="submit">
              + Add Task
            </button>
          </div>
          <input
            placeholder="Optional description / instructions"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: "100%", marginBottom: 8 }}
          />
          {category === "habit" && (
            <div className="row" style={{ flexWrap: "wrap" }}>
              {INTEREST_OPTIONS.map((opt) => (
                <button
                  type="button"
                  key={opt.key}
                  onClick={() => toggleInterest(opt.key)}
                  className={`btn ${interestTags.includes(opt.key) ? "" : "secondary"}`}
                  style={{ fontSize: 12, padding: "6px 10px" }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </form>
        {error && <div className="error-text">{error}</div>}
      </div>

      <div className="card">
        <div className="card-title">Active Tasks ({tasks.filter((t) => t.active).length})</div>
        {tasks.map((t) => (
          <div key={t.id} className="leader-row">
            <div className="leader-name" style={{ opacity: t.active ? 1 : 0.5 }}>
              {CATEGORY_LABEL[t.category]} {t.title}
              {t.is_dynamic_math && " (auto-fills from that week's skills)"}
              {!t.active && " (inactive)"}
            </div>
            {(t.interest_tags || []).length > 0 && (
              <span className="muted" style={{ fontSize: 12 }}>
                {t.interest_tags.join(", ")}
              </span>
            )}
            <span className="pill">+{Number(t.points)} pts</span>
            <button className="btn secondary" onClick={() => toggleTaskActive(t)}>
              {t.active ? "Deactivate" : "Reactivate"}
            </button>
            <button className="btn danger" onClick={() => deleteTask(t)}>
              Delete
            </button>
          </div>
        ))}
        {tasks.length === 0 && <p className="muted">No tasks yet — add one above or load the starter library.</p>}
      </div>

      {latestWeek && (
        <div className="card">
          <div className="card-title">Auto-Assignment</div>
          <p className="muted" style={{ marginBottom: 10 }}>
            Every time you save a week in Weekly Update, active students who don't already
            have tasks for that week automatically get one math task (from that week's
            skills) plus habit tasks matched to their interests. Use this if you've added a
            new student or task after already saving {latestWeek.label} and want to fill in
            the gaps for that week.
          </p>
          <button className="btn secondary" onClick={reassignLatestWeek} disabled={reassigning}>
            {reassigning ? "Assigning…" : `Fill In Missing Assignments for ${latestWeek.label}`}
          </button>
        </div>
      )}

      <div className="card">
        <div className="card-title">Pending Review ({pending.length})</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          You don't have to be the one approving these — each student on the Roster tab has
          a "Copy Parent Link" button that lets their parent review and approve just their
          own child's tasks. This queue is here as a backup / for tasks you'd rather verify
          yourself.
        </p>
        {pending.length === 0 && <p className="muted">Nothing waiting on you right now.</p>}
        {pending.map((s) => {
          const assignment = assignmentById[s.assignment_id];
          const student = studentById[s.student_id];
          const week = weekById[s.week_id];
          return (
            <div key={s.id} className="leader-row">
              <div className="leader-name">
                {assignment?.is_catchup && <span className="match-badge match-unsure" style={{ marginRight: 6 }}>⏪ Catch-up</span>}
                {student?.name || "Unknown"} — {CATEGORY_LABEL[assignment?.category]} {assignment?.title}
                {s.reflection && <span className="muted"> — "{s.reflection}"</span>}
              </div>
              <span className="muted">{week?.label}</span>
              <span className="pill">+{Number(assignment?.points)} pts</span>
              <button className="btn" disabled={busyId === s.id} onClick={() => approve(s)}>
                Approve
              </button>
              <button className="btn secondary" disabled={busyId === s.id} onClick={() => reject(s)}>
                Reject
              </button>
            </div>
          );
        })}
      </div>

      {reviewed.length > 0 && (
        <div className="card">
          <div className="card-title">Recently Reviewed</div>
          {reviewed.map((s) => {
            const assignment = assignmentById[s.assignment_id];
            const student = studentById[s.student_id];
            return (
              <div key={s.id} className="leader-row">
                <div className="leader-name">
                  {student?.name || "Unknown"} — {assignment?.title}
                  {s.reflection && <span className="muted"> — "{s.reflection}"</span>}
                </div>
                <span
                  className={`match-badge ${s.status === "approved" ? "match-good" : "match-none"}`}
                >
                  {s.status === "approved" ? "Approved" : "Rejected"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
