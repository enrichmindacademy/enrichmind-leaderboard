// A single, prioritized "next step" banner — the sleek-minimal answer to
// "what should I do to move up," instead of making a student piece it
// together from several cards. Picks the single most relevant thing:
// catch-up work first (concrete, achievable), then a goal in progress,
// then a league catch-up gap, then a nudge toward Superstar status.
export default function NextMilestone({ isSuperstarThisWeek, myGoal, nextTierGap, pendingCatchUps, tierName }) {
  let headline = null;
  let detail = null;
  let pct = null;

  if (pendingCatchUps > 0) {
    headline = `Finish ${pendingCatchUps === 1 ? "1 task" : `${pendingCatchUps} tasks`} from last week`;
    detail = "That's the fastest way to climb back up.";
  } else if (myGoal && !myGoal.achieved) {
    headline = `${myGoal.remaining} more to hit your goal`;
    detail = "You set this one yourself — go get it.";
    pct = myGoal.target > 0 ? Math.min(100, ((myGoal.actual ?? 0) / myGoal.target) * 100) : null;
  } else if (nextTierGap) {
    headline = `${nextTierGap.gap.toFixed(1)} pts to move up in ${tierName || "your"} League`;
    detail = nextTierGap.label + " next week.";
  } else if (!isSuperstarThisWeek) {
    headline = "Score 100% on IXL to become a Superstar";
    detail = "Perfect weeks get their own spotlight.";
  } else {
    headline = "You're all caught up 🎉";
    detail = "Keep the streak going next week.";
  }

  return (
    <div className="milestone-card">
      <div className="milestone-label">Next Step</div>
      <div className="milestone-headline">{headline}</div>
      {detail && <div className="milestone-detail">{detail}</div>}
      {pct !== null && (
        <div className="progress-track" style={{ marginTop: 10 }}>
          <div className="progress-fill-a" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
