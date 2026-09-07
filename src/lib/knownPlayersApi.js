// ─── Shared roster — Supabase-backed (Phase 1) ─────────────────────────────
// Async equivalents of src/lib/roster.js's loadRoster/upsertRoster, reading
// and writing known_players instead of localStorage. Not wired into any
// screen yet — see the Phase 1 note at the top of roster.js for why this is
// a separate, already-landed building block rather than an in-place swap.
//
// Preserves roster.js's exact case-insensitive-by-name upsert behavior even
// though known_players' own unique constraint is on (host_id, name) exactly
// — matching case-sensitively at the DB level would let "Arjun" and "arjun"
// silently become two rows, which is not how the local version has ever
// behaved.

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

// Add-or-update, dedupe by name case-insensitive — mirrors
// src/lib/roster.js's upsertRoster. Returns the upserted row's id.
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
