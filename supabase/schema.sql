-- EnrichMind Leaderboard — Supabase schema
-- Run this in the Supabase SQL editor (Project > SQL Editor > New query)

create extension if not exists "pgcrypto";

create table if not exists groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  goal_label text default 'Class Goal',
  goal_points integer default 1000,
  teacher_contact text, -- shown to a parent who's forgotten their PIN ("ask your teacher")
  meets_day text check (meets_day in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun')), -- which day this Level actually meets, for the schedule views
  created_at timestamptz default now()
);

alter table groups add column if not exists teacher_contact text;
alter table groups add column if not exists meets_day text check (meets_day in ('Mon','Tue','Wed','Thu','Fri','Sat','Sun'));

-- A "session" is a separate meeting time within the same level/leaderboard
-- (e.g. Level 2 meets Tue 4pm AND Thu 5pm). Students belong to one level
-- (group) but can attend either session in a given week — the leaderboard
-- stays per-level, combining both sessions, never split by session.
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  label text not null, -- e.g. "Tue 4:00pm"
  created_at timestamptz default now()
);

create table if not exists students (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  name text not null,
  team text check (team in ('A','B')) default 'A',
  active boolean default true,
  session_id uuid references sessions(id) on delete set null, -- optional: usual session
  parent_token uuid default gen_random_uuid(), -- unguessable link so a parent can approve this student's tasks without a teacher passcode
  student_token uuid default gen_random_uuid(), -- separate unguessable link for the student's own read-only progress view
  parent_pin text, -- set by the PARENT on their first visit (self-service), not generated/shared by the teacher
  parent_pin_set boolean default false, -- false = link opens straight into "create your PIN"
  parent_pin_attempts integer default 0,
  parent_pin_locked_until timestamptz,
  interests text[] default '{}', -- self-picked, e.g. {sports,art,coding} — drives auto-assigned habit tasks
  parent_email text, -- captured from the registration sheet import, if present -- lets Roster's bulk link export double as a mail-merge-ready contact list
  created_at timestamptz default now()
);

-- Migration for projects created before the sessions/parent_token/interests/
-- parent_pin columns existed (safe to re-run on an existing database).
-- This also SWITCHES existing students over to the new self-service PIN
-- model — any teacher-generated PIN from before this change is cleared,
-- since self-service setup (below) replaces manually sharing one. If
-- you'd already handed a PIN to a parent under the old flow, just have
-- them reopen their link — they'll be prompted to set a new one.
alter table students add column if not exists session_id uuid references sessions(id) on delete set null;
alter table students add column if not exists parent_token uuid default gen_random_uuid();
alter table students add column if not exists student_token uuid default gen_random_uuid();
update students set student_token = gen_random_uuid() where student_token is null;
alter table students add column if not exists interests text[] default '{}';
alter table students add column if not exists parent_pin text;
alter table students add column if not exists parent_pin_set boolean default false;
alter table students add column if not exists parent_pin_attempts integer default 0;
alter table students add column if not exists parent_pin_locked_until timestamptz;
alter table students add column if not exists parent_email text;
update students set parent_token = gen_random_uuid() where parent_token is null;
update students set parent_pin = null, parent_pin_set = false, parent_pin_attempts = 0, parent_pin_locked_until = null
  where parent_pin_set is distinct from true;

create table if not exists weeks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  label text not null,
  date date not null default current_date,
  skills_assigned text, -- e.g. "F1, F3, F4, F5, I1, I7" (for reference only)
  bonus_multiplier numeric default 1, -- e.g. 2 for a "Double Stars Week"
  created_at timestamptz default now()
);

-- Migration for projects created before bonus_multiplier existed
-- (safe to re-run — a no-op if the column already exists):
alter table weeks add column if not exists bonus_multiplier numeric default 1;
-- Note: `league_size` used to live on groups here, back when Leagues
-- were fixed-size brackets. It's gone now that Leagues are a genuine
-- 3-tier percentile split (Diamond/Gold/Silver) with nothing to
-- configure -- if an older database still has that column sitting
-- around from before this change, it's harmless and unused; there's no
-- need to manually drop it.

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  week_id uuid references weeks(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  classpoint_stars integer default 0, -- Class Participation (ClassPoint)
  ixl_avg numeric default 0, -- Assignments (IXL / Formative / ClassMarker)
  notebooking_score numeric default 0, -- Notetaking, manual entry
  study_guide_score numeric default 0, -- Study Guides, manual entry
  exam_score numeric default 0, -- Exams (IXL or Kuta Works)
  exam_corrections_score numeric default 0, -- Exam Corrections, manual entry
  bonus numeric default 0,
  total numeric generated always as (
    classpoint_stars * 5 + ixl_avg + notebooking_score + study_guide_score
    + exam_score + exam_corrections_score + bonus
  ) stored,
  student_goal text, -- optional, student-set short note ("why", extra context)
  goal_metric text check (goal_metric in ('total','stars','ixl_avg')), -- what the goal is measured against
  goal_target numeric, -- the measurable number the student is aiming for
  bonus_note text, -- teacher's running log of why bonus points were given, one dated line per award
  created_at timestamptz default now(),
  unique (week_id, student_id)
);

