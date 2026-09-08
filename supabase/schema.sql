-- Poker Night schema (consolidated, for a fresh Supabase project)
-- 1 bank = 10000 of the app's internal integer unit.
--
-- If you're applying this to a project that already ran an older version of
-- this file, don't re-run this one — use
-- supabase/migrations/20260907_phase1_game_data_and_rls.sql instead, which
-- brings an existing deployment up to this same shape without touching
-- (or losing) whatever's already there. This file is the target shape, kept
-- current for anyone setting up a brand-new project from scratch.

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
  phone text, -- E.164; carried onto game_players.phone when this roster entry is added to a game
  profile_id uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (host_id, name)
);

create table games (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  location text,
  -- [decision, REQUIREMENTS.md -> Game lifecycle] Four host-facing steps map
  -- to three stored states: Setup and Buy-ins are both 'live'; Cash-outs and
  -- Settlement are both 'cashout' (the settlement screen edits computed
  -- transfers in-place but doesn't get its own status); 'closed' is the
  -- final, permanent lock.
  status text not null default 'live' check (status in ('live', 'cashout', 'closed')),
  rake integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- [decision, supersedes the old 60s auto-lock] Set only by run_bank_check()
  -- below, atomically with a bank_checks row. src/core/settlement.js's
  -- lockedCountFor reads this directly: a buy-in is locked iff
  -- buyin.created_at <= games.last_bank_check_at.
  last_bank_check_at timestamptz
);

create table game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  -- [decision] No separate `status` ('unclaimed'/'claimed') column — that
  -- would just be a second source of truth for what `profile_id is null`
  -- already says. "Claimed" means profile_id is not null, full stop.
  profile_id uuid references profiles(id) on delete set null,
  known_player_id uuid references known_players(id) on delete set null,
  display_name text not null,
  phone text, -- E.164, captured at add-time; the claim-by-phone join key. Nullable: a player added without a phone just never auto-claims.
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
  -- Legacy columns from an earlier per-buy-in confirm/lock design that
  -- predates bank-check locking. The current app never writes these —
  -- locking is derived purely from created_at vs. games.last_bank_check_at
  -- (see above). Kept rather than dropped in case a future two-sided
  -- confirm flow (REQUIREMENTS.md -> Settlements ledger, "single-sided
  -- toggle... revisit once player accounts exist") wants them back.
  confirmed boolean not null default false,
  locked_at timestamptz
);

-- Append-only audit trail of every bank check a host has run — the
-- server-side twin of the local `game.bankChecks` array. Only written via
-- run_bank_check() below, atomically with games.last_bank_check_at.
create table bank_checks (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  checked_at timestamptz not null default now()
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
  paid_at timestamptz,
  paid_by uuid references profiles(id) -- REQUIREMENTS.md -> "record who marked a line paid and when"
);

create table push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

create index on push_tokens (profile_id);

create index on known_players (host_id);
create index on games (host_id);
create index on game_players (game_id);
create index on game_players (profile_id);
create index on game_players (phone) where phone is not null;
create index on buyins (game_player_id);
create index on bank_checks (game_id);
create index on settlements (game_id);

-- ── RLS ──
alter table profiles enable row level security;
alter table known_players enable row level security;
alter table games enable row level security;
alter table game_players enable row level security;
alter table buyins enable row level security;
alter table bank_checks enable row level security;
alter table settlements enable row level security;
alter table push_tokens enable row level security;

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

create or replace function is_party_to_settlement(from_gp uuid, to_gp uuid) returns boolean as $$
  select exists (select 1 from game_players where id in (from_gp, to_gp) and profile_id = auth.uid());
$$ language sql security definer stable;

-- push_tokens: a profile can only see/manage its own device tokens
create policy "push_tokens own only" on push_tokens for all
  using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- known_players: only the host who owns the roster can see/manage it
create policy "known_players host only" on known_players for all
  using (auth.uid() = host_id) with check (auth.uid() = host_id);

-- games: host has full read/update/delete on their own games; INSERT requires admin approval;
-- a player who's a party to the game can also read it (to see its name/location/status).
create policy "games host select" on games for select using (auth.uid() = host_id);
create policy "games host update" on games for update using (auth.uid() = host_id) with check (auth.uid() = host_id);
create policy "games host delete" on games for delete using (auth.uid() = host_id);
create policy "games host create requires approval" on games for insert
  with check (
    auth.uid() = host_id
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('host', 'admin') and p.approved)
  );
