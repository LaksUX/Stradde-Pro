-- Poker Night schema (consolidated, for a fresh Supabase project)
-- 1 bank = 10000 of the app's internal integer unit.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  phone text unique,
  display_name text not null,
  role text not null default 'player' check (role in ('admin', 'host', 'player')),
  approved boolean not null default false, -- hosts must be approved by an admin before they can create games
  created_at timestamptz not null default now()
);

-- bootstrap: after your first sign-in, run this once with your own uid to become super admin
-- update profiles set role = 'admin', approved = true where id = '<your-auth-uid>';

create table known_players (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (host_id, name)
);

create table games (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  location text,
  status text not null default 'live' check (status in ('live', 'settled')),
  rake integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  known_player_id uuid references known_players(id) on delete set null,
  display_name text not null,
  cashout_amount integer,
  cashed_out_at timestamptz,
  cashout_confirmed boolean not null default false,
  unique (game_id, display_name)
);

create table buyins (
  id uuid primary key default gen_random_uuid(),
  game_player_id uuid not null references game_players(id) on delete cascade,
  amount integer not null default 10000,
  created_at timestamptz not null default now(),
  confirmed boolean not null default false,
  locked_at timestamptz
);

create table settlements (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  from_game_player_id uuid not null references game_players(id) on delete cascade,
  to_game_player_id uuid not null references game_players(id) on delete cascade,
  amount integer not null,
  note text,
  is_custom boolean not null default false,
  paid boolean not null default false,
  paid_at timestamptz
);

create index on known_players (host_id);
create index on game_players (game_id);
create index on game_players (profile_id);
create index on buyins (game_player_id);
create index on settlements (game_id);

-- ── RLS ──
alter table profiles enable row level security;
alter table known_players enable row level security;
alter table games enable row level security;
alter table game_players enable row level security;
alter table buyins enable row level security;
alter table settlements enable row level security;

-- profiles
create policy "profiles readable" on profiles for select using (true);
create policy "profiles self update" on profiles for update using (auth.uid() = id);
create policy "profiles self insert" on profiles for insert with check (auth.uid() = id);
create policy "profiles admin manage" on profiles for update
  using (exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin'));

-- blocks a non-admin from setting their own role/approved via the self-update policy above.
-- auth.uid() is null when the update runs outside a logged-in session (e.g. the SQL Editor,
-- running as a superuser) — RLS already restricts who can reach this point, so it's safe to
-- let those through untouched; this is what makes the one-time admin bootstrap work.
create or replace function prevent_self_promotion() returns trigger as $$
begin
  if auth.uid() is not null
     and not exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin') then
    new.role := old.role;
    new.approved := old.approved;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger profiles_no_self_promotion
  before update on profiles
  for each row execute function prevent_self_promotion();

-- security-definer helpers avoid games <-> game_players RLS recursion: each function runs
-- as the table owner, which bypasses RLS internally, so checking membership doesn't
-- re-trigger the other table's policy and cause Postgres to detect a cycle.
create or replace function is_game_host(gid uuid) returns boolean as $$
  select exists (select 1 from games where id = gid and host_id = auth.uid());
$$ language sql security definer stable;

create or replace function is_game_player(gid uuid) returns boolean as $$
  select exists (select 1 from game_players where game_id = gid and profile_id = auth.uid());
$$ language sql security definer stable;

create or replace function is_host_of_game_player(gp_id uuid) returns boolean as $$
  select exists (
    select 1 from game_players gp join games g on g.id = gp.game_id
    where gp.id = gp_id and g.host_id = auth.uid()
  );
$$ language sql security definer stable;

create or replace function is_self_game_player(gp_id uuid) returns boolean as $$
  select exists (select 1 from game_players where id = gp_id and profile_id = auth.uid());
$$ language sql security definer stable;

create or replace function is_host_of_settlement_game(gid uuid) returns boolean as $$
  select exists (select 1 from games where id = gid and host_id = auth.uid());
$$ language sql security definer stable;

create or replace function is_party_to_settlement(from_gp uuid, to_gp uuid) returns boolean as $$
  select exists (select 1 from game_players where id in (from_gp, to_gp) and profile_id = auth.uid());
$$ language sql security definer stable;

-- known_players: only the host who owns the roster can see/manage it
create policy "known_players host only" on known_players for all
  using (auth.uid() = host_id) with check (auth.uid() = host_id);

-- games: host has full read/update/delete on their own games; INSERT requires admin approval
create policy "games host select" on games for select using (auth.uid() = host_id);
create policy "games host update" on games for update using (auth.uid() = host_id) with check (auth.uid() = host_id);
create policy "games host delete" on games for delete using (auth.uid() = host_id);
create policy "games host create requires approval" on games for insert
  with check (
    auth.uid() = host_id
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('host', 'admin') and p.approved)
  );
create policy "games player read" on games for select using (is_game_player(id));

-- game_players
create policy "game_players host all" on game_players for all
  using (is_game_host(game_id)) with check (is_game_host(game_id));
create policy "game_players self read" on game_players for select using (profile_id = auth.uid());
create policy "game_players self confirm" on game_players for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- buyins
create policy "buyins host all" on buyins for all
  using (is_host_of_game_player(game_player_id)) with check (is_host_of_game_player(game_player_id));
create policy "buyins self read" on buyins for select using (is_self_game_player(game_player_id));
create policy "buyins self confirm" on buyins for update
  using (is_self_game_player(game_player_id)) with check (is_self_game_player(game_player_id));

-- settlements
create policy "settlements host all" on settlements for all
  using (is_host_of_settlement_game(game_id)) with check (is_host_of_settlement_game(game_id));
create policy "settlements party read" on settlements for select
  using (is_party_to_settlement(from_game_player_id, to_game_player_id));
create policy "settlements party mark paid" on settlements for update
  using (is_party_to_settlement(from_game_player_id, to_game_player_id))
  with check (is_party_to_settlement(from_game_player_id, to_game_player_id));