alter table entries add column if not exists student_goal text;
alter table entries add column if not exists goal_metric text check (goal_metric in ('total','stars','ixl_avg'));
alter table entries add column if not exists goal_target numeric;
alter table entries add column if not exists bonus_note text;
alter table entries add column if not exists notebooking_score numeric default 0;
alter table entries add column if not exists study_guide_score numeric default 0;
alter table entries add column if not exists exam_score numeric default 0;
alter table entries add column if not exists exam_corrections_score numeric default 0;

-- `total` is a generated column, so widening its formula to include the
-- new score segments means dropping and recreating it rather than
-- altering it in place -- Postgres doesn't support editing a generated
-- column's expression directly. Safe to re-run: this only recomputes the
-- stored total for every existing row from the same underlying numbers,
-- nothing is lost (any row that had no new-segment scores yet just adds
-- zero, so pre-existing totals stay exactly the same).
alter table entries drop column if exists total;
alter table entries add column total numeric generated always as (
  classpoint_stars * 5 + ixl_avg + notebooking_score + study_guide_score
  + exam_score + exam_corrections_score + bonus
) stored;

create index if not exists idx_students_group on students(group_id);
create index if not exists idx_students_session on students(session_id);
create unique index if not exists idx_students_parent_token on students(parent_token);
create unique index if not exists idx_students_student_token on students(student_token);
create index if not exists idx_sessions_group on sessions(group_id);
create index if not exists idx_weeks_group on weeks(group_id);
create index if not exists idx_entries_week on entries(week_id);
create index if not exists idx_entries_student on entries(student_id);

-- Tasks: a reusable LIBRARY of possible challenges — math practice or
-- habit-building (reading, chores, kindness, etc). Each can be tagged with
-- interests (sports, art, coding, ...) so the auto-assignment step below
-- can match kids to tasks they're actually likely to enjoy, and math tasks
-- can be marked "dynamic" so their title is generated fresh from whatever
-- skills that week's Weekly Update actually assigned (see is_dynamic_math)
-- instead of needing a hand-written title for every level every week.
create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  title text not null,
  description text,
  category text check (category in ('math','habit')) default 'habit',
  points numeric default 5,
  interest_tags text[] default '{}',
  is_dynamic_math boolean default false, -- title auto-filled from that week's skills_assigned
  active boolean default true,
  created_at timestamptz default now()
);

alter table tasks add column if not exists interest_tags text[] default '{}';
alter table tasks add column if not exists is_dynamic_math boolean default false;

-- Task assignments: the actual, personalized instance of a library task
-- given to one student for one week — this is what auto-assignment
-- creates (see src/lib/autoAssign.js) and what students actually see and
-- submit against. Snapshotting title/points/category here means editing
-- the library later never rewrites history.
create table if not exists task_assignments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  week_id uuid references weeks(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  task_id uuid references tasks(id) on delete set null,
  title text not null,
  description text,
  category text,
  points numeric not null,
  is_catchup boolean default false, -- re-offered because the original (source_assignment_id) was never finished
  source_assignment_id uuid references task_assignments(id) on delete set null,
  created_at timestamptz default now(),
  unique (week_id, student_id, task_id)
);

alter table task_assignments add column if not exists is_catchup boolean default false;
alter table task_assignments add column if not exists source_assignment_id uuid references task_assignments(id) on delete set null;

create table if not exists task_submissions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references tasks(id) on delete cascade, -- legacy; new rows use assignment_id
  assignment_id uuid references task_assignments(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  week_id uuid references weeks(id) on delete cascade,
  status text check (status in ('pending','approved','rejected')) default 'pending',
  reflection text, -- optional student note: "what was that like?"
  submitted_at timestamptz default now(),
  reviewed_at timestamptz,
  unique (task_id, student_id, week_id)
);

