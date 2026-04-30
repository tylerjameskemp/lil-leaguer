import { NextResponse } from "next/server";
import { DEFAULT_PLAYERS, generateAssignments, generateBattingOrder } from "@/lib/rotation";
import { defaultActiveGameId, mergeSeasonSchedule } from "@/lib/season";
import type { SharedGameState } from "@/lib/shared-game";
import { createShareCode, hasSupabaseServerEnv, supabaseRest } from "@/lib/supabase-server";

type TeamRow = {
  id: string;
  name: string;
  share_code: string;
};

type GameRow = {
  id: string;
  team_id: string;
  state: SharedGameState;
  version: number;
};

export async function POST(request: Request) {
  if (!hasSupabaseServerEnv()) {
    return NextResponse.json({ error: "Supabase env vars are not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    state?: Partial<SharedGameState>;
  };

  const players = body.state?.players?.length ? body.state.players : DEFAULT_PLAYERS;
  const seasonSchedule = mergeSeasonSchedule(body.state?.seasonSchedule);
  const initialState: SharedGameState = {
    players,
    pitchLog: body.state?.pitchLog ?? {},
    pitchTracker: body.state?.pitchTracker ?? {
      balls: 0,
      strikes: 0,
      outs: 0,
      coachPitch: false,
      history: [],
    },
    pitchQueue: body.state?.pitchQueue ?? players.filter((player) => player.wants.includes("P")).map((player) => player.id),
    battingOrder: body.state?.battingOrder ?? generateBattingOrder(players, body.state?.seasonStats ?? {}),
    seasonSchedule,
    activeEventId: body.state?.activeEventId ?? defaultActiveGameId(seasonSchedule),
    seasonStats: body.state?.seasonStats ?? {},
    gameHistory: body.state?.gameHistory ?? [],
    gamePlan: body.state?.gamePlan ?? generateAssignments(players, body.state?.seasonStats ?? {}),
    inningsPlayed: body.state?.inningsPlayed ?? 4,
  };

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const shareCode = createShareCode();
    try {
      const [team] = await supabaseRest<TeamRow[]>("teams", {
        method: "POST",
        prefer: "return=representation",
        body: {
          name: body.name?.trim() || "Lil Leaguer Team",
          share_code: shareCode,
        },
      });

      const [game] = await supabaseRest<GameRow[]>("games", {
        method: "POST",
        prefer: "return=representation",
        body: {
          team_id: team.id,
          status: "active",
          state: initialState,
          version: 1,
        },
      });

      return NextResponse.json({
        team: { id: team.id, name: team.name, shareCode: team.share_code },
        game: { id: game.id, state: game.state, version: game.version },
      });
    } catch (error) {
      if (attempt === 4) {
        return NextResponse.json({ error: String(error) }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ error: "Could not create team." }, { status: 500 });
}
