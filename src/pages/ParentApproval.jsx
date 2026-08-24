import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { assignDivisions, computeStreak, effectiveTotal, trailingAverage } from "../lib/calc";

const CATEGORY_LABEL = { math: "📐 Math", habit: "🌱 Habit" };

// This page is intentionally NOT behind the teacher passcode gate — a
// parent reaches it via a private, unguessable link
// (yourapp.netlify.app/parent/<token>) copied from the Roster tab.
//
// It never talks to Supabase directly with the anon key — every read and
// write goes through the parent-portal Netlify Function, which uses the
// service-role key server-side. That function re-scopes every query to
// the single student this token resolves to.
//
// PIN model: the teacher only shares the LINK. Whoever opens it first is
// prompted to create a 4-digit PIN themselves — every visit after that
// requires it. There's no self-service "forgot PIN" recovery (that would
// just recreate the same "who is this really" problem) — instead, ask the
// teacher to reset access from Roster, which re-opens the link for a
// fresh setup.
async function callPortal(body) {
  const res = await fetch("/.netlify/functions/parent-portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export default function ParentApproval() {
  const { token } = useParams();
  const [phase, setPhase] = useState("loading"); // loading | setup | enter-pin | dashboard | not-found
  const [studentName, setStudentName] = useState("");
  const [teacherContact, setTeacherContact] = useState(null);
  const [showForgot, setShowForgot] = useState(false);

  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [verifiedPin, setVerifiedPin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [student, setStudent] = useState(null);
  const [progressCtx, setProgressCtx] = useState(null); // { group, weeks, peers, entries }
  const [pending, setPending] = useState([]);
  const [recent, setRecent] = useState([]);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    callPortal({ action: "check", token })
      .then((data) => {
        setStudentName(data.student.name);
        setTeacherContact(data.teacherContact);
        setPhase(data.needsSetup ? "setup" : "enter-pin");
      })
      .catch((e) => {
        if (e.message.includes("not recognized")) setPhase("not-found");
        else {
          setError(e.message);
          setPhase("enter-pin");
        }
      });
  }, [token]);

  async function submitSetup(e) {
    e.preventDefault();
    setError("");
    if (pinInput.length !== 4) {
      setError("PIN must be 4 digits.");
      return;
    }
    if (pinInput !== pinConfirm) {
      setError("PINs don't match — try again.");
      return;
    }
    setLoading(true);
    try {
      const data = await callPortal({ action: "setup_pin", token, pin: pinInput });
      setVerifiedPin(pinInput);
      setStudent(data.student);
      setProgressCtx({ group: data.group, weeks: data.weeks || [], peers: data.peers || [], entries: data.entries || [] });
      setPending(data.pending);
      setRecent(data.recent);
      setPhase("dashboard");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function submitPin(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await callPortal({ action: "lookup", token, pin: pinInput });
      setVerifiedPin(pinInput);
      setStudent(data.student);
      setProgressCtx({ group: data.group, weeks: data.weeks || [], peers: data.peers || [], entries: data.entries || [] });
      setPending(data.pending);
      setRecent(data.recent);
      setPhase("dashboard");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function approve(submission) {
    setBusyId(submission.id);
    setError("");
    try {
      const data = await callPortal({ action: "approve", token, pin: verifiedPin, submissionId: submission.id });
      setPending(data.pending);
      setRecent(data.recent);
      setProgressCtx({ group: data.group, weeks: data.weeks || [], peers: data.peers || [], entries: data.entries || [] });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(submission) {
    setBusyId(submission.id);
    setError("");
    try {
      const data = await callPortal({ action: "reject", token, pin: verifiedPin, submissionId: submission.id });
      setPending(data.pending);
      setRecent(data.recent);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (phase === "loading") {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (phase === "not-found") {
    return (
      <div className="app-shell">
        <div className="card">
          <p>This link doesn't match any student. Please check the link your teacher shared.</p>
        </div>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className="passcode-screen">
        <div className="passcode-box card">
          <h1>Set Up Access</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            You're setting up parent access for <strong>{studentName}</strong>. Choose a
            4-digit PIN — you'll enter it every time you come back to review and approve
            their tasks.
          </p>
          <form onSubmit={submitSetup}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Choose a 4-digit PIN"
            />
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Confirm PIN"
            />
            <button type="submit" className="btn" disabled={loading}>
              {loading ? "Setting up…" : "Set Up Access"}
            </button>
          </form>
          {error && <div className="error-text">{error}</div>}
          <p className="muted" style={{ marginTop: 12, fontSize: 12 }}>
            Not the parent? Please close this page and let {studentName.split(" ")[0]}'s
            parent open the link themselves.
          </p>
        </div>
      </div>
    );
  }

  if (phase === "enter-pin") {
    return (
      <div className="passcode-screen">
        <div className="passcode-box card">
          <h1>Parent Verification</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            Enter the PIN you set up for {studentName || "this student"}.
          </p>
          <form onSubmit={submitPin}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={4}
              autoFocus
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, "").slice(0, 4))}
              placeholder="PIN"
            />
            <button type="submit" className="btn" disabled={loading || pinInput.length !== 4}>
              {loading ? "Checking…" : "Continue"}
            </button>
          </form>
          {error && <div className="error-text">{error}</div>}
          <button
            type="button"
            className="btn secondary"
            style={{ marginTop: 12, fontSize: 12 }}
            onClick={() => setShowForgot((v) => !v)}
          >
            Forgot your PIN?
          </button>
          {showForgot && (
            <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
              There's no self-service reset — ask {studentName || "the"} student's teacher
              to reset your access from their end, then reopen this link to set up a new
              PIN.
              {teacherContact && <> Contact: {teacherContact}</>}
            </p>
          )}
        </div>
      </div>
    );
  }

  const weeks = progressCtx?.weeks || [];
  const peers = progressCtx?.peers || [];
  const entriesByWeek = useMemo(() => {
    const map = {};
    (progressCtx?.entries || []).forEach((e) => {
      map[e.week_id] = map[e.week_id] || {};
      map[e.week_id][e.student_id] = e;
    });
    return map;
  }, [progressCtx]);
  const latestWeek = weeks[weeks.length - 1];
  const latestWeekId = latestWeek?.id;
  const myEntry = latestWeekId && student ? entriesByWeek[latestWeekId]?.[student.id] : null;
  const myDivision = latestWeekId
    ? assignDivisions(entriesByWeek, weeks, peers, latestWeekId).find((d) => d.student.id === student?.id)
    : null;
  const streakInfo = student ? computeStreak(entriesByWeek, weeks, student.id) : { streak: 0 };
  const myTotal = latestWeekId && student ? effectiveTotal(entriesByWeek, weeks, latestWeekId, student.id) : null;
  const myTrailingAvg =
    latestWeekId && student ? trailingAverage(entriesByWeek, weeks, student.id, latestWeekId) : null;
  const allCategoriesZero =
    myEntry &&
    myEntry.classpoint_stars === 0 &&
    Number(myEntry.ixl_avg) === 0 &&
    Number(myEntry.notebooking_score) === 0 &&
    Number(myEntry.study_guide_score) === 0 &&
    Number(myEntry.exam_score) === 0 &&
    Number(myEntry.exam_corrections_score) === 0 &&
    Number(myEntry.bonus) === 0;

  return (
    <div className="app-shell" style={{ maxWidth: 640 }}>
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-title">{student.name}'s Tasks</div>
        </div>
      </div>

      {myEntry && (
        <div className="card">
          <div className="card-title">{student.name}'s Progress — {latestWeek.label}</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 18, marginBottom: 14 }}>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>League</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{myDivision?.tierName || "—"}</div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>Streak</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>
                🔥 {streakInfo.streak} week{streakInfo.streak === 1 ? "" : "s"}
              </div>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 11 }}>This Week's Total</div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{myTotal !== null ? myTotal.toFixed(1) : "—"}</div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 6, fontSize: 13 }}>
            {myEntry.classpoint_stars !== 0 && (
              <>
                <div>⭐ Class Participation ({myEntry.classpoint_stars} × 5)</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.classpoint_stars * 5).toFixed(1)}</div>
              </>
            )}
            {Number(myEntry.ixl_avg) !== 0 && (
              <>
                <div>📘 Assignments</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.ixl_avg).toFixed(1)}</div>
              </>
            )}
            {Number(myEntry.notebooking_score) !== 0 && (
              <>
                <div>📝 Notebooking</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.notebooking_score).toFixed(1)}</div>
              </>
            )}
            {Number(myEntry.study_guide_score) !== 0 && (
              <>
                <div>📗 Study Guide</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.study_guide_score).toFixed(1)}</div>
              </>
            )}
            {Number(myEntry.exam_score) !== 0 && (
              <>
                <div>🧪 Exams</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.exam_score).toFixed(1)}</div>
              </>
            )}
            {Number(myEntry.exam_corrections_score) !== 0 && (
              <>
                <div>✏️ Exam Corrections</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.exam_corrections_score).toFixed(1)}</div>
              </>
            )}
            {Number(myEntry.bonus) !== 0 && (
              <>
                <div>🎁 Bonus</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.bonus).toFixed(1)}</div>
              </>
            )}
          </div>
          {allCategoriesZero && (
            <p className="muted" style={{ fontSize: 12.5 }}>No scores entered for this week yet.</p>
          )}
          {myTrailingAvg !== null && (
            <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
              Own 4-week average: {myTrailingAvg.toFixed(1)} — this week is{" "}
              {myTotal >= myTrailingAvg ? "above" : "below"} that by{" "}
              {Math.abs(myTotal - myTrailingAvg).toFixed(1)}.
            </p>
          )}
        </div>
      )}

      <div className="card">
        <p className="muted">
          Only approve a task if {student.name.split(" ")[0]} actually completed it — this
          adds bonus points to their class leaderboard. Anything marked "⏪ Catch-up" is a
          task from last week that never got finished, being offered again this week.
        </p>
      </div>

      <div className="card">
        <div className="card-title">Waiting for Your Approval ({pending.length})</div>
        {pending.length === 0 && <p className="muted">Nothing to review right now.</p>}
        {pending.map((s) => (
          <div key={s.id} className="leader-row">
            <div className="leader-name">
              {s.task_assignments?.is_catchup && (
                <span className="match-badge match-unsure" style={{ marginRight: 6 }} title="Left over from last week">
                  ⏪ Catch-up
                </span>
              )}
              {CATEGORY_LABEL[s.task_assignments?.category]} {s.task_assignments?.title}
              {s.reflection && <span className="muted"> — "{s.reflection}"</span>}
            </div>
            <span className="muted">{s.weeks?.label}</span>
            <span className="pill">+{Number(s.task_assignments?.points)} pts</span>
            <button className="btn" disabled={busyId === s.id} onClick={() => approve(s)}>
              Yes, they did it
            </button>
            <button className="btn secondary" disabled={busyId === s.id} onClick={() => reject(s)}>
              Not yet
            </button>
          </div>
        ))}
        {error && <div className="error-text">{error}</div>}
      </div>

      {recent.length > 0 && (
        <div className="card">
          <div className="card-title">Recently Reviewed</div>
          {recent.map((s) => (
            <div key={s.id} className="leader-row">
              <div className="leader-name">{s.task_assignments?.title}</div>
              <span className={`match-badge ${s.status === "approved" ? "match-good" : "match-none"}`}>
                {s.status === "approved" ? "Approved" : "Not approved"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
