"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AAA_RULES,
  DEFAULT_PLAYERS,
  POSITIONS,
  generateAssignments,
  pitchLimitForAge,
  restDaysForPitches,
  type Assignment,
  type Player,
  type PlayerSeasonStats,
  type Position,
  type SeasonStats,
} from "@/lib/rotation";

type PitchLog = Record<string, number>;
type Tab = "game" | "setup" | "pitch" | "season";
type GameRecord = {
  id: string;
  date: string;
  inningsPlayed: number;
  playerCount: number;
  stats: SeasonStats;
};
type StoredState = {
  players?: Player[];
  pitchLog?: PitchLog;
  seasonStats?: SeasonStats;
  gameHistory?: GameRecord[];
  gamePlan?: Assignment[];
  inningsPlayed?: number;
};

const STORAGE_KEY = "lil-leaguer-state-v2";

export default function Home() {
  const stored = readStoredState();
  const [players, setPlayers] = useState<Player[]>(() => stored.players ?? DEFAULT_PLAYERS);
  const [pitchLog, setPitchLog] = useState<PitchLog>(() => stored.pitchLog ?? {});
  const [seasonStats, setSeasonStats] = useState<SeasonStats>(() => stored.seasonStats ?? {});
  const [gameHistory, setGameHistory] = useState<GameRecord[]>(() => stored.gameHistory ?? []);
  const [gamePlan, setGamePlan] = useState<Assignment[]>(
    () => stored.gamePlan ?? generateAssignments(stored.players ?? DEFAULT_PLAYERS, stored.seasonStats ?? {}),
  );
  const [activeInning, setActiveInning] = useState(1);
  const [inningsPlayed, setInningsPlayed] = useState(() => stored.inningsPlayed ?? 4);
  const [activeTab, setActiveTab] = useState<Tab>("game");

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ players, pitchLog, seasonStats, gameHistory, gamePlan, inningsPlayed }),
    );
  }, [players, pitchLog, seasonStats, gameHistory, gamePlan, inningsPlayed]);

  const innings = gamePlan.filter((assignment) => assignment.inning > 0);
  const compliance = gamePlan.find((assignment) => assignment.inning === 0)?.notes ?? [];
  const activeAssignment = innings.find((assignment) => assignment.inning === activeInning) ?? innings[0];
  const presentPlayers = players.filter((player) => player.present);
  const presentCount = presentPlayers.length;
  const benchPerInning = Math.max(0, presentCount - POSITIONS.length);
  const visibleInnings = innings.slice(0, inningsPlayed);
  const gameSummary = useMemo(
    () => summarizeGame(players, visibleInnings, pitchLog),
    [players, visibleInnings, pitchLog],
  );

  function regeneratePlan() {
    const nextPlan = generateAssignments(players, seasonStats);
    setGamePlan(nextPlan);
    setActiveInning(1);
    setActiveTab("game");
  }

  function updatePlayer(id: string, patch: Partial<Player>) {
    setPlayers((current) =>
      current.map((player) => (player.id === id ? { ...player, ...patch } : player)),
    );
  }

  function togglePosition(id: string, field: "wants" | "avoid", position: Position) {
    setPlayers((current) =>
      current.map((player) => {
        if (player.id !== id) return player;
        const active = player[field].includes(position);
        return {
          ...player,
          [field]: active
            ? player[field].filter((item) => item !== position)
            : [...player[field], position],
        };
      }),
    );
  }

  function addPlayer() {
    const id = `p${Date.now()}`;
    setPlayers((current) => [
      ...current,
      { id, name: `Player ${current.length + 1}`, age: 9, present: true, wants: [], avoid: [] },
    ]);
  }

  function assignPosition(inning: number, position: Position, playerId: string) {
    setGamePlan((current) =>
      current.map((assignment) => {
        if (assignment.inning !== inning || assignment.inning === 0) return assignment;

        const selected = players.find((player) => player.id === playerId);
        const currentPlayer = assignment.positions[position];
        const positions = { ...assignment.positions };
        const bench = assignment.bench.filter((player) => player.id !== playerId);

        if (!selected) {
          if (currentPlayer && !bench.some((player) => player.id === currentPlayer.id)) {
            bench.push(currentPlayer);
          }
          delete positions[position];
          return { ...assignment, positions, bench };
        }

        const oldPosition = POSITIONS.find((candidate) => positions[candidate]?.id === selected.id);
        if (oldPosition) {
          if (currentPlayer) {
            positions[oldPosition] = currentPlayer;
          } else {
            delete positions[oldPosition];
          }
        } else if (currentPlayer && !bench.some((player) => player.id === currentPlayer.id)) {
          bench.push(currentPlayer);
        }

        positions[position] = selected;
        return { ...assignment, positions, bench: bench.sort((a, b) => a.name.localeCompare(b.name)) };
      }),
    );
  }

  function benchPlayer(inning: number, playerId: string) {
    setGamePlan((current) =>
      current.map((assignment) => {
        if (assignment.inning !== inning || assignment.inning === 0) return assignment;
        const player = players.find((candidate) => candidate.id === playerId);
        if (!player) return assignment;

        const positions = { ...assignment.positions };
        POSITIONS.forEach((position) => {
          if (positions[position]?.id === playerId) delete positions[position];
        });
        const bench = assignment.bench.some((candidate) => candidate.id === playerId)
          ? assignment.bench
          : [...assignment.bench, player].sort((a, b) => a.name.localeCompare(b.name));

        return { ...assignment, positions, bench };
      }),
    );
  }

  function saveGameToSeason() {
    setSeasonStats((current) => mergeSeasonStats(current, gameSummary));
    setGameHistory((current) => [
      {
        id: String(Date.now()),
        date: new Date().toLocaleDateString(),
        inningsPlayed,
        playerCount: presentCount,
        stats: gameSummary,
      },
      ...current,
    ]);
    setPitchLog({});
    setActiveTab("season");
  }

  function resetSeason() {
    setSeasonStats({});
    setGameHistory([]);
  }

  return (
    <main className="min-h-screen bg-[#f6f4ed] text-[#17211f]">
      <header className="sticky top-0 z-20 border-b border-[#d8d2c4] bg-[#fbfaf5]/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#9b3d2e]">
                Portland AAA
              </p>
              <h1 className="text-2xl font-bold tracking-normal">Lil Leaguer</h1>
            </div>
            <button
              className="h-11 rounded-md bg-[#176a5f] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f554c]"
              onClick={regeneratePlan}
            >
              Generate
            </button>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Metric label="Present" value={`${presentCount}/${players.length}`} />
            <Metric label="Bench" value={`${benchPerInning}/inn`} />
            <Metric label="Played" value={`${inningsPlayed} inn`} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 pb-24 pt-4">
        {activeTab === "game" ? (
          <GameTab
            activeAssignment={activeAssignment}
            activeInning={activeInning}
            compliance={compliance}
            innings={innings}
            inningsPlayed={inningsPlayed}
            players={players}
            setActiveInning={setActiveInning}
            setInningsPlayed={setInningsPlayed}
            onAssign={assignPosition}
            onBench={benchPlayer}
            onSave={saveGameToSeason}
          />
        ) : null}

        {activeTab === "setup" ? (
          <SetupTab
            players={players}
            onAdd={addPlayer}
            onChange={updatePlayer}
            onToggle={togglePosition}
            onGenerate={regeneratePlan}
          />
        ) : null}

        {activeTab === "pitch" ? (
          <PitchTab players={players} pitchLog={pitchLog} setPitchLog={setPitchLog} />
        ) : null}

        {activeTab === "season" ? (
          <SeasonTab
            gameHistory={gameHistory}
            players={players}
            seasonStats={seasonStats}
            currentGameStats={gameSummary}
            onReset={resetSeason}
          />
        ) : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8d2c4] bg-[#fbfaf5]/95 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-4 gap-2">
          <TabButton active={activeTab === "game"} label="Game" onClick={() => setActiveTab("game")} />
          <TabButton active={activeTab === "setup"} label="Setup" onClick={() => setActiveTab("setup")} />
          <TabButton active={activeTab === "pitch"} label="Pitch" onClick={() => setActiveTab("pitch")} />
          <TabButton active={activeTab === "season"} label="Season" onClick={() => setActiveTab("season")} />
        </div>
      </nav>
    </main>
  );
}

