import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Collection from "./pages/Collection";
import DeckDetail from "./pages/DeckDetail";
import Decks from "./pages/Decks";
import Folders from "./pages/Folders";
import Statistics from "./pages/Statistics";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/collection" replace />} />
          <Route path="collection" element={<Collection />} />
          <Route path="folders" element={<Folders />} />
          <Route path="decks" element={<Decks />} />
          <Route path="decks/:id" element={<DeckDetail />} />
          <Route path="statistics" element={<Statistics />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
