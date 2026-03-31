import { Router, Request, Response } from "express";
import {
  getAllGames, createGame, deleteGame,
  getBoardsByGame, createBoard, deleteBoard,
} from "../db/index.js";

export const gamesRouter = Router();

gamesRouter.get("/", (_req: Request, res: Response) => {
  res.json(getAllGames());
});

gamesRouter.post("/", (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  try {
    const game = createGame(name.trim());
    res.status(201).json(game);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Game already exists" });
    } else {
      throw e;
    }
  }
});

gamesRouter.delete("/:id", (req: Request, res: Response) => {
  deleteGame(parseInt(req.params.id));
  res.status(204).send();
});

// ── Boards ────────────────────────────────────────────────────────────────────

gamesRouter.get("/:id/boards", (req: Request, res: Response) => {
  res.json(getBoardsByGame(parseInt(req.params.id)));
});

gamesRouter.post("/:id/boards", (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Board name is required" });
    return;
  }
  try {
    const board = createBoard(parseInt(req.params.id), name.trim());
    res.status(201).json(board);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Board already exists for this game" });
    } else {
      throw e;
    }
  }
});

gamesRouter.delete("/:gameId/boards/:boardId", (req: Request, res: Response) => {
  deleteBoard(parseInt(req.params.boardId));
  res.status(204).send();
});
