-- Phase 1 (docs/MOBILE_MIGRATION_PLAN.md) — move game data onto Supabase with
-- real RLS. Safe to run once against the existing live project: every
-- statement is idempotent (IF NOT EXISTS / DROP...IF EXISTS + re-CREATE), so
-- re-running this script by accident is a no-op, not a hazard.
--
-- Run this in the Supabase SQL editor (project: the one VITE_SUPABASE_URL
-- points at). This repo has no Supabase CLI project link, so there is no
-- automated way to apply it — paste and run by hand.
--
-- What this does, in order:
--   1. Creates games/game_players/buyins/settlements/bank_checks if they
--      don't exist yet (in case they were never actually created — schema.sql
--      was written but game data has been localStorage-only this whole time,
--      per REQUIREMENTS.md -> Known gaps -> "No live database on game
--      screens").
--   2. Brings an already-existing copy of those tables up to the current
--      shape: games.status gains the 'cashout' state (was 'live'/'settled'
--      only), games gains last_bank_check_at, known_players gains phone,
--      settlements gains paid_by.
--   3. Adds bank_checks (new table) and two narrowly-scoped RPCs
--      (run_bank_check, claim_my_player_rows) — see comments below for why
--      these need to be RPCs rather than plain client writes.
--   4. (Re)creates every RLS policy these tables need, matching
--      REQUIREMENTS.md -> Roles inside a game.

-- ── games ────────────────────────────────────────────────────────────────
create table if not exists games (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  location text,
  status text not null default 'live' check (status in ('live', 'cashout', 'closed')),
  rake integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_bank_check_at timestamptz
);

-- Existing deployments: migrate the old 2-state status model forward before
-- tightening the constraint, so the ALTER never fails on real rows.
update games set status = 'closed' where status = 'settled';
alter table games drop constraint if exists games_status_check;
alter table games add constraint games_status_check check (status in ('live', 'cashout', 'closed'));
alter table games add column if not exists last_bank_check_at timestamptz;

-- ── game_players ─────────────────────────────────────────────────────────
-- [decision] No separate `status` ('unclaimed'/'claimed') column — it would
-- just be a second source of truth for what `profile_id is null` already
-- says. "Claimed" means profile_id is not null, full stop.
create table if not exists game_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  profile_id uuid references profiles(id) on delete set null,
  known_player_id uuid references known_players(id) on delete set null,
  display_name text not null,
  phone text, -- E.164; the claim-by-phone join key (REQUIREMENTS.md -> Player identity vs. account linking). Nullable: a player added without a phone just never auto-claims.
  cashout_amount integer,
  cashed_out_at timestamptz,
  cashout_confirmed boolean not null default false,
  unique (game_id, display_name)
);

alter table game_players add column if not exists phone text;
create index if not exists game_players_phone_idx on game_players (phone) where phone is not null;

-- ── buyins ───────────────────────────────────────────────────────────────
-- `confirmed` / `locked_at` are legacy columns from an earlier per-buy-in
-- confirm/lock design that predates bank-check locking. The current app
-- never writes them — locking is derived purely from
-- `created_at <= games.last_bank_check_at` (src/core/settlement.js,
-- `lockedCountFor`), same rule on web and (eventually) mobile. Left in place
-- rather than dropped since we can't verify from here whether any row
-- already depends on them; harmless to ignore.
create table if not exists buyins (
  id uuid primary key default gen_random_uuid(),
  game_player_id uuid not null references game_players(id) on delete cascade,
  amount integer not null default 10000,
  created_at timestamptz not null default now(),
  confirmed boolean not null default false,
  locked_at timestamptz
);

-- ── bank_checks (new) ────────────────────────────────────────────────────
-- Append-only audit trail of every bank check a host has run on a game —
-- the server-side equivalent of the local `game.bankChecks` array. Written
-- only via run_bank_check() below, atomically with games.last_bank_check_at,
-- so the two can never drift out of sync.
create table if not exists bank_checks (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  checked_at timestamptz not null default now()
);

-- ── known_players (roster) ───────────────────────────────────────────────
alter table known_players add column if not exists phone text;

