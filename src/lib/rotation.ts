export type Position =
  | "P"
  | "C"
  | "1B"
  | "2B"
  | "3B"
  | "SS"
  | "LF"
  | "CF"
  | "RF";

export type Player = {
  id: string;
  name: string;
  age: number;
  present: boolean;
  wants: Position[];
  avoid: Position[];
  lastPitched?: string;
  lastPitchCount?: number;
};

export type Assignment = {
  inning: number;
  positions: Record<Position, Player>;
  bench: Player[];
  notes: string[];
};

export type PlayerSeasonStats = {
  fieldInnings: number;
  benchInnings: number;
  pitches: number;
  games: number;
  battingGames?: number;
  battingOrderTotal?: number;
  leadoffGames?: number;
  bottomThirdGames?: number;
  positions: Partial<Record<Position, number>>;
};

export type SeasonStats = Record<string, PlayerSeasonStats>;

export const POSITIONS: Position[] = [
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "LF",
  "CF",
  "RF",
];

export const DEFAULT_PLAYERS: Player[] = [
  "Cameron",
  "George",
  "Kamari",
  "Kordell",
  "Felix",
  "Isaac",
  "Benjamin",
  "Chance",
  "Lincoln",
  "Sonny",
  "Finn",
  "Finley",
  "Coen",
].map((name, index) => ({
  id: `p${index + 1}`,
  name,
  age: 9,
  present: true,
  wants: [],
  avoid: [],
}));

export const AAA_RULES = {
  innings: 6,
  gameMinutes: 90,
  noNewInningAfterMinutes: 75,
  minDefensiveInnings: 3,
  maxRunsPerInning: 5,
  stealPlaysPerInning: 1,
  pitcherToCatcherLockout: 41,
  catcherToPitcherLockoutInnings: 4,
  dailyPitchLimits: [
    { ages: "7-8", max: 50 },
    { ages: "9-10", max: 75 },
    { ages: "11-12", max: 85 },
  ],
  restDays: [
    { range: "1-20", days: 0 },
    { range: "21-35", days: 1 },
    { range: "36-50", days: 2 },
    { range: "51-65", days: 3 },
    { range: "66+", days: 4 },
  ],
};

export function pitchLimitForAge(age: number) {
  if (age <= 8) return 50;
  if (age <= 10) return 75;
  return 85;
}

export function restDaysForPitches(pitches: number) {
  if (pitches <= 20) return 0;
  if (pitches <= 35) return 1;
  if (pitches <= 50) return 2;
  if (pitches <= 65) return 3;
  return 4;
}

export function generateBattingOrder(players: Player[], seasonStats: SeasonStats = {}) {
  const presentPlayers = players.filter((player) => player.present);
  const lineupSize = presentPlayers.length || 1;
  const bottomThirdStart = Math.floor((lineupSize * 2) / 3) + 1;

  return [...presentPlayers]
    .map((player) => {
      const stats = seasonStats[player.id];
      const battingGames = stats?.battingGames ?? 0;
      const averageSlot = battingGames
        ? (stats?.battingOrderTotal ?? 0) / battingGames
        : lineupSize + 1;
      const bottomThirdGames = stats?.bottomThirdGames ?? 0;
      const leadoffGames = stats?.leadoffGames ?? 0;
      const score =
        averageSlot * 10 +
        bottomThirdGames * 14 -
        leadoffGames * 18 +
        ((player.name.charCodeAt(0) + player.id.length) % 7) / 10;

      return {
        player,
        score,
        bottomThirdStart,
      };
    })
    .sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name))
    .map(({ player }) => player.id);
}

