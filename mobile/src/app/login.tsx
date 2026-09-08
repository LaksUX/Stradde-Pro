// ─── Login (email OTP code) ────────────────────────────────────────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 2, revised 2026-09-08]
// Originally built as tap-the-magic-link, matching the web app. That requires
// completing a deep-link round trip (Supabase's /verify endpoint redirecting
// back into the app via its exp:// or pokernight:// URL), which turned out
// to be unreliable while testing in Expo Go: Gmail's in-app browser doesn't
// complete custom-scheme handoffs, and — more fundamentally — Supabase kept
// falling back to the project's Site URL (a different, unrelated app that
// shares this same Supabase project) instead of honoring the exp://<lan-ip>
// redirect_to, even once it was added to Authentication -> URL Configuration
// -> Redirect URLs. Root cause never fully confirmed (see the migration plan
// for the full troubleshooting trail); rather than keep chasing it, switched
// to a mechanism that doesn't need a redirect URL at all.
//
// Supabase's OTP email includes a 6-digit code alongside the link. Verifying
// that code directly via supabase.auth.verifyOtp() needs no link tap, no
// redirect_to, no browser handoff — sidesteps the whole class of problem.
// RootLayout's magic-link deep-link handling (createSessionFromUrl) is left
// in place as a bonus path in case the link ever does complete successfully,
// but code entry is now the primary, reliable flow.
//
// [decision, M3 Expressive restyle, 2026-09-08] Paper's Button/TextInput
// pick up the app's new M3 theme (_layout.tsx) automatically — this screen
// didn't need a rewrite, just a bolder headline treatment (displaySmall
// instead of headlineMedium, a bigger hero glyph) to match the rest of the
// app's push toward bigger, bolder type.
import { useState } from "react"
import { View, KeyboardAvoidingView, Platform } from "react-native"
import { Text, TextInput, Button } from "react-native-paper"
import { supabase } from "@/lib/supabase"

type Stage = "email" | "code"

export default function LoginScreen() {
  const [stage, setStage] = useState<Stage>("email")
  const [email, setEmail] = useState("")
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const sendCode = async () => {
    if (!email.trim() || loading) return
    setLoading(true)
    setError("")
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setStage("code")
  }

  const verifyCode = async () => {
    if (!code.trim() || loading) return
    setLoading(true)
    setError("")
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "email",
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    // Success: verifyOtp() sets the session on the client itself, which
    // fires RootLayout's onAuthStateChange listener and redirects to the
    // signed-in home screen — nothing else to do here.
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-felt-bg"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-1 justify-center px-6">
        <Text className="text-7xl mb-6 text-center">{stage === "email" ? "♠" : "✉️"}</Text>

        {stage === "email" ? (
          <>
            <Text variant="displaySmall" className="text-gold-vivid mb-1 text-center font-black tracking-tight">
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
              loading={loading}
              disabled={!email.trim() || loading}
              onPress={sendCode}
              contentStyle={{ height: 56 }}
              labelStyle={{ fontSize: 15, fontWeight: "800" }}
            >
              Send code
            </Button>
          </>
        ) : (
          <>
            <Text variant="headlineSmall" className="text-white font-black text-center tracking-tight">
              Check your email
            </Text>
            <Text className="text-white/60 text-sm mt-2 mb-8 text-center">
              Enter the 6-digit code we sent to {email}.
            </Text>

            <TextInput
              label="Code"
              mode="outlined"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              placeholder="123456"
              autoFocus
              className="mb-4"
            />
            <Button
              mode="contained"
              loading={loading}
              disabled={!code.trim() || loading}
              onPress={verifyCode}
              contentStyle={{ height: 56 }}
              labelStyle={{ fontSize: 15, fontWeight: "800" }}
            >
              Verify
            </Button>
            <Button
              mode="text"
              onPress={() => { setStage("email"); setCode(""); setError("") }}
              className="mt-2"
            >
              Use a different email
            </Button>
          </>
        )}

        {error ? <Text className="text-red-400 mt-4 text-center">{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  )
}
