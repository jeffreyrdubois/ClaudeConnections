import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Players from "./pages/Players";
import Games from "./pages/Games";
import Matches from "./pages/Matches";
import Analytics from "./pages/Analytics";
import HeadToHead from "./pages/HeadToHead";
import MonopolyTracker from "./pages/MonopolyTracker";
import Instructions from "./pages/Instructions";

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="matches" element={<Matches />} />
        <Route path="players" element={<Players />} />
        <Route path="games" element={<Games />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="head-to-head" element={<HeadToHead />} />
        <Route path="monopoly" element={<MonopolyTracker />} />
        <Route path="instructions" element={<Instructions />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
