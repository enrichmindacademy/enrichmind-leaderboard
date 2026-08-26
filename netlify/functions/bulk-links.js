// netlify/functions/bulk-links.js
//
// Roster's "Export All Links" button calls this to fetch every student's
// tokens AND their family's token in one request, since none of those
// are readable directly from the browser (see supabase/schema.sql).
// Also finds-or-creates a parent_accounts row for every unique parent
// email in the batch, the same as get-family-link.js does for one
// student at a time -- batched here so exporting a whole roster doesn't
// mean one request per family.
//
// POST { groupId? }  -- omit groupId to export every active student
//                        across every Level at once.
// -> { students: [{ id, name, group_id, parent_email, parent_token, student_token, family_token }] }

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
    const students = data || [];

    const uniqueEmails = [...new Set(students.map((s) => (s.parent_email || "").toLowerCase().trim()).filter(Boolean))];
    const familyTokenByEmail = {};

    if (uniqueEmails.length > 0) {
      const { data: existingAccounts, error: findErr } = await supabase
        .from("parent_accounts")
        .select("email, token")
        .in("email", uniqueEmails);
      if (findErr) throw findErr;
      (existingAccounts || []).forEach((a) => {
        familyTokenByEmail[a.email] = a.token;
      });

      const missingEmails = uniqueEmails.filter((e) => !familyTokenByEmail[e]);
      if (missingEmails.length > 0) {
        const { data: created, error: createErr } = await supabase
          .from("parent_accounts")
          .insert(missingEmails.map((email) => ({ email })))
          .select("email, token");
        if (createErr) throw createErr;
        (created || []).forEach((a) => {
          familyTokenByEmail[a.email] = a.token;
        });
      }
    }

    const withFamilyTokens = students.map((s) => ({
      ...s,
      family_token: s.parent_email ? familyTokenByEmail[s.parent_email.toLowerCase().trim()] || null : null,
    }));

    return { statusCode: 200, body: JSON.stringify({ students: withFamilyTokens }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
