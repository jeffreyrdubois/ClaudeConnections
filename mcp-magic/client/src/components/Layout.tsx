import {
  BarChart3,
  BookOpen,
  FolderOpen,
  Layers,
  LogOut,
  Menu,
  ShoppingBag,
  Swords,
  User,
  X,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../context/AuthContext";

const NAV = [
  { to: "/collection", label: "Collection", icon: Layers },
  { to: "/shop",       label: "Shop",       icon: ShoppingBag },
  { to: "/folders",    label: "Folders",    icon: FolderOpen },
  { to: "/decks",      label: "Decks",      icon: Swords },
  { to: "/statistics", label: "Statistics", icon: BarChart3 },
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

      {/* ── Mobile backdrop ────────────────────────────────────── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* ── Sidebar ───────────────────────────────────────────── */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex flex-col w-56
          bg-surface-card border-r border-gray-700/50
          transform transition-transform duration-200 ease-in-out
          md:relative md:translate-x-0 md:z-auto md:shrink-0
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* Logo + mobile close */}
        <div className="p-5 border-b border-gray-700/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center shrink-0">
              <BookOpen className="w-4 h-4 text-gray-900" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-tight">Magic</div>
              <div className="text-xs text-gray-400 leading-tight">Collection Manager</div>
            </div>
          </div>
          <button
            onClick={closeSidebar}
            className="md:hidden p-1 text-gray-500 hover:text-gray-300 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                    : "text-gray-400 hover:text-gray-100 hover:bg-gray-700/50"
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer — user + logout */}
        <div className="p-3 border-t border-gray-700/50 space-y-2">
          {user && (
            <div className="flex items-center gap-2 px-1">
              <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <User className="w-3.5 h-3.5 text-amber-400" />
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
          )}
          <div className="text-xs text-gray-600 text-center">Powered by Scryfall</div>
        </div>
      </aside>

      {/* ── Main content ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 bg-surface-card border-b border-gray-700/50 shrink-0">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1.5 -ml-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700/50 transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-amber-500 rounded flex items-center justify-center">
              <BookOpen className="w-3.5 h-3.5 text-gray-900" />
            </div>
            <span className="text-sm font-bold text-white">Magic</span>
          </div>
          {user && (
            <span className="ml-auto text-xs text-gray-500">{user.username}</span>
          )}
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-auto bg-surface">
          <Outlet />
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden flex border-t border-gray-700/50 bg-surface-card shrink-0">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
                  isActive ? "text-amber-400" : "text-gray-500 hover:text-gray-300"
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
