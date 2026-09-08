// ─── Shared game-screen UI primitives — ported from web App.jsx ───────────
// RN/NativeWind equivalents of App.jsx's NumB, Dot, Av, AppSheet, Keypad,
// BuyinSlider, SL. Kept in one file since none of these are large enough to
// warrant their own, and it mirrors how App.jsx itself keeps them together
// as small top-of-file helpers. A few web-only decorative touches are
// dropped rather than ported 1:1 (see inline notes) — CSS radial-gradient
// avatars, box-shadow glow on status dots, and `hover:` states don't have a
// meaningful RN equivalent and aren't worth a new dependency for polish
// alone; can revisit if it's worth it once this is actually seen running.
import { View, Text, Pressable, Modal, ScrollView } from "react-native"
import Slider from "@react-native-community/slider"
import { BANK, fmtBankNum } from "@core/money"

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ")
}

// ─── Bank-unit number display: bold number + small muted "bank(s)" unit ───
// A single RN <Text> tree, not <View>+<Text> — color set via `className` on
// the root is meant to be INHERITED by the value span below (RN inherits
// text style across nested <Text>, unlike <View>), while the unit label
// explicitly overrides back to a fixed muted color either way. Matches
// web's NumB, where the outer element's color cascades to the plain <b>
// but the muted unit span sets its own color regardless of caller.
export function NumB({
  value,
  sign = false,
  size = "text-sm",
  className = "",
}: {
  value: number
  sign?: boolean
  size?: string
  className?: string
}) {
  const bankCount = Math.abs(value) / BANK
  const label = bankCount === 1 ? "bank" : "banks"
  const prefix = sign ? (value > 0 ? "+" : value < 0 ? "−" : "") : ""
  return (
    <Text className={cn("font-mono", className)}>
      <Text className={cn("font-extrabold", size)}>
        {prefix}
        {fmtBankNum(value)}
      </Text>
      <Text> </Text>
      <Text className="text-[10px] font-semibold text-zinc-500">{label}</Text>
    </Text>
  )
}

// ─── Small status dot (in-play/locked/settled state) ──────────────────────
// [decision, M3 structural pass, 2026-09-08] Bumped from w-2/h-2 to
// w-2.5/h-2.5 and "indigo" moved from gold-light to gold-vivid, matching
// the same bolder-dot decision made on web.
export function Dot({ color = "zinc", className = "" }: { color?: "indigo" | "emerald" | "red" | "zinc"; className?: string }) {
  const map: Record<string, string> = {
    indigo: "bg-gold-vivid",
    emerald: "bg-emerald-400",
    red: "bg-red-400",
    zinc: "bg-felt-outline",
  }
  return <View className={cn("w-2.5 h-2.5 rounded-full", map[color] || map.zinc, className)} />
}

// ─── Avatar — solid color (hashed from name) + initials, not web's gradient
// [decision, M3 Expressive restyle, 2026-09-08] Bumped from Tailwind's 600-
// shades to their brighter/more saturated 500-shades — a small, low-risk
// way for avatars specifically to read as bolder without touching the
// hashing logic or the felt/gold/mint/bloom brand palette itself.
const AV_COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#ef4444", "#ec4899", "#f59e0b", "#3b82f6", "#6366f1"]
function avColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  return AV_COLORS[Math.abs(h) % AV_COLORS.length]
}
const initials = (n: string) => n.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()

export function Av({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <View
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: avColor(name) }}
      className="items-center justify-center"
    >
      <Text style={{ fontSize: size * 0.4, letterSpacing: 0.3 }} className="text-white font-extrabold">
        {initials(name)}
      </Text>
    </View>
  )
}

// ─── Section label ──────────────────────────────────────────────────────────
export function SL({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <View className="px-5 mt-4 mb-1.5 flex-row items-center justify-between">
      <Text className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">{children}</Text>
      {action}
    </View>
  )
}

// ─── Bottom sheet — RN Modal standing in for web's shadcn Sheet/Radix Dialog
// No drag-to-dismiss (web's Radix Sheet doesn't rely on it functionally
// either — the X tap target and backdrop tap both close it there too), so
// this is a reasonable straight swap: same open/onClose contract, same
// title/subtitle/avatar header shape as web's AppSheet.
export function AppSheet({
  open,
  onClose,
  title,
  subtitle,
  avatar,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string | null
  subtitle?: string
  avatar?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/60" onPress={onClose} />
        <View className="bg-felt-surface-3 border-t border-felt-outline rounded-t-[28px] px-5 pt-3.5 pb-8 max-h-[85%]">
          <View className="w-11 h-1.5 rounded-full bg-felt-outline self-center mb-4" />
          <View className="flex-row items-center gap-3 mb-4">
            {avatar}
            <View className="flex-1">
              {title ? <Text className="text-white font-extrabold text-base">{title}</Text> : null}
              {subtitle ? <Text className="text-zinc-400 text-xs mt-0.5">{subtitle}</Text> : null}
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.9 : 1 }] })}
              className="w-9 h-9 rounded-full bg-felt-surface-2 border border-felt-border items-center justify-center"
            >
              <Text className="text-zinc-400 text-xs">✕</Text>
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>{children}</ScrollView>
        </View>
      </View>
    </Modal>
  )
}

