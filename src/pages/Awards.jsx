import { useState, useMemo, useEffect } from "react";
import { useGroup } from "../lib/GroupContext";
import { supabase } from "../supabaseClient";
import { suggestAwardCandidates } from "../lib/awardSuggestions";

export default function Awards() {
  const { students, weeks, entriesByWeek, groupId, groups, reloadGroups } = useGroup();
  const group = groups.find((g) => g.id === groupId);
  const activeStudents = students.filter((s) => s.active);

  const [awards, setAwards] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Draft form for adding/editing one award at a time -- kept simple on
  // purpose since award categories genuinely change year to year; this
  // isn't meant to enforce a fixed set, just make adding a lot of them
  // fast.
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDetail, setDraftDetail] = useState("");
  const [draftStudentId, setDraftStudentId] = useState("");

  const suggestions = useMemo(
    () => suggestAwardCandidates(entriesByWeek, weeks, students),
    [entriesByWeek, weeks, students]
  );

  async function loadAwards() {
    if (!groupId) return;
    setBusy(true);
    const { data, error: e } = await supabase
      .from("awards")
      .select("id, student_id, title, detail, created_at")
      .eq("group_id", groupId)
      .order("created_at");
    if (e) setError(e.message);
    else setAwards(data || []);
    setBusy(false);
  }

  useEffect(() => {
    loadAwards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId]);

  const awardedStudentIds = new Set(awards.map((a) => a.student_id));
  const notYetAwarded = activeStudents.filter((s) => !awardedStudentIds.has(s.id));

  function applySuggestion(sug) {
    setDraftTitle(sug.title);
    setDraftDetail(sug.detail);
    setDraftStudentId(sug.student.id);
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
  }

  async function saveAward() {
    if (!draftTitle.trim() || !draftStudentId) {
      setError("Pick a student and give the award a title first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: e } = await supabase.from("awards").insert({
        group_id: groupId,
        student_id: draftStudentId,
        title: draftTitle.trim(),
        detail: draftDetail.trim() || null,
      });
      if (e) throw e;
      setDraftTitle("");
      setDraftDetail("");
      setDraftStudentId("");
      await loadAwards();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteAward(id) {
    if (!confirm("Remove this award?")) return;
    setBusy(true);
    try {
      await supabase.from("awards").delete().eq("id", id);
      await loadAwards();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleReveal() {
    setBusy(true);
    try {
      await supabase.from("groups").update({ awards_revealed: !group?.awards_revealed }).eq("id", groupId);
      await reloadGroups();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>Year-End Awards</div>
            <p className="muted" style={{ margin: 0 }}>
              {awards.length} awards given so far · {notYetAwarded.length} of {activeStudents.length} students
              don't have one yet
            </p>
          </div>
          <button className="btn" onClick={toggleReveal} disabled={busy}>
            {group?.awards_revealed ? "Hide from students" : "Reveal to students"}
          </button>
        </div>
        {group?.awards_revealed && (
          <p className="muted" style={{ marginTop: 10, color: "var(--text-success, #4a9)" }}>
            Students can currently see their awards on My Progress. Hide again if you're not ready.
          </p>
        )}
      </div>

      {notYetAwarded.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 4 }}>Still need an award</div>
          <p className="muted" style={{ marginBottom: 10 }}>
            Research on classroom recognition is consistent that the goal is every student feeling
            distinctly valued — these are the ones without one yet.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {notYetAwarded.map((s) => (
              <span key={s.id} className="pill" style={{ fontSize: 13 }}>
                {s.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="card">
          <div className="card-title" style={{ marginBottom: 4 }}>Data-backed suggestions</div>
          <p className="muted" style={{ marginBottom: 10 }}>
            Real numbers from this season, one per category — a starting point, not a final answer.
            Click one to pre-fill it below, then edit the title however you like before saving.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
            {suggestions.map((sug) => (
              <button
                key={sug.category}
                type="button"
                onClick={() => applySuggestion(sug)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: "var(--radius, 8px)",
                  border: "0.5px solid var(--border, #333)",
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", marginBottom: 2 }}>
                  {sug.category}
                </div>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>{sug.student.name}</div>
                <div className="muted" style={{ fontSize: 12.5 }}>{sug.detail}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ marginBottom: 10 }}>Add an award</div>
        <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ minWidth: 180 }}>
            <label className="muted" style={{ display: "block", marginBottom: 4 }}>Student</label>
            <select value={draftStudentId} onChange={(e) => setDraftStudentId(e.target.value)}>
              <option value="">Choose a student</option>
              {activeStudents.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label className="muted" style={{ display: "block", marginBottom: 4 }}>Award title</label>
            <input
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              placeholder='e.g. "The Curiosity Catalyst Award"'
              style={{ width: "100%" }}
            />
          </div>
          <div style={{ minWidth: 260, flex: 2 }}>
            <label className="muted" style={{ display: "block", marginBottom: 4 }}>
              Why (specific detail — this is what makes it land)
            </label>
            <input
              value={draftDetail}
              onChange={(e) => setDraftDetail(e.target.value)}
              placeholder='e.g. "Always makes sure everyone has a role in group work"'
              style={{ width: "100%" }}
            />
          </div>
          <button className="btn" onClick={saveAward} disabled={busy}>
            Save Award
          </button>
        </div>
        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      <div className="card">
        <div className="card-title" style={{ marginBottom: 10 }}>All awards given</div>
        {awards.length === 0 ? (
          <p className="muted">No awards yet.</p>
        ) : (
          <table className="review-table">
            <thead>
              <tr>
                <th>Student</th>
                <th>Award</th>
                <th>Why</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {awards.map((a) => (
                <tr key={a.id}>
                  <td>{students.find((s) => s.id === a.student_id)?.name || "—"}</td>
                  <td style={{ fontWeight: 600 }}>{a.title}</td>
                  <td className="muted">{a.detail || "—"}</td>
                  <td>
                    <button className="btn secondary" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => deleteAward(a.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
