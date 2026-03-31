export interface Player {
  id: number;
  name: string;
  is_active: number;
  created_at: number;
}

export interface Game {
  id: number;
  name: string;
  created_at: number;
}

export interface Board {
  id: number;
  game_id: number;
  name: string;
  created_at: number;
}

export interface MatchResult {
  id: number;
  match_id: number;
  player_id: number;
  player_name: string;
  position: number;
}

export interface Match {
  id: number;
  game_id: number;
  game_name: string;
  board_id: number | null;
  board_name: string | null;
  date: string | null;
  player_count: number;
  notes: string | null;
  instruction_version_id: number | null;
  instruction_version_name: string | null;
  created_at: number;
  results?: MatchResult[];
}

export interface AverageRankEntry {
  game_id: number;
  game_name: string;
  player_id: number;
  player_name: string;
  match_count: number;
  avg_position: number;
}

export interface WinOddsEntry {
  game_id: number;
  game_name: string;
  player_id: number;
  player_name: string;
  match_count: number;
  win_odds: number;
}

export interface HeadToHeadMatch {
  match_id: number;
  date: string | null;
  game_name: string;
  player1_position: number;
  player2_position: number;
}

export interface HeadToHeadResult {
  matches: HeadToHeadMatch[];
  summary: {
    player1_wins: number;
    player2_wins: number;
    ties: number;
    total: number;
  };
}

export interface MonopolyTournamentMatch {
  id: number;
  date: string | null;
  jeffrey_pos: number;
  robert_pos: number;
  bobby_pos: number;
  jeffrey_cumulative: number;
  robert_cumulative: number;
  bobby_cumulative: number;
  jeffrey_vs_robert: number;
  jeffrey_vs_bobby: number;
  robert_vs_bobby: number;
}

export interface MonopolyTournament {
  matches: MonopolyTournamentMatch[];
  total_games: number;
  wins: { jeffrey: number; robert: number; bobby: number };
  yearly: Record<string, { jeffrey: number; robert: number; bobby: number; count: number }>;
  cumulative: { jeffrey: number; robert: number; bobby: number };
}

export interface PlayerStat {
  player_id: number;
  player_name: string;
  total_matches: number;
  wins: number;
  overall_avg_position: number;
}

export interface TrendPoint {
  date: string | null;
  game_name: string;
  position: number;
  player_count: number;
  running_avg: number;
}

export interface InstructionVersion {
  id: number;
  game_id: number;
  version_name: string;
  notes: string | null;
  created_at: number;
  created_by: string | null;
}

export interface InstructionLine {
  id: number;
  section_id: number;
  line_number: number;
  content: string;
}

export interface InstructionSection {
  id: number;
  version_id: number;
  section_number: number;
  title: string;
  lines: InstructionLine[];
}

export interface FullInstructions extends InstructionVersion {
  sections: InstructionSection[];
}

export interface AuthUser {
  username: string;
  is_admin: boolean;
  is_approved: boolean;
}
