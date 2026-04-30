import type { Assignment, Player, SeasonStats } from "@/lib/rotation";

export type PitchLog = Record<string, number>;

export type GameRecord = {
  id: string;
  date: string;
  inningsPlayed: number;
  playerCount: number;
  stats: SeasonStats;
};

export type SharedGameState = {
  players: Player[];
  pitchLog: PitchLog;
  pitchQueue: string[];
  seasonStats: SeasonStats;
  gameHistory: GameRecord[];
  gamePlan: Assignment[];
  inningsPlayed: number;
};

export type TeamSession = {
  teamId: string;
  gameId: string;
  teamName: string;
  shareCode: string;
  version: number;
};

