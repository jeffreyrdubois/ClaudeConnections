import { BookOpen } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login, setup } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    if (needsSetup && password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (needsSetup) {
        await setup(username, password);
      } else {
        await login(username, password);
      }
      navigate("/collection");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Login failed";
      if (msg.includes("Password not set") || msg.includes("needsSetup")) {
        setNeedsSetup(true);
        setError("First time signing in? Create a password below.");
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  function selectUser(name: string) {
    setUsername(name);
    setNeedsSetup(false);
    setError(null);
    setPassword("");
    setConfirmPassword("");
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-amber-500 rounded-xl flex items-center justify-center mx-auto mb-3">
            <BookOpen className="w-6 h-6 text-gray-900" />
          </div>
          <h1 className="text-2xl font-bold text-white">Magic Collection</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to manage your cards</p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* User selector */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-2">Who are you?</label>
              <div className="grid grid-cols-2 gap-2">
                {["Jeffrey", "Abby"].map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => selectUser(name)}
                    className={`py-3 rounded-lg text-sm font-semibold border transition-colors ${
                      username === name
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        : "bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-600"
                    }`}
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-xs font-medium text-gray-400 mb-1.5">
                {needsSetup ? "Create Password" : "Password"}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={needsSetup ? "Choose a password" : "Enter your password"}
                className="input w-full"
                autoFocus={!!username}
                disabled={!username}
              />
            </div>

            {/* Confirm password (first-time setup only) */}
            {needsSetup && (
              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  className="input w-full"
                />
              </div>
            )}

            {error && (
              <div className="p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg text-sm text-amber-400">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!username || !password || loading}
              className="btn-primary w-full"
            >
              {loading ? "Signing in..." : needsSetup ? "Set Password & Sign In" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
