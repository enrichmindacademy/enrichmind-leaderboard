// Pure calculation helpers shared across screens.
//
// `weeks` is always the full array of week rows (oldest -> newest), each
// with { id, bonus_multiplier }. We compute an "effective total" per
// student per week as raw total * that week's bonus multiplier, so a
// teacher-declared "Double Stars Week" (bonus_multiplier = 2) actually
// doubles what counted that week everywhere: growth, streak comparisons,
// team goal, personal bests.

const DIVISION_NAMES = ["Diamond", "Gold", "Silver"];
const DIAMOND_CUTOFF = 90; // % of a strong week -- editable here if these ever need retuning
const GOLD_CUTOFF = 70;
const GRACE_WEEKS = 1; // built-in "streak freeze": 1 missed week is forgiven

// The six score categories don't share one scale -- Assignments and Exams
// are naturally 0-100, but Participation (stars), Notebooking, and Study
// Guide are whatever scale the teacher happens to use, and can change
// week to week. Averaging raw points across scales like that isn't
// meaningful (a "20" in a category worth 25 max is very different from a
// "20" in one worth 5 max) -- the standard fix, same one used whenever
// real grades get combined across different assessments, is to convert
// every category to a percentage FIRST, then combine the percentages.
//
// Assignments/Exams already ARE percentages, so they're used directly.
// The three open-scale categories are converted to "percent of the best
// score anyone in the class got in that category this same week" --
// self-calibrating, no manual "this is out of ___" setup ever needed,
// and it adjusts automatically to however generous or strict that
// week's scoring happened to be.
//
// A category that nobody was assigned anything in that week (no exam
// that week, e.g.) is left out of the average entirely rather than
// counted as a 0 for everyone -- a light week shouldn't drag scores
// down just because fewer things were graded.
//
// Participation (stars) gets its own small fixed weight instead of an
// equal share with everything else. It's naturally a much coarser scale
// than the others -- typically just 0-3 or 0-5 stars per class -- so
// self-calibrating it the same way as Notebooking/Study Guide means a
// single star of difference can swing 30+ percentage points (1 star out
// of a 3-star max = 33%, 2 stars = 67%), while the same "one point"
// difference in Assignments barely moves anything. Averaged in equally,
// that coarseness let Participation dominate the whole composite out of
// proportion to how much it's actually meant to count.
const PARTICIPATION_WEIGHT = 0.08; // 8% -- low enough that a perfect Assignments score plus low stars still comfortably clears Diamond; adjust here if this ever needs retuning
const OPEN_SCALE_FIELDS = ["notebooking_score", "study_guide_score"];
const FIXED_SCALE_FIELDS = ["ixl_avg", "exam_score"]; // already 0-100

function weekMultiplier(week) {
  const m = Number(week?.bonus_multiplier);
  return Number.isFinite(m) && m > 0 ? m : 1;
}

export function effectiveTotal(entriesByWeek, weeks, weekId, studentId) {
  const entry = entriesByWeek[weekId]?.[studentId];
  if (!entry) return null;
  const week = weeks.find((w) => w.id === weekId);
  return Number(entry.total) * weekMultiplier(week);
}

export function trailingAverage(entriesByWeek, weeks, studentId, excludeWeekId, span = 4) {
  const weekIds = weeks.map((w) => w.id);
  const idx = weekIds.indexOf(excludeWeekId);
  const priorWeekIds = weekIds.slice(Math.max(0, idx - span), idx);
  const totals = priorWeekIds
    .map((wid) => effectiveTotal(entriesByWeek, weeks, wid, studentId))
    .filter((t) => typeof t === "number");
  if (totals.length === 0) return null;
  return totals.reduce((a, b) => a + b, 0) / totals.length;
}

