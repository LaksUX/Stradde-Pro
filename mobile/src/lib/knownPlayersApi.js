// ─── Shared roster — Supabase-backed (Phase 1, ported for mobile Phase 3) ──
// Duplicated from the web app's src/lib/knownPlayersApi.js — see
// mobile/src/lib/gamesApi.js's header comment for why this file is
// duplicated rather than cross-imported (its `./supabase` import needs to
// resolve to this platform's client). Keep in sync by hand if the web
// version changes.

import { supabase } from "./supabase"

export async function fetchRoster(hostId) {
  const { data, error } = await supabase
    .from("known_players")
    .select("*")
    .eq("host_id", hostId)
    .order("name", { ascending: true })
  if (error) throw error
  return (data || []).map((r) => ({ id: r.id, name: r.name, phone: r.phone || "" }))
}

// Add-or-update, dedupe by name case-insensitive — mirrors the web app's
// src/lib/roster.js upsertRoster behavior. Returns the upserted row's id.
export async function upsertRosterEntry(hostId, name, phone) {
  const n = (name || "").trim()
  const ph = (phone || "").trim()
  if (!n) return null

  const { data: existing, error: findError } = await supabase
    .from("known_players")
    .select("id, phone")
    .eq("host_id", hostId)
    .ilike("name", n)
    .maybeSingle()
  if (findError) throw findError

  if (existing) {
    const { error: updateError } = await supabase
      .from("known_players")
      .update({ name: n, phone: ph || existing.phone || null })
      .eq("id", existing.id)
    if (updateError) throw updateError
    return existing.id
  }

  const { data: inserted, error: insertError } = await supabase
    .from("known_players")
    .insert({ host_id: hostId, name: n, phone: ph || null })
    .select("id")
    .single()
  if (insertError) throw insertError
  return inserted.id
}
