import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";

const DAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

function dayOf(group) {
  if (group.meets_day) return group.meets_day;
  const match = group.name.trim().match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  return match ? match[1] : null;
}

// The new landing page -- built around the one thing that happens every
// single day: walking into a class and needing to enter that day's
// scores. Everything else the app can do (the full schedule, roster
// management, deep stats) is a click away under "More" in the sidebar,
// but this page shows nothing except what's relevant to *today*, as big
// clickable cards that go straight into scoring -- no separate
// class-picker-then-nav-click sequence to get there.
export default function Today() {
  const { groups, selectGroup } = useGroup();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState([]);

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
    const groupIds = groups.map((g) => g.id);
    const [{ data: students }, { data: weeks }] = await Promise.all([
      supabase.from("students").select("id, group_id, active").in("group_id", groupIds),
      supabase.from("weeks").select("id, group_id, label, date").in("group_id", groupIds),
    ]);

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

    setRows(
      groups.map((g) => ({
        group: g,
        studentCount: studentCounts[g.id] || 0,
        latestWeek: latestWeek[g.id] || null,
      }))
    );
    setLoading(false);
  }

  function enterScores(groupId) {
    selectGroup(groupId);
    navigate("/weekly-update");
  }

  function viewBoard(groupId) {
    selectGroup(groupId);
    navigate("/board");
  }

  const now = new Date();
  const todayAbbr = now.toLocaleDateString("en-US", { weekday: "short" });
  const todayFull = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const todayRows = rows.filter((r) => dayOf(r.group) === todayAbbr);

  if (loading) return <div className="card">Loading…</div>;

  if (groups.length === 0) {
    return (
      <div className="card">
        <p className="muted">No Levels yet. Head to Roster and click "Load My Programs" to get started.</p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "Poppins, sans-serif" }}>
          {DAY_FULL[todayAbbr] || todayAbbr}
        </div>
        <div className="muted">{todayFull}</div>
      </div>

      {todayRows.length === 0 ? (
        <div className="card">
          <p className="muted" style={{ marginBottom: 8 }}>
            No classes scheduled for today.
          </p>
          <Link to="/overview" className="muted" style={{ fontSize: 13 }}>
            View the full weekly schedule →
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {todayRows.map(({ group, studentCount, latestWeek }) => (
            <div key={group.id} className="card" style={{ marginBottom: 0, display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 700, fontFamily: "Poppins, sans-serif" }}>
                  {group.name}
                </div>
                <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                  {studentCount} student{studentCount === 1 ? "" : "s"}
                  {latestWeek ? ` · last updated ${latestWeek.label}` : " · no weeks logged yet"}
                </div>
              </div>
              <div className="row" style={{ marginTop: "auto" }}>
                <button className="btn" onClick={() => enterScores(group.id)} style={{ flex: 1 }}>
                  Enter Scores
                </button>
                <button className="btn secondary" onClick={() => viewBoard(group.id)}>
                  Board
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <Link to="/overview" className="muted" style={{ fontSize: 13 }}>
          View all classes and the full schedule →
        </Link>
      </div>
    </div>
  );
}
