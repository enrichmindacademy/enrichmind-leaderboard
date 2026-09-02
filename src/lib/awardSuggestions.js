// Suggests award candidates for the year, backed by actual season data --
// not because the suggestion should BE the award (categories genuinely
// change year to year, per how this teacher actually runs it), but
// because research on classroom recognition is consistent that a SPECIFIC
// reason ("averaged +6% growth all season") lands far better with a
// student than a generic certificate, and generating that specific
// detail by hand for 20+ students is exactly the kind of thing worth
// automating. Every suggestion here is a starting point the teacher can
// accept, edit, retitle, or ignore entirely -- src/pages/Awards.jsx is
// where a fully custom award (no suggestion at all) also lives, so no
// student is limited to only the categories below.

import {
  assignDivisions,
  computeGrowthForWeek,
  computeStreak,
  isPersonalBest,
  superstarCount,
  findComeback,
  weeklyCompositePercentages,
} from "./calc.js";

function topOf(list, valueFn) {
  let best = null;
  let bestValue = -Infinity;
  list.forEach((item) => {
    const v = valueFn(item);
    if (typeof v === "number" && v > bestValue) {
      bestValue = v;
      best = item;
    }
  });
  return best ? { item: best, value: bestValue } : null;
}

export function suggestAwardCandidates(entriesByWeek, weeks, students) {
  const activeStudents = students.filter((s) => s.active);
  if (activeStudents.length === 0 || weeks.length === 0) return [];

  const sortedWeeks = [...weeks].sort((a, b) => new Date(a.date) - new Date(b.date));
  const lastWeekId = sortedWeeks[sortedWeeks.length - 1]?.id;

  // Diamond weeks -- most weeks spent in the top league tier, all season.
  const diamondCounts = activeStudents.map((s) => ({
    student: s,
    count: sortedWeeks.filter((w) => {
      const divisions = assignDivisions(entriesByWeek, weeks, activeStudents, w.id);
      return divisions.find((d) => d.student.id === s.id)?.tierIndex === 0;
    }).length,
  }));

  // Average growth -- self-referenced improvement, all season, the
  // metric a student with a lower starting point can still win.
  const avgGrowths = activeStudents.map((s) => {
    const values = sortedWeeks
      .map((w) => computeGrowthForWeek(entriesByWeek, weeks, w.id, activeStudents).find((r) => r.student.id === s.id)?.growth)
      .filter((v) => typeof v === "number");
    return { student: s, avg: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null };
  });

  // Current streak -- as of the last saved week (the natural "as of
  // today" reading for a year-end award, not a historical max).
  const streaks = activeStudents.map((s) => ({
    student: s,
    streak: computeStreak(entriesByWeek, weeks, s.id, activeStudents).streak,
  }));

  // Personal bests -- how many times this student beat their own prior
  // record this season.
  const personalBestCounts = activeStudents.map((s) => ({
    student: s,
    count: sortedWeeks.filter((w) => isPersonalBest(entriesByWeek, weeks, w.id, s.id)).length,
  }));

  // Superstars -- perfect weeks, all-time count.
  const superstars = activeStudents.map((s) => ({
    student: s,
    count: superstarCount(entriesByWeek, weeks, s.id),
  }));

  // Comebacks -- how many weeks THIS student was the one who bounced
  // back after a dip.
  const comebackCounts = activeStudents.map((s) => ({
    student: s,
    count: sortedWeeks.filter((w) => findComeback(entriesByWeek, weeks, w.id, activeStudents)?.student.id === s.id).length,
  }));

  // Most consistent -- highest fraction of weeks with an entry at all
  // (shows up, every week, no gaps) -- character/effort, not raw ability.
  const consistency = activeStudents.map((s) => {
    const weeksWithEntry = sortedWeeks.filter((w) => !!entriesByWeek[w.id]?.[s.id]).length;
    return { student: s, rate: sortedWeeks.length > 0 ? weeksWithEntry / sortedWeeks.length : 0 };
  });

  // Season-long improvement -- first tracked week's % vs the last week's
  // % (distinct from average growth -- this is "where they started" vs
  // "where they ended up", the classic "most improved all year" framing).
  const seasonImprovement = activeStudents.map((s) => {
    const firstWeekWithEntry = sortedWeeks.find((w) => !!entriesByWeek[w.id]?.[s.id]);
    if (!firstWeekWithEntry || !lastWeekId) return { student: s, delta: null, first: null, last: null };
    const first = weeklyCompositePercentages(entriesByWeek, weeks, firstWeekWithEntry.id, activeStudents).get(s.id);
    const last = weeklyCompositePercentages(entriesByWeek, weeks, lastWeekId, activeStudents).get(s.id);
    return { student: s, delta: first !== null && last !== null ? last - first : null, first, last };
  });

  const suggestions = [];

  const bestDiamond = topOf(diamondCounts, (d) => d.count);
  if (bestDiamond && bestDiamond.value > 0) {
    suggestions.push({
      category: "Most Diamond Weeks",
      student: bestDiamond.item.student,
      title: "Diamond League Champion",
      detail: `Finished in the Diamond League ${bestDiamond.value} week${bestDiamond.value === 1 ? "" : "s"} this year.`,
    });
  }

  const bestGrowth = topOf(avgGrowths, (d) => d.avg);
  if (bestGrowth && bestGrowth.value > 0) {
    suggestions.push({
      category: "Best Average Growth",
      student: bestGrowth.item.student,
      title: "Growth Champion",
      detail: `Averaged +${bestGrowth.value.toFixed(1)} points above their own weekly average, all season.`,
    });
  }

  const bestStreak = topOf(streaks, (d) => d.streak);
  if (bestStreak && bestStreak.value > 0) {
    suggestions.push({
      category: "Longest Current Streak",
      student: bestStreak.item.student,
      title: "Consistency Streak Award",
      detail: `Currently on a ${bestStreak.value}-week streak of hitting the bar.`,
    });
  }

  const mostPersonalBests = topOf(personalBestCounts, (d) => d.count);
  if (mostPersonalBests && mostPersonalBests.value > 0) {
    suggestions.push({
      category: "Most Personal Bests",
      student: mostPersonalBests.item.student,
      title: "Personal Record Breaker",
      detail: `Set a new personal best ${mostPersonalBests.value} time${mostPersonalBests.value === 1 ? "" : "s"} this year.`,
    });
  }

  const mostSuperstar = topOf(superstars, (d) => d.count);
  if (mostSuperstar && mostSuperstar.value > 0) {
    suggestions.push({
      category: "Most Perfect Weeks",
      student: mostSuperstar.item.student,
      title: "Superstar of the Year",
      detail: `Had ${mostSuperstar.value} perfect week${mostSuperstar.value === 1 ? "" : "s"} this season.`,
    });
  }

  const mostComeback = topOf(comebackCounts, (d) => d.count);
  if (mostComeback && mostComeback.value > 0) {
    suggestions.push({
      category: "Most Comebacks",
      student: mostComeback.item.student,
      title: "Comeback Kid Award",
      detail: `Bounced back from a dip ${mostComeback.value} time${mostComeback.value === 1 ? "" : "s"} this season.`,
    });
  }

  const mostConsistent = topOf(consistency, (d) => d.rate);
  if (mostConsistent && mostConsistent.value >= 0.9) {
    suggestions.push({
      category: "Most Consistent",
      student: mostConsistent.item.student,
      title: "Never Missed a Beat Award",
      detail: `Turned in an entry ${Math.round(mostConsistent.value * 100)}% of weeks this year.`,
    });
  }

  const mostImprovedSeason = topOf(seasonImprovement, (d) => d.delta);
  if (mostImprovedSeason && mostImprovedSeason.value > 5) {
    const { first, last } = mostImprovedSeason.item;
    suggestions.push({
      category: "Most Improved (Season)",
      student: mostImprovedSeason.item.student,
      title: "Most Improved All Year",
      detail: `Went from ${first?.toFixed(0)}% to ${last?.toFixed(0)}% over the year.`,
    });
  }

  return suggestions;
}
