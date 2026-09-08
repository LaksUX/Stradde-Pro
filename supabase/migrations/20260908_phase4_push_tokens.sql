-- Phase 4 (docs/MOBILE_MIGRATION_PLAN.md) — add push_tokens for the mobile
-- app's push-notification registration (client half only — see that file's
-- Phase 4 section for what's built and what still needs server-side work).
-- Safe to run once against the existing live project: idempotent
-- (IF NOT EXISTS throughout), so re-running by accident is a no-op.
--
-- Run this in the Supabase SQL editor (project: the one
-- EXPO_PUBLIC_SUPABASE_URL / VITE_SUPABASE_URL points at). This repo has no
-- Supabase CLI project link, so there is no automated way to apply it —
-- paste and run by hand, same as the Phase 1 migration.

create table if not exists push_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  expo_push_token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now()
);

create index if not exists push_tokens_profile_id_idx on push_tokens (profile_id);

alter table push_tokens enable row level security;

drop policy if exists "push_tokens own only" on push_tokens;
create policy "push_tokens own only" on push_tokens for all
  using (auth.uid() = profile_id) with check (auth.uid() = profile_id);
