create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  share_code text not null unique,
  created_at timestamptz default now()
);

alter table public.teams enable row level security;

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references public.teams(id) on delete cascade,
  status text not null default 'active',
  state jsonb not null,
  version integer not null default 1,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.games enable row level security;

drop policy if exists "Public can receive active game updates" on public.games;
create policy "Public can receive active game updates"
  on public.games
  for select
  to anon
  using (status = 'active');

do $$
begin
  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.games;
exception
  when duplicate_object then null;
end $$;
