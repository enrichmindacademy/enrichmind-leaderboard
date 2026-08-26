# EnrichMind Leaderboard

A persistent, multi-device class leaderboard: Vite + React frontend, Supabase
database, and a Netlify Function that calls Claude's vision API server-side
to read ClassPoint and IXL screenshots. Deploys to Netlify.

## 1. Create the Supabase project

1. Go to https://supabase.com -> New project (free tier is fine).
2. Once it's up, open **SQL Editor -> New query**, paste the contents of
   `supabase/schema.sql`, and run it. This creates `groups`, `students`,
   `weeks`, `entries`, and Row Level
   Security policies that require a signed-in session for every table.
   - **Already had this project running before?** The `alter table ...`
     and `drop policy if exists` / `create policy` lines are safe to
     re-run on an existing database -- they add new columns and switch
     the old open policies over to requiring authentication, without
     touching your existing data.
3. Create your one teacher login: **Authentication -> Users -> Add user**,
   enter your email and a password, and toggle **Auto Confirm User** on.
   There's no sign-up screen in the app itself -- this is the only account.
4. Go to **Project Settings -> API** and copy:
   - Project URL -> `VITE_SUPABASE_URL`
   - `anon` public key -> `VITE_SUPABASE_ANON_KEY`
   - `service_role` secret key -> `SUPABASE_SERVICE_ROLE_KEY` (server-side
     only -- see step 3 of deploying, below)

The anon key is safe to expose in the browser bundle -- that's how
Supabase's anon key + Row Level Security model is designed to work. What
changed is that the RLS policies here now require `auth.role() =
'authenticated'`, so the anon key alone (without your teacher login)
can't read or write anything.

## 2. Local setup

```bash
npm install
cp .env.example .env
# fill in .env with your Supabase URL/anon key
npm run dev
```

Sign in with the teacher account you created in step 3 above.
`ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` don't need to be set
locally unless you also run `netlify dev` (via the Netlify CLI) to test
the screenshot-parsing or parent-approval functions end-to-end.

Once you're in, go to the **Roster** tab and click **"Load My Programs"**
-- this pulls your real 16-course catalog straight from
enrichmindacademy.com/programs and creates each as a Level, with sessions
already set up for the courses that meet twice a week (Level 3, 4, 5, 6,
Algebra 1, and Geometry). You can still add a Level manually too, for
anything the button doesn't cover, or if the site's course lineup changes
later (`src/lib/programCatalog.js` is where that list lives).

## 3. Deploy to Netlify

1. Push this project to a GitHub repo.
2. In Netlify: **Add new site -> Import an existing project**, pick the repo.
   Netlify will read `netlify.toml` automatically (build command
   `npm run build`, publish dir `dist`, functions dir `netlify/functions`).
3. Under **Site settings -> Environment variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `ANTHROPIC_API_KEY` -- **do not** prefix this with `VITE_`, or it will be
     bundled into the public client code. It's only read inside
     `netlify/functions/parse-screenshot.js`, which runs server-side.
   - `SUPABASE_SERVICE_ROLE_KEY` -- also **no `VITE_` prefix**. Used only by
     `netlify/functions/parent-portal.js` and `get-parent-link.js` to serve
     the parent-approval flow without exposing student data via the anon
     key. Find it in Supabase under Project Settings > API > service_role
     (a different, more powerful key than the anon one -- keep it out of
     any `VITE_SUPABASE_...` variable).
4. Deploy. The app is now reachable from any device/browser -- phone, laptop,
   classroom projector -- pointing at the same Supabase database. Sign in
   with the teacher account from step 3 of the Supabase setup above.

## Levels and sessions (multiple classes)

Each **Level** (Level 1, Level 2, etc.) is its own leaderboard — this is
just the existing "class group" concept, so switching levels uses the
same picker at the top of the app and the same "Class Groups"/Levels
management on the Roster tab.

Some levels meet twice a week with students free to attend either
meeting. For those, add a **Session** per meeting time on the Roster tab
(e.g. "Tue 4:00pm" and "Thu 5:00pm") under that level, and set each
student's "usual session" there too (a dropdown next to their name once
sessions exist).

- **The Projector Board shows one session at a time.** When a level has
  sessions, a "Viewing" picker appears at the top -- pick the session
  that's actually meeting right now, and every ranking, spotlight, league
  bracket, and the team goal bar scopes down to just that session's
  students. A "Thursday" kid doesn't show up on Tuesday's projected
  screen. An "All Sessions (combined)" option is still there for an
  end-of-term view across the whole level.
- **My Progress scopes the same way automatically** -- a student's rank,
  league, and catch-up comparisons are against their own session's
  classmates, matching whatever the projector would show for their
  session, not the whole level.
- **This only works if each student has a session assigned** on Roster.
  A student with no session set won't appear on either session's
  filtered view (only under "All Sessions") -- so if someone's missing
  from what you're projecting, that's usually why.
- On Weekly Update, if a level has sessions you'll get one ClassPoint
  upload slot per session (since ClassPoint stars are captured live,
  per meeting) instead of a single upload. Whichever session's screenshot
  a student's name shows up in that week is where their stars come from
  -- this part is unchanged: a student can still be scored from either
  session's screenshot regardless of their "usual session" label, since
  the label now drives *display* grouping, not score matching.
- The IXL screenshot stays a single upload regardless of sessions, since
  IXL tracks each student's own pace outside of class time.
- A level with no sessions added behaves exactly as before (one ClassPoint
  upload, one IXL upload, one combined leaderboard).

## A student joining mid-term

Just add them on Roster like any other student — no special step. Two
things happen automatically to keep their first week fair:

- **League placement isn't seeded at zero.** A brand-new student has no
  cumulative history, and sorting on that literally would always drop
  them into the bottom bracket on day one regardless of how strong they
  actually are -- an artifact of missing data, not a real signal. This
  mirrors how real skill-rating systems (Elo, Glicko, TrueSkill) handle a
  new entrant: they're placed near the group's *median* standing rather
  than at zero, and their real position takes over the moment they have
  one week of their own history. This only affects which bracket they're
  placed in -- their actual points, growth, and everything else are
  untouched.
- **Their first week gets its own welcome message** instead of being
  compared to a "trailing average" that doesn't exist yet -- My Progress
  and their student link both show "Welcome! This is your very first
  tracked week..." rather than a growth-based nudge that wouldn't mean
  anything yet.

Everything else already works fine for a late joiner without changes:
catch-up tasks only look at *their own* prior week, so a student with no
history gets none; growth compares only to their own past, so there's
nothing to be behind on yet; and streaks/Superstar/goals all start
naturally from whenever they begin.

## Motivation mechanics (Duolingo-inspired)

