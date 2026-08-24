import { Home, LayoutDashboard, User, UploadCloud, CheckSquare, BarChart2, Users, Clock } from "lucide-react";

// PRIMARY: the handful of things actually used every day, always visible.
// SECONDARY: everything else -- still one click away, just tucked behind
// "More" in the sidebar instead of competing for attention on every visit.
export const NAV_LINKS = [
  { to: "/", label: "Today", end: true, icon: Home, primary: true },
  { to: "/board", label: "Projector Board", icon: LayoutDashboard, primary: true },
  { to: "/roster", label: "Roster", icon: Users, primary: true },

  { to: "/overview", label: "Overview", icon: BarChart2, primary: false },
  { to: "/my-progress", label: "My Progress", icon: User, primary: false },
  { to: "/weekly-update", label: "Weekly Update", icon: UploadCloud, primary: false },
  { to: "/tasks", label: "Tasks", icon: CheckSquare, primary: false },
  { to: "/insights", label: "Insights", icon: BarChart2, primary: false },
  { to: "/history", label: "History", icon: Clock, primary: false },
];
