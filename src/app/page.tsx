"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AAA_RULES,
  DEFAULT_PLAYERS,
  POSITIONS,
  generateAssignments,
  generateBattingOrder,
  pitchLimitForAge,
  restDaysForPitches,
  type Assignment,
  type Player,
  type PlayerSeasonStats,
  type Position,
  type SeasonStats,
} from "@/lib/rotation";
import { defaultActiveGameId, mergeSeasonSchedule } from "@/lib/season";
import type {
  GameFlow,
  GameFlowSnapshot,
  GameHalf,
  GameRecord,
  PitchLog,
  PitchTracker,
  PitchTrackerSnapshot,
  SeasonEvent,
  SharedGameState,
  TeamSession,
} from "@/lib/shared-game";

type Tab = "field" | "batting" | "pitch" | "roster" | "season";
type StoredState = {
  players?: Player[];
  pitchLog?: PitchLog;
  pitchTracker?: PitchTracker;
  gameFlow?: GameFlow;
  pitchQueue?: string[];
  battingOrder?: string[];
  seasonSchedule?: SeasonEvent[];
  activeEventId?: string;
  seasonStats?: SeasonStats;
  gameHistory?: GameRecord[];
  gamePlan?: Assignment[];
  inningsPlayed?: number;
  teamSession?: TeamSession;
};

const STORAGE_KEY = "lil-leaguer-state-v2";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const OLD_STARTER_NAMES = [
  "Caleb",
  "Owen",
  "Mason",
  "Henry",
  "Jack",
  "Leo",
  "Noah",
  "Sam",
  "Miles",
  "Theo",
  "Eli",
  "Lucas",
  "Max",
];

