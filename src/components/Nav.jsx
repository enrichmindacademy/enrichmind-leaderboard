import { NavLink } from "react-router-dom";
import { NAV_LINKS } from "../lib/navLinks";

// Horizontal pill nav — used on narrow screens (see .sidebar / .mobile-nav
// visibility rules in index.css). The desktop sidebar is Sidebar.jsx.
export default function Nav() {
  return (
    <nav className="tabs mobile-nav">
      {NAV_LINKS.map((l) => (
        <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
          {l.label}
        </NavLink>
      ))}
    </nav>
  );
}
