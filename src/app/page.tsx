"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AAA_RULES,
  DEFAULT_PLAYERS,
  POSITIONS,
  generateAssignments,
  pitchLimitForAge,
  restDaysForPitches,
  type Player,
  type Position,
} from "@/lib/rotation";

type PitchLog = Record<string, number>;

const STORAGE_KEY = "lil-leaguer-state-v1";

export default function Home() {
  const [players, setPlayers] = useState<Player[]>(() => readStoredState().players ?? DEFAULT_PLAYERS);
  const [pitchLog, setPitchLog] = useState<PitchLog>(() => readStoredState().pitchLog ?? {});
  const [activeInning, setActiveInning] = useState(1);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ players, pitchLog }));
  }, [players, pitchLog]);

  const assignments = useMemo(() => generateAssignments(players), [players]);
  const innings = assignments.filter((assignment) => assignment.inning > 0);
  const compliance = assignments.find((assignment) => assignment.inning === 0)?.notes ?? [];
  const activeAssignment = innings.find((assignment) => assignment.inning === activeInning) ?? innings[0];
  const presentCount = players.filter((player) => player.present).length;

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

  return (
    <main className="min-h-screen bg-[#f6f4ed] text-[#17211f]">
      <section className="border-b border-[#d8d2c4] bg-[#fbfaf5]">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-[#9b3d2e]">
                Portland AAA Baseball
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-normal text-[#17211f] sm:text-4xl">
                Lil Leaguer
              </h1>
              <p className="mt-2 max-w-3xl text-base leading-7 text-[#4d5a55]">
                Generate fair defensive rotations, track bench turns, honor position requests, and keep
                pitch-count rules in front of the coaches during the game.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center sm:w-[430px]">
              <Metric label="Present" value={`${presentCount}/${players.length}`} />
              <Metric label="Bench/inning" value={String(Math.max(0, presentCount - 9))} />
              <Metric label="Min field" value={`${AAA_RULES.minDefensiveInnings} inn`} />
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto grid max-w-7xl gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[340px_1fr] lg:px-8">
        <aside className="space-y-5">
          <section className="rounded-lg border border-[#d8d2c4] bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Roster</h2>
                <p className="text-sm text-[#66716d]">Tap positions kids ask for.</p>
              </div>
              <button
                className="h-9 rounded-md bg-[#176a5f] px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#0f554c]"
                onClick={addPlayer}
              >
                Add
              </button>
            </div>
            <div className="mt-4 space-y-3">
              {players.map((player) => (
                <PlayerEditor
                  key={player.id}
                  player={player}
                  onChange={(patch) => updatePlayer(player.id, patch)}
                  onToggle={(field, position) => togglePosition(player.id, field, position)}
                />
              ))}
            </div>
          </section>
        </aside>

        <section className="space-y-5">
          <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
            <section className="rounded-lg border border-[#d8d2c4] bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Defensive Rotation</h2>
                  <p className="text-sm text-[#66716d]">Six innings, continuous batting assumed.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {innings.map((assignment) => (
                    <button
                      key={assignment.inning}
                      className={`h-9 w-10 rounded-md border text-sm font-semibold transition ${
                        activeInning === assignment.inning
                          ? "border-[#176a5f] bg-[#176a5f] text-white"
                          : "border-[#d8d2c4] bg-[#fbfaf5] text-[#17211f] hover:border-[#176a5f]"
                      }`}
                      onClick={() => setActiveInning(assignment.inning)}
                    >
                      {assignment.inning}
                    </button>
                  ))}
                </div>
              </div>

              {activeAssignment ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_220px]">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {POSITIONS.map((position) => {
                      const player = activeAssignment.positions[position];
                      return (
                        <div
                          key={position}
                          className="min-h-20 rounded-md border border-[#e4ded0] bg-[#fbfaf5] p-3"
                        >
                          <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#9b3d2e]">
                            {position}
                          </div>
                          <div className="mt-2 text-lg font-semibold">
                            {player?.name ?? "Open"}
                          </div>
                          {player?.wants.includes(position) ? (
                            <div className="mt-1 text-xs font-medium text-[#176a5f]">
                              requested
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <div className="rounded-md border border-[#e4ded0] bg-[#f7fbfb] p-3">
                    <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#176a5f]">
                      Bench
                    </h3>
                    <div className="mt-3 space-y-2">
                      {activeAssignment.bench.length ? (
                        activeAssignment.bench.map((player) => (
                          <div
                            key={player.id}
                            className="rounded-md bg-white px-3 py-2 text-sm font-semibold shadow-sm"
                          >
                            {player.name}
                          </div>
                        ))
                      ) : (
                        <p className="text-sm text-[#66716d]">No bench this inning.</p>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </section>

            <section className="rounded-lg border border-[#d8d2c4] bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold">Rule Watch</h2>
              <div className="mt-4 space-y-3">
                {compliance.map((note) => (
                  <div
                    key={note}
                    className="rounded-md border border-[#d8d2c4] bg-[#fbfaf5] px-3 py-2 text-sm leading-6"
                  >
                    {note}
                  </div>
                ))}
                <div className="rounded-md border border-[#e6c08b] bg-[#fff8e9] px-3 py-2 text-sm leading-6">
                  No new inning after {AAA_RULES.noNewInningAfterMinutes} minutes. Game ends at{" "}
                  {AAA_RULES.innings} innings or {AAA_RULES.gameMinutes} minutes.
                </div>
                <div className="rounded-md border border-[#e6c08b] bg-[#fff8e9] px-3 py-2 text-sm leading-6">
                  Inning ends after 3 outs, batting through the lineup, or {AAA_RULES.maxRunsPerInning} runs.
                </div>
              </div>
            </section>
          </div>

          <section className="rounded-lg border border-[#d8d2c4] bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Pitch Count</h2>
                <p className="text-sm text-[#66716d]">
                  Tracks daily max, required rest, and pitcher/catcher lockouts.
                </p>
              </div>
              <button
                className="h-9 rounded-md border border-[#d8d2c4] px-3 text-sm font-semibold transition hover:border-[#9b3d2e]"
                onClick={() => setPitchLog({})}
              >
                Clear counts
              </button>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[#d8d2c4] text-xs uppercase tracking-[0.12em] text-[#66716d]">
                    <th className="py-3 pr-3">Player</th>
                    <th className="px-3">Age</th>
                    <th className="px-3">Pitches</th>
                    <th className="px-3">Daily max</th>
                    <th className="px-3">Rest</th>
                    <th className="px-3">Catcher status</th>
                  </tr>
                </thead>
                <tbody>
                  {players
                    .filter((player) => player.present)
                    .map((player) => {
                      const pitches = pitchLog[player.id] ?? 0;
                      const limit = pitchLimitForAge(player.age);
                      return (
                        <tr key={player.id} className="border-b border-[#eee8dc]">
                          <td className="py-3 pr-3 font-semibold">{player.name}</td>
                          <td className="px-3">{player.age}</td>
                          <td className="px-3">
                            <input
                              className="h-9 w-20 rounded-md border border-[#d8d2c4] px-2"
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
                          </td>
                          <td className="px-3">{limit}</td>
                          <td className="px-3 font-medium">{restDaysForPitches(pitches)} day(s)</td>
                          <td className="px-3">
                            {pitches >= AAA_RULES.pitcherToCatcherLockout ? (
                              <span className="rounded-md bg-[#ffe6df] px-2 py-1 font-semibold text-[#9b3d2e]">
                                cannot catch today
                              </span>
                            ) : (
                              <span className="rounded-md bg-[#e8f3f0] px-2 py-1 font-semibold text-[#176a5f]">
                                eligible
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function readStoredState() {
  if (typeof window === "undefined") return {};
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (!stored) return {};
  try {
    return JSON.parse(stored) as { players?: Player[]; pitchLog?: PitchLog };
  } catch {
    return {};
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[#d8d2c4] bg-white px-3 py-3 shadow-sm">
      <div className="text-xs font-bold uppercase tracking-[0.12em] text-[#66716d]">{label}</div>
      <div className="mt-1 text-2xl font-bold text-[#17211f]">{value}</div>
    </div>
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
    <div className="rounded-lg border border-[#e4ded0] bg-[#fbfaf5] p-3">
      <div className="grid grid-cols-[1fr_64px] gap-2">
        <input
          className="h-10 rounded-md border border-[#d8d2c4] bg-white px-3 text-sm font-semibold"
          value={player.name}
          onChange={(event) => onChange({ name: event.target.value })}
        />
        <input
          className="h-10 rounded-md border border-[#d8d2c4] bg-white px-2 text-sm"
          min={7}
          max={12}
          type="number"
          value={player.age}
          onChange={(event) => onChange({ age: Number(event.target.value) })}
        />
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm font-medium">
        <input
          checked={player.present}
          className="h-4 w-4 accent-[#176a5f]"
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
              className={`h-8 min-w-10 rounded-md border px-2 text-xs font-bold transition ${
                player.wants.includes(position)
                  ? "border-[#176a5f] bg-[#176a5f] text-white"
                  : "border-[#d8d2c4] bg-white hover:border-[#176a5f]"
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
