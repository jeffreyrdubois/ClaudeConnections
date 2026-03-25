import { Router } from "express";
import { getFolders, getFolderById, createFolder, updateFolder, deleteFolder } from "../db/index.js";

export const foldersRouter = Router();

// GET /api/folders
foldersRouter.get("/", (_req, res) => {
  res.json(getFolders());
});

// POST /api/folders
foldersRouter.post("/", (req, res) => {
  const { name, description } = req.body as { name?: string; description?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Folder name is required" });
    return;
  }
  try {
    const folder = createFolder(name.trim(), description?.trim());
    res.status(201).json(folder);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("UNIQUE")) {
      res.status(409).json({ error: `Folder "${name}" already exists` });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// PATCH /api/folders/:id
foldersRouter.patch("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (!getFolderById(id)) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  const { name, description } = req.body as { name?: string; description?: string };
  try {
    const folder = updateFolder(id, name?.trim(), description?.trim());
    res.json(folder);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    res.status(500).json({ error: msg });
  }
});

// DELETE /api/folders/:id
foldersRouter.delete("/:id", (req, res) => {
  const id = parseInt(req.params.id);
  if (!getFolderById(id)) {
    res.status(404).json({ error: "Folder not found" });
    return;
  }
  deleteFolder(id);
  res.status(204).send();
});
