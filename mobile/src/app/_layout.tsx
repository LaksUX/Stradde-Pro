// ─── Root layout ────────────────────────────────────────────────────────────
// Auth gate for the whole app, backed by AppStateProvider (mobile/src/lib/
// AppContext.tsx) which now owns session/profile bootstrap the way
// App.jsx's App root does — this file wraps the tree in that provider and
// redirects between /login and the signed-in screens based on its session
// state, and renders the shared toast once here rather than per-screen. The
// magic-link deep-link handling is kept as a "bonus path" per
// docs/MOBILE_MIGRATION_PLAN.md's Phase 2 note: OTP-code entry (login.tsx)
// is the primary sign-in flow now, but a magic-link URL will still complete
// sign-in here if one ever arrives.
import { useEffect } from "react"
import { Slot, useRouter, useSegments } from "expo-router"
import { PaperProvider, MD3DarkTheme } from "react-native-paper"
import * as Linking from "expo-linking"
import * as QueryParams from "expo-auth-session/build/QueryParams"
import "../global.css"
import { supabase } from "@/lib/supabase"
import { AppStateProvider, useAppState } from "@/lib/AppContext"
import { AppToast } from "@/components/Toast"

// ─── Material 3 Expressive theme, 2026-09-08 ───────────────────────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> M3 Expressive restyle] Full
// MD3 dark color-role set, not just the handful of keys the old felt/gold
// theme touched — real primary/secondary/tertiary pairs with their
// container + on-* counterparts, so Paper's own components (login.tsx's
// TextInput/Button — the one screen that actually uses Paper widgets
// directly) get authentic M3 ripple/elevation/state-layer behavior instead
// of falling back to MD3DarkTheme's default purple. Same hex values as
// mobile/tailwind.config.js's new token families (gold=primary,
// mint=secondary, bloom=tertiary, felt.surface-3/4=the extra elevation
// tiers) so Paper-driven and NativeWind-driven UI read as one system.
const theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary: "#b68616",
    onPrimary: "#2d2106",
    primaryContainer: "#5b430b",
    onPrimaryContainer: "#f9edd2",
    secondary: "#3b9169",
    onSecondary: "#ffffff",
    secondaryContainer: "#1e4834",
    onSecondaryContainer: "#dbf0e6",
    tertiary: "#a52777",
    onTertiary: "#ffffff",
    tertiaryContainer: "#53133b",
    onTertiaryContainer: "#f5d6ea",
    background: "#0a0f0c",
    onBackground: "#e3e8e5",
    surface: "#121b16",
    onSurface: "#e3e8e5",
    surfaceVariant: "#182620",
    onSurfaceVariant: "#c5d3cc",
    outline: "#4d6658",
    outlineVariant: "#24352c",
    error: "#db3624",
    onError: "#ffffff",
    errorContainer: "#58160e",
    onErrorContainer: "#f8d7d3",
  },
}

// Completes sign-in from a magic-link deep link (see login.tsx). Unlike web
// — where Supabase's client reads the same tokens straight out of the
// browser's own URL bar (detectSessionInUrl) — there's no browser URL here,
// just whatever URL opened the app, so this has to explicitly parse it and
// hand the tokens to setSession() itself.
async function createSessionFromUrl(url: string) {
  const { params, errorCode } = QueryParams.getQueryParams(url)
  if (errorCode) throw new Error(errorCode)
  const { access_token, refresh_token } = params as {
    access_token?: string
    refresh_token?: string
  }
  if (!access_token || !refresh_token) return // not a magic-link URL — ignore
  const { error } = await supabase.auth.setSession({ access_token, refresh_token })
  if (error) throw error
}

// Split out from RootLayout so it can call useAppState() — the provider has
// to be an ancestor of this, not a sibling.
function RootLayoutNav() {
  const { authLoading, session, toast } = useAppState()
  const router = useRouter()
  const segments = useSegments()
  const url = Linking.useLinkingURL()

  useEffect(() => {
    if (!url) return
    createSessionFromUrl(url).catch((err) => {
      console.error("Magic-link sign-in failed", err)
    })
  }, [url])

  useEffect(() => {
    if (authLoading) return // still checking — don't redirect yet
    const inAuthGroup = segments[0] === "login"
    if (!session && !inAuthGroup) {
      router.replace("/login")
    } else if (session && inAuthGroup) {
      router.replace("/")
    }
  }, [authLoading, session, segments, router])

  if (authLoading) {
    // Deliberately blank rather than a spinner — this should resolve in a
    // frame or two from a cached session; a flash of a loading screen on
    // every cold start would be more distracting than a blank one.
    return null
  }

  return (
    <>
      <Slot />
      <AppToast toast={toast} />
    </>
  )
}

export default function RootLayout() {
  return (
    <PaperProvider theme={theme}>
      <AppStateProvider>
        <RootLayoutNav />
      </AppStateProvider>
    </PaperProvider>
  )
}
