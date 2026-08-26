import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { assignDivisions, computeStreak, effectiveTotal, trailingAverage } from "../lib/calc";

// This page is intentionally NOT behind the teacher passcode gate — a
// parent reaches it via a private, unguessable link
// (yourapp.netlify.app/family/<token>) copied from Roster's "Copy
// Family Link". Unlike the older per-student /parent/:token page, this
// one is keyed by EMAIL, not by one student enrollment — logging in
// once shows every child sharing that same parent email, across every
// Level each one is in, rather than needing a separate link and PIN
// per class enrollment.
async function callPortal(body) {
  const res = await fetch("/.netlify/functions/family-portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export default function FamilyPortal() {
  const { token } = useParams();
  const [phase, setPhase] = useState("loading"); // loading | setup | enter-pin | dashboard | not-found
  const [email, setEmail] = useState("");

  const [pinInput, setPinInput] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [verifiedPin, setVerifiedPin] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [children, setChildren] = useState([]);
  const [busyId, setBusyId] = useState(null);

  useEffect(() => {
    callPortal({ action: "check", token })
      .then((data) => {
        setEmail(data.email);
        setPhase(data.needsSetup ? "setup" : "enter-pin");
      })
      .catch((e) => {
        if (e.message.includes("not recognized")) setPhase("not-found");
        else setError(e.message);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function submitSetup(e) {
    e.preventDefault();
    setError("");
    if (!/^\d{4}$/.test(pinInput)) return setError("PIN must be 4 digits.");
    if (pinInput !== pinConfirm) return setError("PINs don't match.");
    setLoading(true);
    try {
      const data = await callPortal({ action: "setup_pin", token, pin: pinInput });
      setVerifiedPin(pinInput);
      setChildren(data.children);
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
      setChildren(data.children);
      setPhase("dashboard");
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function approve(studentId, submission) {
    setBusyId(submission.id);
    setError("");
    try {
      const data = await callPortal({ action: "approve", token, pin: verifiedPin, studentId, submissionId: submission.id });
      setChildren(data.children);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function reject(studentId, submission) {
    setBusyId(submission.id);
    setError("");
    try {
      const data = await callPortal({ action: "reject", token, pin: verifiedPin, studentId, submissionId: submission.id });
      setChildren(data.children);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  if (phase === "loading") {
    return (
      <div className="app-shell" style={{ maxWidth: 480 }}>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (phase === "not-found") {
    return (
      <div className="app-shell" style={{ maxWidth: 480 }}>
        <div className="card">
          <p>This link isn't recognized. Double-check it was copied correctly, or ask the teacher for a fresh one.</p>
        </div>
      </div>
    );
  }

  if (phase === "setup") {
    return (
      <div className="app-shell" style={{ maxWidth: 420 }}>
        <div className="card">
          <div className="card-title">Set Up Family Access</div>
          <p className="muted" style={{ marginBottom: 14 }}>
            First time here — pick a 4-digit PIN. This one login covers every child you have in
            an EnrichMind class, in one place.
          </p>
          <form onSubmit={submitSetup}>
            <label className="muted">Choose a 4-digit PIN</label>
            <br />
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
              style={{ marginBottom: 10, width: "100%" }}
            />
            <br />
            <label className="muted">Confirm PIN</label>
            <br />
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinConfirm}
              onChange={(e) => setPinConfirm(e.target.value.replace(/\D/g, ""))}
              style={{ marginBottom: 14, width: "100%" }}
            />
            <br />
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Setting up…" : "Set Up Access"}
            </button>
            {error && <div className="error-text">{error}</div>}
          </form>
        </div>
      </div>
    );
  }

  if (phase === "enter-pin") {
    return (
      <div className="app-shell" style={{ maxWidth: 420 }}>
        <div className="card">
          <div className="card-title">Enter Your PIN</div>
          <form onSubmit={submitPin}>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ""))}
              style={{ marginBottom: 14, width: "100%" }}
              autoFocus
            />
            <br />
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "Checking…" : "Enter"}
            </button>
            {error && <div className="error-text">{error}</div>}
          </form>
          <p className="muted no-print" style={{ marginTop: 14, fontSize: 12.5 }}>
            Forgot your PIN? Ask the teacher to reset access for your family — that reopens this
            link for a fresh setup.
          </p>
        </div>
      </div>
    );
  }

  // dashboard
  return (
    <div className="app-shell" style={{ maxWidth: 640 }}>
      <div className="topbar">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-title">Family Dashboard</div>
        </div>
      </div>
      <p className="muted" style={{ marginBottom: 16 }}>
        Everything for every child linked to {email}, across every class they're in.
      </p>

      {error && <div className="error-text">{error}</div>}

      {children.length === 0 && (
        <div className="card">
          <p className="muted">No students found for this email yet.</p>
        </div>
      )}

      {children.map((child) => (
        <ChildSection key={child.student.id} child={child} busyId={busyId} onApprove={approve} onReject={reject} />
      ))}
    </div>
  );
}

function ChildSection({ child, busyId, onApprove, onReject }) {
  const { student, groupName, weeks, peers, entries, pending, recent } = child;

  const entriesByWeek = {};
  entries.forEach((e) => {
    entriesByWeek[e.week_id] = entriesByWeek[e.week_id] || {};
    entriesByWeek[e.week_id][e.student_id] = e;
  });

  const latestWeek = weeks[weeks.length - 1];
  const latestWeekId = latestWeek?.id;
  const myEntry = latestWeekId ? entriesByWeek[latestWeekId]?.[student.id] : null;
  const myDivision = latestWeekId
    ? assignDivisions(entriesByWeek, weeks, peers, latestWeekId).find((d) => d.student.id === student.id)
    : null;
  const streakInfo = computeStreak(entriesByWeek, weeks, student.id, peers);
  const myTotal = latestWeekId ? effectiveTotal(entriesByWeek, weeks, latestWeekId, student.id) : null;
  const myTrailingAvg = latestWeekId ? trailingAverage(entriesByWeek, weeks, student.id, latestWeekId) : null;

  return (
    <>
      <div className="card" style={{ borderTop: "3px solid var(--purple-500, #6d3fc9)" }}>
        <div className="card-title">
          {student.name} — {groupName}
        </div>
        {myEntry ? (
          <>
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
                  <div>📘 Weekly Assignments</div>
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
            {myTrailingAvg !== null && (
              <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>
                Own 4-week average: {myTrailingAvg.toFixed(1)} — this week is{" "}
                {myTotal >= myTrailingAvg ? "above" : "below"} that by {Math.abs(myTotal - myTrailingAvg).toFixed(1)}.
              </p>
            )}
          </>
        ) : (
          <p className="muted">No scores logged yet for {student.name}.</p>
        )}
      </div>

      <div className="card">
        <div className="card-title">
          {student.name}'s Tasks Waiting for Approval ({pending.length})
        </div>
        {pending.length === 0 && <p className="muted">Nothing to review right now.</p>}
        {pending.map((s) => (
          <div key={s.id} className="leader-row">
            <div className="leader-name">
              {s.task_assignments?.is_catchup && <span className="pill" style={{ marginRight: 6 }}>⏪ Catch-up</span>}
              {s.task_assignments?.title}
              {s.reflection && <div className="muted" style={{ fontSize: 12 }}>"{s.reflection}"</div>}
            </div>
            <button className="btn" onClick={() => onApprove(student.id, s)} disabled={busyId === s.id}>
              Yes, they did it
            </button>
            <button className="btn secondary" onClick={() => onReject(student.id, s)} disabled={busyId === s.id}>
              Not yet
            </button>
          </div>
        ))}
      </div>

      {recent.length > 0 && (
        <div className="card">
          <div className="card-title">Recently Reviewed</div>
          {recent.map((s) => (
            <div key={s.id} className="leader-row">
              <div className="leader-name">{s.task_assignments?.title}</div>
              <span className="pill">{s.status}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
