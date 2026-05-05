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
  type RotationStyle,
  type SeasonStats,
} from "@/lib/rotation";
import { defaultActiveGameId, mergeSeasonSchedule } from "@/lib/season";
import type {
  AttendanceByEventId,
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

type Tab = "today" | "lineup" | "pitch" | "roster" | "season";
type ScheduleStatus = "planned" | "today" | "in_progress" | "completed" | "past";
type StoredState = {
  players?: Player[];
  attendanceByEventId?: AttendanceByEventId;
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
  const initialGameFlow = migratedStarterRoster
    ? defaultGameFlow(initialSeasonEvent)
    : normalizeGameFlow(stored.gameFlow, initialSeasonEvent);
  const [players, setPlayers] = useState<Player[]>(() => initialPlayers);
  const [attendanceByEventId, setAttendanceByEventId] = useState<AttendanceByEventId>(
    () => stored.attendanceByEventId ?? {},
  );
  const [pitchLog, setPitchLog] = useState<PitchLog>(() => (migratedStarterRoster ? {} : stored.pitchLog ?? {}));
  const [pitchTracker, setPitchTracker] = useState<PitchTracker>(() =>
    migratedStarterRoster ? emptyPitchTracker() : normalizePitchTracker(stored.pitchTracker),
  );
  const [gameFlow, setGameFlow] = useState<GameFlow>(() => initialGameFlow);
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
  const [rotationStyle, setRotationStyle] = useState<RotationStyle>("standard");
  const [inningsPlayed, setInningsPlayed] = useState(() => stored.inningsPlayed ?? 4);
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [fieldPreviewInning, setFieldPreviewInning] = useState(() => initialGameFlow.inning);
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
  const fieldPlanVariantRef = useRef(0);
  const battingOrderVariantRef = useRef(0);

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        players,
        attendanceByEventId,
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
    attendanceByEventId,
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
  const activeSeasonEvent = useMemo(
    () => seasonSchedule.find((event) => event.id === activeEventId),
    [seasonSchedule, activeEventId],
  );
  const effectivePlayers = useMemo(
    () => applyEventAttendance(players, activeEventId, attendanceByEventId),
    [players, activeEventId, attendanceByEventId],
  );
  const activeInning = fieldPreviewInning;
  const activeAssignment = innings.find((assignment) => assignment.inning === activeInning) ?? innings[0];
  const currentAssignment = innings.find((assignment) => assignment.inning === gameFlow.inning) ?? innings[0];
  const presentPlayers = effectivePlayers.filter((player) => player.present);
  const presentCount = presentPlayers.length;
  const battingHalf = gameFlow.battingHalf ?? inferBattingHalf(activeSeasonEvent);
  const isOurBattingHalf = gameFlow.half === battingHalf;
  const completedFieldInnings = completedDefensiveInningCount(gameFlow, battingHalf);
  const visibleInnings = innings.slice(0, completedFieldInnings);
  const pitcherInnings = useMemo(() => getPitcherInnings(innings), [innings]);
  const pitcherQueuePlayers = useMemo(
    () => pitchQueue.map((id) => effectivePlayers.find((player) => player.id === id)).filter(Boolean) as Player[],
    [pitchQueue, effectivePlayers],
  );
  const activePitcher =
    currentAssignment?.positions.P ??
    effectivePlayers.find((player) => player.id === pitchTracker.pitcherId) ??
    pitcherQueuePlayers[0];
  const activePitchCount = activePitcher ? pitchLog[activePitcher.id] ?? 0 : 0;
  const selectedEventStatus = activeSeasonEvent
    ? eventStatus(activeSeasonEvent, gameHistory, activeEventId, gameFlow)
    : "planned";
  const featuredEvent =
    todaysGame(seasonSchedule) ??
    seasonSchedule.find((event) => event.id === activeEventId) ??
    nextScheduledGame(seasonSchedule);
  const featuredEventStatus = featuredEvent
    ? eventStatus(featuredEvent, gameHistory, activeEventId, gameFlow)
    : "planned";
  const battingOrderPlayers = useMemo(() => {
    const presentIds = new Set(presentPlayers.map((player) => player.id));
    const ordered = battingOrder
      .filter((id) => presentIds.has(id))
      .map((id) => effectivePlayers.find((player) => player.id === id))
      .filter(Boolean) as Player[];
    const missing = presentPlayers.filter((player) => !battingOrder.includes(player.id));
    return [...ordered, ...missing];
  }, [battingOrder, effectivePlayers, presentPlayers]);
  const gameSummary = useMemo(
    () => summarizeGame(effectivePlayers, visibleInnings, pitchLog, battingOrderPlayers),
    [effectivePlayers, visibleInnings, pitchLog, battingOrderPlayers],
  );
  const sharedGameState = useMemo<SharedGameState>(
    () => ({
      players,
      attendanceByEventId,
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
      attendanceByEventId,
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
    const nextGameFlow = migratedStarterRoster
      ? defaultGameFlow(nextSeasonEvent)
      : normalizeGameFlow(state.gameFlow, nextSeasonEvent);
    setPlayers(nextPlayers);
    setAttendanceByEventId(state.attendanceByEventId ?? {});
    setPitchLog(migratedStarterRoster ? {} : state.pitchLog);
    setPitchTracker(migratedStarterRoster ? emptyPitchTracker() : normalizePitchTracker(state.pitchTracker));
    setGameFlow(nextGameFlow);
    setFieldPreviewInning(nextGameFlow.inning);
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
      setActiveTab("lineup");
    } catch (error) {
      setSyncStatus("offline");
      setSyncMessage(String(error));
    }
  }

  function regenerateFullGamePlan(style = rotationStyle) {
    setRotationStyle(style);
    fieldPlanVariantRef.current += 1;
    const nextPlan = generateAssignments(effectivePlayers, seasonStats, {
      style,
      pitcherOrder: pitchQueue,
      variant: fieldPlanVariantRef.current,
    });
    const nextFlow = defaultGameFlow(activeSeasonEvent);
    const firstPitcher = nextPlan.find((assignment) => assignment.inning === 1)?.positions.P;
    setGamePlan(nextPlan);
    setGameFlow(nextFlow);
    setFieldPreviewInning(nextFlow.inning);
    setPitchTracker({ ...emptyPitchTracker(), pitcherId: firstPitcher?.id });
    setPitchLog({});
    setActiveTab("lineup");
  }

  function regenerateBattingLineup() {
    battingOrderVariantRef.current += 1;
    setBattingOrder(generateBattingOrder(effectivePlayers, seasonStats, battingOrderVariantRef.current));
    setGameFlow((current) => ({
      ...current,
      currentBatterIndex: 0,
      battersThisHalf: 0,
      notice: "Batting lineup regenerated.",
    }));
    setActiveTab("lineup");
  }

  function moveBatter(playerId: string, direction: -1 | 1) {
    setBattingOrder((current) => {
      const normalized = normalizeBattingOrder(current, effectivePlayers);
      const index = normalized.indexOf(playerId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= normalized.length) return normalized;
      const next = [...normalized];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
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
    if (gameFlow.outs + 1 >= 3) {
      moveToNextHalf(gameFlow, "Three outs.");
      return;
    }

    updateGameFlow((current) => {
      const outs = Math.min(3, current.outs + 1);
      return {
        ...current,
        outs,
        notice: "Out added.",
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
    }, "lineup");
  }

  function nextHalfInning() {
    moveToNextHalf(gameFlow);
  }

  function buildNextHalfFlow(current: GameFlow, reasonPrefix = ""): GameFlow {
    const nextHalf: GameHalf = current.half === "top" ? "bottom" : "top";
    const nextInning = current.half === "bottom" ? Math.min(AAA_RULES.innings, current.inning + 1) : current.inning;
    return {
      ...current,
      inning: nextInning,
      half: nextHalf,
      outs: 0,
      runsThisHalf: 0,
      battersThisHalf: 0,
      notice: `${reasonPrefix ? `${reasonPrefix} ` : ""}${halfLabel(nextHalf)} ${nextInning}.`,
      history: [...current.history, snapshotGameFlow(current)].slice(-30),
      status: "live" as const,
    };
  }

  function moveToNextHalf(current: GameFlow, reasonPrefix = "") {
    const nextFlow = buildNextHalfFlow(current, reasonPrefix);
    setGameFlow(nextFlow);
    setFieldPreviewInning(nextFlow.inning);
    setPitchTracker((tracker) => ({
      ...tracker,
      balls: 0,
      strikes: 0,
      outs: 0,
      coachPitch: false,
      notice: "New half-inning.",
    }));
    setActiveTab("lineup");
  }

  function undoGameFlow() {
    const previous = gameFlow.history[gameFlow.history.length - 1];
    if (previous) setFieldPreviewInning(previous.inning);
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

  function updateRosterPlayer(id: string, patch: Partial<Player>) {
    const { present, ...globalPatch } = patch;
    if (present !== undefined) {
      setEventAttendance(id, present);
    }
    if (Object.keys(globalPatch).length) {
      updatePlayer(id, globalPatch);
    }
  }

  function setEventAttendance(playerId: string, present: boolean) {
    if (!activeEventId) {
      updatePlayer(playerId, { present });
      return;
    }

    setAttendanceByEventId((current) => ({
      ...current,
      [activeEventId]: {
        ...(current[activeEventId] ?? {}),
        [playerId]: present,
      },
    }));
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

        const selected = effectivePlayers.find((player) => player.id === playerId);
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

  function assignGamePosition(inning: number, position: Position, playerId: string) {
    assignPosition(inning, position, playerId);
    if (position === "P" && inning === gameFlow.inning) {
      syncPitcherTracker(playerId, "Pitcher changed on Field.");
    }
  }

  function benchPlayer(inning: number, playerId: string) {
    setGamePlan((current) =>
      current.map((assignment) => {
        if (assignment.inning !== inning || assignment.inning === 0) return assignment;
        const player = effectivePlayers.find((candidate) => candidate.id === playerId);
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

  function fillOpenSpots(inning: number) {
    setGamePlan((current) =>
      current.map((assignment) => {
        if (assignment.inning !== inning || assignment.inning === 0) return assignment;

        const positions = { ...assignment.positions };
        const bench = [...assignment.bench];
        POSITIONS.forEach((position) => {
          if (positions[position] || bench.length === 0) return;
          const nextPlayer = bench.shift();
          if (nextPlayer) positions[position] = nextPlayer;
        });

        return { ...assignment, positions, bench };
      }),
    );
  }

  function markPlayerUnavailable(playerId: string) {
    const player = effectivePlayers.find((candidate) => candidate.id === playerId);
    if (!player) return;
    const fromInning = Math.max(1, gameFlow.inning);

    setGamePlan((current) =>
      current.map((assignment) => {
        if (assignment.inning === 0 || assignment.inning < fromInning) return assignment;

        const positions = { ...assignment.positions };
        const bench = assignment.bench.filter((candidate) => candidate.id !== playerId);
        POSITIONS.forEach((position) => {
          if (positions[position]?.id === playerId) delete positions[position];
        });
        POSITIONS.forEach((position) => {
          if (positions[position] || bench.length === 0) return;
          const nextPlayer = bench.shift();
          if (nextPlayer) positions[position] = nextPlayer;
        });

        return { ...assignment, positions, bench };
      }),
    );
    setBattingOrder((current) => current.filter((id) => id !== playerId));
    setPitchQueue((current) => current.filter((id) => id !== playerId));
    setPitchTracker((current) => (current.pitcherId === playerId ? emptyPitchTracker() : current));
    setGameFlow((current) => ({
      ...current,
      notice: `${player.name} removed from inning ${fromInning} forward. Future spots were filled from the bench where possible.`,
    }));
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
    const nextFlow = defaultGameFlow(nextEvent);
    setGameFlow(nextFlow);
    setFieldPreviewInning(nextFlow.inning);
    setActiveEventId(nextEventId);
    setActiveTab("season");
  }

  function resetSeason() {
    setSeasonStats({});
    setGameHistory([]);
  }

  function selectSeasonEvent(eventId: string) {
    const event = seasonSchedule.find((candidate) => candidate.id === eventId);
    const isAlreadyActive = eventId === activeEventId;
    setActiveEventId(eventId);
    if (!isAlreadyActive) {
      const nextFlow = defaultGameFlow(event);
      setGameFlow(nextFlow);
      setFieldPreviewInning(nextFlow.inning);
    }
  }

  function openEvent(eventId: string, tab: Tab = "lineup") {
    selectSeasonEvent(eventId);
    setActiveTab(tab);
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

  function syncPitcherTracker(playerId: string, notice = "Pitcher changed.") {
    setPitchTracker((current) => ({
      ...current,
      pitcherId: playerId || undefined,
      notice: playerId ? notice : "Pitcher cleared.",
    }));
    if (playerId) addPitcher(playerId);
  }

  function changeCurrentPitcher(playerId: string) {
    assignPosition(gameFlow.inning, "P", playerId);
    syncPitcherTracker(playerId);
  }

  return (
    <main className="min-h-screen bg-[#f6f4ed] text-[#17211f]">
      <header className="sticky top-0 z-20 border-b border-[#d8d2c4] bg-[#fbfaf5]/95 backdrop-blur">
        <div className="mx-auto max-w-5xl px-3 py-2 sm:px-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-[#9b3d2e]">
                Portland AAA
              </p>
              <h1 className="text-xl font-bold leading-tight tracking-normal">Lil Leaguer</h1>
              {activeSeasonEvent ? (
                <p className="mt-0.5 max-w-[210px] truncate text-xs font-semibold text-[#66716d] sm:max-w-md">
                  {eventStatusLabel(selectedEventStatus)} · {activeSeasonEvent.title}
                </p>
              ) : null}
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
                  {[
                    ["today", "Today", "Start here before a game"],
                    ["season", "Season", "Schedule, saved games, fairness"],
                    ["roster", "Roster", "Attendance and player asks"],
                  ].map(([tab, label, description]) => (
                    <button
                      key={tab}
                      className={`w-full rounded-md px-3 py-3 text-left font-semibold ${
                        activeTab === tab ? "bg-[#e8f3f0] text-[#176a5f]" : "hover:bg-[#fbfaf5]"
                      }`}
                      type="button"
                      onClick={() => {
                        setActiveTab(tab as Tab);
                        setMenuOpen(false);
                      }}
                    >
                      {label}
                      <span className="mt-0.5 block text-xs font-normal text-[#66716d]">
                        {description}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <HeaderStatus
            activePitchCount={activePitchCount}
            activePitcher={activePitcher}
            gameFlow={gameFlow}
          />
        </div>
      </header>

        <div className="mx-auto max-w-5xl px-3 pb-24 pt-3 sm:px-4">
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

        {activeTab === "lineup" || activeTab === "pitch" ? (
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
        ) : null}

        {activeTab === "today" ? (
          <TodayTab
            event={featuredEvent}
            eventStatus={featuredEventStatus}
            gameFlow={gameFlow}
            teamSession={teamSession}
            onOpenEvent={(eventId, tab) => openEvent(eventId, tab)}
            onOpenRoster={() => setActiveTab("roster")}
            onOpenSeason={() => setActiveTab("season")}
          />
        ) : null}

        {activeTab === "lineup" ? (
          <LineupTab
            activeAssignment={activeAssignment}
            activeInning={activeInning}
            battingOrder={battingOrderPlayers}
            compliance={compliance}
            currentInning={gameFlow.inning}
            gameFlow={gameFlow}
            innings={innings}
            pitchLog={pitchLog}
            pitcherInnings={pitcherInnings}
            pitcherQueue={pitcherQueuePlayers}
            players={effectivePlayers}
            rotationStyle={rotationStyle}
            onAssign={assignGamePosition}
            onBench={benchPlayer}
            onFillOpenSpots={fillOpenSpots}
            onGenerateBattingOrder={regenerateBattingLineup}
            onGeneratePositions={regenerateFullGamePlan}
            onMarkUnavailable={markPlayerUnavailable}
            onMoveBatter={moveBatter}
            onNextBatter={advanceBatter}
            onPreviewInning={setFieldPreviewInning}
            onRotationStyleChange={setRotationStyle}
            onSave={saveGameToSeason}
          />
        ) : null}

        {activeTab === "roster" ? (
          <RosterTab
            activeEvent={activeSeasonEvent}
            players={effectivePlayers}
            onAdd={addPlayer}
            onChange={updateRosterPlayer}
            onToggle={togglePosition}
            onGenerate={() => regenerateFullGamePlan()}
          />
        ) : null}

        {activeTab === "pitch" ? (
          <PitchTab
            gameFlow={gameFlow}
            players={effectivePlayers}
            pitchLog={pitchLog}
            pitchTracker={pitchTracker}
            pitcherInnings={pitcherInnings}
            pitchQueue={pitcherQueuePlayers}
            setPitchLog={setPitchLog}
            setPitchTracker={setPitchTracker}
            currentPitcherId={currentAssignment?.positions.P?.id}
            onAddPitcher={addPitcher}
            onChangeCurrentPitcher={changeCurrentPitcher}
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
            gameFlow={gameFlow}
            gameHistory={gameHistory}
            players={players}
            schedule={seasonSchedule}
            seasonStats={seasonStats}
            onReset={resetSeason}
            onOpenEvent={openEvent}
          />
        ) : null}
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#d8d2c4] bg-[#fbfaf5]/95 px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-2 gap-1.5">
          <TabButton active={activeTab === "lineup"} label="Lineup" onClick={() => setActiveTab("lineup")} />
          <TabButton active={activeTab === "pitch"} label="Pitch" onClick={() => setActiveTab("pitch")} />
        </div>
      </nav>
    </main>
  );
}

function TodayTab({
  event,
  eventStatus,
  gameFlow,
  teamSession,
  onOpenEvent,
  onOpenRoster,
  onOpenSeason,
}: {
  event?: SeasonEvent;
  eventStatus: ScheduleStatus;
  gameFlow: GameFlow;
  teamSession?: TeamSession;
  onOpenEvent: (eventId: string, tab: Tab) => void;
  onOpenRoster: () => void;
  onOpenSeason: () => void;
}) {
  const primaryLabel =
    eventStatus === "completed"
      ? "View game"
      : eventStatus === "planned"
        ? "Plan game"
        : "Manage game";
  const primaryTab: Tab = eventStatus === "planned" ? "roster" : "lineup";

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[#d8d2c4] bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#9b3d2e]">Start here</p>
            <h2 className="mt-1 text-2xl font-bold">Today</h2>
            <p className="mt-1 text-sm leading-6 text-[#66716d]">
              Pick the thing you are actually doing: manage today&apos;s game, plan the next one, or adjust the roster.
            </p>
          </div>
          <span className="rounded-md bg-[#e8f3f0] px-2 py-1 text-xs font-bold text-[#176a5f]">
            {teamSession ? "Shared" : "Local"}
          </span>
        </div>
      </div>

      {event ? (
        <div className="rounded-lg border border-[#176a5f] bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-[#176a5f] px-2 py-1 text-xs font-bold uppercase text-white">
                  {eventStatusLabel(eventStatus)}
                </span>
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-[#66716d]">
                  {event.type}
                </span>
              </div>
              <h3 className="mt-3 text-xl font-bold">{event.title}</h3>
              <p className="mt-1 text-sm font-semibold text-[#176a5f]">
                {formatEventDateTime(event.start)} · {shortFieldName(event.field)}
              </p>
              <p className="mt-1 text-sm text-[#66716d]">{event.location}</p>
            </div>
          </div>

          {eventStatus === "in_progress" ? (
            <div className="mt-3 grid grid-cols-4 gap-2 text-center">
              <MiniStat label="Inning" value={`${halfLabel(gameFlow.half)} ${gameFlow.inning}`} />
              <MiniStat label="Score" value={`${gameFlow.ourRuns}-${gameFlow.theirRuns}`} />
              <MiniStat label="Outs" value={`${gameFlow.outs}`} />
              <MiniStat label="Runs" value={`${gameFlow.runsThisHalf}/5`} />
            </div>
          ) : null}

          <button
            className="mt-4 h-12 w-full rounded-md bg-[#176a5f] px-4 text-base font-semibold text-white shadow-sm"
            type="button"
            onClick={() => onOpenEvent(event.id, primaryTab)}
          >
            {primaryLabel}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-[#d8d2c4] bg-white p-4 text-sm text-[#66716d] shadow-sm">
          No games are on the schedule yet. Add or import the season schedule, then this screen can point coaches to the right game.
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        <button
          className="min-h-16 rounded-lg border border-[#d8d2c4] bg-white p-3 text-left shadow-sm"
          type="button"
          onClick={onOpenSeason}
        >
          <span className="block font-bold">Season</span>
          <span className="mt-1 block text-xs text-[#66716d]">Schedule and saved games</span>
        </button>
        <button
          className="min-h-16 rounded-lg border border-[#d8d2c4] bg-white p-3 text-left shadow-sm"
          type="button"
          onClick={onOpenRoster}
        >
          <span className="block font-bold">Roster</span>
          <span className="mt-1 block text-xs text-[#66716d]">Attendance and requests</span>
        </button>
      </div>
    </section>
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
  const displayNotice = limitNotice ?? importantGameNotice(gameFlow.notice);
  const nextHalfText = nextHalfInningLabel(gameFlow);

  return (
    <section className="mb-3 rounded-lg border border-[#d8d2c4] bg-white p-2 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-sm font-bold">
          {isOurBattingHalf ? "Clam Bar batting" : "Clam Bar fielding"}
        </p>
        <button
          className="h-9 shrink-0 rounded-md border border-[#d8d2c4] px-2.5 text-xs font-semibold"
          onClick={onToggleBattingHalf}
          type="button"
        >
          Bat {halfLabel(battingHalf)}
        </button>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 text-center">
        <MiniStat label="Runs" value={`${gameFlow.runsThisHalf}/5`} />
        <MiniStat label="Batters" value={`${gameFlow.battersThisHalf}/${lineupSize || 1}`} />
      </div>

      {displayNotice ? (
        <div className="mt-2 rounded-md border border-[#e6c08b] bg-[#fff8e9] px-3 py-2 text-sm font-semibold text-[#5f5541]">
          {displayNotice}
        </div>
      ) : null}

      <div className="mt-2 grid grid-cols-4 gap-2">
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
          Next: {nextHalfText}
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

function HeaderStatus({
  activePitchCount,
  activePitcher,
  gameFlow,
}: {
  activePitchCount: number;
  activePitcher?: Player;
  gameFlow: GameFlow;
}) {
  return (
    <div className="mt-3 flex items-center gap-1.5 overflow-x-auto pb-1 text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <StatusPill value={`${halfLabel(gameFlow.half)} ${gameFlow.inning}`} />
      <StatusPill value={`${gameFlow.ourRuns}-${gameFlow.theirRuns}`} />
      <StatusPill value={`${gameFlow.outs} out${gameFlow.outs === 1 ? "" : "s"}`} />
      <StatusPill value={activePitcher ? `P ${activePitcher.name} ${activePitchCount}` : "P open"} wide />
    </div>
  );
}

function StatusPill({ value, wide = false }: { value: string; wide?: boolean }) {
  return (
    <span
      className={`inline-flex h-8 shrink-0 items-center rounded-md border border-[#d8d2c4] bg-white px-2.5 font-bold text-[#17211f] shadow-sm ${
        wide ? "max-w-[170px] truncate" : ""
      }`}
    >
      {value}
    </span>
  );
}

function LineupTab({
  activeAssignment,
  activeInning,
  battingOrder,
  compliance,
  currentInning,
  gameFlow,
  innings,
  pitchLog,
  pitcherInnings,
  pitcherQueue,
  players,
  rotationStyle,
  onAssign,
  onBench,
  onFillOpenSpots,
  onGenerateBattingOrder,
  onGeneratePositions,
  onMarkUnavailable,
  onMoveBatter,
  onNextBatter,
  onPreviewInning,
  onRotationStyleChange,
  onSave,
}: {
  activeAssignment?: Assignment;
  activeInning: number;
  battingOrder: Player[];
  compliance: string[];
  currentInning: number;
  gameFlow: GameFlow;
  innings: Assignment[];
  pitchLog: PitchLog;
  pitcherInnings: Record<string, number[]>;
  pitcherQueue: Player[];
  players: Player[];
  rotationStyle: RotationStyle;
  onAssign: (inning: number, position: Position, playerId: string) => void;
  onBench: (inning: number, playerId: string) => void;
  onFillOpenSpots: (inning: number) => void;
  onGenerateBattingOrder: () => void;
  onGeneratePositions: (style?: RotationStyle) => void;
  onMarkUnavailable: (playerId: string) => void;
  onMoveBatter: (playerId: string, direction: -1 | 1) => void;
  onNextBatter: () => void;
  onPreviewInning: (inning: number) => void;
  onRotationStyleChange: (style: RotationStyle) => void;
  onSave: () => void;
}) {
  const [lineupView, setLineupView] = useState<"now" | "plan">("plan");
  const [unavailablePlayerId, setUnavailablePlayerId] = useState("");
  const currentBatter = battingOrder[gameFlow.currentBatterIndex % Math.max(1, battingOrder.length)];
  const nextInning = Math.min(AAA_RULES.innings, currentInning + 1);
  const currentAssignment = innings.find((assignment) => assignment.inning === currentInning) ?? activeAssignment;
  const upcomingBatters = battingOrder
    .slice(gameFlow.currentBatterIndex + 1)
    .concat(battingOrder.slice(0, gameFlow.currentBatterIndex + 1))
    .slice(0, 3);
  const nextAssignment = innings.find((assignment) => assignment.inning === nextInning);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Lineup</h2>
          <p className="truncate text-sm text-[#66716d]">
            Up: {currentBatter?.name ?? "set lineup"} · {gameFlow.battersThisHalf}/{battingOrder.length || 1} batters
          </p>
        </div>
        <div className="grid shrink-0 grid-cols-2 rounded-md border border-[#d8d2c4] bg-white p-1">
          {(["now", "plan"] as const).map((view) => (
            <button
              key={view}
              className={`h-9 rounded px-3 text-sm font-semibold ${
                lineupView === view ? "bg-[#176a5f] text-white" : "text-[#66716d]"
              }`}
              onClick={() => {
                setLineupView(view);
                if (view === "now") onPreviewInning(currentInning);
              }}
            >
              {view === "now" ? "Now" : "Plan"}
            </button>
          ))}
        </div>
      </div>

      {lineupView === "now" ? (
        <>
          <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-md bg-[#fbfaf5] p-3">
                <div className="text-xs font-bold uppercase tracking-[0.08em] text-[#66716d]">Up</div>
                <div className="truncate text-2xl font-bold">{currentBatter?.name ?? "Set lineup"}</div>
              </div>
              <button className="rounded-md bg-[#176a5f] text-base font-bold text-white" onClick={onNextBatter}>
                Batter +1
              </button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-[#66716d]">
                  Next bats
                </div>
                <p className="truncate font-semibold">
                  {upcomingBatters.map((player) => player.name).join(", ") || "Set lineup"}
                </p>
              </div>
              <div>
                <div className="mb-1 text-xs font-bold uppercase tracking-[0.08em] text-[#66716d]">
                  Next bench
                </div>
                <p className="truncate font-semibold">
                  {nextAssignment?.bench.map((player) => player.name).join(", ") || "None"}
                </p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
              <select
                className="h-11 min-w-0 rounded-md border border-[#d8d2c4] bg-white px-3 text-sm font-semibold"
                value={unavailablePlayerId}
                onChange={(event) => setUnavailablePlayerId(event.target.value)}
              >
                <option value="">Player unavailable...</option>
                {players
                  .filter((player) => player.present)
                  .map((player) => (
                    <option key={player.id} value={player.id}>
                      {player.name}
                    </option>
                  ))}
              </select>
              <button
                className="h-11 rounded-md border border-[#d8d2c4] bg-white px-3 text-sm font-semibold disabled:text-[#b6b0a4]"
                disabled={!unavailablePlayerId}
                onClick={() => {
                  onMarkUnavailable(unavailablePlayerId);
                  setUnavailablePlayerId("");
                }}
              >
                Remove future
              </button>
            </div>
          </div>

          <GameTab
            activeAssignment={currentAssignment}
            activeInning={currentInning}
            compliance={compliance}
            currentInning={currentInning}
            pitchLog={pitchLog}
            pitcherInnings={pitcherInnings}
            pitcherQueue={pitcherQueue}
            players={players}
            onAssign={onAssign}
            onBench={onBench}
            onFillOpenSpots={onFillOpenSpots}
            onPreviewInning={onPreviewInning}
            onSave={onSave}
          />
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-[#d8d2c4] bg-white p-2 shadow-sm sm:grid-cols-[1fr_auto_auto]">
            <label className="col-span-2 min-w-0 sm:col-span-1">
              <span className="mb-1 block text-xs font-bold uppercase tracking-[0.08em] text-[#66716d]">
                Positions
              </span>
              <select
                className="h-11 w-full rounded-md border border-[#d8d2c4] bg-white px-3 text-sm font-semibold"
                value={rotationStyle}
                onChange={(event) => onRotationStyleChange(event.target.value as RotationStyle)}
              >
                <option value="standard">Rotate each inning</option>
                <option value="twoInningBlocks">Hold spots where possible</option>
              </select>
            </label>
            <button
              className="h-11 self-end rounded-md bg-[#176a5f] px-3 text-sm font-semibold text-white"
              onClick={() => onGeneratePositions(rotationStyle)}
            >
              Generate positions
            </button>
            <button
              className="h-11 self-end rounded-md border border-[#d8d2c4] bg-white px-3 text-sm font-semibold"
              onClick={onGenerateBattingOrder}
            >
              Fair batting
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-[#d8d2c4] bg-white shadow-sm">
            <table className="min-w-[720px] w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#d8d2c4] bg-[#fbfaf5]">
              <th className="sticky left-0 z-10 w-36 bg-[#fbfaf5] px-2 py-2 text-left text-xs font-bold uppercase tracking-[0.08em] text-[#66716d]">
                Player
              </th>
              <th className="w-12 px-2 py-2 text-center text-xs font-bold uppercase tracking-[0.08em] text-[#66716d]">
                Bat
              </th>
              {innings.map((assignment) => {
                const isCurrent = assignment.inning === currentInning;
                const isNext = assignment.inning === nextInning && !isCurrent;
                const isSelected = assignment.inning === activeInning;
                return (
                  <th
                    key={assignment.inning}
                    className={`w-16 border-l border-[#e7e1d5] px-1 py-1 text-center ${
                      isCurrent
                        ? "bg-[#176a5f] text-white"
                        : isNext
                          ? "bg-[#e8f3f0] text-[#176a5f]"
                          : isSelected
                            ? "bg-[#fff8e9] text-[#9b3d2e]"
                            : "text-[#66716d]"
                    }`}
                  >
                    <button
                      className="h-8 w-full rounded text-sm font-bold"
                      onClick={() => onPreviewInning(assignment.inning)}
                    >
                      {assignment.inning}
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {battingOrder.map((player, index) => (
              <tr key={player.id} className="border-b border-[#eee8dc] last:border-0">
                <th className="sticky left-0 z-10 bg-white px-2 py-2 text-left font-semibold">
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate">{player.name}</span>
                    <span className="grid grid-cols-2 gap-1">
                      <button
                        className="h-7 w-8 rounded border border-[#d8d2c4] bg-[#fbfaf5] text-[11px] font-bold text-[#66716d] disabled:opacity-30"
                        disabled={index === 0}
                        onClick={() => onMoveBatter(player.id, -1)}
                      >
                        Up
                      </button>
                      <button
                        className="h-7 w-8 rounded border border-[#d8d2c4] bg-[#fbfaf5] text-[11px] font-bold text-[#66716d] disabled:opacity-30"
                        disabled={index === battingOrder.length - 1}
                        onClick={() => onMoveBatter(player.id, 1)}
                      >
                        Dn
                      </button>
                    </span>
                  </span>
                </th>
                <td className="px-2 py-2 text-center font-bold text-[#9b3d2e]">{index + 1}</td>
                {innings.map((assignment) => {
                  const value = positionForPlayer(assignment, player.id);
                  const isCurrent = assignment.inning === currentInning;
                  const isNext = assignment.inning === nextInning && !isCurrent;
                  const isSelected = assignment.inning === activeInning;
                  return (
                    <td
                      key={`${player.id}-${assignment.inning}`}
                      className={`border-l border-[#eee8dc] px-1 py-1 text-center ${
                        isCurrent
                          ? "bg-[#e8f3f0]"
                          : isNext
                            ? "bg-[#f4faf8]"
                            : isSelected
                              ? "bg-[#fff8e9]"
                              : ""
                      }`}
                    >
                      <button
                        className={`h-9 w-full rounded-md text-sm font-bold ${
                          value === "B"
                            ? "bg-[#fbfaf5] text-[#66716d]"
                            : value === "-"
                              ? "bg-[#fff1ed] text-[#9b3d2e]"
                              : "bg-white text-[#17211f]"
                        }`}
                        onClick={() => onPreviewInning(assignment.inning)}
                      >
                        {value}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
            </table>
          </div>

          <GameTab
            activeAssignment={activeAssignment}
            activeInning={activeInning}
            compliance={compliance}
            currentInning={currentInning}
            pitchLog={pitchLog}
            pitcherInnings={pitcherInnings}
            pitcherQueue={pitcherQueue}
            players={players}
            onAssign={onAssign}
            onBench={onBench}
            onFillOpenSpots={onFillOpenSpots}
            onPreviewInning={onPreviewInning}
            onSave={onSave}
          />
        </>
      )}
    </section>
  );
}

function GameTab({
  activeAssignment,
  activeInning,
  compliance,
  currentInning,
  pitchLog,
  pitcherInnings,
  pitcherQueue,
  players,
  onAssign,
  onBench,
  onFillOpenSpots,
  onPreviewInning,
  onSave,
}: {
  activeAssignment?: Assignment;
  activeInning: number;
  compliance: string[];
  currentInning: number;
  pitchLog: PitchLog;
  pitcherInnings: Record<string, number[]>;
  pitcherQueue: Player[];
  players: Player[];
  onAssign: (inning: number, position: Position, playerId: string) => void;
  onBench: (inning: number, playerId: string) => void;
  onFillOpenSpots: (inning: number) => void;
  onPreviewInning: (inning: number) => void;
  onSave: () => void;
}) {
  const presentPlayers = players.filter((player) => player.present);
  const nextPitcher = pitcherQueue.find((player) => !pitcherInnings[player.id]?.length);
  const openPositions = activeAssignment
    ? POSITIONS.filter((position) => !activeAssignment.positions[position])
    : [];
  const canFillOpenSpots = Boolean(activeAssignment?.bench.length && openPositions.length);
  const isPreviewing = activeInning !== currentInning;
  const visibleCompliance = compliance.filter((note) => !note.startsWith("Rotation satisfies"));

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Field</h2>
          <p className="truncate text-sm text-[#66716d]">
            Inning {activeInning}
            {isPreviewing ? ` preview; pitch follows ${currentInning}` : " positions"}
            {nextPitcher ? ` · next P ${nextPitcher.name}` : ""}
          </p>
        </div>
        <div className="grid w-[168px] shrink-0 grid-cols-3 gap-1.5">
          <button
            className="h-9 rounded-md border border-[#d8d2c4] bg-white text-xs font-semibold disabled:text-[#b6b0a4]"
            disabled={activeInning <= 1}
            onClick={() => onPreviewInning(Math.max(1, activeInning - 1))}
          >
            Prev
          </button>
          <button
            className="h-9 rounded-md border border-[#d8d2c4] bg-white text-xs font-semibold"
            onClick={() => onPreviewInning(currentInning)}
          >
            Now
          </button>
          <button
            className="h-9 rounded-md border border-[#d8d2c4] bg-white text-xs font-semibold disabled:text-[#b6b0a4]"
            disabled={activeInning >= AAA_RULES.innings}
            onClick={() => onPreviewInning(Math.min(AAA_RULES.innings, activeInning + 1))}
          >
            Next
          </button>
        </div>
      </div>

      {activeAssignment ? (
        <div className="space-y-3">
          {canFillOpenSpots ? (
            <div className="rounded-lg border border-[#efb3a5] bg-[#fff1ed] p-3 text-sm text-[#9b3d2e]">
              <p className="font-semibold">
                {openPositions.join(", ")} open with {activeAssignment.bench.length} on the bench.
              </p>
              <button
                className="mt-2 h-10 w-full rounded-md bg-[#9b3d2e] px-3 text-sm font-bold text-white"
                onClick={() => onFillOpenSpots(activeInning)}
              >
                Fill open spots from bench
              </button>
            </div>
          ) : null}
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

      {visibleCompliance.length ? (
        <div className="space-y-2">
          {visibleCompliance.map((note) => (
          <div key={note} className="rounded-md border border-[#d8d2c4] bg-white px-3 py-2 text-sm">
            {note}
          </div>
          ))}
        </div>
      ) : null}

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
    <label className="grid grid-cols-[44px_1fr] items-center gap-2 rounded-md border border-[#d8d2c4] bg-white p-1.5">
      <span className="flex h-10 items-center justify-center rounded-md bg-[#fbfaf5] text-sm font-bold text-[#9b3d2e]">
        {position}
      </span>
      <span>
        <select
          className="h-10 w-full rounded-md border border-[#d8d2c4] bg-white px-3 text-base font-semibold"
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
        {requested ? <span className="mt-0.5 block text-xs font-semibold text-[#176a5f]">requested</span> : null}
      </span>
    </label>
  );
}

function RosterTab({
  activeEvent,
  players,
  onAdd,
  onChange,
  onToggle,
  onGenerate,
}: {
  activeEvent?: SeasonEvent;
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
          <p className="text-sm text-[#66716d]">
            Attendance is for {activeEvent ? activeEvent.title : "this game"}; position asks stay global.
          </p>
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
        Build field plan for this game
      </button>
    </section>
  );
}

function PitchTab({
  currentPitcherId,
  gameFlow,
  players,
  pitchLog,
  pitchTracker,
  pitcherInnings,
  pitchQueue,
  setPitchLog,
  setPitchTracker,
  onAddPitcher,
  onChangeCurrentPitcher,
  onOut,
  onRunAllowed,
  onMovePitcher,
  onRemovePitcher,
}: {
  currentPitcherId?: string;
  gameFlow: GameFlow;
  players: Player[];
  pitchLog: PitchLog;
  pitchTracker: PitchTracker;
  pitcherInnings: Record<string, number[]>;
  pitchQueue: Player[];
  setPitchLog: React.Dispatch<React.SetStateAction<PitchLog>>;
  setPitchTracker: React.Dispatch<React.SetStateAction<PitchTracker>>;
  onAddPitcher: (playerId: string) => void;
  onChangeCurrentPitcher: (playerId: string) => void;
  onOut: () => void;
  onRunAllowed: () => void;
  onMovePitcher: (playerId: string, direction: -1 | 1) => void;
  onRemovePitcher: (playerId: string) => void;
}) {
  const [selectedPitcher, setSelectedPitcher] = useState("");
  const activePitcher =
    players.find((player) => player.id === currentPitcherId) ??
    players.find((player) => player.id === pitchTracker.pitcherId) ??
    pitchQueue[0];
  const queuedPitchers = activePitcher
    ? pitchQueue.filter((player) => player.id !== activePitcher.id)
    : pitchQueue;
  const pitcherOptions = players.filter(
    (player) =>
      player.present &&
      player.wants.includes("P") &&
      player.id !== activePitcher?.id &&
      !pitchQueue.some((queued) => queued.id === player.id),
  );
  const activePitchCount = activePitcher ? pitchLog[activePitcher.id] ?? 0 : 0;
  const activeLimit = activePitcher ? pitchLimitForAge(activePitcher.age) : 0;
  const canTrack = Boolean(activePitcher);

  function selectTrackerPitcher(playerId: string) {
    onChangeCurrentPitcher(playerId);
  }

  function recordPitch(action: "ball" | "strike" | "foul" | "inPlay" | "out") {
    const pitcherId = currentPitcherId ?? pitchTracker.pitcherId ?? activePitcher?.id;
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
    const pitcherId = currentPitcherId ?? pitchTracker.pitcherId ?? activePitcher?.id;
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
          Next Pitchers
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
          Current pitcher is selected above. Arrange who should be ready next.
        </p>
      </div>

      <div className="space-y-2">
        {queuedPitchers.length ? (
          queuedPitchers.map((player, index) => {
            const pitches = pitchLog[player.id] ?? 0;
            const limit = pitchLimitForAge(player.age);
            const usedInnings = pitcherInnings[player.id] ?? [];
            const queueIndex = pitchQueue.findIndex((queued) => queued.id === player.id);
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
                    disabled={queueIndex <= 0}
                    onClick={() => onMovePitcher(player.id, -1)}
                  >
                    Up
                  </button>
                  <button
                    className="h-10 rounded-md border border-[#d8d2c4] text-sm font-semibold disabled:text-[#b6b0a4]"
                    disabled={queueIndex === pitchQueue.length - 1}
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
            No next pitchers queued yet. Use Roster to tap P for interested kids, then add them here.
          </div>
        )}
      </div>
    </section>
  );
}

function SeasonTab({
  activeEventId,
  currentGameStats,
  gameFlow,
  gameHistory,
  players,
  schedule,
  seasonStats,
  onReset,
  onOpenEvent,
}: {
  activeEventId?: string;
  currentGameStats: SeasonStats;
  gameFlow: GameFlow;
  gameHistory: GameRecord[];
  players: Player[];
  schedule: SeasonEvent[];
  seasonStats: SeasonStats;
  onReset: () => void;
  onOpenEvent: (eventId: string, tab?: Tab) => void;
}) {
  const sortedSchedule = [...schedule].sort(
    (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
  );
  const statusFor = (event: SeasonEvent) => eventStatus(event, gameHistory, activeEventId, gameFlow);
  const currentEvents = sortedSchedule.filter((event) => {
    const status = statusFor(event);
    return status === "today" || status === "in_progress";
  });
  const upcomingEvents = sortedSchedule.filter((event) => statusFor(event) === "planned");
  const completedEvents = sortedSchedule.filter((event) => {
    const status = statusFor(event);
    return status === "completed" || status === "past";
  });

  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-[#d8d2c4] bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-[#9b3d2e]">Season hub</p>
        <h2 className="mt-1 text-2xl font-bold">Schedule</h2>
        <p className="mt-1 text-sm leading-6 text-[#66716d]">
          Use this for planning future games and reviewing completed ones. Live game work still happens in Field, Bat, and Pitch.
        </p>
      </div>

      <ScheduleSection
        activeEventId={activeEventId}
        emptyText="No game or practice is scheduled for today."
        events={currentEvents}
        gameFlow={gameFlow}
        gameHistory={gameHistory}
        title="Current"
        onOpenEvent={onOpenEvent}
      />

      <ScheduleSection
        activeEventId={activeEventId}
        emptyText="No future games are left on the schedule."
        events={upcomingEvents}
        gameFlow={gameFlow}
        gameHistory={gameHistory}
        title="Upcoming"
        onOpenEvent={onOpenEvent}
      />

      <ScheduleSection
        activeEventId={activeEventId}
        emptyText="Saved games will show here after you end them."
        events={completedEvents}
        gameFlow={gameFlow}
        gameHistory={gameHistory}
        title="Completed & Past"
        onOpenEvent={onOpenEvent}
      />

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#176a5f]">
          Fairness
        </h3>
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

function ScheduleSection({
  activeEventId,
  emptyText,
  events,
  gameFlow,
  gameHistory,
  title,
  onOpenEvent,
}: {
  activeEventId?: string;
  emptyText: string;
  events: SeasonEvent[];
  gameFlow: GameFlow;
  gameHistory: GameRecord[];
  title: string;
  onOpenEvent: (eventId: string, tab?: Tab) => void;
}) {
  return (
    <div className="rounded-lg border border-[#d8d2c4] bg-white p-3 shadow-sm">
      <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-[#176a5f]">{title}</h3>
      <div className="mt-3 space-y-2">
        {events.length ? (
          events.map((event) => {
            const status = eventStatus(event, gameHistory, activeEventId, gameFlow);
            const active = event.id === activeEventId;
            const actionLabel =
              status === "completed" || status === "past"
                ? "Review"
                : status === "planned"
                  ? "Plan"
                  : "Manage";
            const targetTab: Tab =
              status === "completed" || status === "past"
                ? "season"
                : status === "planned"
                  ? "roster"
                  : "lineup";

            return (
              <div
                key={event.id}
                className={`rounded-md border p-3 ${
                  active ? "border-[#176a5f] bg-[#e8f3f0]" : "border-[#d8d2c4] bg-[#fbfaf5]"
                }`}
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
                    <span className="rounded-md bg-[#176a5f] px-2 py-1 text-xs font-bold uppercase text-white">
                      {eventStatusLabel(status)}
                    </span>
                    <span className="text-xs font-bold uppercase text-[#66716d]">{event.type}</span>
                  </div>
                </div>
                <button
                  className="mt-3 h-10 w-full rounded-md border border-[#d8d2c4] bg-white text-sm font-semibold"
                  type="button"
                  onClick={() => onOpenEvent(event.id, targetTab)}
                >
                  {actionLabel}
                </button>
              </div>
            );
          })
        ) : (
          <p className="rounded-md bg-[#fbfaf5] px-3 py-3 text-sm text-[#66716d]">{emptyText}</p>
        )}
      </div>
    </div>
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

function eventStatus(
  event: SeasonEvent,
  gameHistory: GameRecord[],
  activeEventId?: string,
  gameFlow?: GameFlow,
): ScheduleStatus {
  if (gameHistory.some((game) => game.scheduleEventId === event.id)) return "completed";
  if (event.id === activeEventId && gameFlow?.status === "live") return "in_progress";

  const eventKey = easternDateKey(event.start);
  const todayKey = easternDateKey(new Date().toISOString());
  if (eventKey === todayKey) return "today";
  if (eventKey < todayKey) return "past";
  return "planned";
}

function todaysGame(schedule: SeasonEvent[]) {
  const todayKey = easternDateKey(new Date().toISOString());
  const sorted = [...schedule].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return sorted.find((event) => event.type === "game" && easternDateKey(event.start) === todayKey);
}

function nextScheduledGame(schedule: SeasonEvent[]) {
  const todayKey = easternDateKey(new Date().toISOString());
  const sorted = [...schedule].sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  return (
    sorted.find((event) => event.type === "game" && easternDateKey(event.start) >= todayKey) ??
    sorted.find((event) => easternDateKey(event.start) >= todayKey)
  );
}

function eventStatusLabel(status: ScheduleStatus) {
  if (status === "in_progress") return "Current";
  if (status === "today") return "Today";
  if (status === "completed") return "Saved";
  if (status === "past") return "Past";
  return "Future";
}

function easternDateKey(start: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(start));
  const year = parts.find((part) => part.type === "year")?.value ?? "0000";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
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

function nextHalfInningLabel(flow: GameFlow) {
  const nextHalf: GameHalf = flow.half === "top" ? "bottom" : "top";
  const nextInning = flow.half === "bottom" ? Math.min(AAA_RULES.innings, flow.inning + 1) : flow.inning;
  return `${halfLabel(nextHalf)} ${ordinal(nextInning)}`;
}

function ordinal(value: number) {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  if (value % 10 === 1) return `${value}st`;
  if (value % 10 === 2) return `${value}nd`;
  if (value % 10 === 3) return `${value}rd`;
  return `${value}th`;
}

function halfInningNotice(flow: GameFlow, lineupSize = 0) {
  if (flow.outs >= 3) return "Three outs. Switch sides when ready.";
  if (flow.runsThisHalf >= AAA_RULES.maxRunsPerInning) return "Five-run limit reached. Switch sides when ready.";
  if (lineupSize > 0 && flow.battersThisHalf >= lineupSize) return "Batted through the lineup. Switch sides when ready.";
  return undefined;
}

function importantGameNotice(notice?: string) {
  if (!notice) return undefined;
  const quietPrefixes = ["Ready for", "Run added", "Out added", "Next batter", "Undid last game action"];
  return quietPrefixes.some((prefix) => notice.startsWith(prefix)) ? undefined : notice;
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

function applyEventAttendance(
  players: Player[],
  activeEventId: string | undefined,
  attendanceByEventId: AttendanceByEventId,
) {
  if (!activeEventId) return players;
  const attendance = attendanceByEventId[activeEventId];
  if (!attendance) return players;
  return players.map((player) => ({
    ...player,
    present: attendance[player.id] ?? player.present,
  }));
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

function positionForPlayer(assignment: Assignment, playerId: string) {
  if (assignment.bench.some((player) => player.id === playerId)) return "B";
  const entry = Object.entries(assignment.positions).find(([, player]) => player.id === playerId);
  return entry?.[0] ?? "-";
}

function normalizeBattingOrder(order: string[], players: Player[]) {
  const present = players.filter((player) => player.present);
  const presentIds = new Set(present.map((player) => player.id));
  const ordered = order.filter((id) => presentIds.has(id));
  const missing = present.filter((player) => !ordered.includes(player.id)).map((player) => player.id);
  return [...ordered, ...missing];
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
        Present for this game
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
