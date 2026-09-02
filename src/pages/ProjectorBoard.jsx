import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";
import {
  computeGrowthForWeek,
  computeStreak,
  findMostImproved,
  findComeback,
  findPersonalBests,
  findSuperstars,
  superstarCount,
  superstarStandings,
  cumulativeTeamTotals,
  assignDivisions,
  divisionChange,
  effectiveTotal,
  appendBonusNote,
} from "../lib/calc";
import { PRESET_BONUS_REASONS, PRESET_DEDUCTION_REASONS } from "../lib/bonusReasons";

function initials(name) {
  return (name || "?").trim().charAt(0).toUpperCase();
}

const VIEWS = [
  { key: "everyone", label: "Everyone" },
  { key: "growth", label: "By Growth" },
  { key: "division", label: "By League" },
  { key: "streak", label: "By Streak" },
];

const TIER_COLORS = ["var(--blue-500)", "var(--gold)", "var(--text-lo)"]; // Diamond, Gold, Silver
const TIER_EMOJI = ["💎", "🥇", "🥈"];
const TIER_LABELS = ["Diamond", "Gold", "Silver"];

// The default landing view -- every student, one glance, grouped by
// league (an absolute bar, not a rank) rather than a single sorted list,
// so nobody's position on the page itself implies "worst." Badges surface
// exactly what the separate Growth/Streak/Superstar tabs used to require
// clicking through one at a time to see -- streak, growth, a perfect
// week, a new personal best -- all visible without a single click. Click
// any card to jump straight into that student's editable row for the
// full breakdown.
function EveryoneView({ divisions, growthRows, personalBests, superstarsThisWeek, onCardClick }) {
  const personalBestIds = new Set(personalBests.map((s) => s.id));
  const superstarIds = new Set(superstarsThisWeek.map((s) => s.id));

  const byTier = [[], [], []];
  divisions.forEach((d) => {
    const g = growthRows.find((r) => r.student.id === d.student.id);
    byTier[d.tierIndex].push({
      student: d.student,
      growth: g?.growth ?? null,
      streak: g?.streakInfo?.streak ?? 0,
      isSuperstar: superstarIds.has(d.student.id),
      isPersonalBest: personalBestIds.has(d.student.id),
    });
  });
  // Alphabetical within a tier, deliberately NOT sorted by score -- a
  // tier is already an absolute bar (principle: never a single ranked
  // ladder), so ordering by exact standing inside it would just quietly
  // reintroduce a rank.
  byTier.forEach((tier) => tier.sort((a, b) => a.student.name.localeCompare(b.student.name)));

  if (divisions.length === 0) return <p className="muted">No entries yet this week.</p>;

  return (
    <div>
      {byTier.map((tierRows, tierIndex) =>
        tierRows.length === 0 ? null : (
          <div key={tierIndex} style={{ marginBottom: 18 }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: TIER_COLORS[tierIndex], marginBottom: 8 }}>
              {TIER_EMOJI[tierIndex]} {TIER_LABELS[tierIndex]}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {tierRows.map((r) => (
                <button
                  key={r.student.id}
                  type="button"
                  onClick={() => onCardClick(r.student.id)}
                  style={{
                    textAlign: "left",
                    border: "1px solid var(--card-border)",
                    borderTop: `3px solid ${TIER_COLORS[tierIndex]}`,
                    borderRadius: "var(--radius-md)",
                    padding: "10px 12px",
                    background: "var(--card-bg)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 13.5, marginBottom: 4 }}>{r.student.name}</div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    {r.streak > 0 && <span style={{ fontSize: 11.5 }} title={`${r.streak}-week streak`}>🔥{r.streak}</span>}
                    {typeof r.growth === "number" && r.growth > 0 && (
                      <span style={{ fontSize: 11.5, color: "var(--green)" }} title="Growth vs. own average">
                        ▲{r.growth.toFixed(0)}
                      </span>
                    )}
                    {r.isSuperstar && <span style={{ fontSize: 11.5 }} title="Perfect week">⭐</span>}
                    {r.isPersonalBest && <span style={{ fontSize: 11.5 }} title="New personal best">🏆</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

const QUICK_ADJUST_AMOUNTS = [-1, 1, 5, 10];

export default function ProjectorBoard() {
  const { students, sessions, weeks, entriesByWeek, loading, groups, groupId, reload } = useGroup();
  const group = groups.find((g) => g.id === groupId);
  const latestWeek = weeks[weeks.length - 1];
  const latestWeekId = latestWeek?.id;
  const activeStudents = students.filter((s) => s.active);
  const [view, setView] = useState("everyone");
  const [showSuperstarChart, setShowSuperstarChart] = useState(false); // collapsed by default -- an all-time stat, not this week's primary info, so it shouldn't eat the top of the screen
  const [sessionFilter, setSessionFilter] = useState(null); // null = not yet chosen by the teacher

  // Live/inline score editing right from the leaderboard row — for fixing
  // a mistake or adding bonus points on the spot without leaving this
  // screen. Only affects the CURRENT (latest) week's entry.
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({
    stars: 0,
    ixl: 0,
    notebooking: 0,
    studyGuide: 0,
    exam: 0,
    examCorrections: 0,
    bonus: 0,
    note: "",
  });
  const [savingId, setSavingId] = useState(null);
  const [pendingAdjust, setPendingAdjust] = useState(null); // { studentId, delta } while picking a reason
  const [customReason, setCustomReason] = useState("");

  function startEdit(studentId) {
    const entry = entriesByWeek[latestWeekId]?.[studentId];
    setDraft({
      stars: entry?.classpoint_stars ?? 0,
      ixl: entry?.ixl_avg ?? 0,
      notebooking: entry?.notebooking_score ?? 0,
      studyGuide: entry?.study_guide_score ?? 0,
      exam: entry?.exam_score ?? 0,
      examCorrections: entry?.exam_corrections_score ?? 0,
      bonus: entry?.bonus ?? 0,
      note: entry?.bonus_note || "",
    });
    setEditingId(studentId);
  }

  function updateDraft(field, value) {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }

  function cancelEdit() {
    setEditingId(null);
  }

  async function saveEdit() {
    if (!editingId || !latestWeekId) return;
    setSavingId(editingId);
    try {
      const existing = entriesByWeek[latestWeekId]?.[editingId];
      const payload = {
        classpoint_stars: Number(draft.stars) || 0,
        ixl_avg: Number(draft.ixl) || 0,
        notebooking_score: Number(draft.notebooking) || 0,
        study_guide_score: Number(draft.studyGuide) || 0,
        exam_score: Number(draft.exam) || 0,
        exam_corrections_score: Number(draft.examCorrections) || 0,
        bonus: Number(draft.bonus) || 0,
        bonus_note: draft.note?.trim() || null,
      };
      if (existing) {
        await supabase.from("entries").update(payload).eq("id", existing.id);
      } else {
        await supabase.from("entries").insert({ week_id: latestWeekId, student_id: editingId, ...payload });
      }
      await reload();
      setEditingId(null);
    } finally {
      setSavingId(null);
    }
  }

  // Two-step quick-adjust: clicking +1/+5/+10/-1 opens a small reason
  // picker (preset chips + optional custom text) right in that row,
  // instead of a plain browser prompt() — one click on a preset is enough
  // for the common cases.
  function requestQuickAdjust(studentId, delta) {
    setCustomReason("");
    setPendingAdjust({ studentId, delta });
  }

  function cancelQuickAdjust() {
    setPendingAdjust(null);
    setCustomReason("");
  }

  async function confirmQuickAdjust(reasonText) {
    if (!pendingAdjust || !latestWeekId) return;
    const { studentId, delta } = pendingAdjust;
    setSavingId(studentId);
    setPendingAdjust(null);
    try {
      const existing = entriesByWeek[latestWeekId]?.[studentId];
      const newNote = appendBonusNote(existing?.bonus_note, delta, reasonText);
      if (existing) {
        await supabase
          .from("entries")
          .update({ bonus: Number(existing.bonus) + delta, bonus_note: newNote })
          .eq("id", existing.id);
      } else {
        await supabase.from("entries").insert({
          week_id: latestWeekId,
          student_id: studentId,
          classpoint_stars: 0,
          ixl_avg: 0,
          bonus: delta,
          bonus_note: newNote,
        });
      }
      await reload();
    } finally {
      setSavingId(null);
      setCustomReason("");
    }
  }

  // If this level has sessions, the board defaults to showing just ONE of
  // them (whichever the teacher is actually running right now) rather than
  // mixing both meeting times into one projected list — a student who
  // only ever comes Thursdays doesn't belong on Tuesday's screen. "All
  // Sessions" is still available for an end-of-term combined view.
  const activeSessionFilter = sessionFilter ?? (sessions[0]?.id || "all");
  const sessionScopedStudents =
    sessions.length === 0 || activeSessionFilter === "all"
      ? activeStudents
      : activeStudents.filter((s) => s.session_id === activeSessionFilter);

  const growthRows = useMemo(() => {
    if (!latestWeekId) return [];
    return computeGrowthForWeek(entriesByWeek, weeks, latestWeekId, sessionScopedStudents)
      .map((r) => ({
        ...r,
        streakInfo: computeStreak(entriesByWeek, weeks, r.student.id, sessionScopedStudents),
        superstars: superstarCount(entriesByWeek, weeks, r.student.id),
      }))
      .filter((r) => r.currentTotal !== null);
  }, [entriesByWeek, weeks, latestWeekId, sessionScopedStudents]);

  const mostImproved = findMostImproved(growthRows);
  const comeback = latestWeekId ? findComeback(entriesByWeek, weeks, latestWeekId, sessionScopedStudents) : null;
  const personalBests = latestWeekId
    ? findPersonalBests(entriesByWeek, weeks, latestWeekId, sessionScopedStudents)
    : [];
  const superstarsThisWeek = latestWeekId
    ? findSuperstars(entriesByWeek, latestWeekId, sessionScopedStudents)
    : [];
  const standings = superstarStandings(entriesByWeek, weeks, sessionScopedStudents);

  const divisions = latestWeekId
    ? assignDivisions(entriesByWeek, weeks, sessionScopedStudents, latestWeekId)
    : [];

  const goalPoints = group?.goal_points || 1000;
  const cumulative = cumulativeTeamTotals(entriesByWeek, weeks, sessionScopedStudents);
  const pctA = Math.min(100, (cumulative.A / goalPoints) * 100);
  const pctB = Math.min(100, (cumulative.B / goalPoints) * 100);
  const multiplier = Number(latestWeek?.bonus_multiplier) || 1;

  if (loading) return <div className="card">Loading…</div>;

  if (!latestWeekId) {
    return (
      <div className="card">
        <p className="muted">
          No weeks logged yet for this group. Add one from the Weekly Update tab.
        </p>
      </div>
    );
  }

  const rowById = Object.fromEntries(growthRows.map((r) => [r.student.id, r]));

  return (
    <>
      {sessions.length > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              Viewing
            </div>
            <select value={activeSessionFilter} onChange={(e) => setSessionFilter(e.target.value)}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
              <option value="all">All Sessions (combined)</option>
            </select>
          </div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            {weeks.find((w) => w.id === latestWeekId)?.label}
          </div>
          <nav className="tabs">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                className={view === v.key ? "active" : ""}
                onClick={() => setView(v.key)}
              >
                {v.label}
              </button>
            ))}
          </nav>
        </div>
        <p className="muted" style={{ marginBottom: 10 }}>
          Tap a student for the full breakdown and to edit their week.
        </p>

        {view === "everyone" && (
          <EveryoneView
            divisions={divisions}
            growthRows={growthRows}
            personalBests={personalBests}
            superstarsThisWeek={superstarsThisWeek}
            onCardClick={(studentId) => {
              setView("division");
              startEdit(studentId);
            }}
          />
        )}

        {view === "division" && (
          <DivisionView
            divisions={divisions}
            rowById={rowById}
            entriesByWeek={entriesByWeek}
            weeks={weeks}
            students={sessionScopedStudents}
            latestWeekId={latestWeekId}
            editingId={editingId}
            draft={draft}
            savingId={savingId}
            onStartEdit={startEdit}
            onDraftChange={updateDraft}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onQuickAdjust={requestQuickAdjust}
            pendingAdjust={pendingAdjust}
            customReason={customReason}
            onCustomReasonChange={setCustomReason}
            onConfirmAdjust={confirmQuickAdjust}
            onCancelAdjust={cancelQuickAdjust}
          />
        )}
        {view === "growth" && (
          <GrowthView
            rows={growthRows}
            editingId={editingId}
            draft={draft}
            savingId={savingId}
            onStartEdit={startEdit}
            onDraftChange={updateDraft}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onQuickAdjust={requestQuickAdjust}
            pendingAdjust={pendingAdjust}
            customReason={customReason}
            onCustomReasonChange={setCustomReason}
            onConfirmAdjust={confirmQuickAdjust}
            onCancelAdjust={cancelQuickAdjust}
          />
        )}
        {view === "streak" && (
          <StreakView
            rows={growthRows}
            editingId={editingId}
            draft={draft}
            savingId={savingId}
            onStartEdit={startEdit}
            onDraftChange={updateDraft}
            onSaveEdit={saveEdit}
            onCancelEdit={cancelEdit}
            onQuickAdjust={requestQuickAdjust}
            pendingAdjust={pendingAdjust}
            customReason={customReason}
            onCustomReasonChange={setCustomReason}
            onConfirmAdjust={confirmQuickAdjust}
            onCancelAdjust={cancelQuickAdjust}
          />
        )}
      </div>

      <div className="spotlight-grid">
        {mostImproved && (
          <div className="spotlight-card">
            <div className="spotlight-label">🚀 Most Improved</div>
            <div className="spotlight-name">{mostImproved.student.name}</div>
            <div className="muted">
              +{mostImproved.growth.toFixed(1)} pts vs their 4-week average
            </div>
          </div>
        )}
        {comeback && (
          <div className="spotlight-card">
            <div className="spotlight-label">🔥 Comeback of the Week</div>
            <div className="spotlight-name">{comeback.student.name}</div>
            <div className="muted">
              Back up +{comeback.growth.toFixed(1)} pts after a dip last week
            </div>
          </div>
        )}
        {personalBests.length > 0 && (
          <div className="spotlight-card">
            <div className="spotlight-label">🏆 New Personal Bests</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
              {personalBests.map((s) => (
                <span
                  key={s.id}
                  className="pill"
                  style={{ fontSize: 13, padding: "3px 10px", background: "rgba(255,255,255,0.08)" }}
                >
                  {s.name}
                </span>
              ))}
            </div>
            <div className="muted" style={{ marginTop: 6 }}>Their highest weekly total ever</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">Two-Team Goal Progress</div>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <span className="muted">Team A — {cumulative.A.toFixed(0)} pts</span>
          <span className="muted">Team B — {cumulative.B.toFixed(0)} pts</span>
        </div>
        <div className="progress-track" style={{ marginBottom: 4 }}>
          <div className="progress-fill-a" style={{ width: `${pctA}%` }} />
        </div>
        <div className="progress-track">
          <div className="progress-fill-b" style={{ width: `${pctB}%` }} />
        </div>
        <p className="muted" style={{ marginTop: 8 }}>
          Goal: {goalPoints} pts per team ({group?.goal_label || "Class Goal"})
          {multiplier > 1 && (
            <span style={{ color: "#c9891f", fontWeight: 700 }}> · ⚡ {multiplier}x Bonus Week!</span>
          )}
        </p>
      </div>

      {(superstarsThisWeek.length > 0 || standings.length > 0) && (
        <div className="superstar-card">
          <div className="superstar-title">🌟 Superstars of the Week — Perfect IXL Club</div>
          {superstarsThisWeek.length > 0 ? (
            <div className="superstar-names">
              {superstarsThisWeek
                .map((s) => `${s.name} (${superstarCount(entriesByWeek, weeks, s.id)}x all-time)`)
                .join("  ·  ")}
              {" "}
              hit 100% IXL this week!
            </div>
          ) : (
            <div className="muted">No perfect IXL scores this week — first one back on top next week!</div>
          )}
        </div>
      )}

      {standings.length > 0 && (
        <div className="card">
          <button
            type="button"
            className="row"
            style={{
              justifyContent: "space-between",
              width: "100%",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
            onClick={() => setShowSuperstarChart((v) => !v)}
          >
            <div className="card-title" style={{ marginBottom: 0 }}>🌟 Superstar Counts — All-Time</div>
            <span className="muted">{showSuperstarChart ? "Hide ▲" : "Show ▼"}</span>
          </button>
          {showSuperstarChart && (
            <>
              <p className="muted" style={{ marginTop: 10, marginBottom: 10 }}>
                All-time perfect-IXL weeks — a separate, running competition from this week's board.
              </p>
              <div style={{ width: "100%", height: Math.max(160, standings.length * 34) }}>
                <ResponsiveContainer>
                  <BarChart data={standings.map((r) => ({ name: r.student.name, count: r.count }))} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,20,60,0.12)" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} stroke="#736c8d" fontSize={12} />
                    <YAxis type="category" dataKey="name" stroke="#736c8d" fontSize={12} width={90} />
                    <Tooltip
                      cursor={{ fill: "rgba(30,20,60,0.06)" }}
                      contentStyle={{ background: "#1e0b3c", border: "1px solid rgba(255,255,255,0.15)" }}
                    />
                    <Bar dataKey="count" radius={[0, 6, 6, 0]}>
                      {standings.map((_, i) => (
                        <Cell key={i} fill={i === 0 ? "#c9891f" : "#a87f2e"} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

function GrowthPill({ growth }) {
  if (growth === null || growth === undefined) return null;
  return (
    <div className={`pill ${growth >= 0 ? "growth-pos" : "growth-neg"}`}>
      {growth >= 0 ? "+" : ""}
      {growth.toFixed(1)}
    </div>
  );
}

function SuperstarBadge({ count }) {
  if (!count) return null;
  return (
    <span title={`Perfect IXL week ${count} time${count === 1 ? "" : "s"} all-time`} style={{ fontSize: 13 }}>
      🌟{count > 1 ? `x${count}` : ""}
    </span>
  );
}

// Inline "fix a mistake" / "add points live" controls on each leaderboard
// row. Quick +1/-1 nudge bonus points instantly (e.g. "great answer, +1!");
// the pencil opens a small form to correct stars/IXL/bonus directly without
// leaving the projected screen or digging into History.
function ScoreControls({
  studentId,
  editingId,
  draft,
  savingId,
  onStartEdit,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onQuickAdjust,
  pendingAdjust,
  customReason,
  onCustomReasonChange,
  onConfirmAdjust,
  onCancelAdjust,
}) {
  const saving = savingId === studentId;

  if (editingId === studentId) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <input
            type="number"
            style={{ width: 50 }}
            value={draft.stars}
            onChange={(e) => onDraftChange("stars", e.target.value)}
            title="Class Participation (ClassPoint stars)"
          />
          <input
            type="number"
            step="0.1"
            style={{ width: 60 }}
            value={draft.ixl}
            onChange={(e) => onDraftChange("ixl", e.target.value)}
            title="Assignments (IXL avg)"
          />
          <input
            type="number"
            step="0.1"
            style={{ width: 55 }}
            value={draft.notebooking}
            onChange={(e) => onDraftChange("notebooking", e.target.value)}
            title="Notebooking"
          />
          <input
            type="number"
            step="0.1"
            style={{ width: 55 }}
            value={draft.studyGuide}
            onChange={(e) => onDraftChange("studyGuide", e.target.value)}
            title="Study Guide"
          />
          <input
            type="number"
            step="0.1"
            style={{ width: 55 }}
            value={draft.exam}
            onChange={(e) => onDraftChange("exam", e.target.value)}
            title="Exams"
          />
          <input
            type="number"
            step="0.1"
            style={{ width: 55 }}
            value={draft.examCorrections}
            onChange={(e) => onDraftChange("examCorrections", e.target.value)}
            title="Exam Corrections"
          />
          <input
            type="number"
            step="0.1"
            style={{ width: 55 }}
            value={draft.bonus}
            onChange={(e) => onDraftChange("bonus", e.target.value)}
            title="Bonus"
          />
          <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} disabled={saving} onClick={onSaveEdit}>
            {saving ? "…" : "Save"}
          </button>
          <button className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onCancelEdit}>
            ✕
          </button>
        </div>
        <div className="muted" style={{ fontSize: 10.5 }}>
          Order: Participation (stars — counts ×5 in Total), Assignments, Notebooking, Study
          Guide, Exams, Exam Corrections, Bonus — hover a box to check which is which.
        </div>
        <textarea
          rows={2}
          placeholder="Bonus note log — why these points were given (one line per award)"
          value={draft.note}
          onChange={(e) => onDraftChange("note", e.target.value)}
          style={{ width: "100%", fontSize: 12 }}
        />
      </div>
    );
  }

  if (pendingAdjust && pendingAdjust.studentId === studentId) {
    const { delta } = pendingAdjust;
    const reasonList = delta < 0 ? PRESET_DEDUCTION_REASONS : PRESET_BONUS_REASONS;
    return (
      <div className="reason-picker">
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          Why the {delta > 0 ? "+" : ""}
          {delta}? (optional — pick one, type your own, or skip)
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap", marginBottom: 6 }}>
          {reasonList.map((reason) => (
            <button
              key={reason}
              className="btn secondary"
              style={{ padding: "3px 9px", fontSize: 11.5 }}
              onClick={() => onConfirmAdjust(reason)}
            >
              {reason}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <input
            style={{ flex: 1, fontSize: 12 }}
            placeholder="Or type your own reason…"
            value={customReason}
            onChange={(e) => onCustomReasonChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onConfirmAdjust(customReason)}
          />
          <button className="btn" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => onConfirmAdjust(customReason)}>
            Save
          </button>
          <button className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={() => onConfirmAdjust("")}>
            Skip
          </button>
          <button className="btn secondary" style={{ padding: "4px 10px", fontSize: 12 }} onClick={onCancelAdjust}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
      {QUICK_ADJUST_AMOUNTS.map((amount) => (
        <button
          key={amount}
          className="btn secondary"
          style={{ padding: "2px 7px", fontSize: 12 }}
          disabled={saving}
          onClick={() => onQuickAdjust(amount)}
          title={`Quick: ${amount > 0 ? "+" : ""}${amount} bonus point${Math.abs(amount) === 1 ? "" : "s"}`}
        >
          {amount > 0 ? "+" : "−"}
          {Math.abs(amount)}
        </button>
      ))}
      <button
        className="btn secondary"
        style={{ padding: "2px 7px", fontSize: 12 }}
        disabled={saving}
        onClick={onStartEdit}
        title="Edit this week's stars/IXL/bonus — type an exact amount"
      >
        ✎
      </button>
    </div>
  );
}

function DivisionView({
  divisions,
  rowById,
  entriesByWeek,
  weeks,
  students,
  latestWeekId,
  editingId,
  draft,
  savingId,
  onStartEdit,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onQuickAdjust,
  pendingAdjust,
  customReason,
  onCustomReasonChange,
  onConfirmAdjust,
  onCancelAdjust,
}) {
  const byTier = {};
  divisions.forEach((d) => {
    byTier[d.tierIndex] = byTier[d.tierIndex] || { name: d.tierName, rows: [] };
    const weekTotal = effectiveTotal(entriesByWeek, weeks, latestWeekId, d.student.id) ?? 0;
    byTier[d.tierIndex].rows.push({ ...d, weekTotal });
  });

  return (
    <div>
      {Object.keys(byTier)
        .sort((a, b) => a - b)
        .map((tierKey) => {
          const tier = byTier[tierKey];
          const ranked = [...tier.rows].sort((a, b) => b.weekTotal - a.weekTotal);
          return (
            <div key={tierKey} style={{ marginBottom: 22 }}>
              <div className="muted" style={{ marginBottom: 8, fontWeight: 700 }}>
                {tier.name} League
              </div>
              {ranked.map((r, i) => {
                const change = divisionChange(
                  entriesByWeek,
                  weeks,
                  students,
                  latestWeekId,
                  r.student.id
                );
                const growthInfo = rowById[r.student.id];
                return (
                  <div key={r.student.id} className={`leader-row ${i === 0 ? "rank-1" : ""}`}>
                    <div className="rank-num">{i + 1}</div>
                    <div className="avatar">{initials(r.student.name)}</div>
                    <div className="leader-name">{r.student.name}</div>
                    <SuperstarBadge count={growthInfo?.superstars} />
                    {change === "up" && <span title="Promoted">⬆️</span>}
                    {change === "down" && <span title="Relegated">⬇️</span>}
                    <GrowthPill growth={growthInfo?.growth} />
                    {r.growthBonus > 0 && (
                      <span
                        className="pill growth-pos"
                        title="Added to this week's percentage for beating your own recent average"
                        style={{ fontSize: 11 }}
                      >
                        +{r.growthBonus.toFixed(1)}% growth
                      </span>
                    )}
                    <div className="total-score">{r.weekTotal.toFixed(1)}</div>
                    <ScoreControls
                      studentId={r.student.id}
                      editingId={editingId}
                      draft={draft}
                      savingId={savingId}
                      onStartEdit={() => onStartEdit(r.student.id)}
                      onDraftChange={onDraftChange}
                      onSaveEdit={onSaveEdit}
                      onCancelEdit={onCancelEdit}
                      onQuickAdjust={(delta) => onQuickAdjust(r.student.id, delta)}
                      pendingAdjust={pendingAdjust}
                      customReason={customReason}
                      onCustomReasonChange={onCustomReasonChange}
                      onConfirmAdjust={onConfirmAdjust}
                      onCancelAdjust={onCancelAdjust}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
    </div>
  );
}

function GrowthView({
  rows,
  editingId,
  draft,
  savingId,
  onStartEdit,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onQuickAdjust,
  pendingAdjust,
  customReason,
  onCustomReasonChange,
  onConfirmAdjust,
  onCancelAdjust,
}) {
  const sorted = [...rows].sort((a, b) => (b.growth ?? -Infinity) - (a.growth ?? -Infinity));
  return sorted.map((r, i) => (
    <div key={r.student.id} className={`leader-row ${i === 0 ? "rank-1" : ""}`}>
      {/* Only the top 3 get a literal rank number -- past that, this is a
          full class-wide list sorted worst-to-best, and numbering every
          single row would put someone at a public "last place" here every
          week, the exact thing the League tiers above are built to avoid.
          Everyone still sees their own growth number either way. */}
      <div className="rank-num">{i < 3 ? i + 1 : ""}</div>
      <div className="avatar">{initials(r.student.name)}</div>
      <div className="leader-name">{r.student.name}</div>
      <SuperstarBadge count={r.superstars} />
      <div className="streak">
        🔥 {r.streakInfo.streak}
        {r.streakInfo.usedFreeze && "❄️"}
      </div>
      <GrowthPill growth={r.growth} />
      <div className="total-score">{Number(r.currentTotal).toFixed(1)}</div>
      <ScoreControls
        studentId={r.student.id}
        editingId={editingId}
        draft={draft}
        savingId={savingId}
        onStartEdit={() => onStartEdit(r.student.id)}
        onDraftChange={onDraftChange}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
        onQuickAdjust={(delta) => onQuickAdjust(r.student.id, delta)}
        pendingAdjust={pendingAdjust}
        customReason={customReason}
        onCustomReasonChange={onCustomReasonChange}
        onConfirmAdjust={onConfirmAdjust}
        onCancelAdjust={onCancelAdjust}
      />
    </div>
  ));
}

function StreakView({
  rows,
  editingId,
  draft,
  savingId,
  onStartEdit,
  onDraftChange,
  onSaveEdit,
  onCancelEdit,
  onQuickAdjust,
  pendingAdjust,
  customReason,
  onCustomReasonChange,
  onConfirmAdjust,
  onCancelAdjust,
}) {
  const sorted = [...rows].sort((a, b) => b.streakInfo.streak - a.streakInfo.streak);
  return sorted.map((r, i) => (
    <div key={r.student.id} className={`leader-row ${i === 0 ? "rank-1" : ""}`}>
      <div className="rank-num">{i < 3 ? i + 1 : ""}</div>
      <div className="avatar">{initials(r.student.name)}</div>
      <div className="leader-name">{r.student.name}</div>
      <SuperstarBadge count={r.superstars} />
      <div className="streak" style={{ fontSize: 16 }}>
        🔥 {r.streakInfo.streak} week{r.streakInfo.streak === 1 ? "" : "s"}
        {r.streakInfo.usedFreeze && " ❄️ freeze used"}
      </div>
      <GrowthPill growth={r.growth} />
      <div className="total-score">{Number(r.currentTotal).toFixed(1)}</div>
      <ScoreControls
        studentId={r.student.id}
        editingId={editingId}
        draft={draft}
        savingId={savingId}
        onStartEdit={() => onStartEdit(r.student.id)}
        onDraftChange={onDraftChange}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
        onQuickAdjust={(delta) => onQuickAdjust(r.student.id, delta)}
        pendingAdjust={pendingAdjust}
        customReason={customReason}
        onCustomReasonChange={onCustomReasonChange}
        onConfirmAdjust={onConfirmAdjust}
        onCancelAdjust={onCancelAdjust}
      />
    </div>
  ));
}