export function computeGrowthForWeek(entriesByWeek, weeks, currentWeekId, students) {
  return students.map((s) => {
    const currentTotal = effectiveTotal(entriesByWeek, weeks, currentWeekId, s.id);
    const avg = trailingAverage(entriesByWeek, weeks, s.id, currentWeekId);
    const growth =
      currentTotal !== null && avg !== null
        ? currentTotal - avg
        : currentTotal !== null && avg === null
        ? 0
        : null;
    return { student: s, currentTotal, trailingAvg: avg, growth };
  });
}

// Streak = consecutive most-recent weeks (working back from the latest
// week) the student showed up with an entry. One missed week anywhere in
// that run is forgiven automatically (a built-in "streak freeze"), so a
// single absence doesn't wipe out weeks of consistency — but two misses
// in a row (or a second miss) ends it.
export function computeStreak(entriesByWeek, weeks, studentId) {
  const weekIds = weeks.map((w) => w.id);
  let streak = 0;
  let grace = GRACE_WEEKS;
  let usedFreeze = false;

  for (let i = weekIds.length - 1; i >= 0; i--) {
    const has = !!entriesByWeek[weekIds[i]]?.[studentId];
    if (has) {
      streak += 1;
      continue;
    }
    if (grace > 0) {
      grace -= 1;
      usedFreeze = true;
      continue; // missed week forgiven, keep walking back
    }
    break;
  }
  return { streak, usedFreeze };
}

// Personal best: is this week's effective total higher than every prior
// week's effective total for this student? (Needs at least one prior week
// so week 1 doesn't trivially "count" as a record.)
export function isPersonalBest(entriesByWeek, weeks, currentWeekId, studentId) {
  const weekIds = weeks.map((w) => w.id);
  const idx = weekIds.indexOf(currentWeekId);
  const current = effectiveTotal(entriesByWeek, weeks, currentWeekId, studentId);
  if (current === null || idx <= 0) return false;
  const priorTotals = weekIds
    .slice(0, idx)
    .map((wid) => effectiveTotal(entriesByWeek, weeks, wid, studentId))
    .filter((t) => typeof t === "number");
  if (priorTotals.length === 0) return false;
  return current > Math.max(...priorTotals);
}

export function findMostImproved(growthRows) {
  const valid = growthRows.filter((r) => r.growth !== null);
  if (valid.length === 0) return null;
  return valid.reduce((best, r) => (r.growth > (best?.growth ?? -Infinity) ? r : best), null);
}

// Comeback: student whose growth THIS week is positive, but whose growth
// LAST week was negative (recovering from a dip), ranked by size of swing.
export function findComeback(entriesByWeek, weeks, currentWeekId, students) {
  const weekIds = weeks.map((w) => w.id);
  const idx = weekIds.indexOf(currentWeekId);
  if (idx < 1) return null;
  const prevWeekId = weekIds[idx - 1];

  const currentGrowth = computeGrowthForWeek(entriesByWeek, weeks, currentWeekId, students);
  const prevGrowth = computeGrowthForWeek(entriesByWeek, weeks, prevWeekId, students);
  const prevMap = Object.fromEntries(prevGrowth.map((r) => [r.student.id, r.growth]));

  const candidates = currentGrowth
    .filter((r) => r.growth !== null && r.growth > 0 && (prevMap[r.student.id] ?? 0) < 0)
    .map((r) => ({ ...r, swing: r.growth - (prevMap[r.student.id] ?? 0) }));

  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => (r.swing > (best?.swing ?? -Infinity) ? r : best), null);
}

export function findPersonalBests(entriesByWeek, weeks, currentWeekId, students) {
  return students.filter((s) => isPersonalBest(entriesByWeek, weeks, currentWeekId, s.id));
}

// "Superstar" week = a perfect IXL average (100) that week — i.e. every
// assigned skill nailed. This exists because Most Improved can never
// recognize a student who is already at the ceiling every week (there's
// no room left to grow vs. their own average), so without a separate
// callout, consistently-perfect students get no spotlight at all.
const SUPERSTAR_THRESHOLD = 99.95;

