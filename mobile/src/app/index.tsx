// ─── Home — ported from web App.jsx's HomeScreen (Phase 3) ────────────────
// Replaces Phase 2's placeholder. Same Host/Player filter + Overview/
// Settlements tabs as web, backed by AppStateProvider (mobile/src/lib/
// AppContext.tsx) instead of App.jsx's root-component props. The admin
// approvals button web shows here is intentionally left out — Admin/
// pending-approval stays web-only for mobile (see docs/MOBILE_MIGRATION_PLAN.md
// Phase 3 decision) — but the *gate* that sends a non-approved account to a
// "pending approval" screen instead of Home is still ported, since it's
// core access control, not the Admin screen itself.
import { useState } from "react"
import { View, Text, ScrollView, Pressable } from "react-native"
import { useRouter } from "expo-router"
import { useAppState } from "@/lib/AppContext"
import { totalBuyinsFor } from "@core/settlement"
import { fmtB, fmtNet } from "@core/money"
import { NumB, Dot, Av, SL, SegTabs, ProgressBar, cn } from "@/components/game-ui"
import { NetTrendChart } from "@/components/NetTrendChart"

export default function HomeScreen() {
  const router = useRouter()
  const {
    authLoading,
    session,
    profile,
    hostName,
    isApprovedHost,
    isAdmin,
    activeGame,
    pastGames,
    gamesLoading,
    logout,
    toggleSettlementPaid,
    viewGameDetail,
  } = useAppState()

  const [filter, setFilter] = useState<"host" | "player">("player")
  const [tab, setTab] = useState<"overview" | "settlements">("overview")

  if (authLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg">
        <Text className="text-zinc-400 text-sm font-medium">Loading…</Text>
      </View>
    )
  }

  // Signed out — _layout.tsx's redirect effect sends this to /login; render
  // nothing in the meantime rather than a flash of an empty Home.
  if (!session || !profile) return null

  if (!isAdmin && !isApprovedHost) {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg px-6">
        <Text className="text-[48px] mb-5">⏳</Text>
        <Text className="text-white text-2xl font-black tracking-tight text-center">Pending approval</Text>
        <Text className="text-zinc-400 text-sm mt-3 font-medium text-center leading-relaxed">
          Your account is set up. Ask the app admin to approve you as a host to create games.
        </Text>
        <Pressable onPress={logout} className="mt-8 w-full max-w-xs h-12 bg-felt-surface border border-felt-border rounded-xl items-center justify-center">
          <Text className="text-zinc-300 font-bold text-sm">Sign out</Text>
        </Pressable>
      </View>
    )
  }

  if (gamesLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg">
        <Text className="text-zinc-400 text-sm font-medium">Loading your games…</Text>
      </View>
    )
  }

  const closedGames = pastGames.filter((g: any) => g.status !== "live")
  const recent = closedGames.slice(0, 6)
  const hosted = closedGames.filter((g: any) => !g.hostName || g.hostName === hostName)
  const recentHosted = hosted.slice(0, 6)

  return (
    <View className="flex-1 bg-felt-bg">
      <ScrollView>
        {/* Header */}
        <View className="px-5 pt-14 pb-6">
          <View className="flex-row items-start justify-between">
            <View>
              <Text className="text-zinc-400 text-xs font-medium mb-1">Welcome back</Text>
              <Text className="text-white text-2xl font-black tracking-tight">
                {hostName} <Text className="text-zinc-400">♠</Text>
              </Text>
            </View>
            <Pressable onPress={logout} className="p-2.5 rounded-xl bg-felt-surface border border-felt-border">
              <Text className="text-zinc-500 text-sm">⎋</Text>
            </Pressable>
          </View>
        </View>

        <View className="px-5 gap-3">
          {activeGame && (
            <Pressable
              onPress={() => router.push((activeGame.status === "cashout" ? "/cashout-entry" : "/live-game") as never)}
              className="rounded-2xl bg-emerald-950 border border-emerald-800/50 p-4"
            >
              <View className="flex-row items-center gap-2 mb-2">
                <View className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <Text className="text-[10px] font-bold tracking-[2px] uppercase text-emerald-400">Live Game</Text>
              </View>
              <Text className="text-white font-bold text-base">{activeGame.name}</Text>
              <Text className="text-emerald-400/70 text-xs mt-1 font-medium">
                {activeGame.players.length} players · {fmtB(activeGame.buyinAmount)}/bank · Tap to manage
              </Text>
            </Pressable>
          )}
        </View>

        {/* Host/Player filter */}
        <View className="px-5 mt-4 flex-row">
          <View className="flex-row items-center gap-1 bg-felt-surface-2/70 border border-felt-border rounded-full p-1">
            {(["host", "player"] as const).map((f) => (
              <Pressable
                key={f}
                onPress={() => setFilter(f)}
                className={cn("px-3.5 py-1.5 rounded-full", filter === f && "bg-gold")}
              >
                <Text className={cn("text-[11px] font-bold", filter === f ? "text-white" : "text-zinc-400")}>
                  {f === "host" ? "Host" : "Player"}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Overview / Settlements tabs */}
        <View className="px-5 mt-3">
          <SegTabs tabs={["Overview", "Settlements"]} active={tab === "overview" ? "Overview" : "Settlements"} onChange={(t) => setTab(t === "Overview" ? "overview" : "settlements")} />
        </View>

        {tab === "overview" && filter === "host" && (
          <>
            <View className="px-5 mt-4">
              <Pressable onPress={() => router.push("/create-game" as never)} className="rounded-2xl bg-felt-surface border border-felt-border p-4 flex-row items-center gap-4">
                <View className="w-11 h-11 rounded-xl bg-gold/20 border border-gold/30 items-center justify-center">
                  <Text className="text-gold-light text-lg font-bold">+</Text>
                </View>
                <View className="flex-1">
                  <Text className="text-white font-bold text-sm">New Game</Text>
                  <Text className="text-zinc-400 text-xs mt-0.5">Set up players & buy-ins</Text>
                </View>
                <Text className="text-zinc-400">›</Text>
              </Pressable>
            </View>
            <SL>Hosting Overview</SL>
            <HostStatsView pastGames={closedGames} hostName={hostName} />
            {recentHosted.length > 0 && (
              <>
                <SL>Game History</SL>
                <View className="px-5 gap-2">
                  {recentHosted.map((g: any) => {
                    const h = g.players.find((p: any) => p.name === hostName)
                    const net = h ? h.cashoutAmount - totalBuyinsFor(h) : null
                    return (
                      <Pressable key={g.id} onPress={() => viewGameDetail(g, true)} className="bg-felt-surface border border-felt-border rounded-xl px-4 py-3.5 flex-row items-center gap-3">
                        <View className={cn("w-1 h-9 rounded-full", net === null ? "bg-zinc-700" : net > 0 ? "bg-emerald-500" : net < 0 ? "bg-red-500" : "bg-zinc-600")} />
                        <View className="flex-1">
                          <Text className="font-semibold text-zinc-100 text-sm">{g.name}</Text>
                          <Text className="text-zinc-400 text-xs mt-0.5">
                            {g.date} · {g.players.length} players · {fmtB(g.rake || 0)} rake
                          </Text>
                        </View>
                        {net !== null && (
                          <Text className={cn("font-mono text-sm font-bold", net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-400")}>{fmtNet(net)}</Text>
                        )}
                        <Text className="text-zinc-400">›</Text>
                      </Pressable>
                    )
                  })}
                </View>
              </>
            )}
          </>
        )}

        {tab === "overview" && filter === "player" && (
          closedGames.length === 0 ? (
            <Text className="text-zinc-400 text-xs text-center py-10 px-5">Play a game to see your stats here.</Text>
          ) : (
            <>
              {(() => {
                const stakeGroups: Record<number, any[]> = {}
                for (const g of closedGames) {
                  const key = g.buyinAmount || 0
                  ;(stakeGroups[key] ||= []).push(g)
                }
                const stakes = Object.keys(stakeGroups).map(Number).sort((a, b) => b - a)
                return (
                  <>
                    <SL>Net Trend{stakes.length > 1 ? " — by stake" : ""}</SL>
                    <View className="px-5 gap-3">
                      {stakes.map((stake) => (
                        <View key={stake}>
                          {stakes.length > 1 && <Text className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">{fmtB(stake)} / bank stakes</Text>}
                          <NetTrendChart pastGames={stakeGroups[stake]} hostName={hostName} />
                        </View>
                      ))}
                    </View>
                  </>
                )
              })()}
              {recent.length > 0 && (
                <>
                  <SL>Recent Games</SL>
                  <View className="px-5 gap-2">
                    {recent.map((g: any) => {
                      const h = g.players.find((p: any) => p.name === hostName)
                      const net = h ? h.cashoutAmount - totalBuyinsFor(h) : null
                      return (
                        <Pressable key={g.id} onPress={() => viewGameDetail(g, false)} className="bg-felt-surface border border-felt-border rounded-xl px-4 py-3.5 flex-row items-center gap-3">
                          <View className={cn("w-1 h-9 rounded-full", net === null ? "bg-zinc-700" : net > 0 ? "bg-emerald-500" : net < 0 ? "bg-red-500" : "bg-zinc-600")} />
                          <View className="flex-1">
                            <Text className="font-semibold text-zinc-100 text-sm">{g.name}</Text>
                            <Text className="text-zinc-400 text-xs mt-0.5">
                              {g.date} · {g.players.length} players
                            </Text>
                          </View>
                          {net !== null && (
                            <Text className={cn("font-mono text-sm font-bold", net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-400")}>{fmtNet(net)}</Text>
                          )}
                          <Text className="text-zinc-400">›</Text>
                        </Pressable>
                      )
                    })}
                  </View>
                </>
              )}
            </>
          )
        )}

        {tab === "settlements" && (
          <>
            <SL>{filter === "host" ? "Settlement Ledger" : "My Settlements"}</SL>
            <View className="px-5 pb-10">
              {filter === "host" ? (
                <SettlementLedgerSection hostName={hostName} closedGames={closedGames} onSelectGame={(g: any) => viewGameDetail(g, true)} onTogglePaid={toggleSettlementPaid} />
              ) : (
                <MySettlementsSection hostName={hostName} closedGames={closedGames} onSelectGame={(g: any) => viewGameDetail(g, false)} onTogglePaid={toggleSettlementPaid} />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}

function HostStatsView({ pastGames, hostName }: { pastGames: any[]; hostName: string | null }) {
  const hosted = pastGames.filter((g) => !g.hostName || g.hostName === hostName)
  const gamesHosted = hosted.length
  const uniquePlayers = new Set(hosted.flatMap((g) => g.players.map((p: any) => p.name))).size
  const totalRake = hosted.reduce((s, g) => s + (g.rake || 0), 0)
  const totalPot = hosted.reduce((s, g) => s + g.players.reduce((ps: number, p: any) => ps + totalBuyinsFor(p), 0), 0)
  const avgPot = gamesHosted ? Math.round(totalPot / gamesHosted) : 0

  return (
    <View className="px-5 gap-2.5">
      <View className="flex-row flex-wrap gap-2.5">
        <View className="flex-1 min-w-[45%] bg-felt-surface border border-felt-border rounded-2xl p-3.5">
          <Text className="text-[9px] font-bold tracking-[1.5px] uppercase text-zinc-500">Games Hosted</Text>
          <Text className="text-white font-mono text-2xl font-extrabold mt-1">{gamesHosted}</Text>
        </View>
        <View className="flex-1 min-w-[45%] bg-felt-surface border border-felt-border rounded-2xl p-3.5">
          <Text className="text-[9px] font-bold tracking-[1.5px] uppercase text-zinc-500">Players Hosted</Text>
          <Text className="text-white font-mono text-2xl font-extrabold mt-1">{uniquePlayers}</Text>
        </View>
        <View className="flex-1 min-w-[45%] bg-felt-surface border border-felt-border rounded-2xl p-3.5">
          <Text className="text-[9px] font-bold tracking-[1.5px] uppercase text-zinc-500">Rake Collected</Text>
          <NumB value={totalRake} size="text-2xl" className="mt-1 text-amber-400" />
        </View>
        <View className="flex-1 min-w-[45%] bg-felt-surface border border-felt-border rounded-2xl p-3.5">
          <Text className="text-[9px] font-bold tracking-[1.5px] uppercase text-zinc-500">Avg Pot / Game</Text>
          <NumB value={avgPot} size="text-2xl" className="mt-1 text-zinc-100" />
        </View>
      </View>
      {gamesHosted === 0 && <Text className="text-zinc-400 text-xs text-center py-6">Host a game to see stats here.</Text>}
    </View>
  )
}

function PaidToggle({ paid, onToggle }: { paid: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      className={cn("w-7 h-7 rounded-lg border items-center justify-center", paid ? "bg-emerald-500/20 border-emerald-500/40" : "bg-felt-surface-2 border-felt-border")}
    >
      <Text className={cn("text-xs", paid ? "text-emerald-400" : "text-zinc-500")}>✓</Text>
    </Pressable>
  )
}

function MySettlementsSection({
  hostName,
  closedGames,
  onSelectGame,
  onTogglePaid,
}: {
  hostName: string | null
  closedGames: any[]
  onSelectGame: (g: any) => void
  onTogglePaid: (t: any) => void
}) {
  const myLines = closedGames.flatMap((g) => (g.settlement || []).map((t: any, idx: number) => ({ ...t, game: g, idx })).filter((t: any) => t.from === hostName || t.to === hostName))
  const iOwe = myLines.filter((t: any) => t.from === hostName)
  const owedToMe = myLines.filter((t: any) => t.to === hostName)

  return (
    <View className="gap-2">
      {myLines.length === 0 && (
        <Text className="text-zinc-400 text-xs text-center py-6">
          {closedGames.length === 0 ? "No closed games yet — settlements show up here once a game ends." : "No settlements involve you yet in any closed game."}
        </Text>
      )}
      {iOwe.length > 0 && (
        <>
          <Text className="text-[10px] font-bold tracking-[1.5px] uppercase text-zinc-500 mt-1">You owe</Text>
          {iOwe.map((t: any, i: number) => (
            <View key={i} className="bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex-row items-center gap-3">
              <Pressable onPress={() => onSelectGame(t.game)} className="flex-1 flex-row items-center gap-3">
                <Av name={t.to} size={28} />
                <View className="flex-1">
                  <Text className={cn("text-sm font-semibold", t.paid ? "text-zinc-400 line-through" : "text-zinc-100")}>To {t.to}</Text>
                  <Text className="text-zinc-400 text-[10.5px] mt-0.5">
                    {t.game.name} · {t.game.date}
                  </Text>
                </View>
              </Pressable>
              <NumB value={t.amount} size="text-base" className={t.paid ? "text-zinc-500" : "text-red-400"} />
              <PaidToggle paid={t.paid} onToggle={() => onTogglePaid(t)} />
            </View>
          ))}
        </>
      )}
      {owedToMe.length > 0 && (
        <>
          <Text className="text-[10px] font-bold tracking-[1.5px] uppercase text-zinc-500 mt-2">Owed to you</Text>
          {owedToMe.map((t: any, i: number) => (
            <View key={i} className="bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex-row items-center gap-3">
              <Pressable onPress={() => onSelectGame(t.game)} className="flex-1 flex-row items-center gap-3">
                <Av name={t.from} size={28} />
                <View className="flex-1">
                  <Text className={cn("text-sm font-semibold", t.paid ? "text-zinc-400 line-through" : "text-zinc-100")}>From {t.from}</Text>
                  <Text className="text-zinc-400 text-[10.5px] mt-0.5">
                    {t.game.name} · {t.game.date}
                  </Text>
                </View>
              </Pressable>
              <NumB value={t.amount} size="text-base" className={t.paid ? "text-zinc-500" : "text-emerald-400"} />
              <PaidToggle paid={t.paid} onToggle={() => onTogglePaid(t)} />
            </View>
          ))}
        </>
      )}
    </View>
  )
}

function SettlementLedgerSection({
  hostName,
  closedGames,
  onSelectGame,
  onTogglePaid,
}: {
  hostName: string | null
  closedGames: any[]
  onSelectGame: (g: any) => void
  onTogglePaid: (t: any) => void
}) {
  const [drillPlayer, setDrillPlayer] = useState<string | null>(null)
  const hostedClosed = closedGames.filter((g) => !g.hostName || g.hostName === hostName)
  const allHostedLines = hostedClosed.flatMap((g) => (g.settlement || []).map((t: any, idx: number) => ({ ...t, game: g, idx })))
  const hostedPlayers = [...new Set(allHostedLines.flatMap((t: any) => [t.from, t.to]))].sort((a: any, b: any) => a.localeCompare(b))
  const drillLines = drillPlayer ? allHostedLines.filter((t: any) => t.from === drillPlayer || t.to === drillPlayer) : allHostedLines

  return (
    <View className="gap-2">
      {hostedPlayers.length > 0 && (
        <View className="flex-row flex-wrap gap-1.5 mb-1">
          <Pressable onPress={() => setDrillPlayer(null)} className={cn("px-2.5 py-1 rounded-full border", !drillPlayer ? "bg-gold border-gold" : "bg-felt-surface-2 border-felt-border")}>
            <Text className={cn("text-[11px] font-bold", !drillPlayer ? "text-white" : "text-zinc-400")}>All players</Text>
          </Pressable>
          {hostedPlayers.map((p: any) => (
            <Pressable key={p} onPress={() => setDrillPlayer(p)} className={cn("px-2.5 py-1 rounded-full border", drillPlayer === p ? "bg-gold border-gold" : "bg-felt-surface-2 border-felt-border")}>
              <Text className={cn("text-[11px] font-bold", drillPlayer === p ? "text-white" : "text-zinc-400")}>{p}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {drillLines.length === 0 && (
        <Text className="text-zinc-400 text-xs text-center py-6">{hostedClosed.length === 0 ? "No games you've hosted have closed yet." : "No settlement lines to show."}</Text>
      )}
      {drillLines.map((t: any, i: number) => (
        <View key={i} className="bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex-row items-center gap-3">
          <Pressable onPress={() => onSelectGame(t.game)} className="flex-1">
            <Text className={cn("text-sm font-semibold", t.paid ? "text-zinc-400 line-through" : "text-zinc-100")}>
              {t.from} → {t.to}
            </Text>
            <Text className="text-zinc-400 text-[10.5px] mt-0.5">
              {t.game.name} · {t.game.date}
            </Text>
          </Pressable>
          <NumB value={t.amount} size="text-base" className={t.paid ? "text-zinc-500" : "text-zinc-200"} />
          <PaidToggle paid={t.paid} onToggle={() => onTogglePaid(t)} />
        </View>
      ))}
    </View>
  )
}
