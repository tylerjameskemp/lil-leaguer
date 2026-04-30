import { NextResponse } from "next/server";
import type { SharedGameState } from "@/lib/shared-game";
import { hasSupabaseServerEnv, supabaseRest } from "@/lib/supabase-server";

type GameRow = {
  id: string;
  state: SharedGameState;
  version: number;
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseServerEnv()) {
    return NextResponse.json({ error: "Supabase env vars are not configured." }, { status: 503 });
  }

  const { id } = await params;
  const rows = await supabaseRest<GameRow[]>(
    `games?id=eq.${encodeURIComponent(id)}&select=id,state,version&limit=1`,
  );
  const game = rows[0];

  if (!game) return NextResponse.json({ error: "Game not found." }, { status: 404 });

  return NextResponse.json({ game });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseServerEnv()) {
    return NextResponse.json({ error: "Supabase env vars are not configured." }, { status: 503 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    state?: SharedGameState;
    version?: number;
  };

  if (!body.state || typeof body.version !== "number") {
    return NextResponse.json({ error: "State and version are required." }, { status: 400 });
  }

  const rows = await supabaseRest<GameRow[]>(
    `games?id=eq.${encodeURIComponent(id)}&version=eq.${body.version}&select=id,state,version`,
    {
      method: "PATCH",
      prefer: "return=representation",
      body: {
        state: body.state,
        version: body.version + 1,
        updated_at: new Date().toISOString(),
      },
    },
  );

  const updated = rows[0];
  if (updated) return NextResponse.json({ game: updated });

  const latest = await supabaseRest<GameRow[]>(
    `games?id=eq.${encodeURIComponent(id)}&select=id,state,version&limit=1`,
  );

  return NextResponse.json(
    { error: "Game was updated by another coach.", game: latest[0] },
    { status: 409 },
  );
}

