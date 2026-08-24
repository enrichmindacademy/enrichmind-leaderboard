// Default starter task library, organized by category, each tagged with
// interests so auto-assignment can match a kid's own picks. Grounded in a
// few well-established findings: reading volume predicts vocabulary/
// comprehension growth; regular movement supports attention and executive
// function; consistent sleep is when learning consolidates; routine chores
// build a sense of competence and responsibility; brief calming practice
// supports classroom focus; prosocial acts (helping, kindness) support
// kids' own wellbeing; open-ended creative time builds the same flexible
// problem-solving math already asks for.
export const INTEREST_OPTIONS = [
  { key: "sports", label: "🏀 Sports" },
  { key: "art", label: "🎨 Art & Drawing" },
  { key: "building", label: "🧱 Building & Legos" },
  { key: "music", label: "🎵 Music" },
  { key: "coding", label: "💻 Coding & Tech" },
  { key: "animals", label: "🐾 Animals & Pets" },
  { key: "cooking", label: "🍳 Cooking" },
  { key: "dance", label: "💃 Dance" },
  { key: "martial_arts", label: "🥋 Martial Arts" },
  { key: "nature", label: "🌳 Nature & Outdoors" },
  { key: "reading", label: "📚 Reading" },
];

export const DEFAULT_TASK_TEMPLATES = [
  // Reading
  { title: "Read for 20 minutes", category: "habit", points: 5, interest_tags: ["reading"] },
  { title: "Read a biography of an athlete you admire", category: "habit", points: 5, interest_tags: ["sports", "reading"] },
  { title: "Read a book about how something works", category: "habit", points: 5, interest_tags: ["building", "coding", "reading"] },
  { title: "Read about an animal you'd like to learn more about", category: "habit", points: 5, interest_tags: ["animals", "reading"] },

  // Movement
  { title: "20 minutes of any physical activity", category: "habit", points: 5, interest_tags: ["sports", "dance", "nature"] },
  { title: "Practice ball control or a drill for 15 minutes", category: "habit", points: 5, interest_tags: ["sports"] },
  { title: "Learn or practice one new dance step", category: "habit", points: 5, interest_tags: ["dance"] },
  { title: "Practice your karate/martial arts forms for 15 minutes", category: "habit", points: 5, interest_tags: ["martial_arts"] },
  { title: "Take a 15-minute walk outside", category: "habit", points: 4, interest_tags: ["nature"] },

  // Sleep & routine
  { title: "Lights out by your bedtime, 3 nights this week", category: "habit", points: 5, interest_tags: [] },

  // Chores / responsibility
  { title: "Organize your desk or backpack", category: "habit", points: 3, interest_tags: [] },
  { title: "Do one chore around the house without being asked", category: "habit", points: 4, interest_tags: [] },
  { title: "Help make dinner one night this week", category: "habit", points: 5, interest_tags: ["cooking"] },
  { title: "Take care of a pet or a plant for the week", category: "habit", points: 5, interest_tags: ["animals", "nature"] },
  { title: "Build or organize something with your Legos/blocks", category: "habit", points: 4, interest_tags: ["building"] },

  // Focus & calm
  { title: "Try 5 minutes of quiet breathing before homework", category: "habit", points: 4, interest_tags: [] },

  // Kindness / social
  { title: "Help a family member or friend with something", category: "habit", points: 5, interest_tags: [] },
  { title: "Write a thank-you note to someone", category: "habit", points: 4, interest_tags: [] },

  // Creativity
  { title: "Draw or paint something for 20 minutes", category: "habit", points: 5, interest_tags: ["art"] },
  { title: "Try one new coding puzzle or Scratch project", category: "habit", points: 5, interest_tags: ["coding"] },
  { title: "Practice your instrument for 15 minutes", category: "habit", points: 5, interest_tags: ["music"] },
  { title: "Invent a small recipe or snack and share it", category: "habit", points: 5, interest_tags: ["cooking"] },

  // Math — dynamic: title is generated fresh from that week's assigned
  // skills, so it's automatically level-appropriate for every group
  // without writing a separate task per level.
  {
    title: "Extra practice on this week's skills",
    category: "math",
    points: 5,
    interest_tags: [],
    is_dynamic_math: true,
  },
];

const HABIT_REPEAT_AVOID_WEEKS = 3; // don't repeat the same habit template within this many recent weeks
const TASK_SLOTS_PER_WEEK = 2; // total habit-ish slots — catch-up items take priority within this budget

function pickRandom(arr, n) {
  const copy = [...arr];
  const picked = [];
  while (copy.length > 0 && picked.length < n) {
    const i = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(i, 1)[0]);
  }
  return picked;
}