export function generateAssignments(players: Player[], seasonStats: SeasonStats = {}): Assignment[] {
  const presentPlayers = players.filter((player) => player.present);
  const defensiveSlots = Math.min(POSITIONS.length, presentPlayers.length);
  const benchSlots = Math.max(0, presentPlayers.length - defensiveSlots);
  const fieldCounts = new Map(presentPlayers.map((player) => [player.id, 0]));
  const benchCounts = new Map(presentPlayers.map((player) => [player.id, 0]));
  const positionCounts = new Map<string, number>(
    presentPlayers.flatMap((player) =>
      POSITIONS.map((position) => [`${player.id}:${position}`, 0] as const),
    ),
  );

  const assignments: Assignment[] = [];

  for (let inning = 1; inning <= AAA_RULES.innings; inning += 1) {
    const notes: string[] = [];
    const remainingInnings = AAA_RULES.innings - inning + 1;
    const mustField = presentPlayers.filter((player) => {
      const fields = fieldCounts.get(player.id) ?? 0;
      return fields + remainingInnings <= AAA_RULES.minDefensiveInnings;
    });

    const bench = presentPlayers
      .filter((player) => !mustField.some((locked) => locked.id === player.id))
      .sort((a, b) => {
        const seasonBenchDelta =
          (seasonStats[a.id]?.benchInnings ?? 0) - (seasonStats[b.id]?.benchInnings ?? 0);
        if (seasonBenchDelta !== 0) return seasonBenchDelta;
        const benchDelta = (benchCounts.get(a.id) ?? 0) - (benchCounts.get(b.id) ?? 0);
        if (benchDelta !== 0) return benchDelta;
        const fieldDelta = (fieldCounts.get(b.id) ?? 0) - (fieldCounts.get(a.id) ?? 0);
        if (fieldDelta !== 0) return fieldDelta;
        return a.name.localeCompare(b.name);
      })
      .slice(0, benchSlots);

    bench.forEach((player) => {
      benchCounts.set(player.id, (benchCounts.get(player.id) ?? 0) + 1);
    });

    const available = presentPlayers.filter(
      (player) => !bench.some((benched) => benched.id === player.id),
    );

    const positions = {} as Record<Position, Player>;
    const pool = [...available];
    const rotatedPositions = [
      ...POSITIONS.slice((inning - 1) % POSITIONS.length),
      ...POSITIONS.slice(0, (inning - 1) % POSITIONS.length),
    ];

    rotatedPositions.slice(0, defensiveSlots).forEach((position) => {
      const bestIndex = pool
        .map((player, index) => ({
          player,
          index,
          score: scorePlayer(
            player,
            position,
            inning,
            fieldCounts,
            positionCounts,
            seasonStats,
          ),
        }))
        .sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name))[0]?.index;

      if (bestIndex === undefined) return;
      const [player] = pool.splice(bestIndex, 1);
      positions[position] = player;
      fieldCounts.set(player.id, (fieldCounts.get(player.id) ?? 0) + 1);
      positionCounts.set(
        `${player.id}:${position}`,
        (positionCounts.get(`${player.id}:${position}`) ?? 0) + 1,
      );
    });

    if (presentPlayers.length < POSITIONS.length) {
      notes.push(`Only ${presentPlayers.length} players present; empty defensive spots remain.`);
    }

    assignments.push({ inning, positions, bench, notes });
  }

  assignments.push({
    inning: 0,
    positions: {} as Record<Position, Player>,
    bench: [],
    notes: complianceNotes(presentPlayers, fieldCounts, benchCounts),
  });

  return assignments;
}

function scorePlayer(
  player: Player,
  position: Position,
  inning: number,
  fieldCounts: Map<string, number>,
  positionCounts: Map<string, number>,
  seasonStats: SeasonStats,
) {
  let score = 100;
  const season = seasonStats[player.id];
  score -= (fieldCounts.get(player.id) ?? 0) * 8;
  score -= (positionCounts.get(`${player.id}:${position}`) ?? 0) * 30;
  score -= (season?.positions[position] ?? 0) * 3;
  score += (season?.benchInnings ?? 0) * 1.5;
  score -= (season?.fieldInnings ?? 0) * 0.4;
  score += player.wants.includes(position) ? 25 : 0;
  score -= player.avoid.includes(position) ? 40 : 0;
  score += ((player.id.charCodeAt(player.id.length - 1) + inning) % 7) / 10;
  return score;
}

function complianceNotes(
  players: Player[],
  fieldCounts: Map<string, number>,
  benchCounts: Map<string, number>,
) {
  if (players.length === 0) return ["Add or mark players present to generate a legal lineup."];

  const notes: string[] = [];
  players.forEach((player) => {
    const fields = fieldCounts.get(player.id) ?? 0;
    const benches = benchCounts.get(player.id) ?? 0;
    if (fields < AAA_RULES.minDefensiveInnings) {
      notes.push(`${player.name} has ${fields} fielding innings; AAA minimum is 3 full innings.`);
    }
    if (benches > AAA_RULES.innings - AAA_RULES.minDefensiveInnings) {
      notes.push(`${player.name} sits ${benches} innings; check minimum defensive innings.`);
    }
  });

  return notes.length ? notes : ["Rotation satisfies the 3 full defensive innings minimum."];
}
