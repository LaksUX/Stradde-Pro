// ─── Game Detail — ported from web App.jsx's GameDetailScreen ─────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 3] Reads selGame/
// selGameAsHost from AppStateContext (mobile/src/lib/AppContext.tsx) since
// expo-router has no built-in way to pass a whole game object as a route
// param — set by viewGameDetail() right before router.push("/game-detail"),
// same shape as web's App-root selGame/selGameAsHost. Two very different
// views depending on isHost, same split as web: a host sees the full
// breakdown (pot, players, rake, leaderboard, payments with a paid
// toggle); a player sees only their own three numbers.
import { useState } from "react"
import { View, Text, ScrollView, Pressable } from "react-native"
import { useRouter } from "expo-router"
import { useAppState } from "@/lib/AppContext"
import { fmtB } from "@core/money"
import { totalBuyinsFor, computeSettlement } from "@core/settlement"
import { NumB, Av, SL, cn } from "@/components/game-ui"

export default function GameDetailRoute() {
  const router = useRouter()
  const { selGame: game, selGameAsHost, hostName, toggleSettlementPaid } = useAppState()

  if (!game) {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg px-6">
        <Text className="text-zinc-400 text-sm text-center">No game selected.</Text>
        <Pressable onPress={() => router.replace("/")} className="mt-5 h-11 px-6 rounded-full bg-felt-surface-2 border border-felt-outline items-center justify-center">
          <Text className="text-zinc-300 text-sm font-semibold">Back</Text>
        </Pressable>
      </View>
    )
  }

  const reallyHosted = !game.hostName || game.hostName === hostName
  const isHost = selGameAsHost && reallyHosted
  const onBack = () => router.back()
  const onNavigateLive = () => router.push((game.status === "cashout" ? "/cashout-entry" : "/live-game") as never)

  return isHost ? (
    <HostView game={game} onBack={onBack} onNavigateLive={onNavigateLive} onTogglePaid={toggleSettlementPaid} />
  ) : (
    <PlayerView game={game} viewerName={hostName} onBack={onBack} />
  )
}

function PlayerView({ game, viewerName, onBack }: { game: any; viewerName: string | null; onBack: () => void }) {
  const me = game.players.find((p: any) => p.name === viewerName)
  const myIn = me ? totalBuyinsFor(me) : 0
  const myOut = me?.cashoutAmount || 0
  const myNet = myOut - myIn

  return (
    <View className="flex-1 bg-felt-bg">
      <ScrollView>
        <View className="px-5 pt-14 pb-6 border-b border-felt-border">
          <Pressable onPress={onBack} className="flex-row items-center gap-1.5 mb-5">
            <Text className="text-zinc-400 text-sm">✕</Text>
            <Text className="text-zinc-400 text-sm">Back</Text>
          </Pressable>
          <Text className="text-white text-xl font-black tracking-tight">{game.name}</Text>
          <Text className="text-zinc-400 text-sm mt-1">
            {game.date} · hosted by {game.hostName}
          </Text>
        </View>
        <View className="px-5 pt-5 gap-2.5 pb-10">
          <View className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-[18px] flex-row items-center justify-between">
            <Text className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Your buy-ins</Text>
            <NumB value={myIn} size="text-lg" className="text-white" />
          </View>
          <View className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-[18px] flex-row items-center justify-between">
            <Text className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Your cash-out</Text>
            <NumB value={myOut} size="text-lg" className="text-white" />
          </View>
          <View className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-[18px] flex-row items-center justify-between">
            <Text className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Your net</Text>
            <NumB value={myNet} sign size="text-xl" className={myNet >= 0 ? "text-emerald-400" : "text-red-400"} />
          </View>
        </View>
      </ScrollView>
    </View>
  )
}

