// netlify/functions/get-family-link.js
//
// Roster's "Copy Family Link" calls this instead of reading anything
// straight out of the browser's Supabase query -- parent_accounts has
// no RLS policy at all, so this service-role function is the only way
// to reach it. Given a studentId, looks up that student's parent_email,
// then finds the parent_accounts row for that email or creates one if
// this is the first time anyone's asked for a link for this family --
// so a teacher can generate a family link for a student the very first
// time, without a separate "set up the parent account" step.
//
// POST { studentId } -> { token, email }

const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY server environment variables." }),
    };
  }

  let studentId;
  try {
    ({ studentId } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }
  if (!studentId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing studentId." }) };
  }

  try {
    const supabase = createClient(url, serviceKey);

    const { data: student, error: studentErr } = await supabase
      .from("students")
      .select("parent_email")
      .eq("id", studentId)
      .maybeSingle();
    if (studentErr) throw studentErr;
    if (!student) return { statusCode: 404, body: JSON.stringify({ error: "Student not found." }) };
    if (!student.parent_email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "No parent email on file for this student yet -- add one before generating a family link." }),
      };
    }

    const email = student.parent_email.toLowerCase().trim();

    const { data: existing, error: findErr } = await supabase
      .from("parent_accounts")
      .select("token")
      .ilike("email", email)
      .maybeSingle();
    if (findErr) throw findErr;
    if (existing) {
      return { statusCode: 200, body: JSON.stringify({ token: existing.token, email }) };
    }

    const { data: created, error: createErr } = await supabase
      .from("parent_accounts")
      .insert({ email })
      .select("token")
      .single();
    if (createErr) throw createErr;
    return { statusCode: 200, body: JSON.stringify({ token: created.token, email }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
