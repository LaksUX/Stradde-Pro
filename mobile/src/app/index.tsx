// ─── Home (Phase 2 deliverable: empty home screen, signed in) ──────────────
// Deliberately minimal — this is the "you're signed in, the pipes work" proof
// for Phase 2, not a real screen. Phase 3 replaces this with the actual
// ported Home dashboard (Host/Player tabs, settlement sections — see
// docs/MOBILE_MIGRATION_PLAN.md Phase 3 for the port order).
import { useEffect, useState } from "react"
import { View } from "react-native"
import { Text, Button } from "react-native-paper"
import { supabase } from "@/lib/supabase"

export default function HomeScreen() {
  const [identity, setIdentity] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setIdentity(data.user?.phone || data.user?.email || null)
    })
  }, [])

  return (
    <View className="flex-1 items-center justify-center bg-felt-bg px-6">
      <Text variant="headlineSmall" className="text-gold mb-2 font-bold">
        Poker Night
      </Text>
      <Text className="text-white/80 mb-8">
        {identity ? `Signed in as ${identity}` : "Signed in"}
      </Text>
      <Button mode="outlined" onPress={() => supabase.auth.signOut()}>
        Sign out
      </Button>
    </View>
  )
}
