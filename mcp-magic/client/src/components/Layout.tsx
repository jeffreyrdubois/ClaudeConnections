import {
  BarChart3,
  BookOpen,
  FolderOpen,
  Layers,
  Swords,
} from "lucide-react";
import { NavLink, Outlet } from "react-router-dom";

const NAV = [
  { to: "/collection", label: "Collection", icon: Layers },
  { to: "/folders", label: "Folders", icon: FolderOpen },
  { to: "/decks", label: "Decks", icon: Swords },
  { to: "/statistics", label: "Statistics", icon: BarChart3 },
];

export default function Layout() {
  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-surface-card border-r border-gray-700/50 flex flex-col shrink-0">
        {/* Logo */}
        <div className="p-5 border-b border-gray-700/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
              <BookOpen className="w-4 h-4 text-gray-900" />
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-tight">Magic</div>
              <div className="text-xs text-gray-400 leading-tight">Collection Manager</div>
            </div>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-amber-500/15 text-amber-400 border border-amber-500/20"
                    : "text-gray-400 hover:text-gray-100 hover:bg-gray-700/50"
                }`
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-700/50">
          <div className="text-xs text-gray-600 text-center">Powered by Scryfall</div>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto bg-surface">
        <Outlet />
      </main>
    </div>
  );
}
