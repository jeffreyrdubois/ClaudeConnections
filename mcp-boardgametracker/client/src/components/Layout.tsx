import {
  BarChart3,
  BookOpen,
  Dice5,
  Gamepad2,
  LogOut,
  Menu,
  Trophy,
  User,
  Users,
  X,
  Swords,
  FileText,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/dashboard",    label: "Dashboard",    icon: BarChart3 },
  { to: "/matches",      label: "Matches",      icon: Dice5 },
  { to: "/players",      label: "Players",      icon: Users },
  { to: "/games",        label: "Games",        icon: Gamepad2 },
  { to: "/analytics",    label: "Analytics",    icon: Trophy },
  { to: "/head-to-head", label: "Head to Head", icon: Swords },
  { to: "/monopoly",     label: "Monopoly Cup", icon: Trophy },
  { to: "/instructions", label: "Instructions", icon: FileText },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  return (
    <div className="flex h-screen overflow-hidden">
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={closeSidebar}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col w-56
          bg-surface-card border-r border-gray-700/50
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0 md:z-auto md:shrink-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center shrink-0">
              <Dice5 className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-tight">Board Game</div>
              <div className="text-xs text-gray-400 leading-tight">Tracker</div>
            </div>
          </div>
          <button onClick={closeSidebar} className="md:hidden p-1 text-gray-500 hover:text-gray-300 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-accent/15 text-accent-light border border-accent/20"
                    : "text-gray-400 hover:text-gray-100 hover:bg-gray-700/50"
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-700/50 space-y-2">
          {user ? (
            <div className="flex items-center gap-2 px-1">
              <div className="w-6 h-6 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                <User className="w-3.5 h-3.5 text-accent-light" />
              </div>
              <span className="text-sm text-gray-300 font-medium flex-1 truncate">{user.username}</span>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="p-1 text-gray-600 hover:text-red-400 transition-colors rounded"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <NavLink to="/login" className="btn-primary w-full justify-center text-xs">
              <BookOpen className="w-3.5 h-3.5" /> Sign In to Edit
            </NavLink>
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-surface-card border-b border-gray-700/50 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-accent rounded flex items-center justify-center">
              <Dice5 className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="text-sm font-bold text-white">Board Games</span>
          </div>
          {user && <span className="ml-auto text-xs text-gray-500">{user.username}</span>}
        </header>

        <main className="flex-1 overflow-auto bg-surface">
          <Outlet />
        </main>

        <nav className="md:hidden flex border-t border-gray-700/50 bg-surface-card shrink-0">
          {NAV.slice(0, 5).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                  isActive ? "text-accent-light" : "text-gray-500 hover:text-gray-300"
                }`
              }
            >
              <Icon className="w-5 h-5" />
              <span className="leading-tight">{label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
