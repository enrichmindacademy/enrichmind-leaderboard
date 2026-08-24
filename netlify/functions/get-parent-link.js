// netlify/functions/get-parent-link.js
//
// Roster's "Copy Parent Link" / "Reset Parent Access" actions call this
// instead of reading student.parent_token straight out of the browser's
// Supabase query — the anon/authenticated keys can no longer read that
// column at all (see the column-level REVOKE in supabase/schema.sql), so
// this is the only way to fetch it, using the service-role key server-side.
//
// The teacher never sees a parent's PIN under the self-service model — the
// parent chooses it themselves on first visit (see parent-portal.js). This
// function only ever hands back the link itself, or resets access.
//
// POST { studentId }                  -> { token }
// POST { studentId, resetAccess: true } -> clears the current PIN so the
//   link re-opens into first-time setup (use when a parent forgets theirs,
//   or you want to hand the student off to a different parent/guardian)

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
        .update({ parent_pin: null, parent_pin_set: false, parent_pin_attempts: 0, parent_pin_locked_until: null })
        .eq("id", studentId)
        .select("parent_token")
        .maybeSingle();
      if (error) throw error;
      if (!data) return { statusCode: 404, body: JSON.stringify({ error: "Student not found." }) };
      return { statusCode: 200, body: JSON.stringify({ token: data.parent_token }) };
    }

    const { data, error } = await supabase
      .from("students")
      .select("parent_token")
      .eq("id", studentId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return { statusCode: 404, body: JSON.stringify({ error: "Student not found." }) };
    }
    return { statusCode: 200, body: JSON.stringify({ token: data.parent_token }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
