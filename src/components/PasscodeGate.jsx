import { useState } from "react";
import { supabase } from "../supabaseClient";

// Real Supabase Auth login for the teacher — replaces the old client-side
// passcode gate, which never actually restricted database access (anyone
// with the public anon key could bypass it entirely). A signed-in session
// here is what Row Level Security now checks before allowing any read or
// write to groups/students/weeks/entries/tasks — see supabase/schema.sql.
//
// There is no sign-up form here on purpose: this stays single-teacher,
// no public signup. Create the one teacher account once, from Supabase's
// dashboard (Authentication > Users > Add user) — see the README.
export default function PasscodeGate({ onUnlock }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else if (onUnlock) {
      onUnlock();
    }
  }

  return (
    <div className="passcode-screen">
      <div className="passcode-box card">
        <h1>EnrichMind Leaderboard</h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          Sign in with your teacher account to continue.
        </p>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            autoComplete="email"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
          />
          <button type="submit" className="btn" disabled={loading}>
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
        {error && <div className="error-text">{error}</div>}
      </div>
    </div>
  );
}
