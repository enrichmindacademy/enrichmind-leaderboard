import { useMemo, useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";
import { INTEREST_OPTIONS } from "../lib/autoAssign";
import NextMilestone from "../components/NextMilestone";
import KpiStrip from "../components/KpiStrip";
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

export default function MyProgress() {
  const {
    students,
    weeks,
    entriesByWeek,
    assignments,
    submissions,
    reload,
    loading,
    groups,
    groupId,
    selectGroup,
  } = useGroup();
  const group = groups.find((g) => g.id === groupId);
  const [studentId, setStudentId] = useState("");

  useEffect(() => {
    setStudentId("");
  }, [groupId]);
  const [submitting, setSubmitting] = useState(null);
  const [reflectionDrafts, setReflectionDrafts] = useState({});
  const [goalMetric, setGoalMetric] = useState("total");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalNote, setGoalNote] = useState("");
  const [goalSaving, setGoalSaving] = useState(false);
  const [interestSaving, setInterestSaving] = useState(false);
  const activeStudents = students.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name));
  const student = students.find((s) => s.id === studentId);
  const latestWeek = weeks[weeks.length - 1];
  const latestWeekId = latestWeek?.id;
  const myEntry = latestWeekId ? entriesByWeek[latestWeekId]?.[studentId] : null;

  // If this level has sessions, compare a student only against their own
  // session-mates (matches the Projector Board, which shows one session
  // at a time) rather than the whole level. Students with no session set
  // (session_id null) naturally group together — which is every student
  // when a level has no sessions at all, so this is a no-op there.
  const peerStudents = student
    ? activeStudents.filter((s) => s.session_id === student.session_id)
    : activeStudents;

  useEffect(() => {
    setGoalMetric(myEntry?.goal_metric || "total");
    setGoalTarget(myEntry?.goal_target ?? "");
    setGoalNote(myEntry?.student_goal || "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId, latestWeekId]);

  const rankRows = useMemo(() => {
    if (!latestWeekId) return [];
    return computeGrowthForWeek(entriesByWeek, weeks, latestWeekId, peerStudents)
      .filter((r) => r.currentTotal !== null)
      .sort((a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity));
  }, [entriesByWeek, weeks, latestWeekId, peerStudents]);

  const myRankIndex = rankRows.findIndex((r) => r.student.id === studentId);
  const myRow = rankRows[myRankIndex];
  const streakInfo = studentId ? computeStreak(entriesByWeek, weeks, studentId) : { streak: 0 };

  const divisions = latestWeekId
    ? assignDivisions(entriesByWeek, weeks, peerStudents, latestWeekId)
    : [];
  const myDivision = divisions.find((d) => d.student.id === studentId);
  const change = studentId
    ? divisionChange(entriesByWeek, weeks, peerStudents, latestWeekId, studentId)
    : null;

  let catchUpLine = null;
  let nextTierGap = null;
  if (myDivision && latestWeekId) {
    const tierPeers = divisions
      .filter((d) => d.tierIndex === myDivision.tierIndex)
      .map((d) => ({
        ...d,
        weekTotal: effectiveTotal(entriesByWeek, weeks, latestWeekId, d.student.id) ?? 0,
      }))
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

  const newBest = studentId && latestWeekId
    ? isPersonalBest(entriesByWeek, weeks, latestWeekId, studentId)
    : false;

  const isSuperstarThisWeek = studentId && latestWeekId
    ? isSuperstarWeek(entriesByWeek, latestWeekId, studentId)
    : false;
  const totalSuperstars = studentId ? superstarCount(entriesByWeek, weeks, studentId) : 0;

  // Every week logged so far, not just the last few — this naturally
  // grows as new weeks get added, no cap to raise later. Class average is
  // computed from the same peer group used for League/rank comparisons
  // (same-session peers, or the whole Level if no sessions), so a
  // student can see their own line against where the class actually
  // stands each week, not just their own number in isolation.
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
    // For stars/IXL, suggest a bit above last known week's actual.
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
    if (isSuperstarThisWeek)
      return "Perfect IXL score again — you're setting the bar for the whole class. Keep it up!";
    const seed = Math.abs(studentId?.charCodeAt?.(0) || 0) + weeks.length;
    if (myRow.growth > 0) return pick(NUDGES_UP, seed).replace("{g}", myRow.growth.toFixed(1));
    if (myRow.growth === 0) return pick(NUDGES_FLAT, seed);
    return pick(NUDGES_DOWN, seed);
  }

  // Personalized tasks: whatever auto-assignment picked for THIS student
  // THIS week — not a shared list everyone sees the same version of.
  const myAssignments = latestWeekId
    ? assignments.filter((a) => a.student_id === studentId && a.week_id === latestWeekId)
    : [];
  const mySubmissions = latestWeekId
    ? submissions.filter((s) => s.student_id === studentId && s.week_id === latestWeekId)
    : [];
  const submissionByAssignment = Object.fromEntries(mySubmissions.map((s) => [s.assignment_id, s]));
  const maxTaskPoints = myAssignments.length > 0 ? Math.max(...myAssignments.map((a) => Number(a.points))) : 0;
  const pendingCatchUps = myAssignments.filter(
    (a) => a.is_catchup && submissionByAssignment[a.id]?.status !== "approved"
  );

  async function markTaskDone(assignment) {
    setSubmitting(assignment.id);
    try {
      const existing = submissionByAssignment[assignment.id];
      const reflection = reflectionDrafts[assignment.id] || null;
      if (existing && existing.status === "rejected") {
        await supabase
          .from("task_submissions")
          .update({
            status: "pending",
            reflection,
            submitted_at: new Date().toISOString(),
            reviewed_at: null,
          })
          .eq("id", existing.id);
      } else if (!existing) {
        await supabase.from("task_submissions").insert({
          assignment_id: assignment.id,
          student_id: studentId,
          week_id: latestWeekId,
          status: "pending",
          reflection,
        });
      }
      await reload();
    } finally {
      setSubmitting(null);
    }
  }

  async function saveGoal() {
    if (!latestWeekId || goalTarget === "") return;
    setGoalSaving(true);
    try {
      const payload = {
        goal_metric: goalMetric,
        goal_target: Number(goalTarget),
        student_goal: goalNote,
      };
      if (myEntry) {
        await supabase.from("entries").update(payload).eq("id", myEntry.id);
      } else {
        await supabase.from("entries").insert({
          week_id: latestWeekId,
          student_id: studentId,
          classpoint_stars: 0,
          ixl_avg: 0,
          bonus: 0,
          ...payload,
        });
      }
      await reload();
    } finally {
      setGoalSaving(false);
    }
  }

  async function toggleInterest(key) {
    setInterestSaving(true);
    const current = student?.interests || [];
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    await supabase.from("students").update({ interests: next }).eq("id", studentId);
    await reload();
    setInterestSaving(false);
  }

  function printCertificate() {
    window.print();
  }

  if (loading) return <div className="card">Loading…</div>;

  return (
    <>
      <div className="card no-print">
        <div className="card-title">Class</div>
        <select value={groupId || ""} onChange={(e) => selectGroup(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <p className="muted" style={{ marginTop: 6 }}>
          Switching this also changes the sidebar's class picker up top — they're the same
          selection, just shown here too since it's easy to miss it's the whole page's context.
        </p>
      </div>

      <div className="card no-print">
        <div className="card-title">Pick Your Name</div>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)}>
          <option value="">— Select —</option>
          {activeStudents.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {studentId && (
        <>
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
              Pick what you're into — your weekly tasks will include some things you
              actually enjoy, not just math.
            </p>
            <div className="row" style={{ flexWrap: "wrap" }}>
              {INTEREST_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  className={`btn ${(student?.interests || []).includes(opt.key) ? "" : "secondary"}`}
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
            {newBest && (
              <p style={{ color: "#c9891f", fontWeight: 700, marginTop: 12 }}>
                🏆 New personal best this week!
              </p>
            )}
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
              Pick something you can actually measure — a number to hit, not just "do
              better." We'll tell you exactly how close you are.
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
              <button
                className="btn secondary"
                type="button"
                onClick={() => setGoalTarget(String(suggestedTarget(goalMetric)))}
              >
                Use Suggestion ({suggestedTarget(goalMetric)})
              </button>
            </div>
            <input
              style={{ width: "100%", marginTop: 8 }}
              placeholder="Optional note — why this goal?"
              value={goalNote}
              onChange={(e) => setGoalNote(e.target.value)}
            />
            <button
              className="btn"
              style={{ marginTop: 8 }}
              onClick={saveGoal}
              disabled={goalSaving || goalTarget === ""}
            >
              {goalSaving ? "Saving…" : myGoal ? "Update Goal" : "Set Goal"}
            </button>
          </div>

          <div className="card no-print">
            <div className="card-title">A Note Just For You</div>
            <p>{nudgeMessage()}</p>
            {catchUpLine && <p className="muted">{catchUpLine}</p>}
            {myGoal && !myGoal.achieved && (
              <p className="muted">
                🎯 {myGoal.remaining} more {GOAL_METRIC_LABEL[myGoal.metric].toLowerCase()} to hit
                your own goal of {myGoal.target} — that one's just for you.
              </p>
            )}
            {streakInfo.usedFreeze && (
              <p className="muted">❄️ A missed week was covered by your streak freeze.</p>
            )}
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
                  Finish up your Weekly Assignments — you're at {Number(myEntry.ixl_avg).toFixed(0)}%
                  so far this week.
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
                "⏪ Catch-up" is something from last week that didn't get finished yet;
                finishing that is usually the fastest way to move up. Marking one done only
                sends it for approval; a parent or teacher confirms it before points are added.
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
                          <span
                            className="match-badge match-unsure"
                            style={{ marginRight: 6 }}
                            title="Left over from last week — finish this to catch up"
                          >
                            ⏪ Catch-up
                          </span>
                        )}
                        {CATEGORY_LABEL[a.category]} {a.title}
                      </div>
                      <span className="pill">+{Number(a.points)} pts</span>
                      {sub?.status === "approved" && (
                        <span className="match-badge match-good">✅ Approved</span>
                      )}
                      {sub?.status === "pending" && (
                        <span className="match-badge match-unsure">Waiting for review</span>
                      )}
                      {canSubmit && (
                        <button
                          className="btn secondary"
                          disabled={submitting === a.id}
                          onClick={() => markTaskDone(a)}
                        >
                          {sub?.status === "rejected" ? "Try again" : "I did this!"}
                        </button>
                      )}
                    </div>
                    {canSubmit && (
                      <input
                        style={{ width: "100%" }}
                        placeholder="Optional: what was that like? (not graded)"
                        value={reflectionDrafts[a.id] || ""}
                        onChange={(e) =>
                          setReflectionDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))
                        }
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
                  <Tooltip
                    contentStyle={{ background: "#1e0b3c", border: "1px solid rgba(255,255,255,0.15)" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12.5 }} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="You"
                    stroke="#5b8def"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    connectNulls
                  />
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
              <div className="certificate-name">{student?.name}</div>
              <div className="certificate-detail">
                {isSuperstarThisWeek && "Perfect IXL Score — Superstar of the Week"}
                {isSuperstarThisWeek && newBest && " & "}
                {newBest && "New Personal Best"}
              </div>
              <div className="certificate-week">{latestWeek?.label}</div>
              <div className="certificate-footer">EnrichMind Academy</div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
