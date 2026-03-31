import { Router, Request, Response } from "express";
import {
  getAverageRankByGame, getWinOddsByGame, getHeadToHead,
  getMonopolyTournament, getOverallTrend, getPlayerStats,
} from "../db/index.js";

export const analyticsRouter = Router();

// Average rank per player per game
analyticsRouter.get("/average-rank", (_req: Request, res: Response) => {
  res.json(getAverageRankByGame());
});

// Win odds per player per game
analyticsRouter.get("/odds", (_req: Request, res: Response) => {
  res.json(getWinOddsByGame());
});

// Head-to-head comparison
analyticsRouter.get("/head-to-head", (req: Request, res: Response) => {
  const p1 = parseInt(req.query.player1 as string);
  const p2 = parseInt(req.query.player2 as string);
  if (!p1 || !p2) {
    res.status(400).json({ error: "player1 and player2 query params required" });
    return;
  }
  const matches = getHeadToHead(p1, p2);
  // Compute summary
  let p1Wins = 0, p2Wins = 0, ties = 0;
  for (const m of matches) {
    if (m.player1_position < m.player2_position) p1Wins++;
    else if (m.player2_position < m.player1_position) p2Wins++;
    else ties++;
  }
  res.json({ matches, summary: { player1_wins: p1Wins, player2_wins: p2Wins, ties, total: matches.length } });
});

// Monopoly tournament tracker
analyticsRouter.get("/monopoly-tournament", (_req: Request, res: Response) => {
  const matches = getMonopolyTournament();

  // Compute running totals and differentials
  let jeffreyTotal = 0, robertTotal = 0, bobbyTotal = 0;
  const enriched = matches.map(m => {
    // Points: lower position is better. Track cumulative positions.
    jeffreyTotal += m.jeffrey_pos;
    robertTotal += m.robert_pos;
    bobbyTotal += m.bobby_pos;
    return {
      ...m,
      jeffrey_cumulative: jeffreyTotal,
      robert_cumulative: robertTotal,
      bobby_cumulative: bobbyTotal,
      jeffrey_vs_robert: jeffreyTotal - robertTotal,
      jeffrey_vs_bobby: jeffreyTotal - bobbyTotal,
      robert_vs_bobby: robertTotal - bobbyTotal,
    };
  });

  // Yearly breakdown
  const byYear: Record<string, { jeffrey: number; robert: number; bobby: number; count: number }> = {};
  for (const m of matches) {
    const year = m.date ? m.date.slice(0, 4) : "Unknown";
    if (!byYear[year]) byYear[year] = { jeffrey: 0, robert: 0, bobby: 0, count: 0 };
    byYear[year].jeffrey += m.jeffrey_pos;
    byYear[year].robert += m.robert_pos;
    byYear[year].bobby += m.bobby_pos;
    byYear[year].count++;
  }

  // Win counts
  let jeffreyWins = 0, robertWins = 0, bobbyWins = 0;
  for (const m of matches) {
    if (m.jeffrey_pos === 1) jeffreyWins++;
    if (m.robert_pos === 1) robertWins++;
    if (m.bobby_pos === 1) bobbyWins++;
  }

  res.json({
    matches: enriched,
    total_games: matches.length,
    wins: { jeffrey: jeffreyWins, robert: robertWins, bobby: bobbyWins },
    yearly: byYear,
    cumulative: {
      jeffrey: jeffreyTotal,
      robert: robertTotal,
      bobby: bobbyTotal,
    },
  });
});

// Overall trend for a player
analyticsRouter.get("/trend/:playerId", (req: Request, res: Response) => {
  const playerId = parseInt(req.params.playerId);
  const data = getOverallTrend(playerId);
  // Compute running average
  let sum = 0;
  const trend = data.map((d, i) => {
    sum += d.position;
    return { ...d, running_avg: Math.round((sum / (i + 1)) * 1000) / 1000 };
  });
  res.json(trend);
});

// Player leaderboard / overall stats
analyticsRouter.get("/leaderboard", (_req: Request, res: Response) => {
  res.json(getPlayerStats());
});