alter table task_submissions add column if not exists assignment_id uuid references task_assignments(id) on delete cascade;
alter table task_submissions add column if not exists reflection text;
alter table task_submissions alter column task_id drop not null;
create unique index if not exists idx_submissions_assignment on task_submissions(assignment_id) where assignment_id is not null;

-- Backfill: for any pre-existing submission from before auto-assignment
-- existed, create a matching task_assignments row so old pending/approved
-- history keeps working with the new assignment-based screens.
insert into task_assignments (group_id, week_id, student_id, task_id, title, description, category, points)
select w.group_id, ts.week_id, ts.student_id, ts.task_id, t.title, t.description, t.category, t.points
from task_submissions ts
join tasks t on t.id = ts.task_id
join weeks w on w.id = ts.week_id
where ts.assignment_id is null and ts.task_id is not null
on conflict (week_id, student_id, task_id) do nothing;

update task_submissions ts
set assignment_id = ta.id
from task_assignments ta
where ts.assignment_id is null
  and ta.week_id = ts.week_id
  and ta.student_id = ts.student_id
  and ta.task_id = ts.task_id;

create index if not exists idx_tasks_group on tasks(group_id);
create index if not exists idx_assignments_week on task_assignments(week_id);
create index if not exists idx_assignments_student on task_assignments(student_id);
create index if not exists idx_submissions_week on task_submissions(week_id);
create index if not exists idx_submissions_student on task_submissions(student_id);

-- Row Level Security: teacher-side tables now require a real signed-in
-- Supabase Auth session (see "Teacher login" below), not just possession
-- of the public anon key. This replaces the earlier client-side-only
-- passcode gate, which never actually restricted database access — anyone
-- with the anon key could read/write everything regardless of whether
-- they'd "unlocked" the app's UI. Now the anon key alone gets nothing.
alter table groups enable row level security;
alter table sessions enable row level security;
alter table students enable row level security;
alter table weeks enable row level security;
alter table entries enable row level security;
alter table tasks enable row level security;
alter table task_assignments enable row level security;
alter table task_submissions enable row level security;

-- Migration: drop the old open-to-anyone policies if this project was set
-- up before authentication was added (safe no-ops if they don't exist).
drop policy if exists "public read/write groups" on groups;
drop policy if exists "public read/write sessions" on sessions;
drop policy if exists "public read/write students" on students;
drop policy if exists "public read/write weeks" on weeks;
drop policy if exists "public read/write entries" on entries;
drop policy if exists "public read/write tasks" on tasks;
drop policy if exists "public read/write task_submissions" on task_submissions;

-- Drop the current policy names too before recreating them, so this
-- whole file is safe to run more than once on the same project (e.g.
-- after pulling an update that changed the schema) instead of failing
-- the moment it hits a policy that already exists from the last run.
drop policy if exists "authenticated read/write groups" on groups;
drop policy if exists "authenticated read/write sessions" on sessions;
drop policy if exists "authenticated read/write students" on students;
drop policy if exists "authenticated read/write weeks" on weeks;
drop policy if exists "authenticated read/write entries" on entries;
drop policy if exists "authenticated read/write tasks" on tasks;
drop policy if exists "authenticated read/write task_assignments" on task_assignments;
drop policy if exists "authenticated read/write task_submissions" on task_submissions;

create policy "authenticated read/write groups" on groups
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write sessions" on sessions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write students" on students
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write weeks" on weeks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write entries" on entries
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write tasks" on tasks
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write task_assignments" on task_assignments
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy "authenticated read/write task_submissions" on task_submissions
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- The parent-facing flow (/parent/:token) deliberately does NOT sign in —
-- parents never get a Supabase Auth account. It reaches this data only
-- through the parent-portal / get-parent-link Netlify Functions, which use
-- the service-role key and therefore bypass RLS entirely on the server
-- side, while re-scoping every query to one student by their token. So
-- these policies only govern what the anon key can do directly, which is
-- now nothing without a teacher login.

-- Column-level hardening on top of the above: even an authenticated
-- session reading the students table with select("*") never needs
-- parent_token/parent_pin client-side (Roster fetches them via
-- get-parent-link.js instead), so they stay walled off from every role
-- except service_role — which is what the parent-portal function verifies
-- the PIN against server-side.
revoke select (parent_token, parent_pin, parent_pin_attempts, parent_pin_locked_until, student_token) on students from anon, authenticated;

-- Unified parent accounts: one login per EMAIL, not one per student
-- enrollment. A parent with two kids, or one kid in two classes, used to
-- need a totally separate link and PIN for every single class
-- enrollment (since students.parent_token/parent_pin live on each
-- roster row, and a student in 2 classes has 2 separate roster rows).
-- This table is the real fix -- a parent's PIN and access token live
-- here, keyed by email, and the family-portal function looks up EVERY
-- student row across every Level that shares this same parent_email at
-- login time, rather than being scoped to one student row from the
-- start. Same security posture as students.parent_token/parent_pin: no
-- RLS policy at all (default-deny), so only a service-role Netlify
-- Function can ever read or write this table -- never the browser
-- directly, regardless of login state.
create table if not exists parent_accounts (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  token uuid unique not null default gen_random_uuid(),
  pin text,
  pin_set boolean default false,
  pin_attempts integer default 0,
  pin_locked_until timestamptz,
  created_at timestamptz default now()
);

alter table parent_accounts enable row level security;

-- Persistent name-matching memory: once a teacher manually resolves a
-- screenshot name that didn't match anyone on the roster (a parent's
-- name on a Formative account instead of the student's, a nickname, a
-- consistent typo in how a third-party tool spells someone), that
-- correction is remembered here -- so it's a one-time fix, not something
-- to redo every single week the same mismatch shows up. Checked BEFORE
-- fuzzy name matching runs, and wins over it when present, since a
-- teacher's explicit correction is always more trustworthy than a guess.
create table if not exists name_aliases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references groups(id) on delete cascade,
  raw_name text not null, -- normalized (lowercased, trimmed) as it appeared in the screenshot
  student_id uuid references students(id) on delete cascade,
  created_at timestamptz default now(),
  unique (group_id, raw_name)
);