export function isSuperstarWeek(entriesByWeek, weekId, studentId) {
  const entry = entriesByWeek[weekId]?.[studentId];
  if (!entry) return false;
  return Number(entry.ixl_avg) >= SUPERSTAR_THRESHOLD;
}

export function findSuperstars(entriesByWeek, weekId, students) {
  return students.filter((s) => isSuperstarWeek(entriesByWeek, weekId, s.id));
}

// Total number of weeks (all-time) a student has hit a perfect IXL average.
export function superstarCount(entriesByWeek, weeks, studentId) {
  return weeks.filter((w) => isSuperstarWeek(entriesByWeek, w.id, studentId)).length;
}

// A running "Wall of Fame" standings for the Superstar competition: every
// student with at least one perfect-IXL week, ranked by all-time count.
// This is what makes Superstar feel like its own ongoing competition
// (not just a one-off callout) — kids can see who's chasing the lead.
// A short, running log of why bonus points were given — one dated line
// per award, appended (never overwritten) so a teacher (or a parent
// asking "why did my kid get bonus points?") can see the history, not
// just a number.
export function appendBonusNote(existingNote, delta, text) {
  if (!text || !text.trim()) return existingNote || null;
  const date = new Date().toLocaleDateString();
  const sign = delta >= 0 ? "+" : "";
  const line = `${date}: ${sign}${delta} — ${text.trim()}`;
  return existingNote ? `${existingNote}\n${line}` : line;
}

