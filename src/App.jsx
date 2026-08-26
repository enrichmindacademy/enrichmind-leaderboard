import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import PasscodeGate from "./components/PasscodeGate";
import Nav from "./components/Nav";
import Sidebar from "./components/Sidebar";
import { supabase } from "./supabaseClient";
import { GroupProvider, useGroup } from "./lib/GroupContext";
import ProjectorBoard from "./pages/ProjectorBoard";
import Today from "./pages/Today";
import Overview from "./pages/Overview";
import MyProgress from "./pages/MyProgress";
import WeeklyUpdate from "./pages/WeeklyUpdate";
import Tasks from "./pages/Tasks";
import Insights from "./pages/Insights";
import Roster from "./pages/Roster";
import History from "./pages/History";
import ParentApproval from "./pages/ParentApproval";
import FamilyPortal from "./pages/FamilyPortal";
import StudentProgress from "./pages/StudentProgress";

const DAY_ORDER = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const DAY_FULL = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

function dayOfGroup(group) {
  if (group.meets_day) return group.meets_day;
  const match = group.name.trim().match(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
  return match ? match[1] : null;
}

function GroupPicker() {
  const { groups, groupId, selectGroup } = useGroup();
  if (groups.length === 0) return null;

  // Grouped by the day each Level actually meets -- reads the real
  // `meets_day` field where it's set (every Level "Load My Programs"
  // creates has it, including single-session courses like Level 7 or
  // Algebra 2 whose day never showed up in the name at all), falling
  // back to the day suffix on the name for any older Level created
  // before this field existed.
  const byDay = {};
  groups.forEach((g) => {
    const day = dayOfGroup(g) || "No day set";
    byDay[day] = byDay[day] || [];
    byDay[day].push(g);
  });
  const dayKeys = Object.keys(byDay).sort((a, b) => (DAY_ORDER[a] || 8) - (DAY_ORDER[b] || 8));

  return (
    <div>
      <div className="picker-label">Viewing class</div>
      <select className="group-picker" value={groupId || ""} onChange={(e) => selectGroup(e.target.value)}>
        {dayKeys.map((day) => (
          <optgroup key={day} label={DAY_FULL[day] || day}>
            {byDay[day].map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

function Shell() {
  const { groupId, loading } = useGroup();
  const picker = <GroupPicker />;

  return (
    <div className="app-layout">
      <Sidebar groupPicker={picker} />

      <main className="main-content">
        <div className="mobile-topbar">
          <div className="brand">
            <div className="brand-mark" />
            <div className="brand-title">EnrichMind</div>
          </div>
          <div className="row">
            {picker}
            <button className="btn secondary" onClick={() => supabase.auth.signOut()}>
              Sign Out
            </button>
          </div>
        </div>
        <Nav />

        <div className="app-shell">
          {!groupId && !loading && (
            <div className="card">
              <p className="muted">No level yet. Head to the Roster tab to create or load one.</p>
            </div>
          )}

          {groupId && (
            <Routes>
              <Route path="/" element={<Today />} />
              <Route path="/overview" element={<Overview />} />
              <Route path="/board" element={<ProjectorBoard />} />
              <Route path="/my-progress" element={<MyProgress />} />
              <Route path="/weekly-update" element={<WeeklyUpdate />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/insights" element={<Insights />} />
              <Route path="/roster" element={<Roster />} />
              <Route path="/history" element={<History />} />
            </Routes>
          )}
          {!groupId && (
            <Routes>
              <Route path="/roster" element={<Roster />} />
              <Route path="*" element={null} />
            </Routes>
          )}
        </div>
      </main>
    </div>
  );
}

// `session` is undefined while we're checking (avoid a login-form flash for
// an already-signed-in teacher), null when signed out, or the Supabase
// Auth session object when signed in. Row Level Security (see
// supabase/schema.sql) is what actually enforces this server-side — this
// is just the UI reflecting that same session.
function GatedApp() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return <PasscodeGate />;
  }

  return (
    <GroupProvider>
      <Shell />
    </GroupProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/parent/:token" element={<ParentApproval />} />
        <Route path="/family/:token" element={<FamilyPortal />} />
        <Route path="/student/:token" element={<StudentProgress />} />
        <Route path="/*" element={<GatedApp />} />
      </Routes>
    </BrowserRouter>
  );
}
