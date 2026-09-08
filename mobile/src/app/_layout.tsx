// ─── Root layout ────────────────────────────────────────────────────────────
// Auth gate for the whole app, same shape as App.jsx's session/profile
// bootstrap on web (see App.jsx's auth useEffect): pick up any existing
// session on load, keep listening for sign-in/out, and redirect between
// /login and the signed-in screens based on that state. expo-router has no
// direct equivalent of conditionally rendering a whole different tree the
// way web's App.jsx does (`return <LoginScreen />` vs the rest) — the
// idiomatic version is redirecting based on the current route segment, which
// is what the second effect below does.
import { useEffect, useState } from "react"
import { Slot, useRouter, useSegments } from "expo-router"
import { PaperProvider, MD3DarkTheme } from "react-native-paper"
import type { Session } from "@supabase/supabase-js"
import "../global.css"
import { supabase } from "@/lib/supabase"

// Matches the web app's "casino felt" theme tokens (src/index.css @theme
// block) so the two apps read as the same product, not a restyle.
const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: "#caa043",
    secondary: "#e0bb5c",
    background: "#0a0f0c",
    surface: "#121b16",
    surfaceVariant: "#182620",
    outline: "#24352c",
  },
}

export default function RootLayout() {
  // undefined = "haven't checked yet" (matches App.jsx's authLoading),
  // null = "checked, signed out", Session = "checked, signed in".
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) setSession(data.session)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (mounted) setSession(nextSession)
    })
    return () => {
      mounted = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (session === undefined) return // still checking — don't redirect yet
    const inAuthGroup = segments[0] === "login"
    if (!session && !inAuthGroup) {
      router.replace("/login")
    } else if (session && inAuthGroup) {
      router.replace("/")
    }
  }, [session, segments, router])

  if (session === undefined) {
    // Deliberately blank rather than a spinner — this should resolve in a
    // frame or two from a cached session; a flash of a loading screen on
    // every cold start would be more distracting than a blank one.
    return null
  }

  return (
    <PaperProvider theme={theme}>
      <Slot />
    </PaperProvider>
  )
}
