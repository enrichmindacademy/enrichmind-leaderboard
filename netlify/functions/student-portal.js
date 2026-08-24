// netlify/functions/student-portal.js
//
// Powers the student-facing /student/:token page. Uses the service-role
// key server-side (never shipped to the browser) since RLS now requires a
// signed-in teacher session for these tables — a student has no login, so
// everything here goes through this function instead, scoped to what a
// student needs to see their own standing.
//
// A student's league/growth ranking is inherently relative to classmates
// (same as what's projected in class), so this does return peer names and
// scores for their group — not more sensitive than the Projector Board
// already shows. No PIN gate here (unlike the parent portal): this is
// read-only-plus-self-reporting, nothing to protect from the student
// tampering with, since marking a task "done" only ever creates a PENDING
// submission a parent/teacher still has to approve.
//
// Actions (all POST, JSON body):
//   { action: "lookup",       token }
//   { action: "submit_task",  token, assignmentId, reflection? }
//   { action: "save_goal",    token, weekId, goalMetric, goalTarget, note }
//   { action: "set_interests", token, interests: string[] }

const { createClient } = require("@supabase/supabase-js");

function client() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY server environment variables.");
  }
  return createClient(url, serviceKey);
}

async function getStudentByToken(supabase, token) {
  const { data, error } = await supabase
    .from("students")
    .select("id, name, group_id, session_id, team, interests, active")
    .eq("student_token", token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function buildContext(supabase, student) {
  const [{ data: group }, { data: weeks }, { data: peers }] = await Promise.all([
    supabase.from("groups").select("*").eq("id", student.group_id).maybeSingle(),
    supabase.from("weeks").select("*").eq("group_id", student.group_id).order("date"),
    supabase
      .from("students")
      .select("id, name, team, active, session_id, interests")
      .eq("group_id", student.group_id),
  ]);

  const weekIds = (weeks || []).map((w) => w.id);
  const [{ data: entries }, { data: tasks }, { data: assignments }, { data: submissions }] = await Promise.all([
    weekIds.length ? supabase.from("entries").select("*").in("week_id", weekIds) : { data: [] },
    supabase.from("tasks").select("*").eq("group_id", student.group_id),
    weekIds.length
      ? supabase.from("task_assignments").select("*").in("week_id", weekIds).eq("student_id", student.id)
      : { data: [] },
    weekIds.length
      ? supabase.from("task_submissions").select("*").in("week_id", weekIds).eq("student_id", student.id)
      : { data: [] },
  ]);

  return {
    student: { id: student.id, name: student.name, interests: student.interests || [] },
    group: group || null,
    weeks: weeks || [],
    peers: (peers || []).filter((p) => p.active),
    entries: entries || [],
    tasks: (tasks || []).filter((t) => t.active),
    assignments: assignments || [],
    submissions: submissions || [],
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }

  const { action, token } = body;
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing token." }) };
  }

  try {
    const supabase = client();
    const student = await getStudentByToken(supabase, token);
    if (!student || !student.active) {
      return { statusCode: 404, body: JSON.stringify({ error: "Link not recognized." }) };
    }

    if (action === "lookup") {
      const context = await buildContext(supabase, student);
      return { statusCode: 200, body: JSON.stringify(context) };
    }

    if (action === "submit_task") {
      const { assignmentId, reflection } = body;
      if (!assignmentId) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing assignmentId." }) };
      }
      const { data: assignment } = await supabase
        .from("task_assignments")
        .select("*")
        .eq("id", assignmentId)
        .eq("student_id", student.id)
        .maybeSingle();
      if (!assignment) {
        return { statusCode: 404, body: JSON.stringify({ error: "Task not found for this student." }) };
      }

      const { data: existing } = await supabase
        .from("task_submissions")
        .select("*")
        .eq("assignment_id", assignmentId)
        .maybeSingle();

      if (existing && existing.status === "rejected") {
        await supabase
          .from("task_submissions")
          .update({ status: "pending", reflection: reflection || null, submitted_at: new Date().toISOString(), reviewed_at: null })
          .eq("id", existing.id);
      } else if (!existing) {
        await supabase.from("task_submissions").insert({
          assignment_id: assignmentId,
          student_id: student.id,
          week_id: assignment.week_id,
          status: "pending",
          reflection: reflection || null,
        });
      }

      const context = await buildContext(supabase, student);
      return { statusCode: 200, body: JSON.stringify(context) };
    }

    if (action === "save_goal") {
      const { weekId, goalMetric, goalTarget, note } = body;
      if (!weekId || !goalMetric || goalTarget === undefined || goalTarget === null) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing goal fields." }) };
      }
      const { data: existingEntry } = await supabase
        .from("entries")
        .select("*")
        .eq("week_id", weekId)
        .eq("student_id", student.id)
        .maybeSingle();

      const payload = { goal_metric: goalMetric, goal_target: Number(goalTarget), student_goal: note || null };
      if (existingEntry) {
        await supabase.from("entries").update(payload).eq("id", existingEntry.id);
      } else {
        await supabase.from("entries").insert({
          week_id: weekId,
          student_id: student.id,
          classpoint_stars: 0,
          ixl_avg: 0,
          bonus: 0,
          ...payload,
        });
      }

      const context = await buildContext(supabase, student);
      return { statusCode: 200, body: JSON.stringify(context) };
    }

    if (action === "set_interests") {
      const { interests } = body;
      if (!Array.isArray(interests)) {
        return { statusCode: 400, body: JSON.stringify({ error: "interests must be an array." }) };
      }
      await supabase.from("students").update({ interests }).eq("id", student.id);
      const context = await buildContext(supabase, student);
      return { statusCode: 200, body: JSON.stringify(context) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown action." }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
