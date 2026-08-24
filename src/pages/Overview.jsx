import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";
import KpiStrip from "../components/KpiStrip";

// The "front page" for a multi-Level business -- Roster, Weekly Update,
// etc. are all scoped to whichever one Level is currently selected, which
// is fine once you're working inside a class but gives no way to see the
// state of the whole business at a glance. This page runs its own
// cross-group queries (everything else in the app is intentionally
// scoped to the selected group only) to answer, per Level: how many
// students, when was it last updated, and does anything need review.
export default function Overview() {
  const { groups, selectGroup } = useGroup();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [allStudents, setAllStudents] = useState([]); // for cross-Level search
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups.length]);

  async function load() {
    if (groups.length === 0) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const groupIds = groups.map((g) => g.id);

      const [{ data: students, error: sErr }, { data: weeks, error: wErr }, { data: submissions, error: subErr }] =
        await Promise.all([
          supabase.from("students").select("id, name, group_id, active").in("group_id", groupIds),
          supabase.from("weeks").select("id, group_id, label, date").in("group_id", groupIds),
          supabase
            .from("task_submissions")
            .select("id, status, students(group_id)")
            .eq("status", "pending"),
        ]);
      if (sErr) throw sErr;
      if (wErr) throw wErr;
      if (subErr) throw subErr;
      setAllStudents(students || []);

      const studentCounts = {};
      (students || []).forEach((s) => {
        if (!s.active) return;
        studentCounts[s.group_id] = (studentCounts[s.group_id] || 0) + 1;
      });

      const latestWeek = {};
      (weeks || []).forEach((w) => {
        const cur = latestWeek[w.group_id];
        if (!cur || (w.date && w.date > cur.date)) latestWeek[w.group_id] = w;
      });

      const pendingCounts = {};
      (submissions || []).forEach((s) => {
        const gid = s.students?.group_id;
        if (!gid) return;
        pendingCounts[gid] = (pendingCounts[gid] || 0) + 1;
      });

      const built = groups.map((g) => ({
        group: g,
        studentCount: studentCounts[g.id] || 0,
        latestWeek: latestWeek[g.id] || null,
        pendingCount: pendingCounts[g.id] || 0,
      }));

      // Levels that need something done sort to the top: pending reviews
      // first (highest count first), then levels with no week logged yet,
      // then everything else by most-recently-updated last (so the
      // stalest classes surface near the top too).
      built.sort((a, b) => {
        if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
        if (!a.latestWeek && b.latestWeek) return -1;
        if (a.latestWeek && !b.latestWeek) return 1;
        const aDate = a.latestWeek?.date || "";
        const bDate = b.latestWeek?.date || "";
        return aDate.localeCompare(bDate);
      });

      setRows(built);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  function goToLevel(groupId) {
    selectGroup(groupId);
    navigate("/board");
  }

  if (loading) return <div className="card">Loading…</div>;

  if (groups.length === 0) {
    return (
      <div className="card">
        <p className="muted">
          No Levels yet. Head to Roster and click "Load My Programs" to get started.
        </p>
      </div>
    );
  }

  const totalStudents = rows.reduce((sum, r) => sum + r.studentCount, 0);
  const totalPending = rows.reduce((sum, r) => sum + r.pendingCount, 0);
  const staleCount = rows.filter((r) => !r.latestWeek).length;

  // Reads the real `meets_day` field on each Level (set by "Load My
  // Programs," or by hand in Group Settings) rather than guessing from
  // the name -- this is what makes single-session courses like Level 7
  // or Algebra 2 show up correctly here too, not just the ones with a
  // day baked into their name.
  function dayOf(group) {
    if (group.meets_day) return group.meets_day;
    const match = group.name.trim().match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    return match ? match[1] : null;
  }

  const DAY_ORDER = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  const DAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

  const todayAbbr = new Date().toLocaleDateString("en-US", { weekday: "short" });
  const todayRows = rows.filter((r) => dayOf(r.group) === todayAbbr);

  const byDay = {};
  rows.forEach((r) => {
    const day = dayOf(r.group) || "No day set";
    byDay[day] = byDay[day] || [];
    byDay[day].push(r);
  });
  const dayKeys = Object.keys(byDay).sort((a, b) => (DAY_ORDER[a] || 8) - (DAY_ORDER[b] || 8));

  return (
    <div>
      <KpiStrip
        items={[
          { label: "Levels", value: groups.length },
          { label: "Active Students", value: totalStudents },
          { label: "Pending Reviews", value: totalPending },
          { label: "Never Updated", value: staleCount },
        ]}
      />

      {error && <div className="error-text">{error}</div>}

      <div className="card">
        <div className="card-title">Find a Student</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Search across every Level at once -- no need to know which class they're in first.
        </p>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Type a student's name…"
          style={{ width: "100%", maxWidth: 320 }}
        />
        {searchQuery.trim().length > 0 && (
          <div style={{ marginTop: 10 }}>
            {allStudents
              .filter((s) => s.name.toLowerCase().includes(searchQuery.trim().toLowerCase()))
              .map((s) => {
                const group = groups.find((g) => g.id === s.group_id);
                return (
                  <div
                    key={s.id}
                    className="leader-row"
                    style={{ cursor: "pointer" }}
                    onClick={() => {
                      selectGroup(s.group_id);
                      navigate("/roster");
                    }}
                  >
                    <div className="leader-name">
                      {s.name} {!s.active && <span className="muted">(archived)</span>}
                    </div>
                    <span className="pill">{group?.name || "Unknown Level"}</span>
                  </div>
                );
              })}
            {allStudents.filter((s) => s.name.toLowerCase().includes(searchQuery.trim().toLowerCase())).length ===
              0 && <p className="muted">No student matches "{searchQuery}".</p>}
          </div>
        )}
      </div>

      {todayRows.length > 0 && (
        <div className="card">
          <div className="card-title">Today's Classes ({DAY_FULL[todayAbbr] || todayAbbr})</div>
          {todayRows.map(({ group, studentCount, latestWeek, pendingCount }) => (
            <div
              key={group.id}
              className="leader-row"
              style={{ cursor: "pointer" }}
              onClick={() => goToLevel(group.id)}
            >
              <div className="leader-name">{group.name}</div>
              <span className="pill">{studentCount} student{studentCount === 1 ? "" : "s"}</span>
              {latestWeek ? (
                <span className="muted" style={{ fontSize: 12.5 }}>
                  Last updated: {latestWeek.label}
                </span>
              ) : (
                <span className="pill" style={{ background: "rgba(240,185,74,.18)", color: "var(--gold)" }}>
                  No weeks logged yet
                </span>
              )}
              {pendingCount > 0 && (
                <span className="pill" style={{ background: "rgba(240,113,110,.16)", color: "var(--red)" }}>
                  {pendingCount} pending review{pendingCount === 1 ? "" : "s"}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">Weekly Schedule</div>
        <p className="muted" style={{ marginBottom: 14 }}>
          Every Level, grouped by the day it actually meets. Click a name to jump straight to
          it. "No day set" means that Level's day hasn't been set yet -- fix it in that Level's
          Group Settings on Roster.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
          {dayKeys.map((day) => (
            <div key={day}>
              <div className="rowlabel" style={{ marginBottom: 8 }}>
                {DAY_FULL[day] || day}
              </div>
              {byDay[day].map(({ group }) => (
                <div
                  key={group.id}
                  onClick={() => goToLevel(group.id)}
                  style={{ fontSize: 13.5, fontWeight: 600, padding: "5px 0", cursor: "pointer" }}
                >
                  {group.name}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Every Level</div>
        {rows.map(({ group, studentCount, latestWeek, pendingCount }) => (
          <div
            key={group.id}
            className="leader-row"
            style={{ cursor: "pointer" }}
            onClick={() => goToLevel(group.id)}
          >
            <div className="leader-name">{group.name}</div>
            <span className="pill">{studentCount} student{studentCount === 1 ? "" : "s"}</span>
            {latestWeek ? (
              <span className="muted" style={{ fontSize: 12.5 }}>
                Last updated: {latestWeek.label}
              </span>
            ) : (
              <span className="pill" style={{ background: "rgba(240,185,74,.18)", color: "var(--gold)" }}>
                No weeks logged yet
              </span>
            )}
            {pendingCount > 0 && (
              <span className="pill" style={{ background: "rgba(240,113,110,.16)", color: "var(--red)" }}>
                {pendingCount} pending review{pendingCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
