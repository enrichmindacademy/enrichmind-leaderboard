import { useCallback, useEffect, useState } from "react";
import { supabase } from "../supabaseClient";

// Central data loader for a selected group: students, weeks, entries,
// tasks (the library), task_assignments (auto-assigned per student/week),
// and submissions. Exposes reload() so screens can refresh after writes.
export function useAppData(groupId) {
  const [groups, setGroups] = useState([]);
  const [students, setStudents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [weeks, setWeeks] = useState([]);
  const [entriesByWeek, setEntriesByWeek] = useState({});
  const [tasks, setTasks] = useState([]);
  const [assignments, setAssignments] = useState([]); // flat list of task_assignments
  const [submissions, setSubmissions] = useState([]); // flat list of task_submissions
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadGroups = useCallback(async () => {
    const { data, error } = await supabase.from("groups").select("*").order("created_at");
    if (error) setError(error.message);
    else setGroups(data || []);
  }, []);

  const reload = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const [
        { data: studentData, error: sErr },
        { data: weekData, error: wErr },
        { data: sessionData, error: sessErr },
        { data: taskData, error: tErr },
      ] = await Promise.all([
        supabase
          .from("students")
          .select("id, group_id, name, team, active, session_id, interests, parent_pin_set, created_at")
          .eq("group_id", groupId)
          .order("name"),
        supabase.from("weeks").select("*").eq("group_id", groupId).order("date"),
        supabase.from("sessions").select("*").eq("group_id", groupId).order("label"),
        supabase.from("tasks").select("*").eq("group_id", groupId).order("created_at"),
      ]);
      if (sErr) throw sErr;
      if (wErr) throw wErr;
      if (sessErr) throw sessErr;
      if (tErr) throw tErr;

      const weekIds = (weekData || []).map((w) => w.id);
      let entryMap = {};
      let assignmentData = [];
      let submissionData = [];
      if (weekIds.length > 0) {
        const [
          { data: entryData, error: eErr },
          { data: assignData, error: assignErr },
          { data: subData, error: subErr },
        ] = await Promise.all([
          supabase.from("entries").select("*").in("week_id", weekIds),
          supabase.from("task_assignments").select("*").in("week_id", weekIds),
          supabase.from("task_submissions").select("*").in("week_id", weekIds),
        ]);
        if (eErr) throw eErr;
        if (assignErr) throw assignErr;
        if (subErr) throw subErr;
        entryMap = {};
        (entryData || []).forEach((e) => {
          entryMap[e.week_id] = entryMap[e.week_id] || {};
          entryMap[e.week_id][e.student_id] = e;
        });
        assignmentData = assignData || [];
        submissionData = subData || [];
      }

      setStudents(studentData || []);
      setWeeks(weekData || []);
      setSessions(sessionData || []);
      setTasks(taskData || []);
      setAssignments(assignmentData);
      setSubmissions(submissionData);
      setEntriesByWeek(entryMap);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  useEffect(() => {
    reload();
  }, [reload]);

  return {
    groups,
    students,
    sessions,
    weeks,
    entriesByWeek,
    tasks,
    assignments,
    submissions,
    loading,
    error,
    reload,
    reloadGroups: loadGroups,
  };
}
