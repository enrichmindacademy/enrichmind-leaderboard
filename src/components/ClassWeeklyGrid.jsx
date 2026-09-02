// A students-by-weeks grid, all on one screen -- built specifically so a
// teacher can visually scan for entry mistakes (a week that's missing
// for someone, a total that looks obviously wrong) without clicking
// through weeks one at a time. Read-only by design: fixing a wrong
// number still happens in the existing single-week edit flow -- this is
// the "where do I even need to look" view that flow was missing.
//
// The first column is sticky so student names stay visible while
// scrolling horizontally through a full semester of weeks.

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

export default function ClassWeeklyGrid({ weeks, students, entriesByWeek, onSelectWeek }) {
  const sortedWeeks = [...weeks].sort((a, b) => new Date(a.date) - new Date(b.date));
  const activeStudents = students.filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name));

  if (sortedWeeks.length === 0) {
    return <p className="muted">No weeks saved yet.</p>;
  }

  return (
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
                return (
                  <td
                    key={w.id}
                    title={entryTooltip(entry)}
                    style={{
                      textAlign: "center",
                      cursor: onSelectWeek ? "pointer" : undefined,
                      color: entry ? undefined : "var(--red)",
                    }}
                    onClick={() => onSelectWeek?.(w.id)}
                  >
                    {entry ? Number(entry.total).toFixed(1) : "—"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 8 }}>
        Click any cell or week header to jump to that week and fix an entry. A red "—" means that
        student has no entry saved for that week at all.
      </p>
    </div>
  );
}
