import { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUser, loginUser, logoutUser, setupPassword } from "../api/client";

interface AuthUser {
  username: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  isLoading: true,
  login: async () => {},
  setup: async () => {},
  logout: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getCurrentUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  async function login(username: string, password: string) {
    const u = await loginUser(username, password);
    setUser(u);
  }

  async function setup(username: string, password: string) {
    const u = await setupPassword(username, password);
    setUser(u);
  }

  async function logout() {
    await logoutUser();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, setup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