-- Identity-based matching, for CSV sources where the raw NAME text isn't
-- a reliable key even after normalization -- specifically Formative,
-- where a student can be logged in under a parent's account and the
-- displayed name can legitimately change between exports (different
-- parent's device, a typo fixed, etc), while Formative's own Student ID
-- (and, one level less reliably, their account email) stays constant for
-- that account forever. `source`/`external_id` let a single row in this
-- same table be looked up by that stable ID FIRST, before falling back
-- to the raw_name path above -- one alias table, two ways in, so a
-- teacher's one-time "this is who that is" confirmation survives even if
-- the display name drifts week to week.
alter table name_aliases add column if not exists source text; -- e.g. 'formative'
alter table name_aliases add column if not exists external_id text; -- e.g. Formative's Student ID
create unique index if not exists idx_name_aliases_external
  on name_aliases(group_id, source, external_id)
  where source is not null and external_id is not null;

alter table name_aliases enable row level security;
drop policy if exists "authenticated manage name_aliases" on name_aliases;
create policy "authenticated manage name_aliases" on name_aliases
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- Score-edit audit trail: a running log of every change to a saved
-- entry, for the "why did my kid's score change" conversation. This is
-- a database trigger rather than something each save path in the app
-- remembers to call -- it fires on every UPDATE to entries no matter
-- which screen made the change (Weekly Update's full save, Quick
-- Update, History's edit form, the Catch-Up tool), so there's no way
-- for an edit to slip through unlogged just because a new save path
-- gets added later and nobody remembers to instrument it.
create table if not exists entry_edit_log (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid,
  week_id uuid,
  student_id uuid,
  changed_at timestamptz default now(),
  old_values jsonb,
  new_values jsonb
);

create or replace function log_entry_edit() returns trigger as $$
begin
  insert into entry_edit_log (entry_id, week_id, student_id, old_values, new_values)
  values (old.id, old.week_id, old.student_id, to_jsonb(old), to_jsonb(new));
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists entries_edit_log on entries;
create trigger entries_edit_log after update on entries
  for each row execute function log_entry_edit();

alter table entry_edit_log enable row level security;
drop policy if exists "authenticated read entry_edit_log" on entry_edit_log;
create policy "authenticated read entry_edit_log" on entry_edit_log
  for select using (auth.role() = 'authenticated');
-- No insert/update/delete policy for any client role on purpose — the
-- log is only ever written by the trigger itself (security definer, so
-- it runs with the privileges that created the function, not the
-- editing user's), never edited or deleted by the app. A record that
-- could be rewritten after the fact wouldn't be much of an audit trail.

-- Seed a starter group (optional, safe to delete)
-- No starter group is seeded here on purpose — use the "Load My Programs"
-- button on the Roster tab instead, which creates your real course
-- catalog (pulled from enrichmindacademy.com/programs) as Levels, with
-- sessions already set up for the courses that meet twice a week.