- **Three Leagues, judged against an absolute bar, not against
  classmates.** Diamond is 90%+, Gold is 70-89%, Silver is below that --
  a real achievement bar, not a forced curve. If the whole class has a
  genuinely excellent week, the whole class can be Diamond together;
  nobody is guaranteed to land in the bottom tier just because someone
  else did better. (An earlier version split students into top/middle/
  bottom THIRD no matter what -- that meant someone was always
  "relegated" even in a week where everyone did great, which is exactly
  backwards from the goal of positive reinforcement.)

  The "percentage" a week is judged on isn't the raw total, since the
  six score categories don't share one scale -- Assignments and Exams
  are naturally 0-100, but Participation (stars), Notebooking, and Study
  Guide are whatever scale you happen to use, and that can vary week to
  week. Averaging raw points across scales like that isn't meaningful (a
  "20" in a category worth 25 is very different from a "20" in one worth
  5) -- the fix, same one used whenever real grades get combined across
  different assessments, is to convert every category to a percentage
  FIRST, then average the percentages:
  - Assignments and Exams are already 0-100 and used directly.
  - Notebooking and Study Guide are each converted to "percent of the
    best score anyone in the class got in that category this same week"
    -- self-calibrating, no manual "this is out of ___" setup, ever. It
    adjusts automatically to however generous or strict that particular
    week's scoring was.
  - **Participation (stars) gets a fixed 8% weight instead of an equal
    share with everything else**, blended in on top of the average of
    the other categories (90% them, 10% stars) rather than just being
    one more item in the same average. This exists because stars are a
    much coarser scale than the others in practice -- typically just
    0-3 or 0-5 per class -- so self-calibrating it the same way as
    Notebooking/Study Guide meant one single star of difference could
    swing 30+ percentage points (1 star out of a 3-star max = 33%, 2
    stars = 67%), while the same "one point" difference in Assignments
    barely moves anything. Averaged in equally, that coarseness let
    Participation dominate the whole composite out of proportion to how
    much it's actually meant to count. The 8% figure is
    `PARTICIPATION_WEIGHT` in `src/lib/calc.js` if it ever needs
    retuning.
  - A category nobody was assigned anything in that week (no exam that
    week, say) is left out of the average entirely, rather than counted
    as a 0 for everyone -- a lighter week shouldn't drag scores down
    just because fewer things were graded.
  - Bonus is added on top as flat percentage points (capped at +15), not
    averaged in as if it were a requirement.

  This lives in `weeklyCompositePercentages()` in `src/lib/calc.js`,
  with `assignDivisions()` just checking each student's own percentage
  against the 90/70 cutoffs -- no history, no cumulative standing, no
  "brand new student" seeding logic needed anymore, since every week
  now stands entirely on its own. Each tier is still ranked internally
  by that week's raw points (who's #1 in Gold this week), same as
  before -- only which tier you land in changed. Projector Board's "By
  League" view shows this; "By Growth" (self vs. own 4-week average) and
  "By Streak" are the other two views -- use whichever fits the moment.
- **Streaks now mean "consistently scoring well," not just "showed up."**
  A week only counts toward the streak if that student's composite
  percentage for it (the same number Diamond/Gold/Silver is judged
  against) was 95% or higher -- an entry that exists but scored low
  doesn't extend it any more than a missing week does. One below-bar or
  missing week anywhere in the run is still forgiven automatically
  (frozen), so a single rough week doesn't erase a real run of strong
  ones -- mirroring Duolingo's streak-freeze design, which research shows
  meaningfully extends how long people keep a streak going. The 95%
  figure is `STREAK_THRESHOLD` in `src/lib/calc.js` if it ever needs
  retuning.
- **Personal bests.** Any week that beats a student's own all-time high
  total is flagged on the Projector Board and on My Progress -- celebrates
  growth independent of where a student ranks.
- **Bonus multiplier weeks.** Mark any week 1x / 1.5x / 2x ("Double Stars
  Week") in Weekly Update -- it multiplies that week's total everywhere
  (growth, streak comparisons, team goal, personal bests), the same lever
  Duolingo uses for "Double XP Weekend" engagement spikes.
- **Superstar of the Week is its own highlighted competition**, split into
  two clear displays: (1) a glowing gold callout naming everyone who hit a
  perfect 100% IXL average *this week* (there can be several at once), and
  (2) a separate **All-Time Superstar Counts bar chart** -- a graphical,
  ongoing standings of how many perfect weeks each student has ever had.
  That's a second, parallel competition purely about consistency, distinct
  from the main growth-ranked leaderboard below it. A small 🌟xN badge
  also shows next to names everywhere else on the board.
- **This Week — Ranked by Growth** is the third display and the default
  view of the main leaderboard card (League and Streak views are still
  one click away via the toggle at the top of that card).
- **Growth is always visible.** Every leaderboard view -- By League, By
  Growth, By Streak -- now shows the same growth-vs-own-average pill, so a
  student who was behind and bounced back this week stands out no matter
  which view the projector happens to be on.
- **Comeback spotlight** stays for the student who was down last week and
  is up this week -- the "you're not out of it" signal.

## Tasks (auto-assigned by interest, teacher- or parent-verified)

Beyond scores, students get personalized bonus-point **tasks** each week --
math practice AND habit-building (🌱) challenges like reading, chores, or
helping someone -- matched to whatever interests they've picked, without
you assigning anything by hand. See "Interests, auto-assigned tasks, and
other new motivation features" further down for exactly how that works.
This is its own nav tab for managing the underlying library:

- **Manage the Task Library**: add your own tasks (title, description,
  category, points, interest tags), or click "Load Starter Task Library"
  for a ready-made set. Auto-assignment picks from whatever's active here.
- Students see their personalized picks on **My Progress** and tap "I did
  this!" to submit -- this only creates a *pending* request, it does
  **not** add points yet.
- You review submissions in the **Pending Review** queue on the Tasks tab
  and Approve or Reject each one. Approving adds the task's points onto
  that student's bonus for the week they submitted it in (creating a
  bare-bones entry for that week if one doesn't exist yet) -- so nothing
  is scored unless it's actually been verified.
- My Progress also has a **"Ways to Climb Higher"** card that turns the
  league catch-up gap, the Superstar goal, and available tasks into a
  short, concrete to-do list for that student -- so kids get a specific
  answer to "what can I do to move up," not just a number.

### Letting students check their own progress

Previously, My Progress only worked inside the teacher-signed-in app --
fine for a classroom device, useless for a student checking from home. On
**Roster**, each student now also has a **"Copy Student Link"** button --
a private URL like `yourapp.netlify.app/student/<token>` that opens
straight into that one student's own progress view: league, streak,
growth, goal, tasks, 5-week trend, interests picker, certificate printing
-- everything My Progress shows, no teacher login needed.

- It's read-only-plus-self-reporting: a student can mark a task done or
  set a goal, but neither writes real points -- marking a task only ever
  creates a pending submission a parent/teacher still has to approve, same
  as everywhere else in the app.
- No PIN gate here (unlike the parent link) -- there's nothing to protect
  a student from tampering with on their own view, since nothing here
  awards points unverified. The link itself (unguessable, one per
  student) is the only barrier.
- Like the parent flow, this never touches Supabase directly with any
  key a browser could inspect -- every read and write goes through
  `netlify/functions/student-portal.js`, using the service-role key
  server-side, scoped to that one student's token.

**Sending links to everyone at once.** Copying and sending one link at a
time from each student's "⋮" menu works, but doesn't scale past a
handful of students. Roster's **"Export All Links"** buttons (one for
every Level at once, one for just the currently selected Level) download
a CSV with **Student Name, Level, Parent Email, Student Link, Family
Link, Parent Link** for every active student -- ready to drop into a
mail-merge tool (Gmail mail merge, or similar) instead of a hundred
individual copy-paste-sends. Send the Family Link, not the per-class
Parent Link, unless there's a specific reason a family needs one scoped
to just one class -- it's the one that actually covers every child and
every class for that family. Parent Email only shows up if it was captured during
import: the registration sheet importer (both the manual paste box and
the automatic sync) now also reads the sheet's **Parent Email** column
and saves it to `students.parent_email` alongside each student -- a
sibling on the same registration row shares that same email, since it's
one family's contact info either way. Fetching the actual student/parent
tokens for the export happens through a new function,
`netlify/functions/bulk-links.js`, since those columns are revoked from
direct client access the same as everywhere else in this app -- this
just bundles the bulk fetch into one server round-trip instead of one
per student.

