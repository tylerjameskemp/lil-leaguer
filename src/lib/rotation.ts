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
export type RotationStyle = "standard" | "twoInningBlocks";
export type RotationOptions = {
  style?: RotationStyle;
  pitcherOrder?: string[];
  variant?: number;
};

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

export function generateBattingOrder(
  players: Player[],
  seasonStats: SeasonStats = {},
  variant = 0,
) {
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
        seededJitter(player.id, variant) * 8;

      return {
        player,
        score,
        bottomThirdStart,
      };
    })
    .sort((a, b) => b.score - a.score || a.player.name.localeCompare(b.player.name))
    .map(({ player }) => player.id);
}

export function generateAssignments(
  players: Player[],
  seasonStats: SeasonStats = {},
  styleOrOptions: RotationStyle | RotationOptions = "standard",
): Assignment[] {
  const options =
    typeof styleOrOptions === "string"
      ? { style: styleOrOptions }
      : styleOrOptions;
  const style = options.style ?? "standard";

  if (style === "twoInningBlocks") {
    return generateTwoInningAssignments(players, seasonStats, options);
  }

  return generateStandardAssignments(players, seasonStats, options);
}

function generateStandardAssignments(
  players: Player[],
  seasonStats: SeasonStats = {},
  options: RotationOptions = {},
): Assignment[] {
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
  let previousBenchIds = new Set<string>();

  for (let inning = 1; inning <= AAA_RULES.innings; inning += 1) {
    const notes: string[] = [];
    const remainingInnings = AAA_RULES.innings - inning + 1;
    const mustField = presentPlayers.filter((player) => {
      const fields = fieldCounts.get(player.id) ?? 0;
      return fields + remainingInnings <= AAA_RULES.minDefensiveInnings;
    });
    const plannedPitcher = plannedPitcherForInning(presentPlayers, inning, options.pitcherOrder);
    const lockedFielders = plannedPitcher
      ? [...mustField, plannedPitcher].filter(
          (player, index, pool) => pool.findIndex((candidate) => candidate.id === player.id) === index,
        )
      : mustField;

    const bench = chooseBenchPlayers(
      presentPlayers,
      lockedFielders,
      benchSlots,
      previousBenchIds,
      fieldCounts,
      benchCounts,
      seasonStats,
      options.variant ?? 0,
      inning,
    );
    previousBenchIds = new Set(bench.map((player) => player.id));

    bench.forEach((player) => {
      benchCounts.set(player.id, (benchCounts.get(player.id) ?? 0) + 1);
    });

    const available = presentPlayers.filter(
      (player) => !bench.some((benched) => benched.id === player.id),
    );

    const positions = {} as Record<Position, Player>;
    const pool = [...available];
    const rotatedPositions = [
      ...POSITIONS.slice((inning + (options.variant ?? 0) - 1) % POSITIONS.length),
      ...POSITIONS.slice(0, (inning + (options.variant ?? 0) - 1) % POSITIONS.length),
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
            options.variant ?? 0,
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
    const assignment = { inning, positions, bench, notes };
    if (plannedPitcher) {
      forcePitcher(assignment, plannedPitcher);
      notes.push(`${plannedPitcher.name} kept as planned pitcher for inning ${inning}.`);
    }

    assignments.push(assignment);
  }

  assignments.push({
    inning: 0,
    positions: {} as Record<Position, Player>,
    bench: [],
    notes: complianceNotesFromAssignments(presentPlayers, assignments),
  });

  return assignments;
}

function chooseBenchPlayers(
  players: Player[],
  mustField: Player[],
  benchSlots: number,
  previousBenchIds: Set<string>,
  fieldCounts: Map<string, number>,
  benchCounts: Map<string, number>,
  seasonStats: SeasonStats,
  variant: number,
  inning: number,
) {
  if (benchSlots === 0) return [];

  const mustFieldIds = new Set(mustField.map((player) => player.id));
  const candidates = players.filter((player) => !mustFieldIds.has(player.id));
  const preferred = sortBenchCandidates(
    candidates.filter((player) => !previousBenchIds.has(player.id)),
    fieldCounts,
    benchCounts,
    seasonStats,
    variant,
    inning,
  );
  const fallback = sortBenchCandidates(
    candidates.filter((player) => previousBenchIds.has(player.id)),
    fieldCounts,
    benchCounts,
    seasonStats,
    variant,
    inning,
  );

  return [...preferred, ...fallback].slice(0, benchSlots);
}

function sortBenchCandidates(
  players: Player[],
  fieldCounts: Map<string, number>,
  benchCounts: Map<string, number>,
  seasonStats: SeasonStats,
  variant: number,
  inning: number,
) {
  return [...players].sort((a, b) => {
    const seasonBenchDelta =
      (seasonStats[a.id]?.benchInnings ?? 0) - (seasonStats[b.id]?.benchInnings ?? 0);
    if (seasonBenchDelta !== 0) return seasonBenchDelta;
    const benchDelta = (benchCounts.get(a.id) ?? 0) - (benchCounts.get(b.id) ?? 0);
    if (benchDelta !== 0) return benchDelta;
    const fieldDelta = (fieldCounts.get(b.id) ?? 0) - (fieldCounts.get(a.id) ?? 0);
    if (fieldDelta !== 0) return fieldDelta;
    const variantDelta = seededJitter(a.id, variant + inning) - seededJitter(b.id, variant + inning);
    if (variantDelta !== 0) return variantDelta;
    return a.name.localeCompare(b.name);
  });
}

function generateTwoInningAssignments(
  players: Player[],
  seasonStats: SeasonStats = {},
  options: RotationOptions = {},
) {
  const assignments = generateStandardAssignments(players, seasonStats, options);
  const innings = assignments.filter((assignment) => assignment.inning > 0);
  const usedPitcherIds = new Set<string>();
  const presentPlayers = players.filter((player) => player.present);

  for (let index = 0; index < innings.length; index += 2) {
    const first = innings[index];
    const second = innings[index + 1];
    let firstPitcher = first?.positions.P;
    const lockedFirstPitcher = plannedPitcherForInning(presentPlayers, first?.inning ?? 0, options.pitcherOrder);
    if (first && lockedFirstPitcher) {
      forcePitcher(first, lockedFirstPitcher);
      firstPitcher = lockedFirstPitcher;
    } else if (first && firstPitcher && usedPitcherIds.has(firstPitcher.id)) {
      const firstFielders = POSITIONS.map((position) => first.positions[position]).filter(Boolean);
      const replacementPitcher = chooseBlockPitcher(firstFielders, usedPitcherIds, firstPitcher.id);
      if (replacementPitcher && replacementPitcher.id !== firstPitcher.id) {
        swapPitcher(first.positions, replacementPitcher, firstPitcher);
        firstPitcher = replacementPitcher;
      }
    }
    if (firstPitcher) usedPitcherIds.add(firstPitcher.id);
    if (!first || !second) continue;

    const secondPositions = buildStableSecondInningPositions(first, second);
    const secondBench = [...second.bench];
    const oldPitcher = secondPositions.P;
    const fielders = POSITIONS.map((position) => secondPositions[position]).filter(Boolean);
    const lockedSecondPitcher = plannedPitcherForInning(presentPlayers, second.inning, options.pitcherOrder);
    const nextPitcher =
      lockedSecondPitcher ?? chooseBlockPitcher(fielders, usedPitcherIds, oldPitcher?.id);

    if (oldPitcher && nextPitcher && nextPitcher.id !== oldPitcher.id) {
      swapPitcher(secondPositions, nextPitcher, oldPitcher);
    }
    if (nextPitcher) usedPitcherIds.add(nextPitcher.id);

    innings[index + 1] = {
      ...second,
      positions: secondPositions,
      bench: secondBench,
      notes: [
        "Two-inning block: returning fielders stay put where bench fairness allows.",
        ...second.notes,
      ],
    };
  }

  return [
    ...innings,
    {
      inning: 0,
      positions: {} as Record<Position, Player>,
      bench: [],
      notes: complianceNotesFromAssignments(players.filter((player) => player.present), innings),
    },
  ];
}

function plannedPitcherForInning(players: Player[], inning: number, pitcherOrder?: string[]) {
  const playerId = pitcherOrder?.[inning - 1];
  if (!playerId) return undefined;
  return players.find((player) => player.id === playerId && player.present);
}

function forcePitcher(assignment: Assignment, pitcher: Player) {
  assignment.bench = assignment.bench.filter((player) => player.id !== pitcher.id);
  const currentPitcher = assignment.positions.P;
  const existingPosition = POSITIONS.find(
    (position) => assignment.positions[position]?.id === pitcher.id,
  );

  if (existingPosition && existingPosition !== "P" && currentPitcher) {
    assignment.positions[existingPosition] = currentPitcher;
  }
  if (!existingPosition && currentPitcher && currentPitcher.id !== pitcher.id) {
    assignment.bench = [...assignment.bench, currentPitcher].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }
  assignment.positions.P = pitcher;
}

function buildStableSecondInningPositions(first: Assignment, second: Assignment) {
  const benchIds = new Set(second.bench.map((player) => player.id));
  const positions: Partial<Record<Position, Player>> = {};
  const usedIds = new Set<string>();

  POSITIONS.forEach((position) => {
    const player = first.positions[position];
    if (!player || benchIds.has(player.id) || usedIds.has(player.id)) return;
    positions[position] = player;
    usedIds.add(player.id);
  });

  POSITIONS.forEach((position) => {
    if (positions[position]) return;
    const player = second.positions[position];
    if (!player || benchIds.has(player.id) || usedIds.has(player.id)) return;
    positions[position] = player;
    usedIds.add(player.id);
  });

  const available = [
    ...Object.values(first.positions),
    ...Object.values(second.positions),
  ].filter((player, index, pool) => {
    if (!player || benchIds.has(player.id) || usedIds.has(player.id)) return false;
    return pool.findIndex((candidate) => candidate?.id === player.id) === index;
  });

  POSITIONS.forEach((position) => {
    if (positions[position]) return;
    const player = available.shift();
    if (!player) return;
    positions[position] = player;
    usedIds.add(player.id);
  });

  return positions as Record<Position, Player>;
}

function swapPitcher(
  positions: Partial<Record<Position, Player>>,
  nextPitcher: Player,
  oldPitcher: Player,
) {
  const nextPitcherPosition = POSITIONS.find(
    (position) => positions[position]?.id === nextPitcher.id,
  );
  if (nextPitcherPosition) {
    positions[nextPitcherPosition] = oldPitcher;
  }
  positions.P = nextPitcher;
}

function chooseBlockPitcher(
  fielders: Player[],
  usedPitcherIds: Set<string>,
  currentPitcherId?: string,
) {
  const notCurrent = fielders.filter((player) => player.id !== currentPitcherId);
  return (
    notCurrent.find((player) => player.wants.includes("P") && !usedPitcherIds.has(player.id)) ??
    notCurrent.find((player) => !usedPitcherIds.has(player.id)) ??
    notCurrent.find((player) => player.wants.includes("P")) ??
    fielders.find((player) => player.id === currentPitcherId) ??
    fielders[0]
  );
}

function complianceNotesFromAssignments(players: Player[], assignments: Assignment[]) {
  const fieldCounts = new Map(players.map((player) => [player.id, 0]));
  const benchCounts = new Map(players.map((player) => [player.id, 0]));

  assignments.forEach((assignment) => {
    Object.values(assignment.positions).forEach((player) => {
      fieldCounts.set(player.id, (fieldCounts.get(player.id) ?? 0) + 1);
    });
    assignment.bench.forEach((player) => {
      benchCounts.set(player.id, (benchCounts.get(player.id) ?? 0) + 1);
    });
  });

  return complianceNotes(players, fieldCounts, benchCounts);
}

function scorePlayer(
  player: Player,
  position: Position,
  inning: number,
  fieldCounts: Map<string, number>,
  positionCounts: Map<string, number>,
  seasonStats: SeasonStats,
  variant: number,
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
  score += seededJitter(`${player.id}:${position}`, variant + inning) * 8;
  return score;
}

function seededJitter(value: string, variant: number) {
  let hash = 2166136261 + variant * 16777619;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
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
