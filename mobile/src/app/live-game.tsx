// ─── Live Game — ported from web App.jsx's LiveGameScreen (Phase 3) ───────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 3] First real screen
// port. Same business logic and gamesApi/knownPlayersApi calls as the web
// version — this file owns its own data fetch (profile -> active hosted
// game + roster) rather than receiving them as route props, since expo-
// router screens don't get prop-drilled from a shared app root the way
// App.jsx's screens do; the nearest equivalent of App.jsx's App-root
// bootstrap lives right here instead.
//
// Scope trimmed for this pass, on purpose:
// - "End Buy-ins" is disabled here rather than wired to
//   gamesApi.setGameStatus(id, "cashout") — that transition is genuinely
//   real and shared with the web app (same Supabase project, same game
//   row). Firing it before the Cash-outs screen exists on mobile (Phase 3
//   item 3, not built yet) would flip status on a real, possibly-currently-
//   tracked-on-web game with no way to act on it from here — a footgun on
//   real data, not just an incomplete feature. Revisit once Cash-outs is
//   ported.
// - No toast system yet (web's Toast/showToast) — failures and confirmations
//   log to the console for now via a stub showToast. A real mobile toast is
//   a small, separable follow-up, not core to this screen's function.
// - Icons are plain text glyphs, not lucide-react-native (which web's
//   App.jsx uses via lucide-react) — that package ships one file per icon,
//   and bundling it here hit an EMFILE (too many open files) error specific
//   to this device's sandboxed shell. Not a code problem; revisit if it's
//   worth chasing down later, but text glyphs are a fine stand-in for now.
import { useCallback, useEffect, useState } from "react"
import { View, Text, ScrollView, Pressable, TextInput, RefreshControl } from "react-native"
import { useRouter } from "expo-router"
import { supabase } from "@/lib/supabase"
import * as gamesApi from "@/lib/gamesApi"
import * as knownPlayersApi from "@/lib/knownPlayersApi"
import { fmtB, fmtNet, computeBankroll } from "@core/money"
import { totalBuyinsFor, lockedCountFor } from "@core/settlement"
import { NumB, Dot, Av, AppSheet, AppDialog, Keypad, BuyinSlider, SL, cn } from "@/components/game-ui"

type Game = any
type Player = any

export default function LiveGameRoute() {
  const router = useRouter()
  const [accountId, setAccountId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [game, setGame] = useState<Game | null>(null)
  const [roster, setRoster] = useState<{ name: string; phone: string }[]>([])
  const [error, setError] = useState("")

  const loadAll = useCallback(async (uid: string) => {
    const [games, rosterList] = await Promise.all([
      gamesApi.fetchHostedGames(uid),
      knownPlayersApi.fetchRoster(uid),
    ])
    const active = games.find((g: Game) => g.status !== "closed") || null
    setGame(active)
    setRoster(rosterList)
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const { data } = await supabase.auth.getUser()
        const uid = data.user?.id
        if (!uid) {
          if (mounted) setLoading(false)
          return
        }
        if (!mounted) return
        setAccountId(uid)
        await loadAll(uid)
      } catch (err: any) {
        if (mounted) setError(err?.message || "Couldn't load your game")
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadAll])

  const onMutated = useCallback(async () => {
    if (accountId) await loadAll(accountId)
  }, [accountId, loadAll])

  const onRefresh = useCallback(async () => {
    if (!accountId) return
    setRefreshing(true)
    try {
      await loadAll(accountId)
    } finally {
      setRefreshing(false)
    }
  }, [accountId, loadAll])

  // Optimistic-local-then-background-write, same pattern as the web app's
  // App-root addToRoster (see docs/MOBILE_MIGRATION_PLAN.md -> Phase 1).
  const addToRoster = useCallback(
    (name: string, phone: string) => {
      const n = name.trim(),
        ph = phone.trim()
      if (!n) return
      setRoster((prev) => {
        const idx = prev.findIndex((r) => r.name.toLowerCase() === n.toLowerCase())
        if (idx >= 0) {
          const next = prev.slice()
          next[idx] = { ...next[idx], name: n, phone: ph || next[idx].phone || "" }
          return next
        }
        return [...prev, { name: n, phone: ph }]
      })
      if (!accountId) return
      knownPlayersApi.upsertRosterEntry(accountId, n, ph).catch((err) => {
        console.warn("Couldn't save to roster (non-fatal):", err)
      })
    },
    [accountId]
  )

  const showToast = useCallback((icon: string, title: string, msg?: string) => {
    console.log(`${icon} ${title}${msg ? " — " + msg : ""}`)
  }, [])

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg">
        <Text className="text-zinc-400 text-sm font-medium">Loading…</Text>
      </View>
    )
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg px-6">
        <Text className="text-red-400 text-sm text-center">{error}</Text>
      </View>
    )
  }

  if (!game) {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg px-6">
        <Text className="text-zinc-400 text-sm text-center leading-relaxed">
          No active game right now. Start one from the web app for now — Create Game isn't ported to mobile yet.
        </Text>
        <Pressable onPress={() => router.replace("/")} className="mt-5 h-11 px-5 rounded-xl bg-felt-surface-2 border border-felt-border items-center justify-center">
          <Text className="text-zinc-300 text-sm font-semibold">Back</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <LiveGameBody
      game={game}
      roster={roster}
      addToRoster={addToRoster}
      showToast={showToast}
      onMutated={onMutated}
      onBack={() => router.replace("/")}
      refreshing={refreshing}
      onRefresh={onRefresh}
    />
  )
}

