// Every week's full category breakdown for ONE student, one row per
// week -- the student-facing counterpart to ClassWeeklyGrid. A single
// student's own history has room to show the actual category numbers
// (not just a total), which is exactly what's needed to actually verify
// "did the teacher enter this correctly" rather than just "does this
// total look about right."

const COLUMNS = [
  { field: "classpoint_stars", label: "⭐ Participation" },
  { field: "ixl_avg", label: "Assignments" },
  { field: "notebooking_score", label: "Notebooking" },
  { field: "study_guide_score", label: "Study Guide" },
  { field: "exam_score", label: "Exams" },
  { field: "exam_corrections_score", label: "Exam Corr." },
  { field: "bonus", label: "Bonus" },
];

export default function StudentWeeklyTable({ weeks, entriesByWeek, studentId }) {
  const sortedWeeks = [...weeks].sort((a, b) => new Date(b.date) - new Date(a.date)); // most recent first -- a student cares about "did last week save right" more than ancient history

  if (sortedWeeks.length === 0) {
    return <p className="muted">No weeks yet.</p>;
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <table className="review-table">
        <thead>
          <tr>
            <th>Week</th>
            {COLUMNS.map((c) => (
              <th key={c.field}>{c.label}</th>
            ))}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {sortedWeeks.map((w) => {
            const entry = entriesByWeek[w.id]?.[studentId];
            return (
              <tr key={w.id}>
                <td>{w.label}</td>
                {!entry ? (
                  <td colSpan={COLUMNS.length + 1} className="muted">
                    No entry this week
                  </td>
                ) : (
                  <>
                    {COLUMNS.map((c) => (
                      <td key={c.field}>{entry[c.field] != null ? Number(entry[c.field]).toFixed(1) : "—"}</td>
                    ))}
                    <td style={{ fontWeight: 600 }}>{Number(entry.total).toFixed(1)}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted" style={{ marginTop: 8 }}>
        If any of these look wrong, tell your teacher which week and what it should be.
      </p>
    </div>
  );
}
