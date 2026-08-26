import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { INTEREST_OPTIONS } from "../lib/autoAssign";
import {
  computeGrowthForWeek,
  computeStreak,
  isPersonalBest,
  isSuperstarWeek,
  superstarCount,
  effectiveTotal,
  assignDivisions,
  divisionChange,
  trailingAverage,
  goalProgress,
  goalsAchievedCount,
  GOAL_METRIC_LABEL,
} from "../lib/calc";
import NextMilestone from "../components/NextMilestone";
import KpiStrip from "../components/KpiStrip";

const CATEGORY_LABEL = { math: "📐 Math", habit: "🌱 Habit" };

const NUDGES_UP = [
  "You're on fire — up {g} pts vs your own average. Keep that streak alive!",
  "New high energy this week: +{g} pts above your usual. Nice work!",
  "That's real growth — {g} pts better than your own average. Keep pushing!",
];
const NUDGES_FLAT = [
  "Steady week — right at your usual average. Let's chase a new personal best next time.",
  "You held your ground this week. One more push and you'll set a new record.",
];
const NUDGES_DOWN = [
  "A quieter week, but every star and skill still counts. Let's bounce back next time!",
  "Everyone has an off week — your streak isn't broken, and next week is a fresh start.",
  "Small dip this week — no big deal. Come back strong and it'll wash right out.",
];

function pick(list, seed) {
  return list[seed % list.length];
}

