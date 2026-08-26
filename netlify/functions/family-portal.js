// netlify/functions/family-portal.js
//
// The real fix for "a parent with 2 kids, or a kid in 2 classes, needs
// a separate link for each enrollment." A parent_accounts row is keyed
// by EMAIL, not by student -- this function resolves that account's
// token, then looks up EVERY active student row across EVERY Level
// whose parent_email matches, and returns all of them together. Same
// service-role-only, never-touched-by-the-browser-directly security
// model as parent-portal.js.
//
// Actions (all POST, JSON body):
//   { action: "check",     token }
//   { action: "lookup",    token, pin }
//   { action: "setup_pin", token, pin }
//   { action: "approve",   token, pin, studentId, submissionId }
//   { action: "reject",    token, pin, studentId, submissionId }

const { createClient } = require("@supabase/supabase-js");

const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

function client() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY server environment variables.");
  }
  return createClient(url, serviceKey);
}

async function getAccountByToken(supabase, token) {
  const { data, error } = await supabase.from("parent_accounts").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  return data;
}

// Same verify/lockout logic as parent-portal.js, just against the
// account row instead of a student row.
async function verifyPin(supabase, account, pin) {
  if (account.pin_locked_until && new Date(account.pin_locked_until) > new Date()) {
    const mins = Math.ceil((new Date(account.pin_locked_until) - new Date()) / 60000);
    return {
      statusCode: 429,
      body: JSON.stringify({ error: `Too many incorrect PINs. Try again in about ${mins} minute(s).` }),
    };
  }

  if (!pin || String(pin) !== String(account.pin)) {
    const attempts = (account.pin_attempts || 0) + 1;
    const update = { pin_attempts: attempts };
    if (attempts >= MAX_ATTEMPTS) {
      update.pin_locked_until = new Date(Date.now() + LOCKOUT_MINUTES * 60000).toISOString();
      update.pin_attempts = 0;
    }
    await supabase.from("parent_accounts").update(update).eq("id", account.id);
    return { statusCode: 401, body: JSON.stringify({ error: "Incorrect PIN." }) };
  }

  if (account.pin_attempts) {
    await supabase.from("parent_accounts").update({ pin_attempts: 0 }).eq("id", account.id);
  }
  return null;
}

async function getChildrenForEmail(supabase, email) {
  const { data, error } = await supabase
    .from("students")
    .select("id, name, group_id, active")
    .ilike("parent_email", email)
    .eq("active", true);
  if (error) throw error;
  return data || [];
}

async function buildChildPayload(supabase, student) {
  const [{ data: group }, { data: weeks }, { data: peers }, { data: submissions }] = await Promise.all([
    supabase.from("groups").select("*").eq("id", student.group_id).maybeSingle(),
    supabase.from("weeks").select("*").eq("group_id", student.group_id).order("date"),
    supabase.from("students").select("id, name, team, active, session_id").eq("group_id", student.group_id),
    supabase
      .from("task_submissions")
      .select("*, task_assignments(*), weeks(*)")
      .eq("student_id", student.id)
      .order("submitted_at", { ascending: false }),
  ]);

  const weekIds = (weeks || []).map((w) => w.id);
  const { data: entries } = weekIds.length
    ? await supabase.from("entries").select("*").in("week_id", weekIds)
    : { data: [] };

  const subs = submissions || [];
  return {
    student: { id: student.id, name: student.name },
    groupName: group?.name || "Unknown Level",
    teacherContact: group?.teacher_contact || null,
    group: group || null,
    weeks: weeks || [],
    peers: (peers || []).filter((p) => p.active),
    entries: entries || [],
    pending: subs.filter((s) => s.status === "pending"),
    recent: subs.filter((s) => s.status !== "pending").slice(0, 10),
  };
}

async function fullPayload(supabase, account) {
  const children = await getChildrenForEmail(supabase, account.email);
  const payloads = await Promise.all(children.map((c) => buildChildPayload(supabase, c)));
  return { parentEmail: account.email, children: payloads };
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

  const { action, token, pin, studentId, submissionId } = body;
  if (!token) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing token." }) };
  }

  try {
    const supabase = client();
    const account = await getAccountByToken(supabase, token);
    if (!account) {
      return { statusCode: 404, body: JSON.stringify({ error: "Link not recognized." }) };
    }

    if (action === "check") {
      return {
        statusCode: 200,
        body: JSON.stringify({ needsSetup: !account.pin_set, email: account.email }),
      };
    }

    if (action === "setup_pin") {
      if (account.pin_set) {
        return {
          statusCode: 409,
          body: JSON.stringify({ error: "A PIN is already set up for this account. Ask the teacher to reset it if it's been forgotten." }),
        };
      }
      if (!pin || !/^\d{4}$/.test(String(pin))) {
        return { statusCode: 400, body: JSON.stringify({ error: "PIN must be 4 digits." }) };
      }
      await supabase
        .from("parent_accounts")
        .update({ pin, pin_set: true, pin_attempts: 0, pin_locked_until: null })
        .eq("id", account.id);
      return { statusCode: 200, body: JSON.stringify(await fullPayload(supabase, account)) };
    }

    if (!account.pin_set) {
      return { statusCode: 200, body: JSON.stringify({ needsSetup: true, email: account.email }) };
    }

    const pinError = await verifyPin(supabase, account, pin);
    if (pinError) return pinError;

    if (action === "lookup") {
      return { statusCode: 200, body: JSON.stringify(await fullPayload(supabase, account)) };
    }

    if (action === "approve" || action === "reject") {
      if (!studentId || !submissionId) {
        return { statusCode: 400, body: JSON.stringify({ error: "Missing studentId or submissionId." }) };
      }

      // Re-scope: only allow acting on a child whose parent_email
      // actually matches this account, and only on a submission that
      // actually belongs to that child -- a parent can never touch
      // another family's data even if they guessed an id.
      const { data: student, error: studentErr } = await supabase
        .from("students")
        .select("id, parent_email")
        .eq("id", studentId)
        .maybeSingle();
      if (studentErr) throw studentErr;
      if (!student || (student.parent_email || "").toLowerCase() !== account.email.toLowerCase()) {
        return { statusCode: 403, body: JSON.stringify({ error: "That student isn't linked to this account." }) };
      }

      const { data: submission, error: subErr } = await supabase
        .from("task_submissions")
        .select("*, task_assignments(*)")
        .eq("id", submissionId)
        .eq("student_id", studentId)
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
          .eq("student_id", studentId)
          .maybeSingle();

        if (existingEntry) {
          await supabase
            .from("entries")
            .update({ bonus: Number(existingEntry.bonus) + Number(assignment.points) })
            .eq("id", existingEntry.id);
        } else {
          await supabase.from("entries").insert({
            week_id: submission.week_id,
            student_id: studentId,
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

      return { statusCode: 200, body: JSON.stringify(await fullPayload(supabase, account)) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown action." }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