**If a student switches classes after first registering** and the sheet
gets re-imported (or auto-syncs), the importer no longer creates a
duplicate. It checks whether that name already exists *anywhere else*
in your roster, not just the Level it's about to add them to -- if it
finds exactly one match elsewhere, it surfaces it as a **"Possible class
changes — review these"** entry with a one-click **Move** button, rather
than guessing on its own or silently leaving a stale duplicate behind.
"Not the same student" dismisses it without changing anything, for the
rare case of two different students genuinely sharing a name. If the
same name is active in *more than one* other Level already, it's too
ambiguous to guess safely -- that student gets added as new instead,
flagged under **"Needs a manual look"** so you know to check for a
possible duplicate yourself. The **automatic sync** hits the same
detection but has no one present to click Move, so it plays it safe by
skipping the insert entirely rather than creating a duplicate -- the
actual move only completes once you run the manual "Import Students"
box, which is where the confirmation step lives.

**This correctly handles a student enrolled in more than one course at
once** (a Level plus Competition Math, or a Level plus SAT Prep) --
switching just ONE of those doesn't get confused by the other,
unrelated enrollment that's staying exactly where it is. Every group a
student's name maps to *anywhere in the current sheet* counts as one of
their confirmed-current classes and is excluded before checking for a
stale old one -- so a Level 5 Mon → Level 5 Fri switch is correctly
seen as one clean change even when that same student's separate
Competition Math roster spot is sitting right there in the same
`byNameAnywhere` lookup. Without that exclusion, every multi-enrolled
student's switch would have looked "ambiguous" (their own other class
counted as a second false match) and fallen through to being added as
a duplicate instead of offered as a clean move.

**For an existing student who's missing a parent email** (anyone
rostered before this feature existed): re-paste the registration sheet
into "Import Students" — matching students already on the roster are
still skipped as always, but if the sheet has an email they don't have
on file yet, that one field gets filled in. It never overwrites an
email that's already set, in case it was corrected by hand since the
last import, and touches nothing else about that student.

**"Send Both Links by Email"** (in each student's "⋮" menu) is the
actual one-click send for a single student — new signup or existing
one. It fetches both tokens, then hands off to whatever email program
is already set up on this computer via a pre-addressed, pre-filled
`mailto:` link — one more click (the Send button in that program)
finishes it. This needed no new account, no API key, and no
per-email cost or sending limit to think about, which is why it's the
one built first. Requires that student to have a parent email on file;
if they don't, it says so instead of failing silently. **The real
limitation**: this still isn't a *fully* one-click send with zero
second click elsewhere, and there's no bulk version of it (send-to-
everyone-at-once) -- both would need a real transactional email service
wired up server-side, a bigger, separate piece of infrastructure (same
category as the "parent weekly digest" idea from earlier) rather than
this lighter-weight approach. Worth doing if the extra click or the
one-at-a-time limit ever becomes the actual bottleneck.
- **"Reset Student Link"** on Roster invalidates the old link and issues
  a new one -- use it if a link needs to be retired.

### One family login for every child, across every class

The per-class parent link described below still works, but it has a
real limitation: since each Level is its own independent roster, a
student in 2 classes has **2 separate roster rows** -- meaning 2
separate parent links and 2 separate PINs for the same kid, and a parent
with 2 kids has it worse. **"Copy Family Link"** (Roster's "⋮" menu, or
Export All Links' "Family Link" column) is the real fix: one link, one
PIN, keyed by the parent's **email** rather than by one class
enrollment. Opening it shows *every* active child sharing that email,
across *every* Level each one is in, in one dashboard -- no picking
which kid or which class first.

- Lives at `yourapp.netlify.app/family/<token>`, its own route
  (`src/pages/FamilyPortal.jsx`), outside the teacher login gate, same as
  the per-class parent page.
- Backed by a new `parent_accounts` table, keyed by email -- **not** by
  student. `netlify/functions/get-family-link.js` finds the account for
  a given student's `parent_email`, or creates one on the spot if this
  is the first time anyone's asked for a link for that family, so
  there's no separate "set up the family account" step for you to do.
- The PIN model is identical to the per-class version (self-service,
  first-visit setup, 5-attempt lockout, teacher-resettable) -- just
  scoped to the account, not to one student.
- `netlify/functions/family-portal.js` does the actual work: resolves
  the token to an account, looks up every active student whose
  `parent_email` matches (case-insensitive), and builds the same
  progress context (League tier, streak, score breakdown, pending
  tasks) for each one that the per-class version already builds for a
  single student -- reusing the same `calc.js` functions everywhere
  else in the app already does, not a second copy of that math.
  Approving or rejecting a task re-verifies that the specific child
  belongs to this account's email server-side before touching anything,
  so a family can never act on a child that isn't actually theirs even
  if a submission id were guessed.
- **Sibling on the same registration row**: since siblings share the
  same `parent_email` (see the registration importer notes above), a
  family link generated for either child covers both automatically --
  no separate setup needed per sibling.

### Letting parents approve instead of you (per-class link)

You don't have to be the one clicking Approve, and you don't have to
distribute two secrets to every family. On the **Roster** tab, each
student has a **"Copy Parent Link"** button -- it copies a private,
unguessable URL like `yourapp.netlify.app/parent/<token>`. That link is
the *only* thing you send (text, email, whatever's easiest). The parent
does everything else themselves:

- **First visit**: they're greeted by name ("Set up access for Aishini")
  and asked to choose their own 4-digit PIN -- nothing for you to
  generate or share separately.
- **Every visit after that**: they enter the PIN they chose.
- Once in, they see **their own child's progress first** -- this week's
  League tier, streak, total, and the same six-category score breakdown
  the student and teacher views show (Participation, Assignments,
  Notebooking, Study Guide, Exams, Exam Corrections) -- then their
  pending task submissions below that, with a short "Recently Reviewed"
  list for context. Nothing else in the app, no teacher login needed.

The progress view reuses the exact same `calc.js` functions (League
tier, streak, growth-vs-own-average) the student and teacher pages
already use -- computed server-side in `parent-portal.js` from the same
data shape `student-portal.js` already builds, so there's one source of
truth for this math, not a second copy that could quietly drift out of
sync with what's shown elsewhere.

This page is intentionally outside the teacher passcode gate (it's its
own route, `/parent/:token`). The Tasks tab's Pending Review queue still
works exactly as before too -- use it for anything you'd rather verify
yourself, or for families who'd rather you handled it.

**Making sure it's actually the parent, not the student.** The link by
itself only proves whoever clicked it first -- which could be the
student, especially on a shared family device. That's the real tradeoff
of self-service setup: whoever opens the link *first* is the one who
gets to choose the PIN. There's no way around that without a second,
independently-verified channel (like a parent's own email address and a
real login) -- which this app deliberately doesn't require, in exchange
for you never having to distribute or track a second secret per family.
If that tradeoff doesn't sit right for a particular student, ask the
parent to open the link themselves promptly, or forward it directly to
them rather than posting it somewhere the kid might see it first. A few
other notes:

- **Roster shows setup status** ("PIN set up" / "Awaiting setup") for
  each student, so you can see at a glance who hasn't claimed their
  access yet.
- **Forgotten PIN?** There's no self-service reset (that would just
  recreate the same "who is this really" problem) -- the parent's "Forgot
  your PIN?" link on the entry screen tells them to contact you (shown
  using the **teacher contact** you set in Group Settings), and you click
  **"Reset Parent Access"** on Roster. That clears the old PIN and
  re-opens the link for a fresh first-time setup -- no new link to send,
  just ask them to reopen the one they already have.
