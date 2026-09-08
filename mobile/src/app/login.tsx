// ─── Login (phone OTP) ──────────────────────────────────────────────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 2] Phone OTP via Twilio
// Verify, not email magic-link — chosen for mobile specifically because a
// magic link means leaving the app to the Mail app and back (deep-link
// handling, more friction) where a 6-digit code doesn't. This was blocked on
// the web app by Twilio trial-account number-verification limits; if that's
// still the case, sending a code to an unverified number will fail here with
// a Supabase/Twilio error surfaced below, not a silent failure — check the
// Twilio Verify compliance profile status if that happens.
import { useState } from "react"
import { View, KeyboardAvoidingView, Platform } from "react-native"
import { Text, TextInput, Button } from "react-native-paper"
import { supabase } from "@/lib/supabase"

type Stage = "phone" | "code"

export default function LoginScreen() {
  const [phone, setPhone] = useState("")
  const [code, setCode] = useState("")
  const [stage, setStage] = useState<Stage>("phone")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sendCode = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({ phone: phone.trim() })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    setStage("code")
  }

  const verifyCode = async () => {
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({
      phone: phone.trim(),
      token: code.trim(),
      type: "sms",
    })
    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }
    // No manual navigation here — RootLayout's onAuthStateChange listener
    // picks up the new session and redirects away from /login itself, same
    // as web's App.jsx reacting to the same event.
  }

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-felt-bg"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View className="flex-1 justify-center px-6">
        <Text variant="headlineMedium" className="text-gold mb-1 text-center font-bold">
          Poker Night
        </Text>
        <Text className="text-white/60 mb-8 text-center">
          {stage === "phone" ? "Sign in with your phone number" : `Enter the code sent to ${phone}`}
        </Text>

        {stage === "phone" ? (
          <>
            <TextInput
              label="Phone number"
              mode="outlined"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              placeholder="+15550142"
              autoFocus
              className="mb-4"
            />
            <Button
              mode="contained"
              loading={loading}
              disabled={loading || !phone.trim()}
              onPress={sendCode}
            >
              Send code
            </Button>
          </>
        ) : (
          <>
            <TextInput
              label="6-digit code"
              mode="outlined"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              className="mb-4"
            />
            <Button
              mode="contained"
              loading={loading}
              disabled={loading || !code.trim()}
              onPress={verifyCode}
            >
              Verify
            </Button>
            <Button mode="text" onPress={() => { setStage("phone"); setCode(""); setError(null) }} className="mt-2">
              Use a different number
            </Button>
          </>
        )}

        {error ? <Text className="text-red-400 mt-4 text-center">{error}</Text> : null}
      </View>
    </KeyboardAvoidingView>
  )
}
