import { Router, Request, Response } from "express";
import { getAllPlayers, createPlayer, deletePlayer } from "../db/index.js";

export const playersRouter = Router();

playersRouter.get("/", (_req: Request, res: Response) => {
  res.json(getAllPlayers());
});

playersRouter.post("/", (req: Request, res: Response) => {
  const { name } = req.body as { name?: string };
  if (!name?.trim()) {
    res.status(400).json({ error: "Name is required" });
    return;
  }
  try {
    const player = createPlayer(name.trim());
    res.status(201).json(player);
  } catch (e: unknown) {
    if (e instanceof Error && e.message.includes("UNIQUE")) {
      res.status(409).json({ error: "Player already exists" });
    } else {
      throw e;
    }
  }
});

playersRouter.delete("/:id", (req: Request, res: Response) => {
  deletePlayer(parseInt(req.params.id));
  res.status(204).send();
});