// The single most common "how do I catch up" answer: finish what you
// didn't get to last time, not something brand new. Looks at ONE prior
// week (the one immediately before `week`) and returns that student's
// assignments which were never approved — no submission at all, or a
// submission that was rejected. (Deliberately not scanning the entire
// history: that would let an ever-growing backlog pile up rather than
// giving a student a clean, catchable target.)
function findCatchUpCandidates({ week, weeks, student, existingAssignments, submissions }) {
  const weekIds = weeks.map((w) => w.id);
  const idx = weekIds.indexOf(week.id);
  if (idx <= 0) return [];
  const priorWeekId = weekIds[idx - 1];

  const priorAssignments = existingAssignments.filter(
    (a) => a.week_id === priorWeekId && a.student_id === student.id
  );

  return priorAssignments.filter((a) => {
    const submission = submissions.find((s) => s.assignment_id === a.id);
    return !submission || submission.status === "rejected";
  });
}

// Builds the list of task_assignments rows to insert for one week, for all
// active students who don't already have assignments for that week.
// Pure function — the caller (WeeklyUpdate.jsx) does the actual Supabase
// insert, so this stays easy to test/reason about.
export function buildAutoAssignments({ week, weeks, group, students, tasks, existingAssignments, submissions }) {
  const alreadyAssignedStudentIds = new Set(
    existingAssignments.filter((a) => a.week_id === week.id).map((a) => a.student_id)
  );

  const mathTemplate = tasks.find((t) => t.category === "math" && t.active && t.is_dynamic_math);
  const habitTemplates = tasks.filter((t) => t.category === "habit" && t.active);

  const rows = [];

  students
    .filter((s) => s.active && !alreadyAssignedStudentIds.has(s.id))
    .forEach((student) => {
      const catchUps = findCatchUpCandidates({ week, weeks, student, existingAssignments, submissions });
      const catchUpMath = catchUps.find((a) => a.category === "math");
      const catchUpHabits = catchUps.filter((a) => a.category === "habit");

      // Math: catch up on last week's unfinished practice if there is
      // any, otherwise a fresh dynamic task from this week's skills.
      if (catchUpMath) {
        rows.push({
          group_id: group.id,
          week_id: week.id,
          student_id: student.id,
          task_id: catchUpMath.task_id,
          title: catchUpMath.title,
          description: catchUpMath.description,
          category: "math",
          points: catchUpMath.points,
          is_catchup: true,
          source_assignment_id: catchUpMath.id,
        });
      } else if (mathTemplate) {
        const skills = week.skills_assigned?.trim();
        rows.push({
          group_id: group.id,
          week_id: week.id,
          student_id: student.id,
          task_id: mathTemplate.id,
          title: skills ? `Extra practice: ${skills}` : mathTemplate.title,
          description: mathTemplate.description || null,
          category: "math",
          points: mathTemplate.points,
        });
      }

      // Habits: unfinished ones from last week fill the budget first;
      // any remaining slots get fresh picks matched to interests.
      catchUpHabits.slice(0, TASK_SLOTS_PER_WEEK).forEach((a) => {
        rows.push({
          group_id: group.id,
          week_id: week.id,
          student_id: student.id,
          task_id: a.task_id,
          title: a.title,
          description: a.description,
          category: "habit",
          points: a.points,
          is_catchup: true,
          source_assignment_id: a.id,
        });
      });

      const remainingSlots = Math.max(0, TASK_SLOTS_PER_WEEK - catchUpHabits.length);
      if (remainingSlots > 0) {
        const interests = student.interests || [];
        const recentlyUsedTaskIds = new Set(
          existingAssignments
            .filter(
              (a) =>
                a.student_id === student.id &&
                a.category === "habit" &&
                a.task_id &&
                isWithinRecentWeeks(a, week, HABIT_REPEAT_AVOID_WEEKS)
            )
            .map((a) => a.task_id)
        );

        let pool = habitTemplates.filter((t) => !recentlyUsedTaskIds.has(t.id));
        if (interests.length > 0) {
          const matching = pool.filter((t) =>
            (t.interest_tags || []).some((tag) => interests.includes(tag))
          );
          if (matching.length > 0) pool = matching;
        }
        if (pool.length === 0) pool = habitTemplates; // exhausted variety — allow repeats rather than assign nothing

        pickRandom(pool, remainingSlots).forEach((template) => {
          rows.push({
            group_id: group.id,
            week_id: week.id,
            student_id: student.id,
            task_id: template.id,
            title: template.title,
            description: template.description || null,
            category: "habit",
            points: template.points,
          });
        });
      }
    });

  return rows;
}

function isWithinRecentWeeks(assignment, currentWeek, span) {
  // Best-effort recency check using week creation order isn't available
  // here without the full weeks list, so we approximate with calendar
  // proximity to the current week's date.
  if (!assignment.created_at || !currentWeek?.date) return true;
  const days = (new Date(currentWeek.date) - new Date(assignment.created_at)) / 86400000;
  return days >= 0 && days <= span * 7;
}