create policy "games player read" on games for select using (is_game_player(id));

-- game_players: host full access; a non-host player sees ONLY their own row —
-- this is the load-bearing policy for "a player never sees another player's
-- numbers" (REQUIREMENTS.md -> Roles inside a game). See
-- scripts/test-rls-isolation.mjs for the required proof.
create policy "game_players host all" on game_players for all
  using (is_game_host(game_id)) with check (is_game_host(game_id));
create policy "game_players self read" on game_players for select using (profile_id = auth.uid());
create policy "game_players self confirm" on game_players for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- buyins: host full access; a player may read their OWN buy-ins only
create policy "buyins host all" on buyins for all
  using (is_host_of_game_player(game_player_id)) with check (is_host_of_game_player(game_player_id));
create policy "buyins self read" on buyins for select using (is_self_game_player(game_player_id));

-- bank_checks: host-only (not currently a player-visible fact)
create policy "bank_checks host all" on bank_checks for all
  using (is_game_host(game_id)) with check (is_game_host(game_id));

-- settlements: host full access; either party to a transfer can read it and
-- toggle paid/pending on it (single-sided toggle, not two-party confirm — see REQUIREMENTS.md)
create policy "settlements host all" on settlements for all
  using (is_game_host(game_id)) with check (is_game_host(game_id));
create policy "settlements party read" on settlements for select
  using (is_party_to_settlement(from_game_player_id, to_game_player_id));
create policy "settlements party mark paid" on settlements for update
  using (is_party_to_settlement(from_game_player_id, to_game_player_id))
  with check (is_party_to_settlement(from_game_player_id, to_game_player_id));

-- ── RPCs ──

-- Bank-checking a table is two writes that must never happen apart: the
-- audit row (bank_checks) and the fast-path cache column
-- (games.last_bank_check_at) that lockedCountFor actually reads.
create or replace function run_bank_check(p_game_id uuid) returns timestamptz as $$
declare
  ts timestamptz := now();
begin
  if not exists (select 1 from games where id = p_game_id and host_id = auth.uid()) then
    raise exception 'not authorized to bank-check this game';
  end if;
  insert into bank_checks (game_id, checked_at) values (p_game_id, ts);
  update games set last_bank_check_at = ts where id = p_game_id;
  return ts;
end;
$$ language plpgsql security definer;

revoke all on function run_bank_check(uuid) from public;
grant execute on function run_bank_check(uuid) to authenticated;

-- [decision] Claiming happens on login by phone match. Deliberately narrow:
-- can only set profile_id = auth.uid() (never anyone else's id) on rows
-- whose phone matches the caller's OWN verified profile phone, only when
-- unclaimed. Needs security definer because the claiming account has no
-- standing RLS access to a row it doesn't own yet — a chicken-and-egg gap
-- only this kind of function can bridge safely. Call once after
-- ensureProfile() on every sign-in.
create or replace function claim_my_player_rows() returns integer as $$
declare
  my_phone text;
  claimed_count integer;
begin
  select phone into my_phone from profiles where id = auth.uid();
  if my_phone is null then
    return 0;
  end if;
  update game_players
    set profile_id = auth.uid()
    where phone = my_phone and profile_id is null;
  get diagnostics claimed_count = row_count;
  return claimed_count;
end;
$$ language plpgsql security definer;

revoke all on function claim_my_player_rows() from public;
grant execute on function claim_my_player_rows() to authenticated;