- Wrong PINs lock out after 5 tries for 15 minutes (server-side, via the
  `parent-portal` function), so it isn't trivially brute-forceable.
- This is real friction against a casual guess, not a cryptographic
  guarantee. For the stakes here (bonus points, not anything sensitive),
  that's a reasonable line; if you ever want something stronger, the
  honest next step is real parent accounts (e.g. Supabase Auth per
  family, verified by email) rather than a shared secret either parent or
  child could plausibly set.
- Every approval still lands in the Tasks tab's "Recently Reviewed" list,
  which doubles as an audit trail you can spot-check with a student if
  something looks off.

**A note on security**: this went through a hardening pass. Originally the
parent page queried Supabase directly with the public anon key, which
(combined with this app's open RLS policies) meant anyone with that key
could look up any student's `parent_token` and browse other kids' task
history by going around the UI. Now:

- The parent page (`/parent/:token`) never talks to Supabase directly —
  every read and write goes through a Netlify Function
  (`parent-portal.js`) using Supabase's **service-role key**, which stays
  server-side and is never shipped to the browser.
- That function always re-scopes to the single student the token
  resolves to, so even someone inspecting its network requests can't make
  it return or act on another student's data.
- `parent_token` and `parent_pin` are now walled off at the database
  level: `revoke select (parent_token, parent_pin, ...) on students from
  anon, authenticated;` in `supabase/schema.sql` means neither key can
  ever read those columns directly, full stop, no matter which query asks
  for them -- not even you, since the PIN is chosen by the parent and
  never surfaced back to your Roster view. Roster's "Copy Parent Link" /
  "Reset Parent Access" buttons call a second small function
  (`get-parent-link.js`) for the link itself, using the service-role key.

**Update -- this residual gap is now closed too.** The rest of the app
(Roster, Weekly Update, Tasks review queue, etc.) used to run on the anon
key with open RLS, protected only by a client-side passcode that didn't
actually restrict database access. It now requires a real signed-in
Supabase Auth session -- see "Teacher login" below for how that's set up
and what it does and doesn't cover.

## How the screens work

- **Overview** -- the one screen that isn't scoped to whichever Level you
  currently have selected; it looks across all of them at once. A KPI
  strip up top (total Levels, active students, pending task reviews,
  Levels with no week logged yet) followed by a row per Level, sorted so
  the ones that actually need something from you rise to the top: most
  pending reviews first, then Levels with no data yet, then everything
  else oldest-updated first. Click any row to jump straight into that
  Level (same as picking it from the sidebar) and land on its Projector
  Board. Useful mainly once you're running enough Levels that clicking
  through each one just to check on it stops being practical.

- **Projector Board** -- Two-team goal bar, Most Improved / Comeback /
  Personal Best spotlights, then a leaderboard you can view By League, By
  Growth, or By Streak (toggle at the top of the card). Every row has
  quick controls at the right edge: **+1 / +5 / +10 / -1** buttons nudge
  that student's bonus points instantly (e.g. rewarding a great answer on
  the spot), and the **✎** button opens a small inline form with all six
  score fields -- Participation, Assignments, Notebooking, Study Guide,
  Exams, Exam Corrections -- plus Bonus, so any of them can be corrected
  on the spot without leaving this screen or digging into Weekly Update
  or History (hover a box to see which field it is; they're in that same
  order left to right). For an odd bonus number the quick buttons don't
  cover directly (say, +8), it's usually faster to just tap ✎ and type it
  than to stack multiple quick-adjust clicks. Both write straight to that
  week's entry and update the board immediately. Every quick-adjust click
  opens a small **reason picker** right in that row --
  one-click preset chips (Great perseverance, Good focus, Good note-taking,
  Helped a classmate, and others -- edit the list in
  `src/lib/bonusReasons.js`), a box to type your own, or "Skip" for no
  reason at all. Whatever you pick gets appended, dated, to a running
  **bonus note log** for that student's week, so "why did my kid get bonus
  points" has an actual answer later, not just a number. The ✎ form shows
  and lets you edit that full log directly; it's also visible (read-only)
  on History and on the student's own My Progress / student-link page. (This only works for a student
  already showing on the board, i.e. one with an entry for the current
  week -- to add a student who's missing from the week entirely, use
  History's "Edit This Week" instead, which has an explicit "add a
  missing student" control.)
- **My Progress** -- a student picks their name from a dropdown, sees their
  league, streak, this week's growth, a catch-up line ("You're only 4 pts
  behind Jordan in the Gold League"), a personal-best callout when it
  happens, a rotating supportive nudge, and a 5-week line chart of their
  (bonus-adjusted) total.
