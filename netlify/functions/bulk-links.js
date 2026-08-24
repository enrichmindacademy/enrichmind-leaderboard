// netlify/functions/bulk-links.js
//
// Roster's "Export All Links" button calls this to fetch every student's
// and parent's token in one request, since student_token/parent_token
// are revoked from direct client access (see supabase/schema.sql) --
// name and parent_email aren't sensitive and could be read client-side
// directly, but the tokens can't, so this bundles all three together in
// one server-side call rather than needing a second round-trip just for
// the tokens.
//
// POST { groupId? }  -- omit groupId to export every active student
//                        across every Level at once.
// -> { students: [{ id, name, group_id, parent_email, parent_token, student_token }] }

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

  let groupId;
  try {
    ({ groupId } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body." }) };
  }

  try {
    const supabase = createClient(url, serviceKey);
    let query = supabase
      .from("students")
      .select("id, name, group_id, parent_email, parent_token, student_token")
      .eq("active", true)
      .order("name");
    if (groupId) query = query.eq("group_id", groupId);

    const { data, error } = await query;
    if (error) throw error;

    return { statusCode: 200, body: JSON.stringify({ students: data || [] }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
