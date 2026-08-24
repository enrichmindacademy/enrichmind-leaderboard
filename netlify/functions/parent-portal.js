// netlify/functions/parent-portal.js
//
// Everything the parent-facing page needs, done server-side with Supabase's
// SERVICE ROLE key (never exposed to the browser). This replaces direct
// browser -> Supabase calls for the parent flow so that:
//   - the anon key alone can never resolve a parent_token to a student
//     (see the column-level REVOKE in supabase/schema.sql)
//   - a parent's browser only ever learns about their OWN child — this
//     function looks the student up by token and scopes every query to
//     that student's id, never returning a list of other students.
//
// PIN model: the teacher only ever shares the LINK (no PIN to distribute
// separately). The first person to open a student's link is prompted to
// create a 4-digit PIN themselves ("something you know", chosen by
// whoever's actually there) — every visit after that requires it. This
// trades a small amount of protection (whoever opens the link FIRST claims
// it) for not requiring the teacher to hand out two secrets through two
// channels. If a parent forgets their PIN, there's no self-service
// recovery — that would just recreate the same "who is this really"
// problem — so the teacher resets it from Roster, which clears the PIN
// and re-opens the link for a fresh self-service setup.
//
// Actions (all POST, JSON body):
//   { action: "check",     token }                -- which screen to show;
//        never touches PIN attempts, returns { needsSetup, student, teacherContact }
//   { action: "lookup",    token, pin }
//   { action: "setup_pin", token, pin }           -- first-time only
//   { action: "approve",   token, pin, submissionId }
//   { action: "reject",    token, pin, submissionId }

const { createClient } = require("@supabase/supabase-js");

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function client() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY server environment variables."
    );
  }
  return createClient(url, serviceKey);
}

