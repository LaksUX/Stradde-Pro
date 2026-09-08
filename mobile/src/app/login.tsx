// ─── Login (email magic-link) ──────────────────────────────────────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 2, reversed 2026-09-08]
// This was phone OTP via Twilio Verify until this pass. Reversed after
// finding that Indian phone numbers (this app's actual player base) need
// India's DLT (telecom) registration before Twilio will deliver OTP SMS to
// them at all — a multi-day process that expects a registered business
// entity, not something to take on for a home-game app among friends right
// now. Email magic-link reuses exactly what's already live on the web app,
// at the cost of the deep-link round trip this screen and RootLayout handle
// (see RootLayout's createSessionFromUrl) — the friction phone OTP was
// originally chosen to avoid. Revisit phone OTP if DLT registration ever
// makes sense to do for real (see the migration plan for the full tradeoff).
import { useState } from "react"
import { View, KeyboardAvoidingView, Platform } from "react-native"
import { Text, TextInput, Button } from "react-native-paper"
import { makeRedirectUri } from "expo-auth-session"
import { supabase } from "@/lib/supabase"

// Resolves to the app's custom scheme deep link (pokernight://) in a real
// build, or an exp:// URL when running in Expo Go during development — see
// the Phase 2 note in the migration plan about registering both patterns as
// Supabase redirect URLs while testing in Expo Go.
const redirectTo = makeRedirectUri()

type Status = "idle" | "sending" | "sent" | "error"

export default function LoginScreen() {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState("")

  const submit = async () => {
    if (!email.trim() || status === "sending") return
    setStatus("sending")
    setError("")
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: redirectTo },
    })
    if (error) {
      setStatus("error")
      setError(error.message)
      return
    }
    setStatus("sent")
  }

  if (status === "sent") {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg px-6">
        <Text className="text-5xl mb-4">✉️</Text>
        <Text variant="headlineSmall" className="text-white font-bold text-center">
          Check your email
        </Text>
        <Text className="text-white/60 text-sm mt-2 text-center">
          We sent a magic link to {email}. Open it on this device to sign in.
        </Text>
        <Button mode="text" onPress={() => { setStatus("idle"); setError("") }} className="mt-6">
          Use a different email
        </Button>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-felt-bg"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-1 justify-center px-6">
        <Text className="text-5xl mb-4 text-center">♠</Text>
        <Text variant="headlineMedium" className="text-gold mb-1 text-center font-bold">
          Poker Night
        </Text>
        <Text className="text-white/60 mb-8 text-center">Sign in with your email</Text>

        <TextInput
          label="Email"
          mode="outlined"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="you@example.com"
          autoFocus
          className="mb-4"
        />
        <Button
          mode="contained"
          loading={status === "sending"}
          disabled={!email.trim() || status === "sending"}
          onPress={submit}
        >
          Send magic link
        </Button>

        {error ? <Text className="text-red-400 mt-4 text-center">{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  )
}
