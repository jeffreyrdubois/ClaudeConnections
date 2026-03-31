import { Router, Request, Response } from "express";
import {
  getInstructionVersionsByGame, getFullInstructions,
  createInstructionVersion, deleteInstructionVersion,
  createInstructionSection, updateInstructionSection, deleteInstructionSection,
  getInstructionLines, setInstructionLines,
} from "../db/index.js";

export const instructionsRouter = Router();

// Get all versions for a game
instructionsRouter.get("/game/:gameId", (req: Request, res: Response) => {
  res.json(getInstructionVersionsByGame(parseInt(req.params.gameId)));
});

// Get full instruction content (version + sections + lines)
instructionsRouter.get("/:id", (req: Request, res: Response) => {
  const data = getFullInstructions(parseInt(req.params.id));
  if (!data) { res.status(404).json({ error: "Instruction version not found" }); return; }
  res.json(data);
});

// Create a new version
instructionsRouter.post("/", (req: Request, res: Response) => {
  const { game_id, version_name, notes, created_by } = req.body as {
    game_id: number; version_name: string; notes?: string; created_by?: string;
  };
  if (!game_id || !version_name?.trim()) {
    res.status(400).json({ error: "game_id and version_name required" });
    return;
  }
  try {
    const id = createInstructionVersion(game_id, version_name.trim(), notes, created_by);
    res.status(201).json({ id, game_id, version_name: version_name.trim() });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Version name already exists for this game" });
    } else {
      throw e;
    }
  }
});

// Delete a version
instructionsRouter.delete("/:id", (req: Request, res: Response) => {
  deleteInstructionVersion(parseInt(req.params.id));
  res.status(204).send();
});

// ── Sections ──────────────────────────────────────────────────────────────────

// Add section to a version
instructionsRouter.post("/:versionId/sections", (req: Request, res: Response) => {
  const { section_number, title } = req.body as { section_number: number; title: string };
  if (!section_number || !title?.trim()) {
    res.status(400).json({ error: "section_number and title required" });
    return;
  }
  try {
    const id = createInstructionSection(parseInt(req.params.versionId), section_number, title.trim());
    res.status(201).json({ id, version_id: parseInt(req.params.versionId), section_number, title: title.trim() });
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Section number already exists" });
    } else {
      throw e;
    }
  }
});

// Update section
instructionsRouter.patch("/sections/:sectionId", (req: Request, res: Response) => {
  const { section_number, title } = req.body as { section_number?: number; title?: string };
  updateInstructionSection(parseInt(req.params.sectionId), { section_number, title });
  res.json({ ok: true });
});

// Delete section
instructionsRouter.delete("/sections/:sectionId", (req: Request, res: Response) => {
  deleteInstructionSection(parseInt(req.params.sectionId));
  res.status(204).send();
});

// ── Lines ─────────────────────────────────────────────────────────────────────

// Get lines for a section
instructionsRouter.get("/sections/:sectionId/lines", (req: Request, res: Response) => {
  res.json(getInstructionLines(parseInt(req.params.sectionId)));
});

// Set all lines for a section (replaces existing)
instructionsRouter.put("/sections/:sectionId/lines", (req: Request, res: Response) => {
  const { lines } = req.body as { lines: { line_number: number; content: string }[] };
  if (!lines?.length) {
    res.status(400).json({ error: "lines array required" });
    return;
  }
  setInstructionLines(parseInt(req.params.sectionId), lines);
  res.json(getInstructionLines(parseInt(req.params.sectionId)));
});
