// Lightweight fuzzy name matching — no dependency needed for this scale
// (a class roster of a few dozen names).

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, "")
    .trim();
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a, b) {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length) || 1;
  return 1 - dist / maxLen;
}

// Handles: exact match, first-name-only match, truncated names ("Samhitha
// budhav..." vs "Samhitha Budhavarapu"), and typos.
// roster: [{ id, name }]. Returns { id, name, score } | null, plus ties.
export function fuzzyMatchName(extractedName, roster) {
  const clean = normalize(extractedName).replace(/\.+$/, "");
  const isTruncated = /\.\.\.$/.test((extractedName || "").trim());
  const firstWord = clean.split(" ")[0] || "";

  let candidates = roster.map((r) => {
    const rNorm = normalize(r.name);
    const rFirst = rNorm.split(" ")[0] || "";

    let score = similarity(clean, rNorm);

    // First-name-only extraction (ClassPoint): compare against roster's first name
    if (!clean.includes(" ")) {
      score = Math.max(score, similarity(clean, rFirst));
    }

    // Truncated full name (IXL): treat as a prefix match
    if (isTruncated && rNorm.startsWith(clean)) {
      score = Math.max(score, 0.95);
    } else if (rNorm.startsWith(clean) || clean.startsWith(rFirst)) {
      score = Math.max(score, 0.85);
    }

    return { id: r.id, name: r.name, score };
  });

  candidates.sort((a, b) => b.score - a.score);

  const best = candidates[0];
  const runnerUp = candidates[1];
  const ambiguous =
    best && runnerUp && Math.abs(best.score - runnerUp.score) < 0.08 && best.score < 0.98;

  if (!best || best.score < 0.55) {
    return { match: null, ambiguous: false, candidates: candidates.slice(0, 3) };
  }

  return { match: best, ambiguous, candidates: candidates.slice(0, 3) };
}