- **Weekly Update** -- enter the week label, which IXL skills were assigned
  (e.g. `F1, 3, 4, 5, I 1, 7` -- ranges work too, like `F1-4` for rows 1
  through 4), and the bonus multiplier for the week, then add the
  ClassPoint and/or IXL screenshots and click Extract Data. Screenshots
  don't need to be saved as files first -- copy one (Win+Shift+S or the
  Snipping Tool both copy straight to the clipboard), click into the box,
  and press **Ctrl+V**; dropping a file or picking one still works too.
  This calls the Netlify Function, which sends both images to Claude with
  instructions to read the IXL table row-by-row for only the assigned
  skill rows (blank cells = 0). The model reports each student's **raw
  per-skill scores** rather than an average -- the app computes the
  average itself in JavaScript, so one arithmetic slip by the model can't
  silently throw off a student's whole score. The review table shows that
  per-skill breakdown in small text under each IXL average (e.g. `F1:100
  F2:0 F3:100 F4:100`) so you can actually verify the number rather than
  trust it blind. ClassPoint names are read as first-name -> star count.
  Extracted names are fuzzy-matched against your roster (handles truncated
  IXL column headers and first-name-only ClassPoint rows) and shown in an
  **editable review table** with a **"Source row" dropdown per student**
  -- if a name got matched to the wrong row, just pick the correct
  screenshot row from the dropdown instead of retyping numbers. Nothing is
  written to the database until you click **Save Week**. Saving also
  auto-assigns that week's personalized tasks. Remember this always
  applies to whichever Level is currently selected (top-left picker) --
  since each Level (including split ones like "Level 4 Mon" and "Level 4
  Tue") has its own separate roster, a screenshot from one class's session
  belongs to that Level only, not several at once.
- **History** -- browse any past week's full entry table, **edit a saved
  week** (fix a typo in stars/IXL/bonus, change which skills were assigned,
  change the bonus multiplier, or add a student who was missing that week)
  without touching Supabase directly, and **export to CSV** either for the
  selected week or the group's entire history. **"Catch-Up — One Student,
  Every Week"** at the bottom is for the opposite situation from the rest
  of this page: not "fix one week for everyone," but "fix every week for
  one student" -- pick a student, get one table with every week they've
  been in this Level as editable rows, fix as many as apply, one Save.
  Built for exactly the "I finally finished all my old IXLs/Formatives
  from the last four months" conversation -- without it, catching one
  student up across months of missed work meant repeating the same
  one-week edit over and over. Same targeted-upsert protection as
  everywhere else scores are saved: only that student's six score columns
  in each week get touched, nothing else about that week (bonus notes,
  goals) or any other student is affected.
- **Roster** -- add or archive students at any time (archiving keeps their
  history but drops them from active leaderboards/leagues); click a name to
  rename it inline; search box for long rosters; a duplicate-name check
  warns before adding a name that's already active; a separate hard
  **Delete** is available if you added someone by mistake (this does
  remove their saved scores, so archiving is the safer default). Assign
  Team A/B, create additional class groups, and a **Group Settings** panel
  lets you edit the goal label/points and league bracket size right in the
  app instead of Supabase's table editor. **"Move to Another Level"** (in
  each student's "⋯" menu) reassigns them to a different Level directly --
  no delete-and-re-add needed if an import puts someone in the wrong
  class, or a student genuinely switches which class they attend. Their
  scoring history isn't touched or deleted; it just stops appearing
  anywhere, since every view only ever looks at entries tied to the
  currently selected Level's own weeks -- so moving someone back undoes
  it the same clean way. Their session (tied to the old Level) is cleared
  on move since it wouldn't be valid in the new one; their parent/student
  links and interests carry over unchanged, since those live on the
  student record itself, not tied to any one Level.

## Interests, auto-assigned tasks, and other new motivation features

**Students pick their own interests** (sports, art, building, music,
coding, animals, cooking, dance, nature, reading) on My Progress. From
then on, task assignment is fully automatic:

- Every time you save a week in Weekly Update, each active student who
  doesn't already have tasks for that week gets **one math task** (its
  title generated fresh from whatever skills you just entered — so it's
  automatically level-appropriate for every group without writing a
  separate task per level) plus **1-2 habit tasks matched to their own
  interests** (falling back to a general pool if they haven't picked any
  yet, and avoiding repeating the same habit within the last few weeks).
- **Unfinished work from last week takes priority.** Before picking
  anything new, auto-assignment checks the student's tasks from the
  *immediately prior* week (math and habit both) for anything with no
  submission, or one that was rejected. Those get re-offered first, tagged
  "⏪ Catch-up" everywhere they show up (My Progress, the Tasks review
  queue, the parent portal) — this is deliberately the most common thing
  a student gets asked to do to climb back up, since finishing something
  already assigned is a more concrete, achievable ask than a brand-new
  task. It only looks one week back, so a missed task gets one clean
  second chance rather than turning into an ever-growing backlog.
- This is genuinely hands-off: you manage the reusable **Task Library**
  (Tasks tab — add your own, or click "Load Starter Task Library" for a
  research-grounded default set spanning reading, movement, sleep/
  routine, chores, focus, kindness, and creativity) and tag each one with
  interests; the app does the picking every week from there.
- If you add a student or a new task *after* already saving a week, a
  "Fill In Missing Assignments" button on the Tasks tab catches them up
  without redoing the whole week.