export function superstarStandings(entriesByWeek, weeks, students) {
  return students
    .map((s) => ({ student: s, count: superstarCount(entriesByWeek, weeks, s.id) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.student.name.localeCompare(b.student.name));
}

// ---- Measurable weekly goals ----
// A goal is only ever "at least X" on one of three trackable numbers, so
// achievement is a plain comparison — never a vague self-report.
export const GOAL_METRIC_LABEL = {
  total: "Total Points",
  stars: "ClassPoint Stars",
  ixl_avg: "IXL Average",
};

function actualForMetric(entry, metric) {
  if (!entry) return null;
  if (metric === "total") return Number(entry.total);
  if (metric === "stars") return Number(entry.classpoint_stars);
  if (metric === "ixl_avg") return Number(entry.ixl_avg);
  return null;
}

// Returns null if no measurable goal is set this week, otherwise
// { metric, target, actual, achieved, remaining }.
export function goalProgress(entry) {
  if (!entry || !entry.goal_metric || entry.goal_target === null || entry.goal_target === undefined) {
    return null;
  }
  const actual = actualForMetric(entry, entry.goal_metric);
  const target = Number(entry.goal_target);
  return {
    metric: entry.goal_metric,
    target,
    actual,
    achieved: actual !== null && actual >= target,
    remaining: actual !== null ? Math.max(0, target - actual) : null,
  };
}

// All-time record of measurable goals a student has set, for a simple
// "goals hit" count alongside streaks/superstars.
export function goalHistory(entriesByWeek, weeks, studentId) {
  return weeks
    .map((w) => ({ week: w, entry: entriesByWeek[w.id]?.[studentId] }))
    .filter((r) => r.entry?.goal_metric)
    .map((r) => ({ week: r.week, progress: goalProgress(r.entry) }));
}

export function goalsAchievedCount(entriesByWeek, weeks, studentId) {
  return goalHistory(entriesByWeek, weeks, studentId).filter((r) => r.progress.achieved).length;
}

export function teamTotals(entriesByWeek, weeks, weekId, students) {
  const totals = { A: 0, B: 0 };
  students.forEach((s) => {
    const t = effectiveTotal(entriesByWeek, weeks, weekId, s.id) ?? 0;
    if (s.team === "A" || s.team === "B") totals[s.team] += t;
  });
  return totals;
}

export function cumulativeTeamTotals(entriesByWeek, weeks, students) {
  const totals = { A: 0, B: 0 };
  weeks.forEach((w) => {
    students.forEach((s) => {
      const t = effectiveTotal(entriesByWeek, weeks, w.id, s.id) ?? 0;
      if (s.team === "A" || s.team === "B") totals[s.team] += t;
    });
  });
  return totals;
}

// ---- Class-wide trend helpers (for the Insights tab) ----

// Average cumulative points per student, through and including a given
// week -- the number the "Class-Wide Trends" chart actually plots now,
// instead of average week-over-week growth. Growth (this week vs. a
// student's own past average) is the right lens for an individual
// student's own page, where it answers "did I do better than my usual
// this week" -- but averaged across a whole class over a term, it's
// naturally volatile and can trend into negative territory even while
// every student is genuinely accumulating real points and real
// superstar weeks. A class-wide trend chart showing a declining line
// reads as "things are getting worse," which is the opposite of what's
// usually true. A running total, the same visual language every real
// points/XP system uses (Duolingo, Khan Academy -- points only ever
// climb), is unambiguous: it goes up because real work keeps getting
// added on top of what came before.
//
// Clamped at 0 per week before accumulating so an unusually heavy
// deduction week can't make the class average actually dip -- this
// chart is a term-level trend signal, not a literal running ledger.
export function avgCumulativePointsForWeek(entriesByWeek, weeks, weekId, students) {
  const weekIds = weeks.map((w) => w.id);
  const idx = weekIds.indexOf(weekId);
  if (idx === -1 || students.length === 0) return null;

  const sums = students.map((s) => {
    let sum = 0;
    for (let i = 0; i <= idx; i++) {
      sum += Math.max(0, effectiveTotal(entriesByWeek, weeks, weekIds[i], s.id) ?? 0);
    }
    return sum;
  });
  return sums.reduce((a, b) => a + b, 0) / sums.length;
}

export function superstarRateForWeek(entriesByWeek, weekId, students) {
  const withEntry = students.filter((s) => entriesByWeek[weekId]?.[s.id]);
  if (withEntry.length === 0) return null;
  const count = findSuperstars(entriesByWeek, weekId, withEntry).length;
  return (count / withEntry.length) * 100;
}

export function taskCompletionRateForWeek(assignments, submissions, weekId) {
  const weekAssignments = assignments.filter((a) => a.week_id === weekId);
  if (weekAssignments.length === 0) return null;
  const approvedIds = new Set(
    submissions.filter((s) => s.status === "approved" && s.week_id === weekId).map((s) => s.assignment_id)
  );
  const approvedCount = weekAssignments.filter((a) => approvedIds.has(a.id)).length;
  return (approvedCount / weekAssignments.length) * 100;
}

// Computes every active student's composite percentage for ONE week --
// the number Diamond/Gold/Silver is actually judged against. Returns a
// Map<studentId, percentage|null> (null = no entry at all that week, so
// there's nothing to grade them on).
export function weeklyCompositePercentages(entriesByWeek, weeks, weekId, students) {
  const weekEntries = entriesByWeek[weekId] || {};
  const result = new Map();

  // Class max for each open-scale category, among students who have an
  // entry this week -- this is the "100%" each student's raw score in
  // that category gets measured against. Participation gets its own
  // class max too, computed the same way, just weighted separately below.
  const classMax = {};
  [...OPEN_SCALE_FIELDS, "classpoint_stars"].forEach((field) => {
    let max = 0;
    students.forEach((s) => {
      const v = Number(weekEntries[s.id]?.[field]) || 0;
      if (v > max) max = v;
    });
    classMax[field] = max;
  });

  students.forEach((s) => {
    const entry = weekEntries[s.id];
    if (!entry) {
      result.set(s.id, null);
      return;
    }

    // Everything except Participation still gets combined as a simple
    // average among whichever categories were actually assigned this
    // week -- same as before.
    const otherPercents = [];

    FIXED_SCALE_FIELDS.forEach((field) => {
      // Only counts if someone in the class actually has a non-zero
      // value here -- otherwise this category simply wasn't assigned
      // this week (e.g. no exam), and including it would count as a
      // false 0 for everyone rather than being left out entirely.
      const assignedThisWeek = students.some((s2) => Number(weekEntries[s2.id]?.[field]) > 0);
      if (assignedThisWeek) otherPercents.push(Math.min(100, Number(entry[field]) || 0));
    });

    OPEN_SCALE_FIELDS.forEach((field) => {
      const max = classMax[field];
      if (max > 0) otherPercents.push((Number(entry[field]) || 0) / max * 100);
    });

    const othersAvg = otherPercents.length > 0
      ? otherPercents.reduce((a, b) => a + b, 0) / otherPercents.length
      : null;

    const starsMax = classMax.classpoint_stars;
    const participationPct = starsMax > 0 ? (Number(entry.classpoint_stars) || 0) / starsMax * 100 : null;

    // Blend the two at a fixed 10/90 split -- unless one side has
    // nothing to blend with (e.g. a week with only stars entered so
    // far), in which case just use whichever side actually has data
    // rather than silently treating the missing side as a 0.
    let base;
    if (othersAvg !== null && participationPct !== null) {
      base = othersAvg * (1 - PARTICIPATION_WEIGHT) + participationPct * PARTICIPATION_WEIGHT;
    } else if (othersAvg !== null) {
      base = othersAvg;
    } else if (participationPct !== null) {
      base = participationPct;
    } else {
      base = 0;
    }

    // Bonus is a genuine bonus, not something to average in as if it
    // were a requirement -- it's added on top as flat percentage
    // points, capped so a big bonus alone can't manufacture Diamond
    // out of an otherwise weak week.
    const withBonus = base + Math.min(15, Number(entry.bonus) || 0);
    result.set(s.id, Math.min(100, Math.max(0, withBonus)));
  });

  return result;
}

// Splits active students into Diamond/Gold/Silver by an ABSOLUTE bar --
// each student's own composite percentage this week, not by rank
// against classmates. Everyone can be Diamond in a great week; everyone
// can be Silver in a rough one. No history, no seeding, no "brand new
// student" edge case to handle -- every week stands on its own.
export function assignDivisions(entriesByWeek, weeks, students, currentWeekId) {
  const percentages = weeklyCompositePercentages(entriesByWeek, weeks, currentWeekId, students);

  return students
    .map((s) => {
      const pct = percentages.get(s.id);
      const tierIndex = pct === null ? 2 : pct >= DIAMOND_CUTOFF ? 0 : pct >= GOLD_CUTOFF ? 1 : 2;
      return { student: s, standing: pct, tierIndex, tierName: DIVISION_NAMES[tierIndex] };
    })
    .sort((a, b) => (b.standing ?? -1) - (a.standing ?? -1) || a.student.name.localeCompare(b.student.name));
}

// Compares this week's division assignment to last week's, to show
// promotion/relegation arrows.
export function divisionChange(entriesByWeek, weeks, students, currentWeekId, studentId) {
  const weekIds = weeks.map((w) => w.id);
  const idx = weekIds.indexOf(currentWeekId);
  if (idx < 1) return null;
  const prevWeekId = weekIds[idx - 1];

  const current = assignDivisions(entriesByWeek, weeks, students, currentWeekId);
  const prior = assignDivisions(entriesByWeek, weeks, students, prevWeekId);

  const curTier = current.find((r) => r.student.id === studentId)?.tierIndex;
  const priorTier = prior.find((r) => r.student.id === studentId)?.tierIndex;
  if (curTier === undefined || priorTier === undefined) return null;
  if (curTier < priorTier) return "up";
  if (curTier > priorTier) return "down";
  return "same";
}