function LiveGameBody({
  game,
  roster,
  addToRoster,
  showToast,
  onMutated,
  onBack,
  refreshing,
  onRefresh,
}: {
  game: Game
  roster: { name: string; phone: string }[]
  addToRoster: (name: string, phone: string) => void
  showToast: (icon: string, title: string, msg?: string) => void
  onMutated: () => Promise<void>
  onBack: () => void
  refreshing: boolean
  onRefresh: () => void
}) {
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const [cashoutOn, setCashoutOn] = useState(false)
  const [sliderVal, setSliderVal] = useState(0)
  const [cashoutDigits, setCashoutDigits] = useState("")
  const [addingPlayer, setAddingPlayer] = useState(false)
  const [addMode, setAddMode] = useState<"roster" | "new">("roster")
  const [newName, setNewName] = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [rakeVisible, setRakeVisible] = useState(false)
  const [showBankCheck, setShowBankCheck] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState<string | null>(null)
  const [editName, setEditName] = useState("")
  const [editPhone, setEditPhone] = useState("")
  const [busy, setBusy] = useState(false)
  const [rakeInput, setRakeInput] = useState(String((game.rake || 0) / 10000))

  const players: Player[] = game.players
  const isClosed = game.status === "closed"

  const { totalIn, totalOut, overpaid, overpayError, stillIn } = computeBankroll(players, game.rake || 0)

  const sinceLastCheck = players.reduce((s: number, p: Player) => s + (p.buyins.length - lockedCountFor(p, game)), 0)
  const hoursSinceCheck = game.lastBankCheckAt ? (Date.now() - game.lastBankCheckAt) / 3.6e6 : null
  const checkOverdue = hoursSinceCheck === null || hoursSinceCheck >= 2

  const run = async (fn: () => Promise<void>) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      await onMutated()
    } catch (err: any) {
      console.error(err)
      showToast("⚠️", "Couldn't save that", err?.message || "Please try again")
    } finally {
      setBusy(false)
    }
  }

  const commitRake = (v: string) => {
    if (isClosed) return
    const amt = Math.max(0, (parseFloat(v) || 0) * 10000)
    run(() => gamesApi.updateRake(game.id, amt))
  }

  const removePlayer = (p: Player) => {
    if (lockedCountFor(p, game) > 0) return
    run(async () => {
      await gamesApi.removePlayer(p.id)
      showToast("🗑️", "Player removed", p.name)
    })
  }

  const openEditPlayer = (p: Player) => {
    setEditingPlayer(p.name)
    setEditName(p.name)
    setEditPhone(p.phone || "")
  }
  const closeEditPlayer = () => setEditingPlayer(null)
  const saveEditPlayer = () => {
    const n = editName.trim(),
      ph = editPhone.trim()
    if (!n) return
    if (players.find((p) => p.name.toLowerCase() === n.toLowerCase() && p.name !== editingPlayer)) {
      showToast("⚠️", "Name already in use", n)
      return
    }
    const target = players.find((p) => p.name === editingPlayer)
    if (!target) return
    run(async () => {
      await gamesApi.editPlayer(target.id, { name: n, phone: ph })
      closeEditPlayer()
      showToast("✏️", "Player updated", n)
    })
  }

  const confirmBankCheck = () => {
    run(async () => {
      await gamesApi.runBankCheck(game.id)
      setShowBankCheck(false)
      showToast("🏦", "Bank check confirmed", `${sinceLastCheck} buy-in${sinceLastCheck === 1 ? "" : "s"} locked`)
    })
  }

  // See this file's header note — deliberately not wired to
  // gamesApi.setGameStatus until the Cash-outs screen exists on mobile.
  const handleEndBuyins = () => {
    showToast("🚧", "Not available on mobile yet", "Cash-outs screen isn't ported — use the web app to end buy-ins")
  }

  const openSheet = (p: Player) => {
    setSheetFor(p.name)
    setCashoutOn(!!p.cashedOut)
    setSliderVal(p.buyins.length)
    setCashoutDigits(p.cashedOut ? String(Math.round((p.cashoutAmount || 0) / 10000)) : "")
  }
  const closeSheet = () => {
    setSheetFor(null)
    setCashoutDigits("")
    setCashoutOn(false)
  }

  const addPlayerToGame = (n: string, phone: string) => {
    const t = n.trim()
    if (!t) return
    if (players.find((p) => p.name.toLowerCase() === t.toLowerCase())) {
      showToast("⚠️", "Already added", `${t} is in the game`)
      return
    }
    run(async () => {
      await gamesApi.addPlayer(game.id, { name: t, phone: (phone || "").trim(), startBuyins: 1 })
      showToast("🃏", "Player Added", `${t} — ${fmtB(game.buyinAmount)}`)
    })
  }

  const addFromRoster = (r: { name: string; phone: string }) => addPlayerToGame(r.name, r.phone)

  const addNewPlayer = () => {
    const n = newName.trim(),
      phone = newPhone.trim()
    if (!n || !phone) return
    addPlayerToGame(n, phone)
    addToRoster(n, phone)
    setNewName("")
    setNewPhone("")
    setAddingPlayer(false)
    setAddMode("roster")
  }

  const notInGameRoster = roster.filter((r) => !players.find((p) => p.name.toLowerCase() === r.name.toLowerCase()))

  const confirmBuyins = () => {
    const p = players.find((pp) => pp.name === sheetFor)
    if (!p) return
    const currentCount = p.buyins.length
    const target = Math.max(sliderVal, lockedCountFor(p, game))
    if (target === currentCount) {
      closeSheet()
      return
    }
    run(async () => {
      if (target > currentCount) {
        await gamesApi.addBuyins(p.id, target - currentCount, game.buyinAmount)
        showToast("🏦", "Buy-in added", `${p.name} · now ${target}×`)
      } else {
        await gamesApi.removeBuyins(p.buyins.slice(target).map((b: any) => b.id))
        showToast("↩️", "Buy-in removed", `${p.name} · now ${target}×`)
      }
      closeSheet()
    })
  }

  const confirmCashout = () => {
    const p = players.find((pp) => pp.name === sheetFor)
    if (!p) return
    const val = parseInt(cashoutDigits || "0", 10) * 10000
    const net = val - totalBuyinsFor(p)
    run(async () => {
      await gamesApi.setCashout(p.id, val)
      closeSheet()
      showToast(net >= 0 ? "🟢" : "🔴", `${p.name} cashed out`, `${fmtB(val)} · Net ${fmtNet(net)}`)
    })
  }

  const sheetPlayer = players.find((p) => p.name === sheetFor)
  const sheetPlayerIn = sheetPlayer ? totalBuyinsFor(sheetPlayer) : 0
  const cashoutEntered = parseInt(cashoutDigits || "0", 10) * 10000
  const cashoutNet = cashoutEntered - sheetPlayerIn

  return (
    <View className="flex-1 bg-felt-bg">
      <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#caa043" />}>
        {/* Header */}
        <View className="px-5 pt-14 pb-5 border-b border-felt-border">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center gap-3">
              <Pressable onPress={onBack} className="w-7 h-7 -ml-1 items-center justify-center">
                <Text className="text-zinc-400 text-base">⌄</Text>
              </Pressable>
              <View className="flex-row items-center gap-2">
                <View className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                <Text className="text-[10px] font-bold tracking-[2px] uppercase text-emerald-400">Live</Text>
              </View>
            </View>
            <Pressable
              onPress={() => setShowBankCheck(true)}
              className={cn(
                "flex-row items-center gap-1.5 px-3 py-1.5 rounded-lg border",
                checkOverdue ? "bg-amber-500/10 border-amber-500/30" : "bg-felt-surface border-felt-border"
              )}
            >
              <Text className={cn("text-sm", checkOverdue ? "text-amber-300" : "text-zinc-400")}>🪙</Text>
              <Text className={cn("text-xs font-semibold", checkOverdue ? "text-amber-300" : "text-zinc-400")}>Bank Check</Text>
            </Pressable>
          </View>
          <Text className="text-white text-xl font-bold">{game.name}</Text>
          <Text className="text-zinc-400 text-xs mt-1">
            {players.length} players · {game.date}
            {game.time ? ` · ${game.time}` : ""}
          </Text>
        </View>

        {/* Stats row */}
        <View className="px-5 pt-4 flex-row gap-2.5">
          <View className="flex-1 bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
            <Text className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">On table</Text>
            <View className="mt-1">
              <NumB value={totalIn - totalOut} size="text-[18px]" className="text-white" />
            </View>
          </View>
          <View className="flex-1 bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
            <Text className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Cashed out</Text>
            <View className="mt-1">
              <NumB value={totalOut} size="text-[18px]" className="text-white" />
            </View>
          </View>
          <View className="flex-1 bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5 justify-between">
            <View className="flex-row items-center justify-between">
              <Text className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Rake</Text>
              <Pressable onPress={() => setRakeVisible((v) => !v)} className="w-6 h-6 rounded-lg bg-felt-surface-2 border border-felt-border items-center justify-center">
                {rakeVisible ? <Text className="text-zinc-500 text-xs">⌃</Text> : <Text className="text-[10px] text-zinc-500">◐</Text>}
              </Pressable>
            </View>
            {rakeVisible ? (
              isClosed ? (
                <View className="mt-1">
                  <NumB value={game.rake || 0} size="text-[18px]" className="text-amber-400" />
                </View>
              ) : (
                <TextInput
                  value={rakeInput}
                  onChangeText={setRakeInput}
                  onBlur={() => commitRake(rakeInput)}
                  keyboardType="decimal-pad"
                  className="mt-1 text-[18px] font-extrabold font-mono text-amber-400 p-0"
                />
              )
            ) : (
              <Text className="mt-1 text-[18px] font-extrabold tracking-[3px] text-zinc-400">•••</Text>
            )}
          </View>
        </View>

        {/* Bankroll banner */}
        <View className="px-5 pt-2.5">
          <View
            className={cn(
              "rounded-xl px-3.5 py-2 flex-row items-center gap-2",
              overpayError ? "bg-red-500/10 border border-red-500/30" : "bg-felt-surface-2/50"
            )}
          >
            {overpayError ? (
              <>
                <Text className="text-red-300 text-sm">⚠</Text>
                <Text className="text-[11px] font-medium text-red-300 flex-1 flex-wrap">
                  Paid out <NumB value={overpaid} size="text-[11px]" className="text-red-300" /> more than total buy-ins — check entries
                </Text>
              </>
            ) : (
              <Text className="text-[11px] font-medium text-zinc-500">
                <Text className="text-emerald-400">●</Text> Bankroll checks out ·{" "}
                <NumB value={stillIn} size="text-[11px]" className="text-zinc-500" /> still in play
              </Text>
            )}
          </View>
        </View>

        {/* Add late player */}
        <View className="px-5 mt-4">
          {addingPlayer ? (
            <View className="bg-felt-surface border border-felt-border rounded-2xl p-3.5">
              <View className="flex-row items-center justify-between mb-2.5">
                <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500">Add late player</Text>
                <Pressable
                  onPress={() => {
                    setAddingPlayer(false)
                    setAddMode("roster")
                    setNewName("")
                    setNewPhone("")
                  }}
                  className="w-6 h-6 rounded-lg bg-felt-surface-2 border border-felt-border items-center justify-center"
                >
                  <Text className="text-zinc-500 text-xs">✕</Text>
                </Pressable>
              </View>

              <View className="flex-row gap-1.5 mb-3">
                {(["roster", "new"] as const).map((m) => (
                  <Pressable
                    key={m}
                    onPress={() => setAddMode(m)}
                    className={cn("flex-1 h-8 rounded-lg items-center justify-center", addMode === m ? "bg-gold" : "bg-felt-surface-2")}
                  >
                    <Text className={cn("text-xs font-bold", addMode === m ? "text-white" : "text-zinc-400")}>
                      {m === "roster" ? "Your players" : "Someone new"}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {addMode === "roster" &&
                (notInGameRoster.length > 0 ? (
                  <View className="flex-row flex-wrap gap-1.5">
                    {notInGameRoster.map((r) => (
                      <Pressable
                        key={r.name}
                        onPress={() => addFromRoster(r)}
                        className="flex-row items-center gap-1.5 px-2.5 py-1.5 border border-dashed border-felt-border rounded-full"
                      >
                        <Text className="text-gold-light font-bold text-xs">+</Text>
                        <Text className="text-zinc-400 text-xs font-medium">{r.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <Text className="text-center py-3 text-zinc-400 text-xs font-medium">Everyone in your roster is already in this game</Text>
                ))}

              {addMode === "new" && (
                <View className="gap-2">
                  <TextInput
                    autoFocus
                    className="w-full h-10 bg-felt-surface-2 border border-felt-border rounded-xl px-3.5 text-zinc-100 text-sm"
                    placeholder="Player's name…"
                    placeholderTextColor="#a1a1aa"
                    value={newName}
                    onChangeText={setNewName}
                  />
                  <TextInput
                    className="w-full h-10 bg-felt-surface-2 border border-felt-border rounded-xl px-3.5 text-zinc-100 text-sm"
                    placeholder="Phone number (required)…"
                    placeholderTextColor="#a1a1aa"
                    keyboardType="phone-pad"
                    value={newPhone}
                    onChangeText={setNewPhone}
                  />
                  {newName.trim() && !newPhone.trim() && (
                    <Text className="text-[10.5px] text-amber-500 font-medium">Phone number is required to add a player</Text>
                  )}
                  <Pressable
                    disabled={!newName.trim() || !newPhone.trim()}
                    onPress={addNewPlayer}
                    className={cn(
                      "w-full h-10 rounded-xl items-center justify-center",
                      !newName.trim() || !newPhone.trim() ? "bg-gold/40" : "bg-gold"
                    )}
                  >
                    <Text className="text-white text-sm font-bold">Add to game</Text>
                  </Pressable>
                </View>
              )}
            </View>
          ) : (
            <Pressable onPress={() => setAddingPlayer(true)} className="w-full h-11 bg-felt-surface border border-felt-border rounded-xl items-center justify-center">
              <Text className="text-zinc-400 text-sm font-semibold">+ Add late player</Text>
            </Pressable>
          )}
        </View>

        <SL>Players · tap any to open</SL>

        {players.length === 0 && <Text className="text-center py-8 text-zinc-400 text-sm">Add players above to start tracking</Text>}

        <View className="px-5 gap-2">
          {players.map((p: Player) => {
            const tIn = totalBuyinsFor(p)
            // 0 when not cashed out — never actually rendered in that case
            // (guarded by p.cashedOut below), just keeps this a plain
            // number instead of number|null for NumB's sake.
            const net = p.cashedOut ? p.cashoutAmount - tIn : 0
            const locked = lockedCountFor(p, game)
            const allLocked = p.buyins.length > 0 && locked === p.buyins.length
            const hasLocked = !p.cashedOut && locked > 0
            const dotColor = p.cashedOut ? (net >= 0 ? "emerald" : "red") : allLocked ? "zinc" : "indigo"
            return (
              <View
                key={p.id}
                className={cn("flex-row items-center gap-3 bg-felt-surface border border-felt-border rounded-2xl px-3.5 py-3", p.cashedOut && "opacity-55")}
              >
                <Pressable onPress={() => openSheet(p)} className="flex-row items-center gap-3 flex-1">
                  <Av name={p.name} size={36} />
                  <View className="flex-1">
                    <Text className="font-bold text-sm text-zinc-100">{p.name}</Text>
                    <Text className="text-[10.5px] text-zinc-400 mt-0.5 font-mono">
                      {p.buyins.length} buy-in{p.buyins.length === 1 ? "" : "s"}
                      {p.cashedOut ? " · cashed out" : hasLocked ? " · locked" : ""}
                    </Text>
                  </View>
                  {p.cashedOut ? (
                    <NumB value={net} sign size="text-[17px]" className={net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-400"} />
                  ) : (
                    <NumB value={tIn} size="text-[17px]" className="text-white" />
                  )}
                  <Dot color={dotColor} />
                </Pressable>
                {!isClosed && (
                  <Pressable onPress={() => openEditPlayer(p)} className="w-8 h-8 rounded-lg bg-felt-surface-2 border border-felt-border items-center justify-center">
                    <Text className="text-zinc-500 text-xs">✎</Text>
                  </Pressable>
                )}
                {!isClosed && locked === 0 && (
                  <Pressable onPress={() => removePlayer(p)} className="w-8 h-8 rounded-lg bg-felt-surface-2 border border-felt-border items-center justify-center">
                    <Text className="text-zinc-500 text-xs">✕</Text>
                  </Pressable>
                )}
              </View>
            )
          })}
        </View>

        {players.length > 0 && !isClosed && (
          <View className="px-5 mt-5 pb-10">
            <Pressable
              disabled={busy}
              onPress={handleEndBuyins}
              className="w-full h-12 bg-red-600/50 border border-red-500/30 rounded-xl items-center justify-center"
            >
              <Text className="text-white font-bold text-sm">End Buy-ins →</Text>
            </Pressable>
            <Text className="text-[11px] text-zinc-500 text-center mt-2 leading-relaxed">
              Not available on mobile yet — end buy-ins from the web app for now.
            </Text>
          </View>
        )}
      </ScrollView>

      {/* Bank Check dialog */}
      <AppDialog open={showBankCheck} onClose={() => setShowBankCheck(false)} title="Bank Check" description="Confirm buy-in counts with the table, then lock them in.">
        <ScrollView className="max-h-[280px] mb-3">
          <View className="gap-2">
            {players.map((p: Player) => {
              const unlockedCount = p.buyins.length - lockedCountFor(p, game)
              return (
                <View key={p.id} className="flex-row items-center justify-between bg-felt-surface-2/50 border border-felt-border rounded-xl px-3.5 py-2.5">
                  <View className="flex-row items-center gap-2.5">
                    <Av name={p.name} size={28} />
                    <Text className="text-sm font-semibold text-zinc-200">{p.name}</Text>
                  </View>
                  <Text className="text-xs font-mono text-zinc-400">
                    {p.buyins.length} total{unlockedCount > 0 ? ` · ${unlockedCount} new` : ""}
                  </Text>
                </View>
              )
            })}
          </View>
        </ScrollView>
        <View className="flex-row gap-3">
          <Pressable onPress={() => setShowBankCheck(false)} className="flex-1 h-11 bg-felt-surface-2 border border-felt-border rounded-xl items-center justify-center">
            <Text className="text-zinc-300 font-semibold text-sm">Cancel</Text>
          </Pressable>
          <Pressable
            disabled={sinceLastCheck === 0 || busy}
            onPress={confirmBankCheck}
            className={cn("flex-1 h-11 rounded-xl items-center justify-center", sinceLastCheck === 0 || busy ? "bg-gold/40" : "bg-gold")}
          >
            <Text className="text-white font-bold text-sm">Confirm & Lock {sinceLastCheck > 0 ? sinceLastCheck : ""}</Text>
          </Pressable>
        </View>
      </AppDialog>

      {/* Edit player dialog */}
      <AppDialog open={!!editingPlayer} onClose={closeEditPlayer} title="Edit player">
        <View className="gap-3 mb-3">
          <View>
            <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500 mb-1.5">Name</Text>
            <TextInput value={editName} onChangeText={setEditName} className="w-full h-11 bg-felt-surface-2 border border-felt-border rounded-xl px-4 text-zinc-100 text-sm" />
          </View>
          <View>
            <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500 mb-1.5">Phone</Text>
            <TextInput
              value={editPhone}
              onChangeText={setEditPhone}
              keyboardType="phone-pad"
              className="w-full h-11 bg-felt-surface-2 border border-felt-border rounded-xl px-4 text-zinc-100 text-sm"
            />
          </View>
        </View>
        <View className="flex-row gap-3">
          <Pressable onPress={closeEditPlayer} className="flex-1 h-11 bg-felt-surface-2 border border-felt-border rounded-xl items-center justify-center">
            <Text className="text-zinc-300 font-semibold text-sm">Cancel</Text>
          </Pressable>
          <Pressable
            disabled={!editName.trim() || busy}
            onPress={saveEditPlayer}
            className={cn("flex-1 h-11 rounded-xl items-center justify-center", !editName.trim() || busy ? "bg-gold/40" : "bg-gold")}
          >
            <Text className="text-white font-bold text-sm">Save</Text>
          </Pressable>
        </View>
      </AppDialog>

      {/* Buy-in / Cash-out bottom sheet */}
      <AppSheet
        open={!!sheetFor}
        onClose={closeSheet}
        title={sheetPlayer?.name}
        subtitle={sheetPlayer ? `${sheetPlayer.buyins.length} buy-in${sheetPlayer.buyins.length === 1 ? "" : "s"} at the table` : ""}
        avatar={sheetPlayer && <Av name={sheetPlayer.name} size={36} />}
      >
        {sheetPlayer && (
          <View className="gap-3.5">
            {isClosed && <Text className="text-center text-[10.5px] text-zinc-400 -mt-1 mb-0.5">Game closed — figures are final and read-only</Text>}

            {!cashoutOn && (
              <>
                <View className="items-center pt-1 pb-0.5">
                  <View className="flex-row items-center justify-center gap-2">
                    <Text className="font-mono text-[40px] font-extrabold text-white">{sliderVal}</Text>
                    <Dot color="indigo" className="mt-3" />
                  </View>
                  <Text className="text-[10.5px] font-bold tracking-wider uppercase text-zinc-400 mt-1">
                    buy-in{sliderVal === 1 ? "" : "s"} · <NumB value={sliderVal * game.buyinAmount} size="text-[11px]" className="text-zinc-400" />
                  </Text>
                </View>
                {!isClosed && (
                  <>
                    <BuyinSlider value={sliderVal} onChange={setSliderVal} min={lockedCountFor(sheetPlayer, game)} />
                    <Text className="text-center text-[11px] text-zinc-400">
                      Locks at your <Text className="text-zinc-400 font-semibold">next bank check</Text> — once locked it's permanent, no override
                    </Text>
                    <Pressable disabled={busy} onPress={confirmBuyins} className={cn("w-full h-12 rounded-xl items-center justify-center", busy ? "bg-gold/50" : "bg-gold")}>
                      <Text className="text-white font-bold text-sm">
                        Confirm {sliderVal} buy-in{sliderVal === 1 ? "" : "s"}
                      </Text>
                    </Pressable>
                  </>
                )}
              </>
            )}

            <View className="flex-row items-center justify-between bg-felt-surface-2/50 border border-felt-border rounded-xl px-3.5 py-2.5 mt-1">
              <Text className="text-xs font-bold text-zinc-300">Leaving early? Cash out now</Text>
              <Pressable
                disabled={isClosed}
                onPress={() => setCashoutOn((v) => !v)}
                className={cn("w-11 h-6 rounded-full justify-center px-0.5", cashoutOn ? "bg-gold" : "bg-felt-surface-2 border border-felt-border")}
              >
                <View className={cn("w-5 h-5 rounded-full bg-white", cashoutOn ? "self-end" : "self-start")} />
              </Pressable>
            </View>

            {cashoutOn && (
              <View className="gap-3.5">
                <Text className="text-center text-[11px] text-zinc-500">
                  {sheetPlayerIn === 0 ? "no" : sheetPlayer.buyins.length} buy-in{sheetPlayer.buyins.length === 1 ? "" : "s"} ·{" "}
                  <NumB value={sheetPlayerIn} size="text-[11px]" className="text-zinc-400" /> in — locked while cashing out
                </Text>
                <View className="items-center pt-1 pb-0.5">
                  <Text className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Cashing out</Text>
                  <NumB value={cashoutEntered} size="text-[40px]" className="text-white" />
                </View>
                <Text className="text-center text-[11.5px] font-mono -mt-1.5">
                  net <NumB value={cashoutNet} sign size="text-[11.5px]" className={cashoutNet >= 0 ? "text-emerald-400" : "text-red-400"} />
                </Text>
                {!isClosed && (
                  <>
                    <Keypad
                      onDigit={(d) => setCashoutDigits((prev) => (prev === "0" ? "" : prev) + d)}
                      onBackspace={() => setCashoutDigits((prev) => prev.slice(0, -1))}
                      onClear={() => setCashoutDigits("")}
                    />
                    <Pressable disabled={busy} onPress={confirmCashout} className={cn("w-full h-12 rounded-xl items-center justify-center", busy ? "bg-gold/50" : "bg-gold")}>
                      <Text className="text-white font-bold text-sm">{sheetPlayer.cashedOut ? "Update cash out" : "Confirm cash out"}</Text>
                    </Pressable>
                  </>
                )}
              </View>
            )}
          </View>
        )}
      </AppSheet>
    </View>
  )
}