function HostView({
  game,
  onBack,
  onNavigateLive,
  onTogglePaid,
}: {
  game: any
  onBack: () => void
  onNavigateLive: () => void
  onTogglePaid: (t: any) => void
}) {
  const [rakeVisible, setRakeVisible] = useState(false)
  const totalIn = game.players.reduce((s: number, p: any) => s + totalBuyinsFor(p), 0)
  const rake = game.rake || 0
  const isClosed = game.status === "closed"
  // A closed game's settlement was computed once at close time and stored
  // — read here, never recomputed, so history can't drift. A still-live
  // game (viewed via its in-progress card) computes a live preview.
  const txns = isClosed && game.settlement ? game.settlement : computeSettlement(game.players)
  const positions = game.players
    .map((p: any) => ({ name: p.name, net: Math.round((p.cashoutAmount || 0) - totalBuyinsFor(p)) }))
    .sort((a: any, b: any) => b.net - a.net)
  const medals = ["🥇", "🥈", "🥉"]

  return (
    <View className="flex-1 bg-felt-bg">
      <ScrollView>
        <View className="px-5 pt-14 pb-6 border-b border-felt-border">
          <Pressable onPress={onBack} className="flex-row items-center gap-1.5 mb-5">
            <Text className="text-zinc-400 text-sm">✕</Text>
            <Text className="text-zinc-400 text-sm">Back</Text>
          </Pressable>
          <View className="flex-row items-center gap-2">
            <Text className="text-white text-xl font-black tracking-tight">{game.name}</Text>
            {isClosed ? (
              <Text className="text-[9.5px] font-extrabold uppercase tracking-wide px-2.5 py-1 rounded-full bg-felt-surface-3 text-zinc-400 border border-felt-outline">
                Closed
              </Text>
            ) : (
              <View className="flex-row items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30">
                <View className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <Text className="text-[9.5px] font-extrabold uppercase tracking-wide text-emerald-400">Game in progress</Text>
              </View>
            )}
          </View>
          <Text className="text-zinc-400 text-sm mt-1">
            {game.date} · {game.players.length} players
          </Text>
          {!isClosed && (
            <Pressable onPress={onNavigateLive} className="mt-2">
              <Text className="text-[11.5px] font-semibold text-gold-light">Go to Live Game →</Text>
            </Pressable>
          )}
        </View>

        <View className="px-5 pt-4 flex-row gap-2.5">
          <View className="flex-1 bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3">
            <Text className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Pot</Text>
            <View className="mt-1">
              <NumB value={totalIn} size="text-[17px]" className="text-white" />
            </View>
          </View>
          <View className="flex-1 bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3">
            <Text className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Players</Text>
            <Text className="mt-1 text-[17px] font-extrabold text-white">{game.players.length}</Text>
          </View>
          <View className="flex-1 bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3">
            <View className="flex-row items-center justify-between">
              <Text className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Rake</Text>
              <Pressable onPress={() => setRakeVisible((v) => !v)} className="w-6 h-6 rounded-full bg-felt-surface-3 border border-felt-outline items-center justify-center">
                <Text className="text-zinc-500 text-[9px]">◐</Text>
              </Pressable>
            </View>
            {rakeVisible ? (
              <View className="mt-1">
                <NumB value={rake} size="text-[17px]" className="text-amber-400" />
              </View>
            ) : (
              <Text className="mt-1 text-[17px] font-extrabold tracking-[3px] text-amber-500/70">•••</Text>
            )}
          </View>
        </View>

        <SL>Results</SL>
        <View className="px-5 gap-2 mb-2">
          {positions.map((pos: any, rank: number) => {
            const p = game.players.find((x: any) => x.name === pos.name)
            return (
              <View
                key={pos.name}
                className={cn(
                  "bg-felt-surface-2 border border-felt-outline rounded-3xl px-4 py-3.5 flex-row items-center gap-3 border-l-2",
                  pos.net > 0 ? "border-l-emerald-500" : pos.net < 0 ? "border-l-red-500" : ""
                )}
              >
                <Text className="text-lg w-6 text-center">{rank < 3 ? medals[rank] : `#${rank + 1}`}</Text>
                <Av name={pos.name} size={30} />
                <View className="flex-1">
                  <Text className="font-semibold text-zinc-200 text-sm">{pos.name}</Text>
                  <Text className="text-xs text-zinc-400 font-mono">
                    In {fmtB(totalBuyinsFor(p))} · Out {fmtB(p.cashoutAmount || 0)}
                  </Text>
                </View>
                <NumB value={pos.net} sign size="text-sm" className={pos.net > 0 ? "text-emerald-400" : pos.net < 0 ? "text-red-400" : "text-zinc-400"} />
              </View>
            )
          })}
        </View>

        <SL>Payments — {txns.length}</SL>
        {txns.length === 0 ? (
          <Text className="text-center py-6 text-zinc-400 text-sm">Everyone was even</Text>
        ) : (
          <View className="px-5 gap-2 pb-10">
            {txns.map((t: any, i: number) => (
              <View key={i} className="bg-felt-surface-2 border border-felt-outline rounded-2xl px-4 py-3.5 flex-row items-center gap-3">
                <Av name={t.from} size={28} />
                <Text className={cn("text-sm font-semibold", t.paid ? "text-zinc-500 line-through" : "text-red-400")}>{t.from}</Text>
                <Text className="text-zinc-400">≫</Text>
                <NumB value={t.amount} size="text-sm" className={cn("flex-1", t.paid ? "text-zinc-500" : "text-amber-400")} />
                <Av name={t.to} size={28} />
                <Text className={cn("text-sm font-semibold", t.paid ? "text-zinc-500 line-through" : "text-emerald-400")}>{t.to}</Text>
                {/* Paid toggle only makes sense for a closed game's stored
                    settlement (stable id + index) — a live game's preview
                    is recomputed on the fly and has nothing to persist. */}
                {isClosed && (
                  <Pressable
                    onPress={() => onTogglePaid(t)}
                    className={cn("w-8 h-8 rounded-full border items-center justify-center", t.paid ? "bg-emerald-500/20 border-emerald-500/40" : "bg-felt-surface-3 border-felt-outline")}
                  >
                    <Text className={cn("text-xs", t.paid ? "text-emerald-400" : "text-zinc-500")}>✓</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
