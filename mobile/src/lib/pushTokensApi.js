// ─── Push token storage — Phase 4 ──────────────────────────────────────────
// Upserts the signed-in profile's Expo push token into the new
// push_tokens table (supabase/schema.sql / migrations/20260908_phase4_push_tokens.sql).
// One row per (profile, token) — a profile can have more than one device,
// and a fresh install/reinstall gets a new token, so this is an upsert on
// the token itself, not a single column on profiles.
import { supabase } from "./supabase"

export async function savePushToken(profileId, token, platform) {
  if (!profileId || !token) return
  const { error } = await supabase
    .from("push_tokens")
    .upsert({ profile_id: profileId, expo_push_token: token, platform }, { onConflict: "expo_push_token" })
  if (error) throw error
}
