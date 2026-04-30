import { NextResponse } from "next/server";
import type { SharedGameState } from "@/lib/shared-game";
import { hasSupabaseServerEnv, supabaseRest } from "@/lib/supabase-server";

type TeamRow = {
  id: string;
  name: string;
  share_code: string;
};

type GameRow = {
  id: string;
  state: SharedGameState;
  version: number;
};

export async function POST(request: Request) {
  if (!hasSupabaseServerEnv()) {
    return NextResponse.json({ error: "Supabase env vars are not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { shareCode?: string };
  const shareCode = body.shareCode?.replace(/\D/g, "");

  if (!shareCode) {
    return NextResponse.json({ error: "Share code is required." }, { status: 400 });
  }

  const teams = await supabaseRest<TeamRow[]>(
    `teams?share_code=eq.${encodeURIComponent(shareCode)}&select=id,name,share_code&limit=1`,
  );

  const team = teams[0];
  if (!team) {
    return NextResponse.json({ error: "No team found for that code." }, { status: 404 });
  }

  const games = await supabaseRest<GameRow[]>(
    `games?team_id=eq.${team.id}&status=eq.active&select=id,state,version&order=updated_at.desc&limit=1`,
  );
  const game = games[0];

  if (!game) {
    return NextResponse.json({ error: "No active game found for that team." }, { status: 404 });
  }

  return NextResponse.json({
    team: { id: team.id, name: team.name, shareCode: team.share_code },
    game: { id: game.id, state: game.state, version: game.version },
  });
}

