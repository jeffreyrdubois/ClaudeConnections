import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Dice5 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { getAuthStatus } from "../api/client";

export default function Login() {
  const { user, login, setup, register } = useAuth();
  const navigate = useNavigate();
  const [needsSetup, setNeedsSetup] = useState(false);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (user) navigate("/dashboard", { replace: true });
  }, [user, navigate]);

  useEffect(() => {
    getAuthStatus().then(s => setNeedsSetup(s.needs_setup));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      if (needsSetup) {
        await setup(username, password);
      } else if (mode === "register") {
        const msg = await register(username, password);
        setMessage(msg);
        setMode("login");
      } else {
        await login(username, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface p-4">
      <div className="card p-8 w-full max-w-sm">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-12 h-12 bg-accent rounded-xl flex items-center justify-center">
            <Dice5 className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-xl font-bold text-white">Board Game Tracker</h1>
          <p className="text-sm text-gray-400">
            {needsSetup
              ? "Create the admin account to get started"
              : mode === "register"
              ? "Request an account"
              : "Sign in to enter & edit data"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            className="input"
            placeholder="Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
          />
          <input
            className="input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          {message && <p className="text-green-400 text-sm">{message}</p>}
          <button type="submit" className="btn-primary w-full justify-center">
            {needsSetup ? "Create Admin Account" : mode === "register" ? "Request Account" : "Sign In"}
          </button>
        </form>

        {!needsSetup && (
          <p className="text-center text-sm text-gray-500 mt-4">
            {mode === "login" ? (
              <>
                Need an account?{" "}
                <button onClick={() => { setMode("register"); setError(""); }} className="text-accent-light hover:underline">
                  Register
                </button>
              </>
            ) : (
              <>
                Have an account?{" "}
                <button onClick={() => { setMode("login"); setError(""); }} className="text-accent-light hover:underline">
                  Sign In
                </button>
              </>
            )}
          </p>
        )}

        <p className="text-center text-xs text-gray-600 mt-4">
          Viewing data doesn't require sign-in
        </p>
      </div>
    </div>
  );
}