-- ── settlements ──────────────────────────────────────────────────────────
-- [decision, not yet built -> now built] paid_at already existed; paid_by is
-- new (REQUIREMENTS.md -> Settlements ledger: "Record who marked a line
-- paid and when"). id was already a stable uuid, not an array index, so the
-- "settlement transfers need stable ids" gap was already closed by the
-- original schema — it just needed the app to actually write here.
alter table settlements add column if not exists paid_by uuid references profiles(id);

create index if not exists games_host_idx on games (host_id);
create index if not exists game_players_game_idx on game_players (game_id);
create index if not exists game_players_profile_idx on game_players (profile_id);
create index if not exists buyins_game_player_idx on buyins (game_player_id);
create index if not exists bank_checks_game_idx on bank_checks (game_id);
create index if not exists settlements_game_idx on settlements (game_id);

-- ── RLS ──────────────────────────────────────────────────────────────────
alter table games enable row level security;
alter table game_players enable row level security;
alter table buyins enable row level security;
alter table bank_checks enable row level security;
alter table settlements enable row level security;
alter table known_players enable row level security;

-- Security-definer helpers (unchanged from the original schema.sql design):
-- these run as the table owner, bypassing RLS internally, so checking
-- membership in one table's policy doesn't re-trigger another table's
-- policy and cause Postgres to detect a recursive cycle.
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

-- known_players: only the host who owns the roster can see/manage it.
drop policy if exists "known_players host only" on known_players;
create policy "known_players host only" on known_players for all
  using (auth.uid() = host_id) with check (auth.uid() = host_id);

-- games: host has full read/write on their own games; a player who's a
-- party to the game (via game_players.profile_id) can read it too, so they
-- can see the game name/location/status their own numbers belong to.
drop policy if exists "games host select" on games;
drop policy if exists "games host update" on games;
drop policy if exists "games host delete" on games;
drop policy if exists "games host create requires approval" on games;
drop policy if exists "games player read" on games;
create policy "games host select" on games for select using (auth.uid() = host_id);
create policy "games host update" on games for update using (auth.uid() = host_id) with check (auth.uid() = host_id);
create policy "games host delete" on games for delete using (auth.uid() = host_id);
create policy "games host create requires approval" on games for insert
  with check (
    auth.uid() = host_id
    and exists (select 1 from profiles p where p.id = auth.uid() and p.role in ('host', 'admin') and p.approved)
  );
create policy "games player read" on games for select using (is_game_player(id));

-- game_players: host has full read/write on every player row in a game they
-- host. A non-host player sees ONLY their own row — never another player's
-- buy-ins/cash-out, which live in separate tables gated the same way below.
-- This is the load-bearing policy for REQUIREMENTS.md -> Roles inside a
-- game; see scripts/test-rls-isolation.mjs for the required proof that it
-- actually holds.
drop policy if exists "game_players host all" on game_players;
drop policy if exists "game_players self read" on game_players;
drop policy if exists "game_players self confirm" on game_players;
create policy "game_players host all" on game_players for all
  using (is_game_host(game_id)) with check (is_game_host(game_id));
create policy "game_players self read" on game_players for select using (profile_id = auth.uid());
create policy "game_players self confirm" on game_players for update
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());

-- buyins: host full access; a player may read their OWN buy-ins only, never
-- another player's in the same game.
drop policy if exists "buyins host all" on buyins;
drop policy if exists "buyins self read" on buyins;
create policy "buyins host all" on buyins for all
  using (is_host_of_game_player(game_player_id)) with check (is_host_of_game_player(game_player_id));
create policy "buyins self read" on buyins for select using (is_self_game_player(game_player_id));

-- bank_checks: host-only. Not a per-player-visible fact today (no
-- requirement says a player needs to see check history), so no self-read
-- policy — narrower is safer, easy to widen later if a screen needs it.
drop policy if exists "bank_checks host all" on bank_checks;
create policy "bank_checks host all" on bank_checks for all
  using (is_game_host(game_id)) with check (is_game_host(game_id));

-- settlements: host full access; either party to a transfer can read it and
-- toggle paid/pending on it (REQUIREMENTS.md -> "single-sided toggle, not a
-- two-party mark/confirm flow").
drop policy if exists "settlements host all" on settlements;
drop policy if exists "settlements party read" on settlements;
drop policy if exists "settlements party mark paid" on settlements;
create policy "settlements host all" on settlements for all
  using (is_game_host(game_id)) with check (is_game_host(game_id));
create policy "settlements party read" on settlements for select
  using (is_party_to_settlement(from_game_player_id, to_game_player_id));
create policy "settlements party mark paid" on settlements for update
  using (is_party_to_settlement(from_game_player_id, to_game_player_id))
  with check (is_party_to_settlement(from_game_player_id, to_game_player_id));

-- ── RPCs ─────────────────────────────────────────────────────────────────

-- Bank-checking a table is two writes that must never happen apart: the
-- audit row (bank_checks) and the fast-path cache column
-- (games.last_bank_check_at) that src/core/settlement.js's lockedCountFor
-- actually reads. A host already has RLS access to do both as separate
-- statements, but only this RPC guarantees they land together.
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

-- [decision] Claiming happens on login by phone match (REQUIREMENTS.md ->
-- Player identity vs. account linking). This can't be a plain client write:
-- the row being claimed lives in a game hosted by someone else, so under
-- the policies above the claiming account has no standing read/write access
-- to it *until* it's claimed — a chicken-and-egg RLS gap that only a
-- security-definer function can bridge safely. It is deliberately narrow:
-- it can only ever set profile_id = auth.uid() (never anyone else's id) on
-- rows whose phone matches the caller's OWN verified profile phone, and
-- only when the row isn't already claimed. Call this once right after
-- ensureProfile() on every sign-in (src/lib/auth.js) — idempotent, claims 0
-- rows when there's nothing new.
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
