// Pulled from enrichmindacademy.com/programs — used by Roster's
// "Load My Programs" button to create your real Levels in one click.
//
// Courses that meet twice a week are kept as two fully separate Levels
// (e.g. "Level 5 Mon" and "Level 5 Fri") rather than one Level with two
// sessions — each is its own independent leaderboard/roster. Every entry
// carries its real meeting day explicitly (not just guessed from the
// name), since several single-session courses -- Level 7, Algebra 2,
// Pre-Calculus, Digital SAT Math Prep, all four Competition Math levels
// -- have a real day but nothing in their name to show it. This day gets
// written to that Level's `meets_day` column on creation, which is what
// the schedule views (Overview's "Today's Classes", the sidebar picker's
// day grouping) actually read — update it here if the site's course
// lineup or schedule changes.
export const PROGRAM_CATALOG = [
  { name: "Level 1", day: "Wed" },
  { name: "Level 2", day: "Fri" },
  { name: "Level 3 Tue", day: "Tue" },
  { name: "Level 3 Fri", day: "Fri" },
  { name: "Level 4 Mon", day: "Mon" },
  { name: "Level 4 Tue", day: "Tue" },
  { name: "Level 5 Mon", day: "Mon" },
  { name: "Level 5 Fri", day: "Fri" },
  { name: "Level 6 Tue", day: "Tue" },
  { name: "Level 6 Wed", day: "Wed" },
  { name: "Level 7", day: "Tue" },
  { name: "Algebra 1 Mon", day: "Mon" },
  { name: "Algebra 1 Wed", day: "Wed" },
  { name: "Geometry Mon", day: "Mon" },
  { name: "Geometry Fri", day: "Fri" },
  { name: "Algebra 2", day: "Tue" },
  { name: "Pre-Calculus", day: "Wed" },
  { name: "Digital SAT Math Prep", day: "Thu" },
  { name: "Competition Math 1-2", day: "Thu" },
  { name: "Competition Math 3-4", day: "Thu" },
  { name: "Competition Math 5-6", day: "Thu" },
  { name: "Competition Math 7-8", day: "Thu" },
];
