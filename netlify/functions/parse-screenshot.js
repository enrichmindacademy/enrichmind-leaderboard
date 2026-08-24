// netlify/functions/parse-screenshot.js
//
// Server-side only. Receives base64 screenshots + context from the browser,
// calls Anthropic's vision API with the secret key (never exposed to the
// client), and returns structured JSON the frontend renders into an
// editable review table. Nothing is saved to Supabase here — the browser
// does that only after the teacher confirms the numbers.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "ANTHROPIC_API_KEY is not set on the server." }),
    };
  }

  try {
    const {
      classpointImage, // { base64, mediaType } | null
      ixlImage, // { base64, mediaType } | null
      formativeImage, // { base64, mediaType } | null
      kutaworksImage, // { base64, mediaType } | null
      classmarkerImage, // { base64, mediaType } | null
      skillsAssigned, // string, e.g. "F1, F3, F4, F5, I1, I7" — IXL only
      rosterNames, // string[] full roster names, for fuzzy-match hinting
    } = JSON.parse(event.body || "{}");

    if (!classpointImage && !ixlImage && !formativeImage && !kutaworksImage && !classmarkerImage) {
      return { statusCode: 400, body: JSON.stringify({ error: "No images provided." }) };
    }

    const content = [];

    content.push({
      type: "text",
      text: buildPrompt(skillsAssigned, rosterNames, {
        hasClasspoint: !!classpointImage,
        hasIxl: !!ixlImage,
        hasFormative: !!formativeImage,
        hasKutaworks: !!kutaworksImage,
        hasClassmarker: !!classmarkerImage,
      }),
    });

    if (classpointImage) {
      content.push({
        type: "text",
        text: "=== CLASSPOINT SCREENSHOT (stars leaderboard) ===",
      });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: classpointImage.mediaType,
          data: classpointImage.base64,
        },
      });
    }

    if (ixlImage) {
      content.push({
        type: "text",
        text: "=== IXL SCORE REPORT SCREENSHOT (wide skills table) ===",
      });
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: ixlImage.mediaType,
          data: ixlImage.base64,
        },
      });
    }

    if (formativeImage) {
      content.push({
        type: "text",
        text: "=== FORMATIVE SCREENSHOT (grouped results, TOTALS column) ===",
      });
      content.push({
        type: "image",
        source: { type: "base64", media_type: formativeImage.mediaType, data: formativeImage.base64 },
      });
    }

    if (kutaworksImage) {
      content.push({
        type: "text",
        text: "=== KUTA WORKS SCREENSHOT (# Completed / Percent table) ===",
      });
      content.push({
        type: "image",
        source: { type: "base64", media_type: kutaworksImage.mediaType, data: kutaworksImage.base64 },
      });
    }

    if (classmarkerImage) {
      content.push({
        type: "text",
        text: "=== CLASSMARKER SCREENSHOT (By Individual results table) ===",
      });
      content.push({
        type: "image",
        source: { type: "base64", media_type: classmarkerImage.mediaType, data: classmarkerImage.base64 },
      });
    }

    const response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        messages: [{ role: "user", content }],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status,
        body: JSON.stringify({ error: data.error?.message || "Anthropic API error" }),
      };
    }

    const textBlock = (data.content || []).find((b) => b.type === "text");
    const raw = textBlock ? textBlock.text : "";
    const cleaned = raw.replace(/```json/g, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Model did not return valid JSON.", raw }),
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify(parsed),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};

function buildPrompt(skillsAssigned, rosterNames, has) {
  const rosterList = (rosterNames || []).join(", ");

  return `You are extracting weekly student data from screenshots for a classroom leaderboard app. Respond with ONLY raw JSON — no markdown fences, no commentary, no preamble.

The class roster (full names) is: ${rosterList || "(not provided)"}

${has.hasClasspoint ? `
CLASSPOINT SCREENSHOT INSTRUCTIONS:
This is a simple leaderboard: first name + a star icon + a star count, one row per student.
- Extract every visible row as { "name": "<first name as shown>", "stars": <integer count next to the star icon> }.
- Names shown are first names only. Do not guess a last name.
- If a row has no star icon/count visible, use 0.
` : ""}
${has.hasIxl ? `
IXL SCORE REPORT INSTRUCTIONS:
This is a wide table. Column headers across the top are full student names (may be truncated with "..."). Row groups are lettered sections (e.g. "F. FACTORS, MULTIPLES, AND DIVISIBILITY"), each containing numbered skill rows (e.g. "1. Identify factors", "3. Prime and composite numbers"). Cells contain a score 0-100, or are blank.

The teacher says the skills assigned this week are: "${skillsAssigned || "(not specified)"}" — parse this code list carefully:
- "F1" means section F, row 1.
- "F1, 3, 4" means section F, rows 1, 3, and 4 (a bare number continues the most recent section letter).
- "F1-4" or "F1–4" (a range) means section F, rows 1 THROUGH 4 inclusive (1, 2, 3, 4) — expand ranges fully, don't skip rows in between.
- "I 1, 7" means section I, rows 1 and 7.
Match each resulting code to its lettered section header and numbered row.

- Read ROW BY ROW across all student columns for each of the assigned skill rows only (this table can have 15-20+ student columns — reading row-by-row keeps columns from misaligning). Ignore all other rows.
- For each student column, record the RAW score for every individual assigned skill row — do not average them yourself, the app computes the average from your raw numbers so a single arithmetic slip doesn't silently throw off every student.
- A blank/empty cell (not attempted) counts as 0.
- Extract full names as shown in the column headers, even if truncated (e.g. "Samhitha budhav..." stays as-is; you do NOT need to guess the full name — fuzzy-matching against the roster happens client-side afterward).
` : ""}
${has.hasFormative ? `
FORMATIVE SCREENSHOT INSTRUCTIONS:
This shows results grouped by class session (e.g. "L5 Fri 2026-27", "L5 Mon 2026-27") with a TOTALS percent column. Only ONE group is usually expanded (showing individual student rows beneath it) -- the others are collapsed summary rows with no names under them.
- Extract students ONLY from the expanded group's individual rows -- ignore the top "Average" summary row and any collapsed group rows (a row is a group, not a student, if it has an expand/collapse arrow and no individual rows visible under it).
- Names are shown as "Last, First" (e.g. "Chegireddy, Arjun") -- reverse this to "First Last" order when extracting.
- Use the TOTALS column percentage (not the individual numbered question columns) as that student's score, 0-100.
- If a student shows 0%, include them with 0 -- don't skip them.
` : ""}
${has.hasKutaworks ? `
KUTA WORKS SCREENSHOT INSTRUCTIONS:
This is a simple table with columns Name, "# Completed", and "Percent".
- Extract every student row, using the Percent column (strip the "%" sign) as that student's score, 0-100.
- Names are shown as "Last, First" (e.g. "Asthana, Anya") -- reverse this to "First Last" order when extracting.
- Ignore the bottom "Summary" row -- that's a class total, not a student.
- If the same name appears twice (a genuine duplicate entry in the source data), include both occurrences separately and mention it in "notes" so the teacher can check which one is real.
` : ""}
${has.hasClassmarker ? `
CLASSMARKER SCREENSHOT INSTRUCTIONS:
This is the "By individual" results table: columns are Name, Percentage, Score (shown as "X / Y"), and Duration.
- Names here are already in normal "First Last" order (not reversed) -- extract as shown.
- Ignore the top "Average" summary row -- that's a class total, not a student.
- Use the Percentage column (strip the "%" sign) as that student's score, 0-100.
- A student showing a dash ("-") for percentage/score has not taken the test yet -- record them with a score of 0, and mention in "notes" which names had no attempt yet so the teacher knows the 0 means "not taken," not "failed."
` : ""}

Return JSON in exactly this shape (omit a key entirely if that image wasn't provided). The "skills" object must have one entry per assigned code (e.g. "F1", "F2", "G2"), using the SAME codes for every student even if a cell was blank (use 0):
{
  "classpoint": [ { "name": "Aishini", "stars": 3 }, ... ],
  "ixl": [ { "name": "Samhitha budhav...", "skills": { "F1": 100, "F2": 0, "F3": 100, "F4": 100 } }, ... ],
  "formative": [ { "name": "Arjun Chegireddy", "percent": 70 }, ... ],
  "kutaworks": [ { "name": "Anya Asthana", "percent": 0 }, ... ],
  "classmarker": [ { "name": "Aryan Chhabra", "percent": 100 }, ... ],
  "notes": "any ambiguity, low-confidence reads, or rows you could not find, in one short sentence"
}`;
}
