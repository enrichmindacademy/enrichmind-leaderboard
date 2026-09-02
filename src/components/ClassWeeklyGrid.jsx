import { useState } from "react";

// A students-by-weeks grid, all on one screen -- built specifically so a
// teacher can visually scan for entry mistakes (a week that's missing
// for someone, a total that looks obviously wrong) without clicking
// through weeks one at a time. Read-only by design: fixing a wrong
// number still happens in the existing single-week edit flow -- this is
// the "where do I even need to look" view that flow was missing.
//
// The first column is sticky so student names stay visible while
// scrolling horizontally through a full semester of weeks. A category
// selector lets the same grid answer "who's missing this week's Total"
// AND "who never turned in Assignments this month" -- one screen, any
// score category, not just the total.

const CATEGORIES = [
  { key: "total", label: "Total", field: "total" },
  { key: "classpoint_stars", label: "Participation", field: "classpoint_stars" },
  { key: "ixl_avg", label: "Assignments", field: "ixl_avg" },
  { key: "notebooking_score", label: "Notebooking", field: "notebooking_score" },
  { key: "study_guide_score", label: "Study Guide", field: "study_guide_score" },
  { key: "exam_score", label: "Exams", field: "exam_score" },
  { key: "exam_corrections_score", label: "Exam Corr.", field: "exam_corrections_score" },
  { key: "bonus", label: "Bonus", field: "bonus" },
];

const FIELD_LABELS_SHORT = {
  classpoint_stars: "Participation",
  ixl_avg: "Assignments",
  notebooking_score: "Notebooking",
  study_guide_score: "Study Guide",
  exam_score: "Exams",
  exam_corrections_score: "Exam Corr.",
  bonus: "Bonus",
};

function entryTooltip(entry) {
  if (!entry) return "No entry this week";
  return Object.entries(FIELD_LABELS_SHORT)
    .map(([field, label]) => `${label}: ${entry[field] ?? "—"}`)
    .join("  |  ");
}

// Was this category actually assigned to the class that week at all?
// FIXED_SCALE_FIELDS (ixl_avg, exam_score) only "count" in the real
// composite when SOMEONE in the class has a non-zero value -- same rule
// calc.js already uses, reused here so a week nobody was given an exam
// shows as "not assigned" instead of every student looking like they
// scored a flat 0 and missed it.
const FIXED_SCALE_FIELDS = new Set(["ixl_avg", "exam_score"]);

function wasAssignedThisWeek(entriesByWeek, weekId, students, field) {
  if (field === "total" || field === "classpoint_stars" || !FIXED_SCALE_FIELDS.has(field)) return true;
  return students.some((s) => Number(entriesByWeek[weekId]?.[s.id]?.[field]) > 0);
}

export default function ClassWeeklyGrid({ weeks, students, entriesByWeek, onSelectWeek }) {
  const sortedWeeks = [...weeks].sort((a, b) => new Date(a.date) - new Date(b.date));
  const activeStudents = students.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name));
  const [category, setCategory] = useState("total");
  const selected = CATEGORIES.find((c) => c.key === category) || CATEGORIES[0];

  if (sortedWeeks.length === 0) {
    return <p className="muted">No weeks saved yet.</p>;
  }

  return (
    <div>
      <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`btn ${category === c.key ? "" : "secondary"}`}
            style={{ padding: "3px 10px", fontSize: 11.5 }}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table className="review-table" style={{ width: "auto", minWidth: "100%" }}>
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  background: "var(--card-bg, #16161f)",
                  zIndex: 1,
                  minWidth: 140,
                }}
              >
                Student
              </th>
              {sortedWeeks.map((w) => (
                <th
                  key={w.id}
                  style={{ cursor: onSelectWeek ? "pointer" : undefined, minWidth: 64, textAlign: "center" }}
                  title={w.label}
                  onClick={() => onSelectWeek?.(w.id)}
                >
                  {w.label.length > 10 ? w.label.slice(0, 9) + "…" : w.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeStudents.map((s) => (
              <tr key={s.id}>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    background: "var(--card-bg, #16161f)",
                    fontWeight: 600,
                  }}
                >
                  {s.name}
                </td>
                {sortedWeeks.map((w) => {
                  const entry = entriesByWeek[w.id]?.[s.id];
                  const assigned = wasAssignedThisWeek(entriesByWeek, w.id, activeStudents, selected.field);
                  let display;
                  let color;
                  if (!entry) {
                    display = "—";
                    color = "var(--red)";
                  } else if (!assigned) {
                    display = "n/a";
                    color = "var(--text-lo, #888)";
                  } else {
                    const val = Number(entry[selected.field]) || 0;
                    display = val.toFixed(1);
                    color = val === 0 ? "var(--gold, #c9891f)" : undefined; // a 0 on something that WAS assigned is worth a glance, but isn't as urgent as a fully missing week
                  }
                  return (
                    <td
                      key={w.id}
                      title={entryTooltip(entry)}
                      style={{
                        textAlign: "center",
                        cursor: onSelectWeek ? "pointer" : undefined,
                        color,
                      }}
                      onClick={() => onSelectWeek?.(w.id)}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 8 }}>
        Red "—" = no entry at all that week. Amber 0 = this category was assigned, but they scored
        zero — worth a glance. Gray "n/a" = this category simply wasn't assigned to anyone that
        week. Click any cell or week header to jump there and fix it.
      </p>
    </div>
  );
}
