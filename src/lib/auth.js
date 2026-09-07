import { supabase } from "./supabase"
import { claimMyPlayerRows } from "./gamesApi"

// [decision, REQUIREMENTS.md -> Player identity vs. account linking]
// Claiming happens on login by phone match. Best-effort and non-blocking:
// a failure here shouldn't stop the person from signing in, it just means
// their player rows stay unclaimed until the next successful sign-in.
async function claimPlayerRowsQuietly() {
  try {
    await claimMyPlayerRows()
  } catch (err) {
    console.warn("claimMyPlayerRows failed (non-fatal):", err)
  }
}

// Ensures a `profiles` row exists for the given auth user.
// Never attempts to set role/approved — the DB trigger blocks self-promotion
// anyway, and new accounts should silently land on the table defaults
// ('player', approved = false).
export async function ensureProfile(user) {
  const { data: existing, error: selectError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle()

  if (selectError) throw selectError
  if (existing) {
    await claimPlayerRowsQuietly()
    return existing
  }

  const defaultName = user.email ? user.email.split("@")[0] : (user.phone || "Player")

  const { data: inserted, error: insertError } = await supabase
    .from("profiles")
    .insert({ id: user.id, email: user.email || null, phone: user.phone || null, display_name: defaultName })
    .select("*")
    .single()

  if (insertError) throw insertError
  await claimPlayerRowsQuietly()
  return inserted
}

export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle()
  if (error) throw error
  return data
}
