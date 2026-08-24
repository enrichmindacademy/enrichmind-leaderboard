import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LogOut, ChevronDown, ChevronRight } from "lucide-react";
import { NAV_LINKS } from "../lib/navLinks";
import { supabase } from "../supabaseClient";

export default function Sidebar({ groupPicker }) {
  const location = useLocation();
  const primaryLinks = NAV_LINKS.filter((l) => l.primary);
  const secondaryLinks = NAV_LINKS.filter((l) => !l.primary);
  // Auto-open "More" if landing directly on a secondary page (e.g. a
  // bookmark or a link from Today), so the active item is never hidden
  // behind a collapsed toggle with no visible indication where you are.
  const [moreOpen, setMoreOpen] = useState(() => secondaryLinks.some((l) => l.to === location.pathname));

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark" />
        <div className="brand-title">EnrichMind</div>
      </div>

      {groupPicker}

      <nav className="sidebar-nav">
        {primaryLinks.map((l) => {
          const Icon = l.icon;
          return (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
              <Icon size={17} strokeWidth={2} />
              {l.label}
            </NavLink>
          );
        })}

        <div
          className="navlink-more-toggle"
          onClick={() => setMoreOpen((v) => !v)}
          role="button"
          tabIndex={0}
        >
          {moreOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          More
        </div>

        {moreOpen &&
          secondaryLinks.map((l) => {
            const Icon = l.icon;
            return (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.end}
                className={({ isActive }) => `navlink-secondary ${isActive ? "active" : ""}`}
              >
                <Icon size={16} strokeWidth={2} />
                {l.label}
              </NavLink>
            );
          })}
      </nav>

      <button className="sidebar-signout" onClick={() => supabase.auth.signOut()}>
        <LogOut size={16} strokeWidth={2} />
        Sign Out
      </button>
    </aside>
  );
}
