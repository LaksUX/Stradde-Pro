// ─── Toast — ported from web App.jsx's Toast ───────────────────────────────
import { View, Text } from "react-native"

export function AppToast({ toast }: { toast: { icon: string; title: string; msg?: string } | null }) {
  if (!toast) return null
  return (
    <View pointerEvents="none" className="absolute bottom-8 left-0 right-0 items-center px-4">
      <View className="flex-row items-center gap-3 bg-felt-surface-2 border border-felt-border rounded-2xl px-4 py-3 max-w-[320px]">
        <Text className="text-lg">{toast.icon}</Text>
        <View className="shrink">
          <Text className="text-sm font-semibold text-zinc-100">{toast.title}</Text>
          {toast.msg ? <Text className="text-xs text-zinc-400 mt-0.5">{toast.msg}</Text> : null}
        </View>
      </View>
    </View>
  )
}
