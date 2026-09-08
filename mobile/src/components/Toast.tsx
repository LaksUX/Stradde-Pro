// ─── Toast — ported from web App.jsx's Toast ───────────────────────────────
// [decision, M3 Expressive restyle, 2026-09-08] Bumped to felt-surface-3 +
// felt-outline so a toast — a transient, attention-grabbing surface — reads
// as clearly "floating above" the screen behind it, matching the same
// elevation treatment given to AppSheet/AppDialog rather than blending into
// the same felt-surface-2 tone as ordinary inline cards.
import { View, Text } from "react-native"

export function AppToast({ toast }: { toast: { icon: string; title: string; msg?: string } | null }) {
  if (!toast) return null
  return (
    <View pointerEvents="none" className="absolute bottom-8 left-0 right-0 items-center px-4">
      <View className="flex-row items-center gap-3 bg-felt-surface-3 border border-felt-outline rounded-2xl px-4.5 py-3.5 max-w-[320px]">
        <Text className="text-xl">{toast.icon}</Text>
        <View className="shrink">
          <Text className="text-sm font-bold text-zinc-100">{toast.title}</Text>
          {toast.msg ? <Text className="text-xs text-zinc-400 mt-0.5">{toast.msg}</Text> : null}
        </View>
      </View>
    </View>
  )
}
