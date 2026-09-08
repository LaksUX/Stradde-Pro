// ─── Supabase client (Expo/React Native) ───────────────────────────────────
// Mirrors src/lib/supabase.js on the web app — same project, same anon key,
// same RLS policies (see supabase/schema.sql and the migration in
// supabase/migrations/). Session storage is the one real mobile-specific
// difference: web uses the browser's own localStorage; RN has no such thing,
// so this uses expo-sqlite's localStorage polyfill instead of the older
// AsyncStorage-based pattern (current official Expo+Supabase guidance as of
// SDK 57 — see docs/MOBILE_MIGRATION_PLAN.md Phase 2 for why this needed
// checking rather than assuming).
import "expo-sqlite/localStorage/install"
import { AppState } from "react-native"
import { createClient } from "@supabase/supabase-js"

const url = process.env.EXPO_PUBLIC_SUPABASE_URL
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  console.warn(
    "Supabase env vars missing. Copy .env.example to .env.local and fill in your project URL + anon key (same values as the web app's .env.local)."
  )
}

export const supabase = createClient(url ?? "", anonKey ?? "", {
  auth: {
    storage: localStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false, // no browser URL to inspect on native
  },
})

// Supabase's client-side auto-refresh timer only runs while something is
// actively ticking it — on web that's guaranteed by the page being open, but
// a backgrounded RN app can get suspended entirely. Tie the refresh loop to
// app foreground/background state so a token doesn't go stale while the app
// was backgrounded, and so we're not burning battery refreshing while it's
// not even running.
AppState.addEventListener("change", (state) => {
  if (state === "active") {
    supabase.auth.startAutoRefresh()
  } else {
    supabase.auth.stopAutoRefresh()
  }
})
