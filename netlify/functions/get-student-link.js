// netlify/functions/get-student-link.js
//
// Roster's "Copy Student Link" button calls this instead of reading
// student.student_token straight out of the browser's Supabase query — the
// anon/authenticated keys can no longer read that column at all (see the
// column-level REVOKE in supabase/schema.sql), so this is the only way to
// fetch it, using the service-role key server-side.
//
// POST { studentId }                  -> { token }
// POST { studentId, resetAccess: true } -> generates a fresh token,
//   invalidating the old link (use if a link leaked or was shared wrong)

const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

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

  let studentId, resetAccess;
  try {
    ({ studentId, resetAccess } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }
  if (!studentId) {
    return { statusCode: 400, body: JSON.stringify({ error: "Missing studentId." }) };
  }

  try {
    const supabase = createClient(url, serviceKey);

    if (resetAccess) {
      const { data, error } = await supabase
        .from("students")
        .update({ student_token: randomUUID() })
        .eq("id", studentId)
        .select("student_token")
        .maybeSingle();
      if (error) throw error;
      if (!data) return { statusCode: 404, body: JSON.stringify({ error: "Student not found." }) };
      return { statusCode: 200, body: JSON.stringify({ token: data.student_token }) };
    }

    const { data, error } = await supabase
      .from("students")
      .select("student_token")
      .eq("id", studentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return { statusCode: 404, body: JSON.stringify({ error: "Student not found." }) };
    }
    return { statusCode: 200, body: JSON.stringify({ token: data.student_token }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
