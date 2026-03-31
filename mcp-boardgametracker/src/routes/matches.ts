import { Router, Request, Response } from "express";
import {
  getMatches, getMatchById, createMatch, updateMatch, deleteMatch,
  getMatchResults, setMatchResults, getMatchCount,
} from "../db/index.js";

export const matchesRouter = Router();

matchesRouter.get("/", (req: Request, res: Response) => {
  const game_id = req.query.game_id ? parseInt(req.query.game_id as string) : undefined;
  const player_id = req.query.player_id ? parseInt(req.query.player_id as string) : undefined;
  const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
  const offset = req.query.offset ? parseInt(req.query.offset as string) : undefined;
  res.json(getMatches({ game_id, player_id, limit, offset }));
});

matchesRouter.get("/count", (_req: Request, res: Response) => {
  res.json({ count: getMatchCount() });
});

matchesRouter.get("/:id", (req: Request, res: Response) => {
  const match = getMatchById(parseInt(req.params.id));
  if (!match) { res.status(404).json({ error: "Match not found" }); return; }
  const results = getMatchResults(match.id);
  res.json({ ...match, results });
});

matchesRouter.post("/", (req: Request, res: Response) => {
  const { game_id, board_id, date, player_count, notes, instruction_version_id, results } = req.body as {
    game_id: number;
    board_id?: number | null;
    date?: string | null;
    player_count: number;
    notes?: string | null;
    instruction_version_id?: number | null;
    results: { player_id: number; position: number }[];
  };
  if (!game_id || !player_count || !results?.length) {
    res.status(400).json({ error: "game_id, player_count, and results are required" });
    return;
  }
  const matchId = createMatch({ game_id, board_id, date, player_count, notes, instruction_version_id });
  setMatchResults(matchId, results);
  const match = getMatchById(matchId);
  const matchResults = getMatchResults(matchId);
  res.status(201).json({ ...match, results: matchResults });
});

matchesRouter.patch("/:id", (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  const { game_id, board_id, date, player_count, notes, instruction_version_id, results } = req.body as {
    game_id?: number;
    board_id?: number | null;
    date?: string | null;
    player_count?: number;
    notes?: string | null;
    instruction_version_id?: number | null;
    results?: { player_id: number; position: number }[];
  };
  updateMatch(id, { game_id, board_id, date, player_count, notes, instruction_version_id });
  if (results) {
    setMatchResults(id, results);
  }
  const match = getMatchById(id);
  const matchResults = getMatchResults(id);
  res.json({ ...match, results: matchResults });
});

matchesRouter.delete("/:id", (req: Request, res: Response) => {
  deleteMatch(parseInt(req.params.id));
  res.status(204).send();
});