- Students can leave an optional one-line reflection ("what was that
  like?") when marking a task done — not graded, just a small nudge
  toward noticing their own effort. Visible to whoever reviews it
  (you or the parent).

**Student-set weekly goal is measurable, not just a wish.** On My
Progress, a student picks one of three trackable numbers -- Total
Points, ClassPoint Stars, or IXL Average -- and a target ("at least
___"), with a one-click suggestion based on their own recent history.
That's compared automatically against their actual scores as soon as
they're entered: My Progress shows exactly how far off they are ("12
more IXL points to hit your goal") and flips to a clear "🎯 Goal
achieved!" the moment they cross it -- both the nudge ("A Note Just For
You") and the "Ways to Climb Higher" list point back at it until it's
hit. An all-time **"Goals hit"** count sits next to streaks and
Superstar weeks on their standing card. An optional short note ("why
this goal?") can go alongside it, but the note itself was never what
gets checked -- the number is.

**Printable certificates** -- when a student hits a personal best or a
perfect Superstar week, a "Print Certificate" button appears on My
Progress; it's a print-styled view (`window.print()`, no PDF library
needed) a parent can save or print at home.

**Insights tab** -- three term-long trend charts, plus a quick stat
strip up top for an at-a-glance read: average points earned so far
(running total per student), the Superstar rate (% with a perfect IXL
week), and the task completion rate.

The points chart specifically plots a **running total**, not
week-over-week growth like an earlier version did. Averaged across a
whole class over a term, week-over-week growth is naturally volatile
and can trend into negative territory even while every student is
genuinely accumulating real points and real superstar weeks -- a class
trend chart with a declining line reads as "things are getting worse,"
which usually isn't what's actually happening. A running total is the
same visual language every real points/XP system uses (Duolingo, Khan
Academy -- points only ever climb): it goes up because real work keeps
getting added on top of what came before, never down. Computed by
`avgCumulativePointsForWeek()` in `src/lib/calc.js`; useful for spotting
a dip in engagement (a flattening curve, not a falling one) before it
turns into a parent question.

## Data model

```
groups(id, name, goal_label, goal_points, teacher_contact)
sessions(id, group_id, label)
students(id, group_id, name, team, active, session_id, parent_token, parent_pin, parent_pin_set, parent_pin_attempts, parent_pin_locked_until, student_token, interests)
weeks(id, group_id, label, date, skills_assigned, bonus_multiplier)
entries(week_id, student_id, classpoint_stars, ixl_avg, notebooking_score, study_guide_score, exam_score, exam_corrections_score, bonus, bonus_note, student_goal, goal_metric, goal_target, total)
tasks(id, group_id, title, description, category, points, interest_tags, is_dynamic_math, active)
task_assignments(id, group_id, week_id, student_id, task_id, title, description, category, points, is_catchup, source_assignment_id)
task_submissions(id, assignment_id, student_id, week_id, status, reflection, submitted_at, reviewed_at)
```

`total` is a generated column: `classpoint_stars * 5 + ixl_avg + notebooking_score +
study_guide_score + exam_score + exam_corrections_score + bonus`.

### The six score segments

A student's weekly total breaks into six pieces, each tracked as its own
column on `entries` rather than folded into one opaque number:

| Segment | Column | How it's entered |
|---|---|---|
| Class Participation | `classpoint_stars` (×5) | ClassPoint screenshot, auto-extracted |
| Assignments | `ixl_avg` | IXL, Formative, or ClassMarker screenshot, auto-extracted -- use whichever tool you actually assigned that week |
| Notebooking | `notebooking_score` | Manual entry in Weekly Update |
| Study Guide | `study_guide_score` | Manual entry in Weekly Update |
| Exams | `exam_score` | IXL (toggle it to "Exams" instead of "Assignments") or Kuta Works screenshot, auto-extracted |
| Exam Corrections | `exam_corrections_score` | Manual entry |

Weekly Update's review table has a column for each. Four screenshot
readers now feed into Assignments/Exams: **IXL** (with a toggle for
which of the two it counts toward that week, since the same report
could be either depending on what you assigned), **Formative**,
**ClassMarker**, and **Kuta Works** -- attach whichever screenshot
matches what you actually used that week, and Extract Data reads it the
same way ClassPoint/IXL always worked. Notebooking, Study Guide, and
Exam Corrections stay manual entry -- there's no screenshot parser for
handwritten notebooks or study guides. History's "Edit This Week" has
the same six columns, for going back and correcting any of them later.

Formative and ClassMarker list names in different orders on screen
(Formative: "Last, First"; ClassMarker: normal "First Last"), and Kuta
Works uses "Last, First" too with an occasional genuine duplicate row in
the raw data -- the reader accounts for both naming conventions and
flags duplicates in Extract Data's results rather than silently picking
one. Formative in particular shows multiple class sessions grouped
together with only one usually expanded -- only the expanded group's
individual student rows get read; collapsed group-summary rows are
skipped automatically.

**"Pick a week"** (top of Weekly Update, above the week label) lists
every week you've already logged for this Level, newest first, plus
"➕ New week" -- so going back to add or fix a past week's scores means
picking it from a list instead of having to retype its exact label from
memory (easy to get wrong, and a label that doesn't match exactly would
silently create a brand-new duplicate week instead of editing the one
you meant). Picking an existing week loads everything already saved for
it -- scores, bonus multiplier, skills assigned -- as the starting
point, the same protection described below for scores now extended to
the multiplier and skills-assigned text too, so switching to a past
week and clicking Save Week never resets those back to defaults.
History's "Edit This Week" remains the other way to reach a past week,
better suited for a from-scratch table view of one week; this dropdown
is for using the *normal* Weekly Update flow (screenshots, Quick
Update) against a week other than today's by default.

**"Quick Update — One Category at a Time"** (top of Weekly Update) is
for exactly the workflow of entering different score segments at
different points during the week -- Notebooking during class, Study
Guide the night before an exam -- without the screenshot flow or its
wider table. Pick the week and one category, type values for whoever
needs one, save. It only ever touches that one column in the database:
the upsert payload includes just `week_id`, `student_id`, and the one
category being saved, so anything another session already saved for
that week -- any other category, any other student -- is left
completely alone.

This matters because of a real bug that existed before this panel: the
full screenshot-based review table used to reset the four manual fields
to zero every time it built a fresh review, even for a week that
already had saved scores -- so coming back later in the week to add a
second category and clicking Save Week would have silently overwritten
the first one back to zero. Both flows now load whatever's already
saved for that week as the starting point before anything gets
touched, so re-opening a week to add more never wipes out what's
already there, regardless of which of the two ways you use to enter
scores.

Also on that same panel: **"Reset This Week's Scores (testing)"**
zeroes out every score in whichever week is currently named in the
Week field (asks for confirmation first) -- for exactly what it says,
freely re-testing without piling up a trail of test data. It resets
the numbers, not the week itself -- the week stays, with its label and
any bonus notes intact, just every score back to zero.

**On the student's own page** (My Progress, and the real student-facing
`/student/:token` link), a **"This Week's Score Breakdown"** card shows
all six segments individually, not just the combined total -- so a
student (or a parent looking over their shoulder) can see exactly where
their points came from, not just the final number. Right below it,
their total is compared against that week's **class average**, computed
from the same peer group used for League placement (same-session peers,
or the whole Level if the Level has no sessions).

**The growth curve now shows every week logged so far**, not capped at
5 -- it grows on its own as more weeks get added, no limit to raise
later. A second dashed line on the same chart tracks the **class
average** week by week, so a student can see their own trajectory next
to where the class as a whole is moving, not just their own number in
isolation.

`goal_label` / `goal_points` on `groups` back the two-team progress bar on
the Projector Board (defaults to 1000 pts -- edit directly in Supabase's
Table Editor, or ask me to add a Roster-tab control for it).

## Teacher login

This used to be a client-side-only passcode, which never actually
restricted database access -- anyone with the public anon key could read
or write everything regardless of whether they'd "unlocked" the app's UI.
It's now backed by a real Supabase Auth account, and the database itself
(Row Level Security in `supabase/schema.sql`) requires a signed-in session
before allowing any read or write to groups/students/weeks/entries/tasks.

**One-time setup** (after running `schema.sql`): in Supabase, go to
**Authentication > Users > Add user**, enter your own email and a
password, and toggle **Auto Confirm User** on (so it doesn't wait on a
confirmation email). That's your one teacher account -- there's no
sign-up form in the app on purpose, matching the brief: one teacher, no
public signup.

Sign in with that email/password on the app's login screen. The session
persists across visits (standard Supabase Auth behavior) until you tap
**Sign Out** in the top bar. Forgot the password? Reset or change it
anytime from the same Supabase Authentication screen.

**What's still open, and why**: the `/parent/:token` page deliberately
does **not** require this login -- parents were never meant to have
teacher accounts. It reaches data only through the `parent-portal` /
`get-parent-link` Netlify Functions, which use the service-role key
server-side and re-scope every query to one student by their token (more
detail under "Letting parents approve instead of you" further up). That
path doesn't touch the anon key or these RLS policies at all -- by
design, not as a gap.

## Notes / things you may want to adjust

- **Copy-link buttons and "Send Both Links by Email" no longer trust the
  browser's automatic clipboard write or mailto: handoff silently
  working.** Both can fail with no thrown error to catch: a clipboard
  write issued after an `await`ed network call falls outside the short
  "recent user click" window some browsers require, and a `mailto:`
  link can just as easily do nothing if there's no default mail app
  configured, or on some browsers for the same after-an-await reason.
  Every copy action now always shows the link in a `prompt()` (a
  guaranteed-selectable text field) in addition to attempting the
  automatic copy in the background -- and "Send Both Links by Email"
  always shows the raw message as a fallback too, so there's always a
  manual copy-paste path even when nothing visibly opens.

- **Weekly Update's default week label is last week, not today.** Scores
  usually get entered a few days after the week they're for, so the
  "Week label" field now defaults to 7 days before today instead of
  today's actual date -- one less thing to notice and manually fix at
  the start of every entry session. Still fully editable, and the "Pick
  a week" dropdown for going back further still works exactly the same.

- **Name mismatches in screenshot imports are now a one-time fix, not a
  weekly one.** If a name in a ClassPoint/IXL/Formative/ClassMarker/Kuta
  Works screenshot doesn't match anyone on the roster -- most commonly a
  parent's name showing up on a Formative or ClassMarker account instead
  of the student's -- it no longer gets silently dropped. Weekly Update
  shows an **"Unmatched Names — Pick Who This Is"** card above the review
  table: pick the right student once, click **Save & Remember**, and
  that mapping is saved to the new `name_aliases` table (one per Level,
  keyed by the exact raw name text). Every future week, that same
  mismatched name resolves automatically before fuzzy matching even
  runs -- a teacher's past correction is always trusted over a fresh
  guess. Lives in `WeeklyUpdate.jsx` (`resolveMatch`, `saveAlias`) and
  `supabase/schema.sql` (`name_aliases` table).

  This surfaced a real accuracy bug in the underlying fuzzy matcher
  (`src/lib/fuzzyMatch.js`): a completely unrelated name (a parent's,
  say) could occasionally get silently, wrongly matched to some
  student instead of showing up as unmatched at all -- the "unmatched"
  card can only show what the matcher itself decides it can't resolve.
  The specific cause was a prefix-match rule with no minimum length
  requirement -- a short first name on the roster could coincidentally
  be a literal text-prefix of a totally unrelated full name and get
  accepted with high confidence on that alone. Fixed by requiring a
  meaningful prefix length (4+ characters) before that rule fires, and
  by raising the overall acceptance threshold (0.55 → 0.72) so raw
  character overlap between two genuinely different names is less
  likely to clear the bar by accident. Verified against both directions
  before shipping -- confirmed real unrelated names now correctly fall
  through to "unmatched," while legitimate cases (exact matches,
  ClassPoint's first-name-only extraction, IXL's truncated names,
  minor typos, and short real names) all still match correctly.

- **"Find a Student"** (top of Overview) searches every student across
  every Level at once, not just whichever one is currently selected --
  useful once you're running enough Levels that remembering which class
  someone's in stops being automatic. Click a result to jump straight to
  that Level's Roster.

- **Score-edit audit trail.** Every change to a saved entry is logged
  automatically by a database trigger (`entry_edit_log` /
  `log_entry_edit()` in `schema.sql`) -- not something the app code has
  to remember to call, so it catches an edit no matter which screen made
  it (Weekly Update, Quick Update, History, Catch-Up), including ones
  from a save path added later that nobody thought to instrument. History
  shows this per-week as "Edit History" -- who changed, what changed, and
  when, for whichever week you're looking at. The log itself has no
  update/delete policy for any client role, so it can't be edited or
  cleared after the fact, including from inside the app.

- **Mid-semester joiners are already handled correctly, without needing
  an "absent" flag or any special-casing.** A student's growth is only
  ever compared against their OWN past weeks -- since they simply have
  no entry rows for weeks before they joined, those weeks are excluded
  from their average automatically rather than counting as zeros. Their
  streak walking backward runs into "no entry" at their real join date
  and stops there (the same single-week grace that already exists
  absorbs that one boundary week), so it reports their actual join-to-now
  streak correctly. If a student misses a class and doesn't do the
  makeup work, that's meant to show up as a real zero, not get excused --
  there's no separate "absent" marking for that case on purpose, since
  catching up is the expectation, not an excuse.

- Every Level now has a real **"Meets on"** day (`groups.meets_day`,
  editable in that Level's Group Settings on Roster) instead of it being
  guessed from the name. "Load My Programs" sets this correctly for all
  22 courses, including the ones with no day in their name at all (Level
  7, Algebra 2, Pre-Calculus, Digital SAT Math Prep, all four Competition
  Math levels). This one field is what the sidebar picker's day-grouping,
  Overview's "Today's Classes," and Overview's "Weekly Schedule" all
  actually read -- if you ever add a Level by hand or rename one and the
  schedule views look off, check that Level's "Meets on" setting first.
  If you loaded your Levels before this feature existed, Roster's
  **"Fix Missing Days"** button (next to "Load My Programs") backfills
  the day for any existing Level whose name matches a known course --
  a one-time cleanup, safe to click more than once.

- The app switched from a dark theme to a light, professional one --
  everything runs through CSS variables in `src/index.css` (`--void`,
  `--surface`, `--card-bg`, `--text-hi`, etc.), so the whole app's palette
  lives in one place if you ever want to adjust it further or flip it
  back. A few spots that don't use those variables were updated by hand
  to match: chart grid lines and axis labels (recharts needs literal hex
  colors, not CSS variables), the gold accent used for "personal best" /
  "superstar" callouts (darkened for contrast on white), and the printable
  certificate's text color (kept a fixed dark ink regardless of app theme,
  since that's meant to print on white paper either way).
- The app went through a second design pass -- a proper left sidebar for
  navigation (collapses to a top bar + horizontal tabs on narrow screens),
  a "Next Step" milestone banner (`src/components/NextMilestone.jsx`) on
  every progress view, a bordered **KPI strip** (`src/components/
  KpiStrip.jsx`) for the "Your Standing" numbers instead of a loose row of
  labeled text, and Roster's per-student row was cut down from a wall of
  buttons to name/session/team/status plus a single "..." menu
  (`src/components/RowMenu.jsx`) for the less-frequent actions (links,
  resets, delete). Brand colors and fonts stayed the same throughout --
  this was about structure and clarity, not a rebrand.
- A third pass added some visual life on top of that: cards cycle through
  four subtle background tints instead of one flat gray, everything lifts
  slightly on hover, and a page's cards fade/slide in one-by-one on load
  instead of popping in all at once (all in `src/index.css`, no JS). The
  Superstar card gets a slow gold glow pulse and the "Next Step" banner a
  soft moving gradient -- the two things most worth a kid's attention get
  a bit more presence, the rest stays calm. Respects
  `prefers-reduced-motion` throughout.
- Roster's **"Load My Programs"** button (`src/lib/programCatalog.js`)
  creates your real course catalog as Levels in one click, pulled from
  enrichmindacademy.com/programs. A course that meets twice a week (e.g.
  Level 5) becomes two fully independent Levels, one per day ("Level 5
  Mon", "Level 5 Fri") -- separate rosters and leaderboards, not a shared
  one. Once you've got more than a couple of Levels, a **Sort by** toggle
  (Name / Day / Date Added) above the list reorders it -- "Day" reads the
  Mon/Tue/etc. suffix off the end of a Level's name, so it only does
  anything useful for Levels named that way.

- Right below that, **"Import Students from Registration Sheet"**
  (`src/lib/importRoster.js`) bulk-populates Levels from a pasted copy of
  your registration Google Sheet, instead of typing each student in by
  hand. Copy the rows (header included) straight out of the sheet and
  paste them in -- it needs the **Student Name**, **Courses**,
  **Sections**, and **Status** columns, matched by header name so column
  order doesn't matter. A student who signed up for more than one course
  (the sheet joins those with " + " in both the Courses and Sections
  columns) gets added to every matching Level, not just the first. If
  your sheet has **Sibling Name / Sibling Course / Sibling Section**
  columns (a second child riding along on the same registration), that
  sibling is read and imported too, with the exact same multi-course
  splitting rules -- easy to miss since they don't get their own row, but
  they're still a real second student. If a sibling's course/section
  columns are blank or a multi-session course's day can't be determined
  from what's there, that specific entry is reported as unmatched rather
  than guessed at. If a **Parent Email** column is present, it's saved
  to that student's record too (a sibling shares the same email as the
  primary registrant on their row) -- this is what lets the bulk link
  export below double as a real mail-merge contact list, not just links
  with no way to know whose inbox they go to. Course names are matched
  to Levels the same way "Load My Programs" names them -- e.g. "Level 5
  — Variables & Real-World Modeling" + "Fri 5-6 PM ET" resolves to
  "Level 5 Fri" -- so **Levels need to already exist** (via "Load My
  Programs" above) before importing into them. Inactive registrations
  (`Status` not "Active") are skipped automatically, and it's safe to
  paste the same sheet again later after new signups come in -- anyone
  already rostered in a Level is detected and skipped, never duplicated.
  If a course name in the sheet doesn't
  match any existing Level (a typo, or a brand-new course not loaded
  yet), those students aren't silently dropped -- the tool reports back
  exactly which Level names it couldn't find, so you can fix the name or
  create the Level and paste again to pick up just those. Roster also
  shows a **student count next to every Level button**, plus a running
  **total across every Level** above the list -- both update live, so
  you can cross-check an import against your source sheet at a glance
  instead of clicking into each Level one at a time.

### Automatic sync (no copy-paste at all)

If you'd rather new registrations show up in the right roster the moment
they come in -- no button to click, nothing to remember -- set this up
once. It works by having a small script *inside* the Google Sheet push
its data to the app whenever a new row appears, rather than the app
reaching out to Google (which would need a Google Cloud service account
and OAuth setup). This way is simpler: no Google API credentials needed
anywhere.

**How it behaves:** every push sends the *entire* current sheet, not just
the new row -- so it's self-healing. If a push is ever missed (a network
hiccup, the trigger not firing), the very next one catches everything up,
since already-rostered students are always skipped, never duplicated --
identical guarantee to the manual paste-import above.

**1. Pick a secret and add it to Netlify.** This is just a private
password only your sheet and your app know, so nobody else can push fake
data to your roster. Make one up (any random string works), then in
Netlify: **Site settings -> Environment variables -> Add a variable** ->
name it `SHEET_SYNC_SECRET`, value = the string you picked. Redeploy
after adding it (**Deploys -> Trigger deploy**) so it takes effect.

**2. Open the Apps Script editor inside the sheet.** In the Google Sheet:
**Extensions -> Apps Script**. Delete whatever starter code is there and
paste this in:

```javascript
function syncToApp() {
  var SECRET = "PASTE_YOUR_SECRET_HERE";
  var WEBHOOK_URL = "https://YOUR-SITE.netlify.app/.netlify/functions/sheet-sync";

  var sheet = SpreadsheetApp.getActiveSheet();
  var values = sheet.getDataRange().getValues();

  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify({ secret: SECRET, values: values }),
    muteHttpExceptions: true,
  });
}

function onFormSubmit(e) {
  syncToApp();
}
```

Replace `PASTE_YOUR_SECRET_HERE` with the exact same secret from step 1,
and `YOUR-SITE` with your actual Netlify site name. Click the save icon,
give the project any name (e.g. "EnrichMind Sync").

**3. Add the trigger that fires this automatically.** In the Apps Script
editor's left sidebar, click the clock icon (**Triggers**) -> **+ Add
Trigger**. Set:
- Function to run: `onFormSubmit`
- Event source: **From spreadsheet**
- Event type: **On form submit** (this only appears if the sheet is fed
  by a Google Form, which this registration sheet is, based on its
  Timestamp/Registration ID columns)

Save. The first time, Google will ask you to authorize the script --
click through and allow it (it only needs permission to read this one
sheet and make outbound web requests, nothing else).

> If your sheet is ever edited by hand instead of through a Form
> submission and you want those changes picked up too, add a second
> trigger with event type **On edit** instead (or in addition) -- same
> function, `onFormSubmit` works fine as the target even for an edit
> trigger, the name's just a label.

**4. Test it.** Easiest way: back in the Apps Script editor, select the
`syncToApp` function from the dropdown next to the Run button and click
**Run** once by hand. Check Roster in the app afterward -- since this
pushes the whole sheet, this first run should backfill every existing
active registration into its matching Level in one shot (assuming
you've already run **Load My Programs** so those Levels exist). From
then on, it fires automatically every time the Form receives a new
submission.

- The IXL vision prompt is tuned for the "students as columns, lettered
  skill sections as row groups" layout you shared -- if IXL changes its
  report format, the prompt in `netlify/functions/parse-screenshot.js` is
  the place to update.
- Fuzzy name matching (`src/lib/fuzzyMatch.js`) flags ambiguous matches
  (e.g. two "A..." names close in score) with a "Check name" badge in the
  review table so you catch mismatches before saving.
- "Comeback of the week" = a student whose growth vs. trailing average is
  positive this week after being negative last week. "Most Improved" =
  largest positive growth this week, full stop.