// This page is intentionally NOT behind the teacher login — a student
// reaches it via their own private link (yourapp.netlify.app/student/<token>)
// from Roster. It never talks to Supabase directly; every read and the few
// self-service writes (marking a task done, setting a goal, picking
// interests) go through the student-portal Netlify Function, which uses
// the service-role key server-side. All the math below reuses the exact
// same calc.js functions the teacher's Projector Board and My Progress
// use, just fed by this fetched payload instead of the live app context.
async function callPortal(body) {
  const res = await fetch("/.netlify/functions/student-portal", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

export default function StudentProgress() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [ctx, setCtx] = useState(null); // { student, group, weeks, peers, entries, tasks, assignments, submissions }

  const [submitting, setSubmitting] = useState(null);
  const [reflectionDrafts, setReflectionDrafts] = useState({});
  const [goalMetric, setGoalMetric] = useState("total");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalNote, setGoalNote] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);
  const [interestSaving, setInterestSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const data = await callPortal({ action: "lookup", token });
      setCtx(data);
    } catch (e) {
      if (e.message.includes("not recognized")) setNotFound(true);
      else setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const studentId = ctx?.student?.id;
  const weeks = ctx?.weeks || [];
  const peers = ctx?.peers || [];
  const entriesByWeek = useMemo(() => {
    const map = {};
    (ctx?.entries || []).forEach((e) => {
      map[e.week_id] = map[e.week_id] || {};
      map[e.week_id][e.student_id] = e;
    });
    return map;
  }, [ctx]);

  const latestWeek = weeks[weeks.length - 1];
  const latestWeekId = latestWeek?.id;
  const myEntry = latestWeekId ? entriesByWeek[latestWeekId]?.[studentId] : null;

  useEffect(() => {
    setGoalMetric(myEntry?.goal_metric || "total");
    setGoalTarget(myEntry?.goal_target ?? "");
    setGoalNote(myEntry?.student_goal || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, latestWeekId]);

  const peerStudents = ctx?.student
    ? peers.filter((s) => s.session_id === (peers.find((p) => p.id === studentId)?.session_id ?? null))
    : peers;

  const rankRows = useMemo(() => {
    if (!latestWeekId || !ctx) return [];
    return computeGrowthForWeek(entriesByWeek, weeks, latestWeekId, peerStudents)
      .filter((r) => r.currentTotal !== null)
      .sort((a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity));
  }, [entriesByWeek, weeks, latestWeekId, peerStudents, ctx]);

  const myRankIndex = rankRows.findIndex((r) => r.student.id === studentId);
  const myRow = rankRows[myRankIndex];
  const streakInfo = studentId ? computeStreak(entriesByWeek, weeks, studentId, peerStudents) : { streak: 0 };

  const divisions = latestWeekId && ctx
    ? assignDivisions(entriesByWeek, weeks, peerStudents, latestWeekId)
    : [];
  const myDivision = divisions.find((d) => d.student.id === studentId);
  const change = studentId && ctx
    ? divisionChange(entriesByWeek, weeks, peerStudents, latestWeekId, studentId)
    : null;

  let catchUpLine = null;
  let nextTierGap = null;
  if (myDivision && latestWeekId) {
    const tierPeers = divisions
      .filter((d) => d.tierIndex === myDivision.tierIndex)
      .map((d) => ({ ...d, weekTotal: effectiveTotal(entriesByWeek, weeks, latestWeekId, d.student.id) ?? 0 }))
      .sort((a, b) => b.weekTotal - a.weekTotal);
    const myIdx = tierPeers.findIndex((d) => d.student.id === studentId);
    if (myIdx > 0) {
      const ahead = tierPeers[myIdx - 1];
      const gap = ahead.weekTotal - tierPeers[myIdx].weekTotal;
      if (gap > 0) {
        catchUpLine = `You're only ${gap.toFixed(1)} pts behind ${ahead.student.name} in the ${myDivision.tierName} League — catch up next week!`;
        nextTierGap = { label: `Catch ${ahead.student.name}`, gap };
      }
    } else if (myIdx === 0 && tierPeers.length > 1) {
      catchUpLine = `You're leading the ${myDivision.tierName} League this week!`;
    }
  }

  const newBest = studentId && latestWeekId ? isPersonalBest(entriesByWeek, weeks, latestWeekId, studentId) : false;
  const isSuperstarThisWeek = studentId && latestWeekId ? isSuperstarWeek(entriesByWeek, latestWeekId, studentId) : false;
  const totalSuperstars = studentId ? superstarCount(entriesByWeek, weeks, studentId) : 0;

  const trend = weeks.map((w) => {
    const classTotals = peerStudents
      .map((s) => effectiveTotal(entriesByWeek, weeks, w.id, s.id))
      .filter((t) => t !== null);
    const classAvg = classTotals.length > 0 ? classTotals.reduce((a, b) => a + b, 0) / classTotals.length : null;
    return {
      label: w.label,
      total: effectiveTotal(entriesByWeek, weeks, w.id, studentId),
      classAvg: classAvg !== null ? Math.round(classAvg * 10) / 10 : null,
    };
  });

  const myGoal = goalProgress(myEntry);
  const goalsHit = studentId ? goalsAchievedCount(entriesByWeek, weeks, studentId) : 0;

  const classAvgThisWeek = (() => {
    if (!latestWeekId) return null;
    const totals = peerStudents
      .map((s) => effectiveTotal(entriesByWeek, weeks, latestWeekId, s.id))
      .filter((t) => t !== null);
    return totals.length > 0 ? totals.reduce((a, b) => a + b, 0) / totals.length : null;
  })();

  function suggestedTarget(metric) {
    if (metric === "total") {
      const avg = latestWeekId ? trailingAverage(entriesByWeek, weeks, studentId, latestWeekId) : null;
      return avg !== null ? Math.ceil(avg + 5) : 20;
    }
    const priorWeeks = weeks.filter((w) => w.id !== latestWeekId);
    const lastEntry = [...priorWeeks].reverse().map((w) => entriesByWeek[w.id]?.[studentId]).find(Boolean);
    if (metric === "stars") return lastEntry ? Number(lastEntry.classpoint_stars) + 1 : 3;
    if (metric === "ixl_avg") return lastEntry ? Math.min(100, Number(lastEntry.ixl_avg) + 5) : 90;
    return "";
  }

  function nudgeMessage() {
    if (!myRow) return "No data yet this week — jump in next week and we'll start tracking your growth!";
    if (myRow.trailingAvg === null)
      return "Welcome! This is your very first tracked week, so there's no history to compare against yet — everything from here is about beating your own numbers, not anyone else's.";
    if (isSuperstarThisWeek) return "Perfect IXL score again — you're setting the bar for the whole class. Keep it up!";
    const seed = Math.abs(studentId?.charCodeAt?.(0) || 0) + weeks.length;
    if (myRow.growth > 0) return pick(NUDGES_UP, seed).replace("{g}", myRow.growth.toFixed(1));
    if (myRow.growth === 0) return pick(NUDGES_FLAT, seed);
    return pick(NUDGES_DOWN, seed);
  }

  const myAssignments = latestWeekId ? (ctx?.assignments || []).filter((a) => a.week_id === latestWeekId) : [];
  const mySubmissions = latestWeekId ? (ctx?.submissions || []).filter((s) => s.week_id === latestWeekId) : [];
  const submissionByAssignment = Object.fromEntries(mySubmissions.map((s) => [s.assignment_id, s]));
  const maxTaskPoints = myAssignments.length > 0 ? Math.max(...myAssignments.map((a) => Number(a.points))) : 0;
  const pendingCatchUps = myAssignments.filter((a) => a.is_catchup && submissionByAssignment[a.id]?.status !== "approved");

  async function markTaskDone(assignment) {
    setSubmitting(assignment.id);
    try {
      const data = await callPortal({
        action: "submit_task",
        token,
        assignmentId: assignment.id,
        reflection: reflectionDrafts[assignment.id] || null,
      });
      setCtx(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(null);
    }
  }

  async function saveGoal() {
    if (!latestWeekId || goalTarget === "") return;
    setGoalSaving(true);
    try {
      const data = await callPortal({
        action: "save_goal",
        token,
        weekId: latestWeekId,
        goalMetric,
        goalTarget: Number(goalTarget),
        note: goalNote,
      });
      setCtx(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setGoalSaving(false);
    }
  }

  async function toggleInterest(key) {
    setInterestSaving(true);
    const current = ctx?.student?.interests || [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    try {
      const data = await callPortal({ action: "set_interests", token, interests: next });
      setCtx(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setInterestSaving(false);
    }
  }

  function printCertificate() {
    window.print();
  }

  if (loading) {
    return (
      <div className="app-shell">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="app-shell">
        <div className="card">
          <p>This link doesn't match any student. Please check the link your teacher shared.</p>
        </div>
      </div>
    );
  }

  const firstName = ctx?.student?.name?.split(" ")[0] || "";

  return (
    <div className="app-shell" style={{ maxWidth: 640 }}>
      <div className="topbar no-print">
        <div className="brand">
          <div className="brand-mark" />
          <div className="brand-title">Hi, {firstName} 👋</div>
        </div>
      </div>

      {error && (
        <div className="card no-print">
          <p className="error-text">{error}</p>
        </div>
      )}

      <NextMilestone
        isSuperstarThisWeek={isSuperstarThisWeek}
        myGoal={myGoal}
        nextTierGap={nextTierGap}
        pendingCatchUps={pendingCatchUps.length}
        tierName={myDivision?.tierName}
      />

      <div className="card no-print">
        <div className="card-title">My Interests</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Pick what you're into — your weekly tasks will include some things you actually
          enjoy, not just math.
        </p>
        <div className="row" style={{ flexWrap: "wrap" }}>
          {INTEREST_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              className={`btn ${(ctx?.student?.interests || []).includes(opt.key) ? "" : "secondary"}`}
              disabled={interestSaving}
              onClick={() => toggleInterest(opt.key)}
              style={{ fontSize: 12, padding: "6px 10px" }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">Your Standing</div>
        <KpiStrip
          items={[
            { label: "League", value: `${myDivision?.tierName || "—"}${change === "up" ? " ⬆️" : change === "down" ? " ⬇️" : ""}` },
            { label: "Streak", value: `🔥 ${streakInfo.streak}${streakInfo.usedFreeze ? " ❄️" : ""}` },
            { label: "This Week", value: myRow ? `${myRow.growth >= 0 ? "+" : ""}${myRow.growth.toFixed(1)}` : "—" },
            { label: "Superstars", value: `🌟 ${totalSuperstars}` },
            { label: "Goals Hit", value: `🎯 ${goalsHit}` },
          ]}
        />
        {newBest && <p style={{ color: "#c9891f", fontWeight: 700, marginTop: 12 }}>🏆 New personal best this week!</p>}
        {isSuperstarThisWeek && (
          <p style={{ color: "#c9891f", fontWeight: 700, marginTop: 12 }}>
            🌟 Perfect IXL score this week — Superstar #{totalSuperstars}!
          </p>
        )}
        {(newBest || isSuperstarThisWeek) && (
          <button className="btn secondary no-print" style={{ marginTop: 12 }} onClick={printCertificate}>
            🖨️ Print Certificate
          </button>
        )}
        {myEntry?.bonus_note && (
          <div style={{ marginTop: 12 }}>
            <div className="muted" style={{ marginBottom: 4 }}>Why bonus points were given this week:</div>
            <p style={{ whiteSpace: "pre-line", fontSize: 13 }}>{myEntry.bonus_note}</p>
          </div>
        )}
      </div>

      {myEntry && (
        <div className="card">
          <div className="card-title">This Week's Score Breakdown</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", rowGap: 8, columnGap: 16, fontSize: 13.5 }}>
            {myEntry.classpoint_stars !== 0 && (
              <>
                <div>⭐ Class Participation ({myEntry.classpoint_stars} star{myEntry.classpoint_stars === 1 ? "" : "s"} × 5)</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.classpoint_stars * 5).toFixed(1)} pts</div>
              </>
            )}
            {Number(myEntry.ixl_avg) !== 0 && (
              <>
                <div>📘 Assignments</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.ixl_avg).toFixed(1)} pts</div>
              </>
            )}
            {Number(myEntry.notebooking_score) !== 0 && (
              <>
                <div>📝 Notebooking</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.notebooking_score).toFixed(1)} pts</div>
              </>
            )}
            {Number(myEntry.study_guide_score) !== 0 && (
              <>
                <div>📗 Study Guide</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.study_guide_score).toFixed(1)} pts</div>
              </>
            )}
            {Number(myEntry.exam_score) !== 0 && (
              <>
                <div>🧪 Exams</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.exam_score).toFixed(1)} pts</div>
              </>
            )}
            {Number(myEntry.exam_corrections_score) !== 0 && (
              <>
                <div>✏️ Exam Corrections</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.exam_corrections_score).toFixed(1)} pts</div>
              </>
            )}
            {Number(myEntry.bonus) !== 0 && (
              <>
                <div>🎁 Bonus</div>
                <div style={{ fontWeight: 700 }}>{Number(myEntry.bonus).toFixed(1)} pts</div>
              </>
            )}
          </div>
          {myEntry.classpoint_stars === 0 &&
            Number(myEntry.ixl_avg) === 0 &&
            Number(myEntry.notebooking_score) === 0 &&
            Number(myEntry.study_guide_score) === 0 &&
            Number(myEntry.exam_score) === 0 &&
            Number(myEntry.exam_corrections_score) === 0 &&
            Number(myEntry.bonus) === 0 && (
              <p className="muted" style={{ fontSize: 12.5 }}>No scores entered for this week yet.</p>
            )}
          <div style={{ borderTop: "1px solid var(--card-border)", marginTop: 10, paddingTop: 10 }}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontWeight: 700 }}>Your total this week</span>
              <span className="font-display" style={{ fontWeight: 800 }}>
                {Number(myEntry.total).toFixed(1)} pts
              </span>
            </div>
            {classAvgThisWeek !== null && (
              <div className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
                Class average: {classAvgThisWeek.toFixed(1)} pts — you're{" "}
                {Number(myEntry.total) >= classAvgThisWeek ? "above" : "below"} the class average by{" "}
                {Math.abs(Number(myEntry.total) - classAvgThisWeek).toFixed(1)} pts
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card no-print">
        <div className="card-title">My Goal This Week</div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Pick something you can actually measure — a number to hit, not just "do better."
          We'll tell you exactly how close you are.
        </p>
        {myGoal && (
          <div style={{ marginBottom: 12 }}>
            <p style={{ marginBottom: 4 }}>
              Target: <strong>{GOAL_METRIC_LABEL[myGoal.metric]} ≥ {myGoal.target}</strong>
              {goalNote && <span className="muted"> — "{goalNote}"</span>}
            </p>
            {myGoal.achieved ? (
              <p style={{ color: "#c9891f", fontWeight: 700, margin: 0 }}>
                🎯 Goal achieved! You're at {myGoal.actual} — target was {myGoal.target}.
              </p>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                Currently at {myGoal.actual ?? 0} — {myGoal.remaining} more to hit your goal.
              </p>
            )}
          </div>
        )}
        <div className="row" style={{ flexWrap: "wrap" }}>
          <select value={goalMetric} onChange={(e) => setGoalMetric(e.target.value)}>
            {Object.entries(GOAL_METRIC_LABEL).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <span className="muted">at least</span>
          <input
            type="number"
            style={{ width: 90 }}
            placeholder={String(suggestedTarget(goalMetric))}
            value={goalTarget}
            onChange={(e) => setGoalTarget(e.target.value)}
          />
          <button className="btn secondary" type="button" onClick={() => setGoalTarget(String(suggestedTarget(goalMetric)))}>
            Use Suggestion ({suggestedTarget(goalMetric)})
          </button>
        </div>
        <input
          style={{ width: "100%", marginTop: 8 }}
          placeholder="Optional note — why this goal?"
          value={goalNote}
          onChange={(e) => setGoalNote(e.target.value)}
        />
        <button className="btn" style={{ marginTop: 8 }} onClick={saveGoal} disabled={goalSaving || goalTarget === ""}>
          {goalSaving ? "Saving…" : myGoal ? "Update Goal" : "Set Goal"}
        </button>
      </div>

      <div className="card no-print">
        <div className="card-title">A Note Just For You</div>
        <p>{nudgeMessage()}</p>
        {catchUpLine && <p className="muted">{catchUpLine}</p>}
        {myGoal && !myGoal.achieved && (
          <p className="muted">
            🎯 {myGoal.remaining} more {GOAL_METRIC_LABEL[myGoal.metric].toLowerCase()} to hit your own goal of{" "}
            {myGoal.target} — that one's just for you.
          </p>
        )}
        {streakInfo.usedFreeze && <p className="muted">❄️ A missed week was covered by your streak freeze.</p>}
      </div>

      <div className="card no-print">
        <div className="card-title">Ways to Climb Higher</div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          {pendingCatchUps.length > 0 && (
            <li>
              <strong>
                Finish {pendingCatchUps.length === 1 ? "the task" : `${pendingCatchUps.length} tasks`} left
                over from last week
              </strong>{" "}
              — that's usually the fastest way to catch up.
            </li>
          )}
          {myGoal && !myGoal.achieved && (
            <li>
              Hit your own goal: {myGoal.remaining} more {GOAL_METRIC_LABEL[myGoal.metric].toLowerCase()}.
            </li>
          )}
          {catchUpLine && <li>{catchUpLine}</li>}
          {myEntry && Number(myEntry.ixl_avg) < 100 && (
            <li>
              Finish up your Weekly Assignments — you're at {Number(myEntry.ixl_avg).toFixed(0)}% so far
              this week.
            </li>
          )}
          {!isSuperstarThisWeek && (
            <li>Score a perfect 100% on Weekly Assignments this week to become a Superstar.</li>
          )}
          {myAssignments.length > 0 && (
            <li>Complete a task below for up to {maxTaskPoints} bonus points once approved.</li>
          )}
          {streakInfo.streak > 0 && <li>Keep showing up each week to grow your 🔥 streak.</li>}
        </ul>
      </div>

      {myAssignments.length > 0 && (
        <div className="card no-print">
          <div className="card-title">This Week's Tasks</div>
          <p className="muted" style={{ marginBottom: 10 }}>
            Picked for you based on your interests — not just math. Anything marked
            "⏪ Catch-up" is something from last week that didn't get finished yet. Marking
            one done sends it for approval; a parent or teacher confirms it before points
            are added.
          </p>
          {[...myAssignments]
            .sort((a, b) => Number(b.is_catchup) - Number(a.is_catchup))
            .map((a) => {
              const sub = submissionByAssignment[a.id];
              const canSubmit = !sub || sub.status === "rejected";
              return (
                <div key={a.id} style={{ marginBottom: 10 }}>
                  <div className="leader-row" style={{ marginBottom: canSubmit ? 4 : 8 }}>
                    <div className="leader-name">
                      {a.is_catchup && (
                        <span className="match-badge match-unsure" style={{ marginRight: 6 }}>
                          ⏪ Catch-up
                        </span>
                      )}
                      {CATEGORY_LABEL[a.category]} {a.title}
                    </div>
                    <span className="pill">+{Number(a.points)} pts</span>
                    {sub?.status === "approved" && <span className="match-badge match-good">✅ Approved</span>}
                    {sub?.status === "pending" && <span className="match-badge match-unsure">Waiting for review</span>}
                    {canSubmit && (
                      <button className="btn secondary" disabled={submitting === a.id} onClick={() => markTaskDone(a)}>
                        {sub?.status === "rejected" ? "Try again" : "I did this!"}
                      </button>
                    )}
                  </div>
                  {canSubmit && (
                    <input
                      style={{ width: "100%" }}
                      placeholder="Optional: what was that like? (not graded)"
                      value={reflectionDrafts[a.id] || ""}
                      onChange={(e) => setReflectionDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    />
                  )}
                </div>
              );
            })}
        </div>
      )}

      <div className="card no-print">
        <div className="card-title">Growth Curve — Every Week</div>
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,20,60,0.12)" />
              <XAxis dataKey="label" stroke="#736c8d" fontSize={12} />
              <YAxis stroke="#736c8d" fontSize={12} />
              <Tooltip contentStyle={{ background: "#1e0b3c", border: "1px solid rgba(255,255,255,0.15)" }} />
              <Legend wrapperStyle={{ fontSize: 12.5 }} />
              <Line type="monotone" dataKey="total" name="You" stroke="#5b8def" strokeWidth={3} dot={{ r: 4 }} connectNulls />
              <Line
                type="monotone"
                dataKey="classAvg"
                name="Class Average"
                stroke="#c9891f"
                strokeWidth={2}
                strokeDasharray="5 4"
                dot={{ r: 3 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="certificate-print">
        <div className="certificate-inner">
          <div className="certificate-title">Certificate of Achievement</div>
          <div className="certificate-name">{ctx?.student?.name}</div>
          <div className="certificate-detail">
            {isSuperstarThisWeek && "Perfect IXL Score — Superstar of the Week"}
            {isSuperstarThisWeek && newBest && " & "}
            {newBest && "New Personal Best"}
          </div>
          <div className="certificate-week">{latestWeek?.label}</div>
          <div className="certificate-footer">EnrichMind Academy</div>
        </div>
      </div>
    </div>
  );
}