// ─── Centered dialog — RN Modal standing in for web's shadcn Dialog/Radix ──
// Used for the smaller confirm/review popups (Bank Check, Edit Player, End
// Cash-outs review) as opposed to AppSheet's bottom-sheet treatment, same
// split web keeps between its Dialog and Sheet primitives.
export function AppDialog({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  children?: React.ReactNode
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center px-6">
        <Pressable className="absolute inset-0 bg-black/60" onPress={onClose} />
        <View className="w-full max-w-[340px] bg-felt-surface-3 border border-felt-outline rounded-[28px] p-[18px]">
          {title ? <Text className="text-white font-bold text-base mb-1">{title}</Text> : null}
          {description ? <Text className="text-zinc-400 text-xs mb-3">{description}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  )
}

// ─── Segmented tabs — stand-in for web's shadcn Tabs (used on Home's
// Overview/Settlements and Create Game's player-source selector) ──────────
// [decision, M3 Expressive restyle, 2026-09-08] Active pill switched from
// gold (primary) to bloom (tertiary) — gold is already the dominant CTA
// color everywhere else on screen, so a tab selector in the same hue reads
// as "another button," not a distinct control. Tertiary is M3's own
// prescription for exactly this kind of secondary-emphasis selection UI,
// and gives the app a genuine second/third hue instead of an all-gold look.
export function SegTabs({ tabs, active, onChange }: { tabs: string[]; active: string; onChange: (t: string) => void }) {
  return (
    <View className="flex-row bg-felt-surface-2/70 border border-felt-border rounded-full p-1">
      {tabs.map((t) => (
        <Pressable
          key={t}
          onPress={() => onChange(t)}
          // [fix, 2026-09-08] shadow-md used to be a NativeWind class here,
          // toggled on/off per-tab via the `active === t &&` conditional.
          // Dynamically toggling a `shadow-*` className through NativeWind's
          // runtime CSS interop is a known race condition with Expo Router's
          // navigation context init (nativewind/nativewind#1711) — it threw
          // "Couldn't find a navigation context" on every tab tap. Moved the
          // shadow to a plain RN style object (computed here, not through
          // NativeWind) so it never touches that interop path.
          style={({ pressed }) => [
            { transform: [{ scale: pressed ? 0.96 : 1 }] },
            active === t
              ? { shadowColor: "#000", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 3 }
              : null,
          ]}
          className={cn("flex-1 h-9 rounded-full items-center justify-center", active === t && "bg-bloom")}
        >
          <Text className={cn("text-xs font-bold", active === t ? "text-white" : "text-zinc-400")}>{t}</Text>
        </Pressable>
      ))}
    </View>
  )
}

// ─── Progress bar — plain View-based stand-in for web's shadcn Progress ───
export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <View className={cn("h-2 rounded-full bg-felt-surface-2 overflow-hidden", className)}>
      <View className="h-full rounded-full bg-mint" style={{ width: `${pct}%` }} />
    </View>
  )
}

// ─── Calculator-style numeric keypad ───────────────────────────────────────
export function Keypad({
  onDigit,
  onBackspace,
  onClear,
}: {
  onDigit: (d: string) => void
  onBackspace: () => void
  onClear: () => void
}) {
  const keys = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "⌫", "0", "C"]
  return (
    <View className="flex-row flex-wrap justify-between">
      {keys.map((k) => (
        <Pressable
          key={k}
          onPress={() => (k === "⌫" ? onBackspace() : k === "C" ? onClear() : onDigit(k))}
          style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.93 : 1 }] })}
          className={cn(
            "w-[31%] h-14 mb-2.5 rounded-2xl items-center justify-center",
            k === "⌫" || k === "C" ? "bg-felt-surface-3" : "bg-felt-surface-2 border border-felt-border"
          )}
        >
          <Text className="text-zinc-100 text-lg font-bold font-mono">{k}</Text>
        </Pressable>
      ))}
    </View>
  )
}

// ─── Buy-in slider (0–30, ticks every 5) ───────────────────────────────────
// `min` floors the range at the player's already-locked buy-in count, same
// contract as web's BuyinSlider — see that component's own comment in
// App.jsx for the full reasoning. The gold-dark bar under the track is a
// best-effort visual echo of web's locked-region overlay; @react-native-
// community/slider doesn't expose track segments directly, so this just
// layers a positioned View behind it.
// [decision, M3 Expressive restyle, 2026-09-08] Slider tint colors are
// hardcoded hex (this native component takes color props, not classNames)
// so they can't ride the Tailwind token swap automatically — bumped by
// hand to the same new gold.vivid/gold.light/felt.outline values so the
// slider matches the rest of the bolder gold accent everywhere else.
export function BuyinSlider({
  value,
  onChange,
  max = 30,
  min = 0,
}: {
  value: number
  onChange: (v: number) => void
  max?: number
  min?: number
}) {
  const allLocked = min > 0 && value === min
  return (
    <View>
      <View className="relative justify-center h-9">
        {min > 0 && (
          <View
            pointerEvents="none"
            className="absolute h-2 rounded-l-full bg-gold-dark/70 z-10"
            style={{ left: 0, width: `${(min / max) * 100}%` }}
          />
        )}
        <Slider
          value={value}
          minimumValue={min}
          maximumValue={max}
          step={1}
          disabled={allLocked}
          minimumTrackTintColor="#e3a71c"
          maximumTrackTintColor="#4d6658"
          thumbTintColor="#f4dca4"
          onValueChange={(v) => onChange(Math.max(min, Math.round(v)))}
        />
      </View>
      <View className="flex-row justify-between px-0.5 mt-1">
        {[0, 5, 10, 15, 20, 25, 30].map((t) => (
          <Text key={t} className="text-[10px] font-mono text-zinc-400">
            {t}
          </Text>
        ))}
      </View>
      {min > 0 && (
        <Text className="text-center text-[10.5px] text-zinc-400 mt-1.5">
          {allLocked ? "All buy-ins so far are locked — drag right to add more" : `First ${min} locked — can't go below that`}
        </Text>
      )}
    </View>
  )
}