function GameTab({
  activeAssignment,
  activeInning,
  compliance,
  innings,
  inningsPlayed,
  players,
  setActiveInning,
  setInningsPlayed,
  onAssign,
  onBench,
  onSave,
}: {
  activeAssignment?: Assignment;
  activeInning: number;
  compliance: string[];
  innings: Assignment[];
  inningsPlayed: number;
  players: Player[];
  setActiveInning: (inning: number) => void;
  setInningsPlayed: (innings: number) => void;
  onAssign: (inning: number, position: Position, playerId: string) => void;
  onBench: (inning: number, playerId: string) => void;
  onSave: () => void;
}) {
  const presentPlayers = players.filter((player) => player.present);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Current Inning</h2>
            <p className="text-sm text-[#66716d]">Tap a player name to swap positions.</p>
          </div>
          <label className="text-right text-xs font-bold uppercase tracking-[0.1em] text-[#66716d]">
            Played
            <select
              className="mt-1 block h-10 rounded-md border border-[#d8d2c4] bg-white px-2 text-base font-semibold normal-case tracking-normal text-[#17211f]"
              value={inningsPlayed}
              onChange={(event) => setInningsPlayed(Number(event.target.value))}
            >
              {innings.map((assignment) => (
                <option key={assignment.inning} value={assignment.inning}>
                  {assignment.inning}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid grid-cols-6 gap-1.5">
          {innings.map((assignment) => (
            <button
              key={assignment.inning}
              className={`h-11 rounded-md border text-sm font-bold transition ${
                activeInning === assignment.inning
                  ? "border-[#176a5f] bg-[#176a5f] text-white"
                  : assignment.inning <= inningsPlayed
                    ? "border-[#9bc6bc] bg-[#e8f3f0] text-[#176a5f]"
                    : "border-[#d8d2c4] bg-[#fbfaf5]"
              }`}
              onClick={() => setActiveInning(assignment.inning)}
            >
              {assignment.inning}
            </button>
          ))}
        </div>
      </div>

      {activeAssignment ? (
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {POSITIONS.map((position) => {
              const player = activeAssignment.positions[position];
              return (
                <PositionRow
                  key={position}
                  playerId={player?.id ?? ""}
                  players={presentPlayers}
                  position={position}
                  requested={Boolean(player?.wants.includes(position))}
                  onChange={(playerId) => onAssign(activeInning, position, playerId)}
                />
              );
            })}
          </div>

          <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
            <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#176a5f]">
              Bench
            </h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeAssignment.bench.length ? (
                activeAssignment.bench.map((player) => (
                  <button
                    key={player.id}
                    className="min-h-10 rounded-md border border-[#d8d2c4] bg-[#fbfaf5] px-3 text-sm font-semibold"
                    onClick={() => onBench(activeInning, player.id)}
                  >
                    {player.name}
                  </button>
                ))
              ) : (
                <p className="text-sm text-[#66716d]">No bench this inning.</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <div className="rounded-lg border border-[#e6c08b] bg-[#fff8e9] p-3 text-sm leading-6">
        <p className="font-semibold">Short-game fairness</p>
        <p className="mt-1 text-[#5f5541]">
          If the game ends after 4 innings, set Played to 4 before saving. Only those innings count
          toward season field and bench totals.
        </p>
      </div>

      <div className="space-y-2">
        {compliance.map((note) => (
          <div key={note} className="rounded-md border border-[#d8d2c4] bg-white px-3 py-2 text-sm">
            {note}
          </div>
        ))}
      </div>

      <button
        className="h-12 w-full rounded-md bg-[#176a5f] px-4 text-base font-semibold text-white shadow-sm transition hover:bg-[#0f554c]"
        onClick={onSave}
      >
        Save played innings to season
      </button>
    </section>
  );
}

function PositionRow({
  playerId,
  players,
  position,
  requested,
  onChange,
}: {
  playerId: string;
  players: Player[];
  position: Position;
  requested: boolean;
  onChange: (playerId: string) => void;
}) {
  return (
    <label className="grid grid-cols-[58px_1fr] items-center gap-2 rounded-lg border border-[#d8d2c4] bg-white p-2 shadow-sm">
      <span className="flex h-12 items-center justify-center rounded-md bg-[#fbfaf5] text-sm font-bold text-[#9b3d2e]">
        {position}
      </span>
      <span>
        <select
          className="h-12 w-full rounded-md border border-[#d8d2c4] bg-white px-3 text-base font-semibold"
          value={playerId}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Open</option>
          {players.map((player) => (
            <option key={player.id} value={player.id}>
              {player.name}
            </option>
          ))}
        </select>
        {requested ? <span className="mt-1 block text-xs font-semibold text-[#176a5f]">requested</span> : null}
      </span>
    </label>
  );
}

function SetupTab({
  players,
  onAdd,
  onChange,
  onToggle,
  onGenerate,
}: {
  players: Player[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<Player>) => void;
  onToggle: (id: string, field: "wants" | "avoid", position: Position) => void;
  onGenerate: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pregame Setup</h2>
          <p className="text-sm text-[#66716d]">Mark who is here and capture position asks.</p>
        </div>
        <button
          className="h-11 rounded-md bg-[#176a5f] px-4 text-sm font-semibold text-white"
          onClick={onAdd}
        >
          Add
        </button>
      </div>

      <div className="space-y-3">
        {players.map((player) => (
          <PlayerEditor
            key={player.id}
            player={player}
            onChange={(patch) => onChange(player.id, patch)}
            onToggle={(field, position) => onToggle(player.id, field, position)}
          />
        ))}
      </div>

      <button
        className="h-12 w-full rounded-md bg-[#176a5f] px-4 text-base font-semibold text-white"
        onClick={onGenerate}
      >
        Generate rotation
      </button>
    </section>
  );
}

function PitchTab({
  players,
  pitchLog,
  setPitchLog,
}: {
  players: Player[];
  pitchLog: PitchLog;
  setPitchLog: React.Dispatch<React.SetStateAction<PitchLog>>;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pitch Count</h2>
          <p className="text-sm text-[#66716d]">Daily max, rest, and catcher lockout.</p>
        </div>
        <button
          className="h-10 rounded-md border border-[#d8d2c4] px-3 text-sm font-semibold"
          onClick={() => setPitchLog({})}
        >
          Clear
        </button>
      </div>

      <div className="space-y-2">
        {players
          .filter((player) => player.present)
          .map((player) => {
            const pitches = pitchLog[player.id] ?? 0;
            const limit = pitchLimitForAge(player.age);
            return (
              <div key={player.id} className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{player.name}</div>
                    <div className="text-sm text-[#66716d]">
                      Age {player.age} max {limit}
                    </div>
                  </div>
                  <input
                    className="h-11 w-24 rounded-md border border-[#d8d2c4] px-3 text-lg font-semibold"
                    min={0}
                    max={110}
                    type="number"
                    value={pitches}
                    onChange={(event) =>
                      setPitchLog((current) => ({
                        ...current,
                        [player.id]: Number(event.target.value),
                      }))
                    }
                  />
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  <span className="rounded-md bg-[#fbfaf5] px-2 py-1 font-semibold">
                    {restDaysForPitches(pitches)} day rest
                  </span>
                  {pitches >= AAA_RULES.pitcherToCatcherLockout ? (
                    <span className="rounded-md bg-[#ffe6df] px-2 py-1 font-semibold text-[#9b3d2e]">
                      cannot catch today
                    </span>
                  ) : (
                    <span className="rounded-md bg-[#e8f3f0] px-2 py-1 font-semibold text-[#176a5f]">
                      catcher eligible
                    </span>
                  )}
                </div>
              </div>
            );
          })}
      </div>
    </section>
  );
}

function SeasonTab({
  gameHistory,
  players,
  seasonStats,
  currentGameStats,
  onReset,
}: {
  gameHistory: GameRecord[];
  players: Player[];
  seasonStats: SeasonStats;
  currentGameStats: SeasonStats;
  onReset: () => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Season Fairness</h2>
          <p className="text-sm text-[#66716d]">Stored locally on this phone for v1.</p>
        </div>
        <button
          className="h-10 rounded-md border border-[#d8d2c4] px-3 text-sm font-semibold"
          onClick={onReset}
        >
          Reset
        </button>
      </div>

      <div className="space-y-2">
        {players.map((player) => {
          const stats = seasonStats[player.id] ?? emptyStats();
          const pending = currentGameStats[player.id] ?? emptyStats();
          return (
            <div key={player.id} className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">{player.name}</div>
                <div className="text-sm text-[#66716d]">{stats.games} games</div>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
                <MiniStat label="Field" value={`${stats.fieldInnings}`} />
                <MiniStat label="Bench" value={`${stats.benchInnings}`} />
                <MiniStat label="Pitches" value={`${stats.pitches}`} />
              </div>
              {pending.fieldInnings || pending.benchInnings ? (
                <p className="mt-2 text-xs font-semibold text-[#176a5f]">
                  Current game: +{pending.fieldInnings} field, +{pending.benchInnings} bench
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#176a5f]">
          Saved Games
        </h3>
        <div className="mt-3 space-y-2">
          {gameHistory.length ? (
            gameHistory.slice(0, 6).map((game) => (
              <div key={game.id} className="rounded-md bg-[#fbfaf5] px-3 py-2 text-sm">
                <div className="font-semibold">{game.date}</div>
                <div className="text-[#66716d]">
                  {game.inningsPlayed} innings, {game.playerCount} players
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-[#66716d]">No games saved yet.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function readStoredState(): StoredState {
  if (typeof window === "undefined") return {};
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored) as StoredState;
  } catch {
    return {};
  }
}

function summarizeGame(players: Player[], assignments: Assignment[], pitchLog: PitchLog) {
  const stats: SeasonStats = {};
  players
    .filter((player) => player.present)
    .forEach((player) => {
      stats[player.id] = emptyStats();
      stats[player.id].games = 1;
      stats[player.id].pitches = pitchLog[player.id] ?? 0;
    });

  assignments.forEach((assignment) => {
    assignment.bench.forEach((player) => {
      stats[player.id] ??= emptyStats();
      stats[player.id].benchInnings += 1;
    });
    Object.entries(assignment.positions).forEach(([position, player]) => {
      stats[player.id] ??= emptyStats();
      stats[player.id].fieldInnings += 1;
      stats[player.id].positions[position as Position] =
        (stats[player.id].positions[position as Position] ?? 0) + 1;
    });
  });

  return stats;
}

function mergeSeasonStats(current: SeasonStats, incoming: SeasonStats) {
  const merged: SeasonStats = { ...current };
  Object.entries(incoming).forEach(([playerId, stats]) => {
    const existing = merged[playerId] ?? emptyStats();
    const positions = { ...existing.positions };
    POSITIONS.forEach((position) => {
      positions[position] = (positions[position] ?? 0) + (stats.positions[position] ?? 0);
    });
    merged[playerId] = {
      fieldInnings: existing.fieldInnings + stats.fieldInnings,
      benchInnings: existing.benchInnings + stats.benchInnings,
      pitches: existing.pitches + stats.pitches,
      games: existing.games + stats.games,
      positions,
    };
  });
  return merged;
}

function emptyStats(): PlayerSeasonStats {
  return {
    fieldInnings: 0,
    benchInnings: 0,
    pitches: 0,
    games: 0,
    positions: {},
  };
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-[#d8d2c4] bg-white px-2 py-2 shadow-sm">
      <div className="text-[0.68rem] font-bold uppercase tracking-[0.1em] text-[#66716d]">{label}</div>
      <div className="mt-0.5 text-xl font-bold">{value}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#fbfaf5] px-2 py-2">
      <div className="text-xs font-bold uppercase tracking-[0.08em] text-[#66716d]">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`h-11 rounded-md text-sm font-bold transition ${
        active ? "bg-[#176a5f] text-white" : "bg-white text-[#4d5a55]"
      }`}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function PlayerEditor({
  player,
  onChange,
  onToggle,
}: {
  player: Player;
  onChange: (patch: Partial<Player>) => void;
  onToggle: (field: "wants" | "avoid", position: Position) => void;
}) {
  return (
    <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
      <div className="grid grid-cols-[1fr_70px] gap-2">
        <input
          className="h-11 min-w-0 rounded-md border border-[#d8d2c4] bg-white px-3 text-base font-semibold"
          value={player.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <input
          className="h-11 rounded-md border border-[#d8d2c4] bg-white px-2 text-base"
          min={7}
          max={12}
          type="number"
          value={player.age}
          onChange={(event) => onChange({ age: Number(event.target.value) })}
        />
      </div>
      <label className="mt-3 flex h-10 items-center gap-2 text-sm font-medium">
        <input
          checked={player.present}
          className="h-5 w-5 accent-[#176a5f]"
          type="checkbox"
          onChange={(event) => onChange({ present: event.target.checked })}
        />
        Present today
      </label>
      <div className="mt-3">
        <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#66716d]">Wants</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {POSITIONS.map((position) => (
            <button
              key={position}
              className={`h-9 min-w-11 rounded-md border px-2 text-xs font-bold transition ${
                player.wants.includes(position)
                  ? "border-[#176a5f] bg-[#176a5f] text-white"
                  : "border-[#d8d2c4] bg-[#fbfaf5]"
              }`}
              onClick={() => onToggle("wants", position)}
            >
              {position}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