async function getStudentByToken(supabase, token) {
  const { data, error } = await supabase
    .from("students")
    .select("id, name, group_id, parent_pin, parent_pin_set, parent_pin_attempts, parent_pin_locked_until")
    .eq("parent_token", token)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Returns null if the PIN checks out, or a {statusCode, body} error object
// to return immediately otherwise. Mutates attempt/lockout counters in the
// database as a side effect. Assumes student.parent_pin_set is already true.
async function verifyPin(supabase, student, pin) {
  if (student.parent_pin_locked_until && new Date(student.parent_pin_locked_until) > new Date()) {
    const mins = Math.ceil((new Date(student.parent_pin_locked_until) - new Date()) / 60000);
    return {
      statusCode: 429,
      body: JSON.stringify({ error: `Too many incorrect PINs. Try again in about ${mins} minute(s).` }),
    };
  }

  if (!pin || String(pin) !== String(student.parent_pin)) {
    const attempts = (student.parent_pin_attempts || 0) + 1;
    const update = { parent_pin_attempts: attempts };
    if (attempts >= MAX_ATTEMPTS) {
      update.parent_pin_locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString();
      update.parent_pin_attempts = 0;
    }
    await supabase.from("students").update(update).eq("id", student.id);
    return { statusCode: 401, body: JSON.stringify({ error: "Incorrect PIN." }) };
  }

  if (student.parent_pin_attempts) {
    await supabase.from("students").update({ parent_pin_attempts: 0 }).eq("id", student.id);
  }
  return null;
}

async function getSubmissionsForStudent(supabase, studentId) {
  const { data, error } = await supabase
    .from("task_submissions")
    .select("*, task_assignments(*), weeks(*)")
    .eq("student_id", studentId)
    .order("submitted_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

async function getTeacherContact(supabase, groupId) {
  const { data } = await supabase.from("groups").select("teacher_contact").eq("id", groupId).maybeSingle();
  return data?.teacher_contact || null;
}

// Same shape student-portal.js already builds for the student-facing
// page -- group, every week, active peers, and every entry for those
// weeks. This is what lets the parent portal compute League tier,
// growth, and the score breakdown using the exact same calc.js
// functions the student and teacher views already use, rather than a
// second, separately-maintained copy of that math.
async function buildProgressContext(supabase, student) {
  const [{ data: group }, { data: weeks }, { data: peers }] = await Promise.all([
    supabase.from("groups").select("*").eq("id", student.group_id).maybeSingle(),
    supabase.from("weeks").select("*").eq("group_id", student.group_id).order("date"),
    supabase
      .from("students")
      .select("id, name, team, active, session_id")
      .eq("group_id", student.group_id),
  ]);

  const weekIds = (weeks || []).map((w) => w.id);
  const { data: entries } = weekIds.length
    ? await supabase.from("entries").select("*").in("week_id", weekIds)
    : { data: [] };

  return {
    group: group || null,
    weeks: weeks || [],
    peers: (peers || []).filter((p) => p.active),
    entries: entries || [],
  };
}

function payloadFor(student, submissions, teacherContact, progress) {
  return {
    student: { id: student.id, name: student.name },
    pending: submissions.filter((s) => s.status === "pending"),
    recent: submissions.filter((s) => s.status !== "pending").slice(0, 10),
    teacherContact,
    ...progress,
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

  const { action, token, pin, submissionId } = body;
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing token." }) };
  }

  try {
    const supabase = client();
    const student = await getStudentByToken(supabase, token);
    if (!student) {
      return { statusCode: 404, body: JSON.stringify({ error: "Link not recognized." }) };
    }

    const teacherContact = await getTeacherContact(supabase, student.group_id);

    if (action === "check") {
      // Just "which screen should I show" — never touches PIN attempts.
      return {
        statusCode: 200,
        body: JSON.stringify({
          needsSetup: !student.parent_pin_set,
          student: { id: student.id, name: student.name },
          teacherContact,
        }),
      };
    }

    if (action === "setup_pin") {
      if (student.parent_pin_set) {
        return {
          statusCode: 409,
          body: JSON.stringify({ error: "A PIN is already set up for this student. Ask the teacher to reset it if it's been forgotten." }),
        };
      }
      if (!pin || !/^\d{4}$/.test(String(pin))) {
        return { statusCode: 400, body: JSON.stringify({ error: "PIN must be 4 digits." }) };
      }
      await supabase
        .from("students")
        .update({ parent_pin: pin, parent_pin_set: true, parent_pin_attempts: 0, parent_pin_locked_until: null })
        .eq("id", student.id);

      const submissions = await getSubmissionsForStudent(supabase, student.id);
      const progress = await buildProgressContext(supabase, student);
      return { statusCode: 200, body: JSON.stringify(payloadFor(student, submissions, teacherContact, progress)) };
    }

    if (!student.parent_pin_set) {
      // Nobody has claimed this student's PIN yet — every action short-
      // circuits into "please set one up" rather than failing.
      return {
        statusCode: 200,
        body: JSON.stringify({ needsSetup: true, student: { id: student.id, name: student.name }, teacherContact }),
      };
    }

    const pinError = await verifyPin(supabase, student, pin);
    if (pinError) return pinError;

    if (action === "lookup") {
      const submissions = await getSubmissionsForStudent(supabase, student.id);
      const progress = await buildProgressContext(supabase, student);
      return { statusCode: 200, body: JSON.stringify(payloadFor(student, submissions, teacherContact, progress)) };
    }

    if (action === "approve" || action === "reject") {
      if (!submissionId) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing submissionId." }) };
      }

      // Re-scope: only allow acting on a submission that actually belongs
      // to the student this token resolves to — a parent can never touch
      // another student's submission even if they guessed an id.
      const { data: submission, error: subErr } = await supabase
        .from("task_submissions")
        .select("*, task_assignments(*)")
        .eq("id", submissionId)
        .eq("student_id", student.id)
        .maybeSingle();
      if (subErr) throw subErr;
      if (!submission) {
        return { statusCode: 404, body: JSON.stringify({ error: "Submission not found for this student." }) };
      }

      if (action === "approve") {
        const assignment = submission.task_assignments;
        const { data: existingEntry } = await supabase
          .from("entries")
          .select("*")
          .eq("week_id", submission.week_id)
          .eq("student_id", student.id)
          .maybeSingle();

        if (existingEntry) {
          await supabase
            .from("entries")
            .update({ bonus: Number(existingEntry.bonus) + Number(assignment.points) })
            .eq("id", existingEntry.id);
        } else {
          await supabase.from("entries").insert({
            week_id: submission.week_id,
            student_id: student.id,
            classpoint_stars: 0,
            ixl_avg: 0,
            bonus: Number(assignment.points),
          });
        }

        await supabase
          .from("task_submissions")
          .update({ status: "approved", reviewed_at: new Date().toISOString() })
          .eq("id", submissionId);
      } else {
        await supabase
          .from("task_submissions")
          .update({ status: "rejected", reviewed_at: new Date().toISOString() })
          .eq("id", submissionId);
      }

      const submissions = await getSubmissionsForStudent(supabase, student.id);
      const progress = await buildProgressContext(supabase, student);
      return { statusCode: 200, body: JSON.stringify(payloadFor(student, submissions, teacherContact, progress)) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown action." }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