export default function Home() {
  const stored = readStoredState();
  const migratedStarterRoster = hasOldStarterRoster(stored.players);
  const initialPlayers = normalizeStoredPlayers(stored.players);
  const initialSchedule = mergeSeasonSchedule(stored.seasonSchedule);
  const initialActiveEventId = stored.activeEventId ?? defaultActiveGameId(initialSchedule);
  const initialSeasonEvent = initialSchedule.find((event) => event.id === initialActiveEventId);
  const [players, setPlayers] = useState<Player[]>(() => initialPlayers);
  const [pitchLog, setPitchLog] = useState<PitchLog>(() => (migratedStarterRoster ? {} : stored.pitchLog ?? {}));
  const [pitchTracker, setPitchTracker] = useState<PitchTracker>(() =>
    migratedStarterRoster ? emptyPitchTracker() : normalizePitchTracker(stored.pitchTracker),
  );
  const [gameFlow, setGameFlow] = useState<GameFlow>(() =>
    migratedStarterRoster ? defaultGameFlow(initialSeasonEvent) : normalizeGameFlow(stored.gameFlow, initialSeasonEvent),
  );
  const [pitchQueue, setPitchQueue] = useState<string[]>(() => (migratedStarterRoster ? [] : stored.pitchQueue ?? []));
  const [seasonStats, setSeasonStats] = useState<SeasonStats>(() =>
    migratedStarterRoster ? {} : stored.seasonStats ?? {},
  );
  const [battingOrder, setBattingOrder] = useState<string[]>(
    () =>
      (migratedStarterRoster ? undefined : stored.battingOrder) ??
      generateBattingOrder(initialPlayers, migratedStarterRoster ? {} : stored.seasonStats ?? {}),
  );
  const [gameHistory, setGameHistory] = useState<GameRecord[]>(() =>
    migratedStarterRoster ? [] : stored.gameHistory ?? [],
  );
  const [seasonSchedule, setSeasonSchedule] = useState<SeasonEvent[]>(() => initialSchedule);
  const [activeEventId, setActiveEventId] = useState<string | undefined>(
    () => initialActiveEventId,
  );
  const [gamePlan, setGamePlan] = useState<Assignment[]>(
    () =>
      (migratedStarterRoster ? undefined : stored.gamePlan) ??
      generateAssignments(initialPlayers, migratedStarterRoster ? {} : stored.seasonStats ?? {}),
  );
  const [inningsPlayed, setInningsPlayed] = useState(() => stored.inningsPlayed ?? 4);
  const [activeTab, setActiveTab] = useState<Tab>("field");
  const [menuOpen, setMenuOpen] = useState(false);
  const [teamSession, setTeamSession] = useState<TeamSession | undefined>(() => stored.teamSession);
  const [syncStatus, setSyncStatus] = useState<"local" | "live" | "saving" | "offline" | "conflict">(
    () => (stored.teamSession ? "live" : "local"),
  );
  const [teamName, setTeamName] = useState("Lil Leaguer Team");
  const [joinCode, setJoinCode] = useState("");
  const [syncMessage, setSyncMessage] = useState("");
  const lastSyncedStateRef = useRef("");
  const latestSignatureRef = useRef("");
  const latestSessionRef = useRef<TeamSession | undefined>(stored.teamSession);
  const remoteApplyRef = useRef(false);
  const saveRequestRef = useRef(0);
  const syncStatusRef = useRef(syncStatus);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        players,
        pitchLog,
        pitchTracker,
        gameFlow,
        pitchQueue,
        battingOrder,
        seasonSchedule,
        activeEventId,
        seasonStats,
        gameHistory,
        gamePlan,
        inningsPlayed,
        teamSession,
      }),
    );
  }, [
    players,
    pitchLog,
    pitchTracker,
    gameFlow,
    pitchQueue,
    battingOrder,
    seasonSchedule,
    activeEventId,
    seasonStats,
    gameHistory,
    gamePlan,
    inningsPlayed,
    teamSession,
  ]);

  const innings = gamePlan.filter((assignment) => assignment.inning > 0);
  const compliance = gamePlan.find((assignment) => assignment.inning === 0)?.notes ?? [];
  const activeInning = gameFlow.inning;
  const activeAssignment = innings.find((assignment) => assignment.inning === activeInning) ?? innings[0];
  const presentPlayers = players.filter((player) => player.present);
  const presentCount = presentPlayers.length;
  const activeSeasonEvent = useMemo(
    () => seasonSchedule.find((event) => event.id === activeEventId),
    [seasonSchedule, activeEventId],
  );
  const battingHalf = gameFlow.battingHalf ?? inferBattingHalf(activeSeasonEvent);
  const isOurBattingHalf = gameFlow.half === battingHalf;
  const completedFieldInnings = completedDefensiveInningCount(gameFlow, battingHalf);
  const visibleInnings = innings.slice(0, completedFieldInnings);
  const pitcherInnings = useMemo(() => getPitcherInnings(innings), [innings]);
  const pitcherQueuePlayers = useMemo(
    () => pitchQueue.map((id) => players.find((player) => player.id === id)).filter(Boolean) as Player[],
    [pitchQueue, players],
  );
  const activePitcher =
    players.find((player) => player.id === pitchTracker.pitcherId) ?? pitcherQueuePlayers[0];
  const activePitchCount = activePitcher ? pitchLog[activePitcher.id] ?? 0 : 0;
  const battingOrderPlayers = useMemo(() => {
    const presentIds = new Set(presentPlayers.map((player) => player.id));
    const ordered = battingOrder
      .filter((id) => presentIds.has(id))
      .map((id) => players.find((player) => player.id === id))
      .filter(Boolean) as Player[];
    const missing = presentPlayers.filter((player) => !battingOrder.includes(player.id));
    return [...ordered, ...missing];
  }, [battingOrder, players, presentPlayers]);
  const gameSummary = useMemo(
    () => summarizeGame(players, visibleInnings, pitchLog, battingOrderPlayers),
    [players, visibleInnings, pitchLog, battingOrderPlayers],
  );
  const sharedGameState = useMemo<SharedGameState>(
    () => ({
      players,
      pitchLog,
      pitchTracker,
      gameFlow,
      pitchQueue,
      battingOrder: battingOrderPlayers.map((player) => player.id),
      seasonSchedule,
      activeEventId,
      seasonStats,
      gameHistory,
      gamePlan,
      inningsPlayed: completedFieldInnings,
    }),
    [
      players,
      pitchLog,
      pitchTracker,
      gameFlow,
      pitchQueue,
      battingOrderPlayers,
      seasonSchedule,
      activeEventId,
      seasonStats,
      gameHistory,
      gamePlan,
      completedFieldInnings,
    ],
  );

  useEffect(() => {
    latestSessionRef.current = teamSession;
  }, [teamSession]);

  useEffect(() => {
    syncStatusRef.current = syncStatus;
  }, [syncStatus]);

  useEffect(() => {
    latestSignatureRef.current = JSON.stringify(sharedGameState);
  }, [sharedGameState]);

  const applyRemoteState = useCallback((state: SharedGameState) => {
    const migratedStarterRoster = hasOldStarterRoster(state.players);
    const nextPlayers = normalizeStoredPlayers(state.players);
    const nextSchedule = mergeSeasonSchedule(state.seasonSchedule);
    const nextActiveEventId = state.activeEventId ?? defaultActiveGameId(nextSchedule);
    const nextSeasonEvent = nextSchedule.find((event) => event.id === nextActiveEventId);
    setPlayers(nextPlayers);
    setPitchLog(migratedStarterRoster ? {} : state.pitchLog);
    setPitchTracker(migratedStarterRoster ? emptyPitchTracker() : normalizePitchTracker(state.pitchTracker));
    setGameFlow(migratedStarterRoster ? defaultGameFlow(nextSeasonEvent) : normalizeGameFlow(state.gameFlow, nextSeasonEvent));
    setPitchQueue(migratedStarterRoster ? [] : state.pitchQueue);
    setBattingOrder(
      migratedStarterRoster
        ? generateBattingOrder(nextPlayers, {})
        : state.battingOrder ?? generateBattingOrder(nextPlayers, state.seasonStats),
    );
    setSeasonSchedule(nextSchedule);
    setActiveEventId(nextActiveEventId);
    setSeasonStats(migratedStarterRoster ? {} : state.seasonStats);
    setGameHistory(migratedStarterRoster ? [] : state.gameHistory);
    setGamePlan(migratedStarterRoster ? generateAssignments(nextPlayers, {}) : state.gamePlan);
    setInningsPlayed(state.inningsPlayed);
  }, []);

  const applyRemoteGame = useCallback(
    (game: { state: SharedGameState; version: number }, message: string) => {
      const signature = JSON.stringify(game.state);
      remoteApplyRef.current = true;
      lastSyncedStateRef.current = signature;
      latestSignatureRef.current = signature;
      applyRemoteState(game.state);
      setTeamSession((current) => (current ? { ...current, version: game.version } : current));
      setSyncStatus("live");
      setSyncMessage(message);
    },
    [applyRemoteState],
  );

  const hasUnsavedLocalChanges = useCallback(
    () =>
      latestSignatureRef.current !== lastSyncedStateRef.current ||
      syncStatusRef.current === "saving",
    [],
  );

  useEffect(() => {
    if (!teamSession?.gameId) return;

    const signature = JSON.stringify(sharedGameState);
    latestSignatureRef.current = signature;

    if (remoteApplyRef.current) {
      remoteApplyRef.current = false;
      lastSyncedStateRef.current = signature;
      return;
    }

    if (!lastSyncedStateRef.current) {
      lastSyncedStateRef.current = signature;
      return;
    }
    if (signature === lastSyncedStateRef.current) return;

    const timeout = window.setTimeout(async () => {
      const session = latestSessionRef.current;
      if (!session) return;

      const saveId = saveRequestRef.current + 1;
      saveRequestRef.current = saveId;
      setSyncStatus("saving");
      setSyncMessage("");
      try {
        const response = await fetch(`/api/game/${session.gameId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: sharedGameState, version: session.version }),
        });
        const payload = (await response.json()) as {
          game?: { state: SharedGameState; version: number };
          error?: string;
        };

        if (saveId !== saveRequestRef.current) return;

        if (response.status === 409 && payload.game) {
          applyRemoteGame(payload.game, "Another coach updated first. Pulled their latest game state.");
          setSyncStatus("conflict");
          return;
        }

        if (!response.ok || !payload.game) throw new Error(payload.error ?? "Save failed");

        setTeamSession((current) =>
          current ? { ...current, version: payload.game?.version ?? current.version } : current,
        );
        lastSyncedStateRef.current = signature;
        setSyncStatus("live");
        setSyncMessage("");
      } catch (error) {
        setSyncStatus("offline");
        setSyncMessage(String(error));
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [applyRemoteGame, sharedGameState, teamSession?.gameId]);

  useEffect(() => {
    if (!teamSession?.gameId) return;

    const interval = window.setInterval(async () => {
      try {
        const session = latestSessionRef.current;
        if (!session) return;
        const response = await fetch(`/api/game/${session.gameId}`);
        const payload = (await response.json()) as {
          game?: { state: SharedGameState; version: number };
        };
        if (!payload.game || payload.game.version <= (latestSessionRef.current?.version ?? 0)) return;
        if (hasUnsavedLocalChanges()) return;

        applyRemoteGame(payload.game, "Updated from another coach.");
      } catch {
        setSyncStatus("offline");
      }
    }, 4000);

    return () => window.clearInterval(interval);
  }, [applyRemoteGame, hasUnsavedLocalChanges, teamSession?.gameId]);

  useEffect(() => {
    if (!teamSession?.gameId || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return;

    const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
    const gameId = teamSession.gameId;
    const channel = supabase
      .channel(`game:${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "games",
          filter: `id=eq.${gameId}`,
        },
        (payload) => {
          const next = payload.new as { state?: SharedGameState; version?: number };
          if (!next.state || !next.version || next.version <= (latestSessionRef.current?.version ?? 0)) {
            return;
          }
          if (hasUnsavedLocalChanges()) return;
          applyRemoteGame({ state: next.state, version: next.version }, "Live update received.");
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [applyRemoteGame, hasUnsavedLocalChanges, teamSession?.gameId]);

  async function createTeam() {
    setSyncStatus("saving");
    setSyncMessage("Creating shared team...");
    try {
      const response = await fetch("/api/team/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: teamName, state: sharedGameState }),
      });
      const payload = (await response.json()) as {
        team?: { id: string; name: string; shareCode: string };
        game?: { id: string; state: SharedGameState; version: number };
        error?: string;
      };
      if (!response.ok || !payload.team || !payload.game) throw new Error(payload.error);

      applyRemoteState(payload.game.state);
      const session = {
        teamId: payload.team.id,
        gameId: payload.game.id,
        teamName: payload.team.name,
        shareCode: payload.team.shareCode,
        version: payload.game.version,
      };
      setTeamSession(session);
      lastSyncedStateRef.current = JSON.stringify(payload.game.state);
      setSyncStatus("live");
      setSyncMessage(`Share code ${session.shareCode}`);
    } catch (error) {
      setSyncStatus("offline");
      setSyncMessage(String(error));
    }
  }

  async function joinTeam() {
    setSyncStatus("saving");
    setSyncMessage("Joining shared team...");
    try {
      const response = await fetch("/api/team/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareCode: joinCode }),
      });
      const payload = (await response.json()) as {
        team?: { id: string; name: string; shareCode: string };
        game?: { id: string; state: SharedGameState; version: number };
        error?: string;
      };
      if (!response.ok || !payload.team || !payload.game) throw new Error(payload.error);

      applyRemoteState(payload.game.state);
      setTeamSession({
        teamId: payload.team.id,
        gameId: payload.game.id,
        teamName: payload.team.name,
        shareCode: payload.team.shareCode,
        version: payload.game.version,
      });
      lastSyncedStateRef.current = JSON.stringify(payload.game.state);
      setSyncStatus("live");
      setSyncMessage("Joined shared game.");
      setActiveTab("field");
    } catch (error) {
      setSyncStatus("offline");
      setSyncMessage(String(error));
    }
  }

  function regenerateFullGamePlan() {
    const nextPlan = generateAssignments(players, seasonStats);
    setGamePlan(nextPlan);
    setBattingOrder(generateBattingOrder(players, seasonStats));
    setGameFlow(defaultGameFlow(activeSeasonEvent));
    setPitchTracker(emptyPitchTracker());
    setPitchLog({});
    setActiveTab("field");
  }

  function regenerateBattingOrder() {
    setBattingOrder(generateBattingOrder(players, seasonStats));
    setActiveTab("batting");
  }

  function updateGameFlow(
    updater: (current: GameFlow) => GameFlow,
    preferredTab?: Tab,
  ) {
    setGameFlow((current) => {
      const snapshot = snapshotGameFlow(current);
      const next = updater(current);
      return {
        ...next,
        status: next.status === "final" ? "final" : "live",
        history: [...current.history, snapshot].slice(-30),
      };
    });
    if (preferredTab) setActiveTab(preferredTab);
  }

  function recordRun(side: "ours" | "theirs" | "auto" = "auto") {
    updateGameFlow((current) => {
      const scoringSide = side === "auto" ? (current.half === current.battingHalf ? "ours" : "theirs") : side;
      const runsThisHalf = current.runsThisHalf + 1;
      return {
        ...current,
        runsThisHalf,
        ourRuns: current.ourRuns + (scoringSide === "ours" ? 1 : 0),
        theirRuns: current.theirRuns + (scoringSide === "theirs" ? 1 : 0),
        notice:
          runsThisHalf >= AAA_RULES.maxRunsPerInning
            ? "Five-run limit reached. Switch sides when ready."
            : "Run added.",
      };
    });
  }

  function recordOut() {
    updateGameFlow((current) => {
      const outs = Math.min(3, current.outs + 1);
      return {
        ...current,
        outs,
        notice: outs >= 3 ? "Three outs. Switch sides when ready." : "Out added.",
      };
    });
  }

  function advanceBatter() {
    updateGameFlow((current) => {
      const lineupSize = Math.max(1, battingOrderPlayers.length);
      const battersThisHalf = current.battersThisHalf + 1;
      return {
        ...current,
        battersThisHalf,
        currentBatterIndex: (current.currentBatterIndex + 1) % lineupSize,
        notice:
          battersThisHalf >= lineupSize
            ? "Batted through the lineup. Switch sides when ready."
            : "Next batter.",
      };
    }, "batting");
  }

  function nextHalfInning() {
    const current = gameFlow;
    const nextHalf: GameHalf = current.half === "top" ? "bottom" : "top";
    const nextInning = current.half === "bottom" ? Math.min(AAA_RULES.innings, current.inning + 1) : current.inning;
    const nextFlow: GameFlow = {
      ...current,
      inning: nextInning,
      half: nextHalf,
      outs: 0,
      runsThisHalf: 0,
      battersThisHalf: 0,
      notice: `${halfLabel(nextHalf)} ${nextInning}.`,
      history: [...current.history, snapshotGameFlow(current)].slice(-30),
      status: "live",
    };
    setGameFlow(nextFlow);
    setPitchTracker((tracker) => ({
      ...tracker,
      balls: 0,
      strikes: 0,
      outs: 0,
      coachPitch: false,
      notice: "New half-inning.",
    }));
    setActiveTab(nextHalf === battingHalf ? "batting" : "field");
  }

  function undoGameFlow() {
    setGameFlow((current) => {
      const previous = current.history[current.history.length - 1];
      if (!previous) return current;
      return {
        ...previous,
        history: current.history.slice(0, -1),
        notice: "Undid last game action.",
      };
    });
  }

  function toggleBattingHalf() {
    updateGameFlow((current) => {
      const battingHalf = current.battingHalf === "top" ? "bottom" : "top";
      return {
        ...current,
        battingHalf,
        notice: `Clam Bar bats ${halfLabel(battingHalf).toLowerCase()}.`,
      };
    });
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

    if (field === "wants" && position === "P") {
      setPitchQueue((current) => {
        const active = players.find((player) => player.id === id)?.wants.includes("P");
        if (active) return current.filter((playerId) => playerId !== id);
        return current.includes(id) ? current : [...current, id];
      });
    }
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
    const savedEvent = activeSeasonEvent;
    const inningsCompleted = Math.max(1, completedFieldInnings);
    const nextEventId = nextGameIdAfter(seasonSchedule, savedEvent?.id);
    const nextEvent = seasonSchedule.find((event) => event.id === nextEventId);
    setSeasonStats((current) => mergeSeasonStats(current, gameSummary));
    setGameHistory((current) => [
      {
        id: String(Date.now()),
        date: savedEvent ? formatEventDate(savedEvent.start) : new Date().toLocaleDateString(),
        title: savedEvent?.title,
        scheduleEventId: savedEvent?.id,
        inningsPlayed: inningsCompleted,
        playerCount: presentCount,
        stats: gameSummary,
      },
      ...current,
    ]);
    setPitchLog({});
    setPitchTracker(emptyPitchTracker());
    setGameFlow(defaultGameFlow(nextEvent));
    setActiveEventId(nextEventId);
    setActiveTab("season");
  }

  function resetSeason() {
    setSeasonStats({});
    setGameHistory([]);
  }

  function selectSeasonEvent(eventId: string) {
    const event = seasonSchedule.find((candidate) => candidate.id === eventId);
    setActiveEventId(eventId);
    setGameFlow((current) => ({
      ...current,
      battingHalf: inferBattingHalf(event),
      notice: event ? `Selected ${event.title}.` : current.notice,
    }));
  }

  function addPitcher(playerId: string) {
    if (!playerId) return;
    setPitchQueue((current) => (current.includes(playerId) ? current : [...current, playerId]));
    const player = players.find((candidate) => candidate.id === playerId);
    if (player && !player.wants.includes("P")) {
      updatePlayer(playerId, { wants: [...player.wants, "P"] });
    }
  }

  function movePitcher(playerId: string, direction: -1 | 1) {
    setPitchQueue((current) => {
      const index = current.indexOf(playerId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function removePitcher(playerId: string) {
    setPitchQueue((current) => current.filter((id) => id !== playerId));
  }

  function moveBatter(playerId: string, direction: -1 | 1) {
    setBattingOrder((current) => {
      const normalized = normalizeBattingOrder(players, current);
      const index = normalized.indexOf(playerId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= normalized.length) return normalized;
      const next = [...normalized];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
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
            <div className="relative flex items-center gap-2">
              <SyncBadge syncStatus={syncStatus} teamSession={teamSession} message={syncMessage} />
              <button
                className="flex h-11 w-11 flex-col items-center justify-center gap-1 rounded-md border border-[#d8d2c4] bg-white shadow-sm"
                type="button"
                aria-label="Open menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
              >
                <span className="h-0.5 w-5 rounded bg-[#17211f]" />
                <span className="h-0.5 w-5 rounded bg-[#17211f]" />
                <span className="h-0.5 w-5 rounded bg-[#17211f]" />
              </button>
              {menuOpen ? (
                <div className="absolute right-0 top-12 z-40 w-56 rounded-lg border border-[#d8d2c4] bg-white p-2 text-sm shadow-lg">
                  <button
                    className={`w-full rounded-md px-3 py-3 text-left font-semibold ${
                      activeTab === "season" ? "bg-[#e8f3f0] text-[#176a5f]" : "hover:bg-[#fbfaf5]"
                    }`}
                    type="button"
                    onClick={() => {
                      setActiveTab("season");
                      setMenuOpen(false);
                    }}
                  >
                    Season
                    <span className="mt-0.5 block text-xs font-normal text-[#66716d]">
                      Schedule, saved games, fairness totals
                    </span>
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
            <Metric label="Inning" value={`${halfLabel(gameFlow.half)} ${gameFlow.inning}`} />
            <Metric label="Score" value={`${gameFlow.ourRuns}-${gameFlow.theirRuns}`} />
            <Metric label="Outs" value={`${gameFlow.outs}`} />
            <Metric label="P" value={activePitcher ? `${activePitcher.name} ${activePitchCount}` : "-"} />
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-4 pb-24 pt-4">
        {!teamSession ? (
          <SyncPanel
            joinCode={joinCode}
            setJoinCode={setJoinCode}
            setTeamName={setTeamName}
            syncMessage={syncMessage}
            syncStatus={syncStatus}
            teamName={teamName}
            onCreate={createTeam}
            onJoin={joinTeam}
          />
        ) : null}

        <GameControl
          battingHalf={battingHalf}
          gameFlow={gameFlow}
          isOurBattingHalf={isOurBattingHalf}
          lineupSize={battingOrderPlayers.length}
          onNextHalf={nextHalfInning}
          onOut={() => recordOut()}
          onRun={() => recordRun("auto")}
          onToggleBattingHalf={toggleBattingHalf}
          onUndo={undoGameFlow}
        />

        {activeTab === "field" ? (
          <GameTab
            activeAssignment={activeAssignment}
            activeInning={activeInning}
            compliance={compliance}
            pitchLog={pitchLog}
            pitcherInnings={pitcherInnings}
            pitcherQueue={pitcherQueuePlayers}
            players={players}
            seasonEvent={activeSeasonEvent}
            onAssign={assignPosition}
            onBench={benchPlayer}
            onSave={saveGameToSeason}
          />
        ) : null}

        {activeTab === "batting" ? (
          <BattingTab
            battingOrder={battingOrderPlayers}
            gameFlow={gameFlow}
            seasonStats={seasonStats}
            onGenerate={regenerateBattingOrder}
            onNextBatter={advanceBatter}
            onOut={() => recordOut()}
            onRun={() => recordRun("ours")}
            onMove={moveBatter}
          />
        ) : null}

        {activeTab === "roster" ? (
          <RosterTab
            players={players}
            onAdd={addPlayer}
            onChange={updatePlayer}
            onToggle={togglePosition}
            onGenerate={regenerateFullGamePlan}
          />
        ) : null}

        {activeTab === "pitch" ? (
          <PitchTab
            gameFlow={gameFlow}
            players={players}
            pitchLog={pitchLog}
            pitchTracker={pitchTracker}
            pitcherInnings={pitcherInnings}
            pitchQueue={pitcherQueuePlayers}
            setPitchLog={setPitchLog}
            setPitchTracker={setPitchTracker}
            onAddPitcher={addPitcher}
            onOut={() => recordOut()}
            onRunAllowed={() => recordRun("theirs")}
            onMovePitcher={movePitcher}
            onRemovePitcher={removePitcher}
          />
        ) : null}

        {activeTab === "season" ? (
          <SeasonTab
            activeEventId={activeEventId}
            currentGameStats={gameSummary}
            gameHistory={gameHistory}
            players={players}
            schedule={seasonSchedule}
            seasonStats={seasonStats}
            onReset={resetSeason}
            onSelectEvent={selectSeasonEvent}
          />
        ) : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8d2c4] bg-[#fbfaf5]/95 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-4 gap-1.5">
          <TabButton active={activeTab === "field"} label="Field" onClick={() => setActiveTab("field")} />
          <TabButton active={activeTab === "batting"} label="Bat" onClick={() => setActiveTab("batting")} />
          <TabButton active={activeTab === "pitch"} label="Pitch" onClick={() => setActiveTab("pitch")} />
          <TabButton active={activeTab === "roster"} label="Roster" onClick={() => setActiveTab("roster")} />
        </div>
      </nav>
    </main>
  );
}

function GameControl({
  battingHalf,
  gameFlow,
  isOurBattingHalf,
  lineupSize,
  onNextHalf,
  onOut,
  onRun,
  onToggleBattingHalf,
  onUndo,
}: {
  battingHalf: GameHalf;
  gameFlow: GameFlow;
  isOurBattingHalf: boolean;
  lineupSize: number;
  onNextHalf: () => void;
  onOut: () => void;
  onRun: () => void;
  onToggleBattingHalf: () => void;
  onUndo: () => void;
}) {
  const limitNotice = halfInningNotice(gameFlow, lineupSize);

  return (
    <section className="mb-4 rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {halfLabel(gameFlow.half)} {gameFlow.inning}
          </h2>
          <p className="text-sm text-[#66716d]">
            {isOurBattingHalf ? "Clam Bar batting" : "Clam Bar fielding"} · bats {halfLabel(battingHalf).toLowerCase()}
          </p>
        </div>
        <button
          className="h-10 rounded-md border border-[#d8d2c4] px-3 text-sm font-semibold"
          onClick={onToggleBattingHalf}
          type="button"
        >
          Bat {halfLabel(battingHalf)}
        </button>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2 text-center">
        <MiniStat label="Score" value={`${gameFlow.ourRuns}-${gameFlow.theirRuns}`} />
        <MiniStat label="Outs" value={`${gameFlow.outs}/3`} />
        <MiniStat label="Runs" value={`${gameFlow.runsThisHalf}/5`} />
        <MiniStat label="Batters" value={`${gameFlow.battersThisHalf}`} />
      </div>

      {limitNotice || gameFlow.notice ? (
        <div className="mt-3 rounded-md border border-[#e6c08b] bg-[#fff8e9] px-3 py-2 text-sm font-semibold text-[#5f5541]">
          {limitNotice ?? gameFlow.notice}
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-4 gap-2">
        <button className="h-11 rounded-md bg-[#176a5f] text-sm font-bold text-white" onClick={onRun}>
          Run +1
        </button>
        <button className="h-11 rounded-md bg-[#176a5f] text-sm font-bold text-white" onClick={onOut}>
          Out +1
        </button>
        <button
          className="h-11 rounded-md border border-[#d8d2c4] text-sm font-semibold disabled:text-[#b6b0a4]"
          disabled={!gameFlow.history.length}
          onClick={onUndo}
        >
          Undo
        </button>
        <button className="h-11 rounded-md border border-[#d8d2c4] text-sm font-semibold" onClick={onNextHalf}>
          Next Half
        </button>
      </div>
    </section>
  );
}

function SyncPanel({
  joinCode,
  setJoinCode,
  setTeamName,
  syncMessage,
  syncStatus,
  teamName,
  onCreate,
  onJoin,
}: {
  joinCode: string;
  setJoinCode: (code: string) => void;
  setTeamName: (name: string) => void;
  syncMessage: string;
  syncStatus: "local" | "live" | "saving" | "offline" | "conflict";
  teamName: string;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <section className="mb-4 rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
      <div>
        <h2 className="text-lg font-semibold">Share Between Coaches</h2>
        <p className="text-sm text-[#66716d]">
          Create a team code or join one so three phones see the same game.
        </p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="space-y-2">
          <input
            className="h-11 w-full rounded-md border border-[#d8d2c4] px-3 text-base font-semibold"
            value={teamName}
            onChange={(event) => setTeamName(event.target.value)}
            placeholder="Team name"
          />
          <button
            className="h-11 w-full rounded-md bg-[#176a5f] px-4 text-sm font-semibold text-white disabled:bg-[#b8c9c4]"
            disabled={syncStatus === "saving"}
            onClick={onCreate}
          >
            Create team code
          </button>
        </div>
        <div className="space-y-2">
          <input
            className="h-11 w-full rounded-md border border-[#d8d2c4] px-3 text-center text-xl font-bold tracking-[0.18em]"
            inputMode="numeric"
            maxLength={6}
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456"
          />
          <button
            className="h-11 w-full rounded-md border border-[#d8d2c4] px-4 text-sm font-semibold disabled:text-[#b6b0a4]"
            disabled={syncStatus === "saving" || joinCode.length < 6}
            onClick={onJoin}
          >
            Join team code
          </button>
        </div>
      </div>
      {syncMessage ? <p className="mt-2 text-sm text-[#66716d]">{syncMessage}</p> : null}
    </section>
  );
}

function SyncBadge({
  message,
  syncStatus,
  teamSession,
}: {
  message: string;
  syncStatus: "local" | "live" | "saving" | "offline" | "conflict";
  teamSession?: TeamSession;
}) {
  if (!teamSession) {
    return (
      <span className="hidden h-11 items-center rounded-md border border-[#d8d2c4] bg-white px-3 text-xs font-bold text-[#66716d] sm:flex">
        Local
      </span>
    );
  }

  const label =
    syncStatus === "saving"
      ? "Saving"
      : syncStatus === "offline"
        ? "Offline"
        : syncStatus === "conflict"
          ? "Updated"
          : "Live";
  const tone =
    syncStatus === "offline"
      ? "border-[#e6c08b] bg-[#fff8e9] text-[#9b3d2e]"
      : syncStatus === "saving"
        ? "border-[#d8d2c4] bg-white text-[#66716d]"
        : "border-[#9bc6bc] bg-[#e8f3f0] text-[#176a5f]";

  return (
    <span
      className={`flex h-11 min-w-20 flex-col justify-center rounded-md border px-3 text-right text-xs font-bold ${tone}`}
      title={message || teamSession.teamName}
    >
      <span>{label}</span>
      <span className="font-mono text-[0.68rem]">{teamSession.shareCode}</span>
    </span>
  );
}

function GameTab({
  activeAssignment,
  activeInning,
  compliance,
  pitchLog,
  pitcherInnings,
  pitcherQueue,
  players,
  seasonEvent,
  onAssign,
  onBench,
  onSave,
}: {
  activeAssignment?: Assignment;
  activeInning: number;
  compliance: string[];
  pitchLog: PitchLog;
  pitcherInnings: Record<string, number[]>;
  pitcherQueue: Player[];
  players: Player[];
  seasonEvent?: SeasonEvent;
  onAssign: (inning: number, position: Position, playerId: string) => void;
  onBench: (inning: number, playerId: string) => void;
  onSave: () => void;
}) {
  const presentPlayers = players.filter((player) => player.present);
  const nextPitcher = pitcherQueue.find((player) => !pitcherInnings[player.id]?.length);

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Field Positions</h2>
            <p className="text-sm text-[#66716d]">
              {seasonEvent ? seasonEvent.title : "Tap names to swap. Pitchers cannot re-enter later."}
            </p>
            {seasonEvent ? (
              <p className="mt-1 text-xs font-semibold text-[#176a5f]">
                {formatEventDateTime(seasonEvent.start)} · {shortFieldName(seasonEvent.field)}
              </p>
            ) : null}
          </div>
          <div className="rounded-md bg-[#fbfaf5] px-3 py-2 text-right">
            <div className="text-xs font-bold uppercase tracking-[0.1em] text-[#66716d]">Inning</div>
            <div className="text-lg font-bold">{activeInning}</div>
          </div>
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
                  activeInning={activeInning}
                  pitchLog={pitchLog}
                  players={presentPlayers}
                  pitcherInnings={pitcherInnings}
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
        <p className="font-semibold">
          {nextPitcher ? `Next queued pitcher: ${nextPitcher.name}` : "Short-game fairness"}
        </p>
        <p className="mt-1 text-[#5f5541]">
          Defensive rotation is generated from Roster before the game. During play, make simple
          swaps here and use Next Half to move the game forward.
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
  activeInning,
  pitchLog,
  players,
  pitcherInnings,
  position,
  requested,
  onChange,
}: {
  playerId: string;
  activeInning: number;
  pitchLog: PitchLog;
  players: Player[];
  pitcherInnings: Record<string, number[]>;
  position: Position;
  requested: boolean;
  onChange: (playerId: string) => void;
}) {
  const selectedPlayer = players.find((player) => player.id === playerId);
  const pitcherWarning =
    position === "P" && selectedPlayer
      ? pitcherStatusMessage(selectedPlayer, activeInning, pitcherInnings, pitchLog)
      : "";

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
          {players.map((player) => {
            const usedInnings = pitcherInnings[player.id] ?? [];
            const otherInnings = usedInnings.filter((inning) => inning !== activeInning);
            return (
              <option key={player.id} value={player.id}>
                {player.name}
                {position === "P" && otherInnings.length ? ` (P inn ${otherInnings.join(", ")})` : ""}
              </option>
            );
          })}
        </select>
        {pitcherWarning ? (
          <span className="mt-2 block rounded-md border border-[#efb3a5] bg-[#fff1ed] px-2 py-1.5 text-xs font-semibold leading-5 text-[#9b3d2e]">
            {pitcherWarning}
          </span>
        ) : null}
        {requested ? <span className="mt-1 block text-xs font-semibold text-[#176a5f]">requested</span> : null}
      </span>
    </label>
  );
}

function BattingTab({
  battingOrder,
  gameFlow,
  seasonStats,
  onGenerate,
  onNextBatter,
  onOut,
  onRun,
  onMove,
}: {
  battingOrder: Player[];
  gameFlow: GameFlow;
  seasonStats: SeasonStats;
  onGenerate: () => void;
  onNextBatter: () => void;
  onOut: () => void;
  onRun: () => void;
  onMove: (playerId: string, direction: -1 | 1) => void;
}) {
  const bottomThirdStart = Math.floor((Math.max(battingOrder.length, 1) * 2) / 3) + 1;
  const currentBatter = battingOrder[gameFlow.currentBatterIndex % Math.max(1, battingOrder.length)];

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Batting Lineup</h2>
            <p className="text-sm text-[#66716d]">
              Current batter: {currentBatter?.name ?? "Set lineup"}
            </p>
          </div>
          <button
            className="h-11 rounded-md bg-[#176a5f] px-4 text-sm font-semibold text-white"
            onClick={onGenerate}
          >
            Fair order
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
        <div className="grid grid-cols-3 gap-2">
          <button className="h-12 rounded-md bg-[#176a5f] text-sm font-bold text-white" onClick={onRun}>
            Run +1
          </button>
          <button className="h-12 rounded-md bg-[#176a5f] text-sm font-bold text-white" onClick={onOut}>
            Out +1
          </button>
          <button className="h-12 rounded-md border border-[#d8d2c4] text-sm font-semibold" onClick={onNextBatter}>
            Next Batter
          </button>
        </div>
        <p className="mt-2 text-sm text-[#66716d]">
          Batters this half: {gameFlow.battersThisHalf}/{battingOrder.length || 1}
        </p>
      </div>

      <div className="space-y-2">
        {battingOrder.map((player, index) => {
          const stats = seasonStats[player.id] ?? emptyStats();
          const battingGames = stats.battingGames ?? 0;
          const averageSlot = battingGames
            ? ((stats.battingOrderTotal ?? 0) / battingGames).toFixed(1)
            : "new";
          const isBottomThird = index + 1 >= bottomThirdStart;

          return (
            <div
              key={player.id}
              className={`rounded-lg border bg-white p-3 shadow-sm ${
                isBottomThird ? "border-[#e6c08b]" : "border-[#d8d2c4]"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[#fbfaf5] font-bold text-[#9b3d2e]">
                    {index + 1}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {player.name}
                      {currentBatter?.id === player.id ? " · up" : ""}
                    </div>
                    <div className="text-xs text-[#66716d]">
                      Avg slot {averageSlot}
                      {stats.bottomThirdGames ? ` · ${stats.bottomThirdGames} bottom-third` : ""}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    className="h-10 w-12 rounded-md border border-[#d8d2c4] text-sm font-semibold disabled:text-[#b6b0a4]"
                    disabled={index === 0}
                    onClick={() => onMove(player.id, -1)}
                  >
                    Up
                  </button>
                  <button
                    className="h-10 w-14 rounded-md border border-[#d8d2c4] text-sm font-semibold disabled:text-[#b6b0a4]"
                    disabled={index === battingOrder.length - 1}
                    onClick={() => onMove(player.id, 1)}
                  >
                    Down
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function RosterTab({
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
  const sortedPlayers = [...players].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Roster</h2>
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
        {sortedPlayers.map((player) => (
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
        Build field plan
      </button>
    </section>
  );
}

function PitchTab({
  gameFlow,
  players,
  pitchLog,
  pitchTracker,
  pitcherInnings,
  pitchQueue,
  setPitchLog,
  setPitchTracker,
  onAddPitcher,
  onOut,
  onRunAllowed,
  onMovePitcher,
  onRemovePitcher,
}: {
  gameFlow: GameFlow;
  players: Player[];
  pitchLog: PitchLog;
  pitchTracker: PitchTracker;
  pitcherInnings: Record<string, number[]>;
  pitchQueue: Player[];
  setPitchLog: React.Dispatch<React.SetStateAction<PitchLog>>;
  setPitchTracker: React.Dispatch<React.SetStateAction<PitchTracker>>;
  onAddPitcher: (playerId: string) => void;
  onOut: () => void;
  onRunAllowed: () => void;
  onMovePitcher: (playerId: string, direction: -1 | 1) => void;
  onRemovePitcher: (playerId: string) => void;
}) {
  const [selectedPitcher, setSelectedPitcher] = useState("");
  const pitcherOptions = players.filter(
    (player) => player.present && player.wants.includes("P") && !pitchQueue.some((queued) => queued.id === player.id),
  );
  const activePitcher =
    players.find((player) => player.id === pitchTracker.pitcherId) ?? pitchQueue[0];
  const activePitchCount = activePitcher ? pitchLog[activePitcher.id] ?? 0 : 0;
  const activeLimit = activePitcher ? pitchLimitForAge(activePitcher.age) : 0;
  const canTrack = Boolean(activePitcher);

  function selectTrackerPitcher(playerId: string) {
    setPitchTracker((current) => ({
      ...current,
      pitcherId: playerId || undefined,
      notice: playerId ? "Pitch tracker ready." : "Choose the current pitcher.",
    }));
  }

  function recordPitch(action: "ball" | "strike" | "foul" | "inPlay" | "out") {
    const pitcherId = pitchTracker.pitcherId ?? activePitcher?.id;
    if (!pitcherId) {
      setPitchTracker((current) => ({ ...current, notice: "Choose the current pitcher first." }));
      return;
    }

    const countsAgainstPlayer = !pitchTracker.coachPitch;
    const createsOut = action === "out" || (action === "strike" && pitchTracker.strikes >= 2);
    setPitchTracker((current) => {
      const snapshot = {
        pitcherId: current.pitcherId ?? pitcherId,
        balls: current.balls,
        strikes: current.strikes,
        outs: current.outs,
        coachPitch: current.coachPitch,
        notice: current.notice,
        pitchLog,
      };
      return advancePitchTracker({ ...current, pitcherId }, action, activePitcher?.name ?? "Pitcher", countsAgainstPlayer, snapshot);
    });

    if (countsAgainstPlayer) {
      setPitchLog((current) => ({
        ...current,
        [pitcherId]: Math.max(0, (current[pitcherId] ?? 0) + 1),
      }));
    }
    if (createsOut) onOut();
  }

  function startCoachPitch() {
    const pitcherId = pitchTracker.pitcherId ?? activePitcher?.id;
    setPitchTracker((current) => ({
      ...current,
      pitcherId,
      balls: 0,
      strikes: 1,
      coachPitch: true,
      notice: "Coach pitch: count starts at 0-1. Coach pitches do not add to the player's pitch count.",
      history: [
        ...current.history,
        {
          pitcherId: current.pitcherId,
          balls: current.balls,
          strikes: current.strikes,
          outs: current.outs,
          coachPitch: current.coachPitch,
          notice: current.notice,
          pitchLog,
        },
      ].slice(-20),
    }));
  }

  function newBatter() {
    setPitchTracker((current) => ({
      ...current,
      balls: 0,
      strikes: 0,
      coachPitch: false,
      notice: "New batter.",
    }));
  }

  function resetHalfInning() {
    setPitchTracker((current) => ({
      ...current,
      balls: 0,
      strikes: 0,
      outs: 0,
      coachPitch: false,
      notice: "Half-inning reset.",
    }));
  }

  function undoPitch() {
    const last = pitchTracker.history[pitchTracker.history.length - 1];
    if (!last) return;
    setPitchLog(last.pitchLog);
    setPitchTracker({
      pitcherId: last.pitcherId,
      balls: last.balls,
      strikes: last.strikes,
      outs: last.outs,
      coachPitch: last.coachPitch,
      notice: "Undid last pitch.",
      history: pitchTracker.history.slice(0, -1),
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Pitch Tracker</h2>
          <p className="text-sm text-[#66716d]">Tap every pitch while your team is in the field.</p>
        </div>
        <button
          className="h-10 rounded-md border border-[#d8d2c4] px-3 text-sm font-semibold"
          onClick={resetHalfInning}
        >
          Reset
        </button>
      </div>

      <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
        <label className="text-xs font-bold uppercase tracking-[0.12em] text-[#66716d]">
          Current pitcher
          <select
            className="mt-2 h-12 w-full rounded-md border border-[#d8d2c4] bg-white px-3 text-base font-semibold normal-case tracking-normal text-[#17211f]"
            value={activePitcher?.id ?? ""}
            onChange={(event) => selectTrackerPitcher(event.target.value)}
          >
            <option value="">Choose pitcher</option>
            {players
              .filter((player) => player.present)
              .map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name}
                </option>
              ))}
          </select>
        </label>

        <div className="mt-3 grid grid-cols-4 gap-2 text-center">
          <MiniStat label="Balls" value={`${pitchTracker.balls}`} />
          <MiniStat label="Strikes" value={`${pitchTracker.strikes}`} />
          <MiniStat label="Outs" value={`${gameFlow.outs}`} />
          <MiniStat label="Pitches" value={`${activePitchCount}`} />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            className="h-14 rounded-md bg-[#176a5f] text-base font-bold text-white disabled:bg-[#b8c9c4]"
            disabled={!canTrack}
            onClick={() => recordPitch("ball")}
          >
            Ball
          </button>
          <button
            className="h-14 rounded-md bg-[#176a5f] text-base font-bold text-white disabled:bg-[#b8c9c4]"
            disabled={!canTrack}
            onClick={() => recordPitch("strike")}
          >
            Strike
          </button>
          <button
            className="h-14 rounded-md border border-[#d8d2c4] bg-[#fbfaf5] text-base font-bold disabled:text-[#b6b0a4]"
            disabled={!canTrack}
            onClick={() => recordPitch("foul")}
          >
            Foul
          </button>
          <button
            className="h-14 rounded-md border border-[#d8d2c4] bg-[#fbfaf5] text-base font-bold disabled:text-[#b6b0a4]"
            disabled={!canTrack}
            onClick={() => recordPitch("inPlay")}
          >
            In play
          </button>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2">
          <button
            className="h-11 rounded-md border border-[#d8d2c4] text-sm font-semibold disabled:text-[#b6b0a4]"
            disabled={!canTrack}
            onClick={() => recordPitch("out")}
          >
            Out
          </button>
          <button
            className="h-11 rounded-md border border-[#d8d2c4] text-sm font-semibold"
            onClick={onRunAllowed}
          >
            Run Allowed
          </button>
          <button
            className="h-11 rounded-md border border-[#d8d2c4] text-sm font-semibold"
            onClick={newBatter}
          >
            New batter
          </button>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2">
          <button
            className="h-11 rounded-md border border-[#d8d2c4] text-sm font-semibold disabled:text-[#b6b0a4]"
            disabled={!pitchTracker.history.length}
            onClick={undoPitch}
          >
            Undo
          </button>
        </div>

        {pitchTracker.balls >= 4 ? (
          <button
            className="mt-3 h-12 w-full rounded-md bg-[#9b3d2e] px-3 text-sm font-bold text-white"
            onClick={startCoachPitch}
          >
            Bases loaded walk: coach pitches
          </button>
        ) : null}

        <div className="mt-3 rounded-md border border-[#e6c08b] bg-[#fff8e9] px-3 py-2 text-sm leading-6 text-[#5f5541]">
          <p className="font-semibold text-[#17211f]">
            {pitchTracker.coachPitch ? "Coach pitch is active" : pitchTracker.notice ?? "Ready"}
          </p>
          <p>
            Bases-loaded walk: set the count to 0-1 and the batting coach pitches until a strikeout
            or ball in play.
          </p>
        </div>

        {pitchTracker.notice ? (
          <p className="mt-2 text-sm font-semibold text-[#9b3d2e]">{pitchTracker.notice}</p>
        ) : null}

        {activePitcher ? (
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <span className="rounded-md bg-[#fbfaf5] px-2 py-1 font-semibold">
              Age {activePitcher.age} max {activeLimit}
            </span>
            <span className="rounded-md bg-[#fbfaf5] px-2 py-1 font-semibold">
              {restDaysForPitches(activePitchCount)} day rest
            </span>
            {activePitchCount >= AAA_RULES.pitcherToCatcherLockout ? (
              <span className="rounded-md bg-[#ffe6df] px-2 py-1 font-semibold text-[#9b3d2e]">
                cannot catch today
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
        <h3 className="mb-3 text-sm font-bold uppercase tracking-[0.12em] text-[#176a5f]">
          Pitcher Queue
        </h3>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <select
            className="h-11 min-w-0 rounded-md border border-[#d8d2c4] bg-white px-3 text-base font-semibold"
            value={selectedPitcher}
            onChange={(event) => setSelectedPitcher(event.target.value)}
          >
            <option value="">Add pitcher</option>
            {pitcherOptions.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name}
              </option>
            ))}
          </select>
          <button
            className="h-11 rounded-md bg-[#176a5f] px-4 text-sm font-semibold text-white disabled:bg-[#b8c9c4]"
            disabled={!selectedPitcher}
            onClick={() => {
              onAddPitcher(selectedPitcher);
              setSelectedPitcher("");
            }}
          >
            Add
          </button>
        </div>
        <p className="mt-2 text-xs text-[#66716d]">
          Mark kids as wanting P on Roster first, then arrange the pitching order here.
        </p>
      </div>

      <div className="space-y-2">
        {pitchQueue.length ? (
          pitchQueue.map((player, index) => {
            const pitches = pitchLog[player.id] ?? 0;
            const limit = pitchLimitForAge(player.age);
            const usedInnings = pitcherInnings[player.id] ?? [];
            return (
              <div key={player.id} className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#fbfaf5] text-sm font-bold text-[#9b3d2e]">
                        {index + 1}
                      </span>
                      <div className="font-semibold">{player.name}</div>
                    </div>
                    <div className="text-sm text-[#66716d]">
                      Age {player.age} max {limit}
                    </div>
                    {usedInnings.length ? (
                      <div className="mt-1 text-xs font-semibold text-[#9b3d2e]">
                        Used inning {usedInnings.join(", ")}; check before re-entry
                      </div>
                    ) : (
                      <div className="mt-1 text-xs font-semibold text-[#176a5f]">
                        Available to pitch
                      </div>
                    )}
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
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <button
                    className="h-10 rounded-md border border-[#d8d2c4] text-sm font-semibold disabled:text-[#b6b0a4]"
                    disabled={index === 0}
                    onClick={() => onMovePitcher(player.id, -1)}
                  >
                    Up
                  </button>
                  <button
                    className="h-10 rounded-md border border-[#d8d2c4] text-sm font-semibold disabled:text-[#b6b0a4]"
                    disabled={index === pitchQueue.length - 1}
                    onClick={() => onMovePitcher(player.id, 1)}
                  >
                    Down
                  </button>
                  <button
                    className="h-10 rounded-md border border-[#d8d2c4] text-sm font-semibold text-[#9b3d2e]"
                    onClick={() => onRemovePitcher(player.id)}
                  >
                    Remove
                  </button>
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
          })
        ) : (
          <div className="rounded-lg border border-[#d8d2c4] bg-white p-4 text-sm text-[#66716d] shadow-sm">
            No pitchers queued yet. Use Roster to tap P for interested kids, then add them here.
          </div>
        )}
      </div>
    </section>
  );
}

function SeasonTab({
  activeEventId,
  currentGameStats,
  gameHistory,
  players,
  schedule,
  seasonStats,
  onReset,
  onSelectEvent,
}: {
  activeEventId?: string;
  currentGameStats: SeasonStats;
  gameHistory: GameRecord[];
  players: Player[];
  schedule: SeasonEvent[];
  seasonStats: SeasonStats;
  onReset: () => void;
  onSelectEvent: (eventId: string) => void;
}) {
  const savedEventIds = new Set(gameHistory.map((game) => game.scheduleEventId).filter(Boolean));

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Season</h2>
          <p className="text-sm text-[#66716d]">Pick the game, then save innings after it ends.</p>
        </div>
        <button
          className="h-10 rounded-md border border-[#d8d2c4] px-3 text-sm font-semibold"
          onClick={onReset}
        >
          Reset
        </button>
      </div>

      <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#176a5f]">
          Schedule
        </h3>
        <div className="mt-3 space-y-2">
          {schedule.map((event) => {
            const active = event.id === activeEventId;
            const saved = savedEventIds.has(event.id);
            return (
              <button
                key={event.id}
                className={`w-full rounded-md border p-3 text-left transition ${
                  active ? "border-[#176a5f] bg-[#e8f3f0]" : "border-[#d8d2c4] bg-[#fbfaf5]"
                }`}
                onClick={() => onSelectEvent(event.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{event.title}</div>
                    <div className="text-sm text-[#66716d]">
                      {formatEventDateTime(event.start)} · {shortFieldName(event.field)}
                    </div>
                    <div className="mt-1 truncate text-xs text-[#66716d]">{event.location}</div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span
                      className={`rounded-md px-2 py-1 text-xs font-bold uppercase ${
                        event.type === "game"
                          ? "bg-[#176a5f] text-white"
                          : "bg-[#efe9da] text-[#5f5541]"
                      }`}
                    >
                      {event.type}
                    </span>
                    {active ? (
                      <span className="text-xs font-bold text-[#176a5f]">Selected</span>
                    ) : null}
                    {saved ? <span className="text-xs font-bold text-[#66716d]">Saved</span> : null}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#176a5f]">
          Fairness
        </h3>
        <span className="text-xs font-semibold text-[#66716d]">{players.length} players</span>
      </div>

      <div className="space-y-2">
        {players.map((player) => {
          const stats = seasonStats[player.id] ?? emptyStats();
          const pending = currentGameStats[player.id] ?? emptyStats();
          const averageSlot = stats.battingGames
            ? ((stats.battingOrderTotal ?? 0) / stats.battingGames).toFixed(1)
            : "-";
          return (
            <div key={player.id} className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold">{player.name}</div>
                <div className="text-sm text-[#66716d]">{stats.games} games</div>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-2 text-center text-sm">
                <MiniStat label="Field" value={`${stats.fieldInnings}`} />
                <MiniStat label="Bench" value={`${stats.benchInnings}`} />
                <MiniStat label="Avg Bat" value={averageSlot} />
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
                <div className="font-semibold">{game.title ?? game.date}</div>
                <div className="text-[#66716d]">
                  {game.title ? `${game.date} · ` : ""}
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

function defaultGameFlow(event?: SeasonEvent): GameFlow {
  const battingHalf = inferBattingHalf(event);
  return {
    inning: 1,
    half: "top",
    outs: 0,
    runsThisHalf: 0,
    ourRuns: 0,
    theirRuns: 0,
    battersThisHalf: 0,
    currentBatterIndex: 0,
    status: "pregame",
    battingHalf,
    notice: event ? `Ready for ${event.title}.` : "Ready for game.",
    history: [],
  };
}

function normalizeGameFlow(flow?: GameFlow, event?: SeasonEvent): GameFlow {
  const fallback = defaultGameFlow(event);
  if (!flow) return fallback;
  return {
    inning: clampNumber(flow.inning, 1, AAA_RULES.innings, fallback.inning),
    half: flow.half === "bottom" ? "bottom" : "top",
    outs: clampNumber(flow.outs, 0, 3, 0),
    runsThisHalf: clampNumber(flow.runsThisHalf, 0, AAA_RULES.maxRunsPerInning, 0),
    ourRuns: clampNumber(flow.ourRuns, 0, 99, 0),
    theirRuns: clampNumber(flow.theirRuns, 0, 99, 0),
    battersThisHalf: clampNumber(flow.battersThisHalf, 0, 99, 0),
    currentBatterIndex: clampNumber(flow.currentBatterIndex, 0, 99, 0),
    status: flow.status ?? "pregame",
    battingHalf: flow.battingHalf === "bottom" ? "bottom" : inferBattingHalf(event),
    notice: flow.notice,
    history: Array.isArray(flow.history) ? flow.history.slice(-30) : [],
  };
}

function snapshotGameFlow(flow: GameFlow): GameFlowSnapshot {
  return {
    inning: flow.inning,
    half: flow.half,
    outs: flow.outs,
    runsThisHalf: flow.runsThisHalf,
    ourRuns: flow.ourRuns,
    theirRuns: flow.theirRuns,
    battersThisHalf: flow.battersThisHalf,
    currentBatterIndex: flow.currentBatterIndex,
    status: flow.status,
    battingHalf: flow.battingHalf,
    notice: flow.notice,
  };
}

function inferBattingHalf(event?: SeasonEvent): GameHalf {
  return event?.homeAway === "home" ? "bottom" : "top";
}

function halfLabel(half: GameHalf) {
  return half === "top" ? "Top" : "Bottom";
}

function halfInningNotice(flow: GameFlow, lineupSize = 0) {
  if (flow.outs >= 3) return "Three outs. Switch sides when ready.";
  if (flow.runsThisHalf >= AAA_RULES.maxRunsPerInning) return "Five-run limit reached. Switch sides when ready.";
  if (lineupSize > 0 && flow.battersThisHalf >= lineupSize) return "Batted through the lineup. Switch sides when ready.";
  return undefined;
}

function completedDefensiveInningCount(flow: GameFlow, battingHalf: GameHalf) {
  const fieldingHalf = battingHalf === "top" ? "bottom" : "top";
  const currentHalfIndex = (flow.inning - 1) * 2 + (flow.half === "bottom" ? 1 : 0);
  let completed = 0;
  for (let index = 0; index < currentHalfIndex; index += 1) {
    const half = index % 2 === 0 ? "top" : "bottom";
    if (half === fieldingHalf) completed += 1;
  }
  if (flow.status === "final" || halfInningNotice(flow)) {
    if (flow.half === fieldingHalf) completed += 1;
  }
  return Math.min(AAA_RULES.innings, completed);
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Number(value)));
}

function emptyPitchTracker(): PitchTracker {
  return {
    balls: 0,
    strikes: 0,
    outs: 0,
    coachPitch: false,
    history: [],
  };
}

function normalizePitchTracker(tracker?: PitchTracker): PitchTracker {
  if (!tracker) return emptyPitchTracker();

  return {
    pitcherId: tracker.pitcherId,
    balls: Number.isFinite(tracker.balls) ? tracker.balls : 0,
    strikes: Number.isFinite(tracker.strikes) ? tracker.strikes : 0,
    outs: Number.isFinite(tracker.outs) ? tracker.outs : 0,
    coachPitch: Boolean(tracker.coachPitch),
    notice: tracker.notice,
    history: Array.isArray(tracker.history) ? tracker.history.slice(-20) : [],
  };
}

function normalizeStoredPlayers(players?: Player[]) {
  if (!players?.length) return DEFAULT_PLAYERS;

  if (hasOldStarterRoster(players)) return DEFAULT_PLAYERS;

  return players;
}

function hasOldStarterRoster(players?: Player[]) {
  if (!players?.length) return false;
  const oldNameCount = players.filter((player) => OLD_STARTER_NAMES.includes(player.name)).length;
  return oldNameCount >= Math.min(8, players.length);
}

function nextGameIdAfter(schedule: SeasonEvent[], currentEventId?: string) {
  const games = schedule.filter((event) => event.type === "game");
  if (!games.length) return undefined;
  const index = games.findIndex((event) => event.id === currentEventId);
  return games[index + 1]?.id ?? games[index]?.id ?? games[0]?.id;
}

function formatEventDate(start: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(start));
}

function formatEventDateTime(start: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(start));
}

function shortFieldName(field: string) {
  return field.replace(" > Field 1", "");
}

function pitcherStatusMessage(
  player: Player,
  activeInning: number,
  pitcherInnings: Record<string, number[]>,
  pitchLog: PitchLog,
) {
  const usedInnings = pitcherInnings[player.id] ?? [];
  const otherInnings = usedInnings.filter((inning) => inning !== activeInning);
  const pitchesToday = pitchLog[player.id] ?? 0;
  const lastPitchCount = player.lastPitchCount ?? 0;

  if (otherInnings.length && pitchesToday > 0) {
    return `${player.name} has already pitched ${pitchesToday} pitches in inning ${otherInnings.join(
      ", ",
    )}. Check the re-entry rule before using them again.`;
  }

  if (otherInnings.length) {
    return `${player.name} was already assigned as pitcher in inning ${otherInnings.join(
      ", ",
    )}, but has 0 pitches logged. If they never threw a pitch, this may be okay; otherwise check the re-entry rule.`;
  }

  if (pitchesToday > 0) {
    return `${player.name} has ${pitchesToday} pitches logged today. Keep tracking the count and rest requirement.`;
  }

  if (lastPitchCount > 0) {
    return `${player.name} threw ${lastPitchCount} pitches last time and may need ${restDaysForPitches(
      lastPitchCount,
    )} day(s) of rest.`;
  }

  return "";
}

function advancePitchTracker(
  current: PitchTracker,
  action: "ball" | "strike" | "foul" | "inPlay" | "out",
  pitcherName: string,
  countsAgainstPlayer: boolean,
  snapshot: PitchTrackerSnapshot,
): PitchTracker {
  let balls = current.balls;
  let strikes = current.strikes;
  let outs = current.outs;
  let coachPitch = current.coachPitch;
  let notice = "";

  if (action === "ball") {
    if (coachPitch) {
      notice = "Coach pitch mode: balls do not change the count.";
    } else {
      balls += 1;
      notice =
        balls >= 4
          ? "Walk. If the bases were loaded, tap the coach-pitch button."
          : `Ball ${balls}.`;
    }
  }

  if (action === "strike") {
    strikes += 1;
    if (strikes >= 3) {
      outs = Math.min(3, outs + 1);
      balls = 0;
      strikes = 0;
      coachPitch = false;
      notice = "Strikeout. Count reset for the next batter.";
    } else {
      notice = `Strike ${strikes}.`;
    }
  }

  if (action === "foul") {
    if (strikes < 2) strikes += 1;
    notice = strikes >= 2 ? "Foul ball. Count stays at two strikes." : `Foul ball, strike ${strikes}.`;
  }

  if (action === "inPlay") {
    balls = 0;
    strikes = 0;
    coachPitch = false;
    notice = "Ball in play. Count reset for the next batter.";
  }

  if (action === "out") {
    outs = Math.min(3, outs + 1);
    balls = 0;
    strikes = 0;
    coachPitch = false;
    notice = "Out recorded. Count reset for the next batter.";
  }

  if (!countsAgainstPlayer) {
    notice = `Coach pitch: ${notice} ${pitcherName}'s pitch count did not increase.`;
  }

  if (outs >= 3) {
    notice = `${notice} Three outs; reset for the next half-inning.`;
  }

  return {
    ...current,
    balls,
    strikes,
    outs,
    coachPitch,
    notice,
    history: [...current.history, snapshot].slice(-20),
  };
}

function summarizeGame(
  players: Player[],
  assignments: Assignment[],
  pitchLog: PitchLog,
  battingOrder: Player[],
) {
  const stats: SeasonStats = {};
  players
    .filter((player) => player.present)
    .forEach((player) => {
      stats[player.id] = emptyStats();
      stats[player.id].games = 1;
      stats[player.id].pitches = pitchLog[player.id] ?? 0;
    });

  const bottomThirdStart = Math.floor((Math.max(battingOrder.length, 1) * 2) / 3) + 1;
  battingOrder.forEach((player, index) => {
    stats[player.id] ??= emptyStats();
    stats[player.id].battingGames = 1;
    stats[player.id].battingOrderTotal = index + 1;
    stats[player.id].leadoffGames = index === 0 ? 1 : 0;
    stats[player.id].bottomThirdGames = index + 1 >= bottomThirdStart ? 1 : 0;
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
      battingGames: (existing.battingGames ?? 0) + (stats.battingGames ?? 0),
      battingOrderTotal:
        (existing.battingOrderTotal ?? 0) + (stats.battingOrderTotal ?? 0),
      leadoffGames: (existing.leadoffGames ?? 0) + (stats.leadoffGames ?? 0),
      bottomThirdGames:
        (existing.bottomThirdGames ?? 0) + (stats.bottomThirdGames ?? 0),
      positions,
    };
  });
  return merged;
}

function getPitcherInnings(assignments: Assignment[]) {
  return assignments.reduce<Record<string, number[]>>((acc, assignment) => {
    const pitcher = assignment.positions.P;
    if (assignment.inning > 0 && pitcher) {
      acc[pitcher.id] = [...(acc[pitcher.id] ?? []), assignment.inning];
    }
    return acc;
  }, {});
}

function emptyStats(): PlayerSeasonStats {
  return {
    fieldInnings: 0,
    benchInnings: 0,
    pitches: 0,
    games: 0,
    battingGames: 0,
    battingOrderTotal: 0,
    leadoffGames: 0,
    bottomThirdGames: 0,
    positions: {},
  };
}

function normalizeBattingOrder(players: Player[], order: string[]) {
  const presentPlayers = players.filter((player) => player.present);
  const presentIds = new Set(presentPlayers.map((player) => player.id));
  const existing = order.filter((id) => presentIds.has(id));
  const missing = presentPlayers
    .filter((player) => !existing.includes(player.id))
    .map((player) => player.id);
  return [...existing, ...missing];
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
