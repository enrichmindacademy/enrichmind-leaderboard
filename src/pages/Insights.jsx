import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { useGroup } from "../lib/GroupContext";
import { avgCumulativePointsForWeek, superstarRateForWeek, taskCompletionRateForWeek } from "../lib/calc";

export default function Insights() {
  const { students, weeks, entriesByWeek, assignments, submissions, loading } = useGroup();
  const activeStudents = students.filter((s) => s.active);

  if (loading) return <div className="card">Loading…</div>;

  if (weeks.length === 0) {
    return (
      <div className="card">
        <p className="muted">No weeks logged yet — trends will show up once you've saved a few.</p>
      </div>
    );
  }

  const data = weeks.map((w) => ({
    label: w.label,
    avgPoints: round1(avgCumulativePointsForWeek(entriesByWeek, weeks, w.id, activeStudents)),
    superstarRate: round1(superstarRateForWeek(entriesByWeek, w.id, activeStudents)),
    taskCompletionRate: round1(taskCompletionRateForWeek(assignments, submissions, w.id)),
  }));

  const latest = data[data.length - 1];

  return (
    <>
      <div className="card">
        <div className="card-title">Class-Wide Trends</div>
        <p className="muted">
          How the class is trending across a full term — a quick pulse-check before it shows up
          as a parent question.
        </p>
      </div>

      <div className="card">
        <div className="row" style={{ gap: 28, flexWrap: "wrap" }}>
          <Stat label="Avg. points earned so far" value={latest.avgPoints?.toFixed(0) ?? "—"} />
          <Stat label="Superstar rate this week" value={latest.superstarRate !== null ? `${latest.superstarRate}%` : "—"} />
          <Stat label="Task completion" value={latest.taskCompletionRate !== null ? `${latest.taskCompletionRate}%` : "—"} />
        </div>
      </div>

      <ChartCard
        title="Average Points Earned (running total per student)"
        subtitle="Always climbs as real work accumulates — a dip in one week's score doesn't undo what came before."
        dataKey="avgPoints"
        color="#5b8def"
        data={data}
      />
      <ChartCard
        title="Superstar Rate"
        subtitle="% of students with a perfect IXL week"
        dataKey="superstarRate"
        color="#c9891f"
        data={data}
        suffix="%"
      />
      <ChartCard
        title="Task Completion Rate"
        subtitle="% of assigned tasks approved"
        dataKey="taskCompletionRate"
        color="#2f9e63"
        data={data}
        suffix="%"
      />
    </>
  );
}

function round1(n) {
  return n === null || n === undefined ? null : Math.round(n * 10) / 10;
}

function Stat({ label, value }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".04em" }}>
        {label}
      </div>
      <div className="font-display" style={{ fontSize: 22, fontWeight: 800 }}>
        {value}
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, dataKey, color, data, suffix = "" }) {
  return (
    <div className="card">
      <div className="card-title" style={{ marginBottom: 2 }}>
        {title}
      </div>
      <p className="muted" style={{ fontSize: 12.5, marginBottom: 12 }}>
        {subtitle}
      </p>
      <div style={{ width: "100%", height: 200 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 12, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(30,20,60,0.08)" vertical={false} />
            <XAxis dataKey="label" stroke="#736c8d" fontSize={11.5} tickLine={false} axisLine={false} />
            <YAxis stroke="#736c8d" fontSize={11.5} unit={suffix} tickLine={false} axisLine={false} width={44} />
            <Tooltip
              contentStyle={{
                background: "#1e0b3c",
                border: "none",
                borderRadius: 10,
                fontSize: 13,
              }}
              labelStyle={{ color: "rgba(255,255,255,.7)" }}
            />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={3}
              dot={{ r: 4, fill: color, strokeWidth: 0 }}
              activeDot={{ r: 6 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
