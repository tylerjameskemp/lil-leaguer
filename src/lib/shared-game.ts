import type { Assignment, Player, SeasonStats } from "@/lib/rotation";

export type PitchLog = Record<string, number>;

export type PitchTrackerSnapshot = {
  pitcherId?: string;
  balls: number;
  strikes: number;
  outs: number;
  coachPitch: boolean;
  notice?: string;
  pitchLog: PitchLog;
};

export type PitchTracker = {
  pitcherId?: string;
  balls: number;
  strikes: number;
  outs: number;
  coachPitch: boolean;
  notice?: string;
  history: PitchTrackerSnapshot[];
};

export type GameRecord = {
  id: string;
  date: string;
  title?: string;
  scheduleEventId?: string;
  inningsPlayed: number;
  playerCount: number;
  stats: SeasonStats;
};

export type SeasonEvent = {
  id: string;
  type: "game" | "practice";
  title: string;
  start: string;
  end: string;
  field: string;
  location: string;
  opponent?: string;
  homeAway?: "home" | "away";
};

export type SharedGameState = {
  players: Player[];
  pitchLog: PitchLog;
  pitchTracker: PitchTracker;
  pitchQueue: string[];
  battingOrder: string[];
  seasonSchedule: SeasonEvent[];
  activeEventId?: string;
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
