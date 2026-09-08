// ─── Settlement — ported from web App.jsx's SettlementScreen ──────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 3] Step 4 — the last
// screen before a game closes. Same auto-computed transfers (computeSettlement,
// @core/settlement, unchanged from web) with per-transfer override/remove
// and custom payments, same leaderboard, same clipboard-copy summary (now
// via expo-clipboard instead of navigator.clipboard). "End Game & Send
// Results" hands the visible transfer list to AppStateContext's
// handleCloseGame, which writes the settlement, closes the game, and routes
// home — same shape as web's onClose(transfers) callback into the App root.
//
// One trim: the "settled" checkbox state (`settled`/`setSettled` on web) is
// local UI-only there too (never persisted, no read anywhere) — kept here
// as well, but it doesn't do anything the persisted per-settlement `paid`
// toggle on Home doesn't already cover once the game closes, so tapping a
// payment row here doesn't currently flip PAID/DUE. Not wired to a control
// yet since web's PAID/DUE badge design didn't have a tap target on this
// screen either — the toggle lives on Home post-close, same as web.
import { useState } from "react"
import { View, Text, ScrollView, Pressable } from "react-native"
import { useRouter } from "expo-router"
import * as Clipboard from "expo-clipboard"
import { useAppState } from "@/lib/AppContext"
import { fmtB, computeBankroll } from "@core/money"
import { totalBuyinsFor, computeSettlement } from "@core/settlement"
import { NumB, Av, AppSheet, ProgressBar, Keypad, SL, cn } from "@/components/game-ui"

type Game = any
type Player = any
type Txn = { key: string; from: string; to: string; amount: number; isAuto: boolean }

export default function SettlementRoute() {
  const router = useRouter()
  const { authLoading, gamesLoading, activeGame, showToast, handleCloseGame } = useAppState()

  if (authLoading || gamesLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg">
        <Text className="text-zinc-400 text-sm font-medium">Loading…</Text>
      </View>
    )
  }

  if (!activeGame || activeGame.status !== "cashout") {
    return (
      <View className="flex-1 items-center justify-center bg-felt-bg px-6">
        <Text className="text-zinc-400 text-sm text-center leading-relaxed">No game is ready to settle right now.</Text>
        <Pressable onPress={() => router.replace("/")} className="mt-5 h-11 px-5 rounded-xl bg-felt-surface-2 border border-felt-border items-center justify-center">
          <Text className="text-zinc-300 text-sm font-semibold">Back</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <SettlementBody
      game={activeGame}
      showToast={showToast}
      onBack={() => router.replace("/cashout-entry" as never)}
      onClose={handleCloseGame}
    />
  )
}

function SettlementBody({
  game,
  showToast,
  onBack,
  onClose,
}: {
  game: Game
  showToast: (icon: string, title: string, msg?: string) => void
  onBack: () => void
  onClose: (transfers: any[]) => Promise<void>
}) {
  const players: Player[] = game.players
  const rake = game.rake || 0
  const { totalIn, totalOut, diff: delta, balanced } = computeBankroll(players, rake)

  const positions = players
    .map((p: Player) => ({ name: p.name, net: Math.round((p.cashoutAmount || 0) - totalBuyinsFor(p)) }))
    .sort((a: any, b: any) => b.net - a.net)

  const baseTxns = computeSettlement(players)
  const [overrides, setOverrides] = useState<Record<string, { from: string; to: string; amount: number; removed?: boolean }>>(() =>
    Object.fromEntries(baseTxns.map((t: any, i: number) => [`auto-${i}`, { from: t.from, to: t.to, amount: t.amount }]))
  )
  const [customTxns, setCustomTxns] = useState<Txn[]>([])
  const [sheetTxn, setSheetTxn] = useState<(Txn & { isNew?: boolean }) | null>(null)
  const [sheetFrom, setSheetFrom] = useState("")
  const [sheetTo, setSheetTo] = useState("")
  const [sheetDigits, setSheetDigits] = useState("")
  const [ending, setEnding] = useState(false)

  const allTxns: Txn[] = [
    ...baseTxns.map((t: any, i: number) => {
      const key = `auto-${i}`
      const ov = overrides[key]
      return { key, from: ov?.from ?? t.from, to: ov?.to ?? t.to, amount: ov?.amount ?? t.amount, isAuto: true }
    }),
    ...customTxns,
  ]
  const visibleTxns = allTxns.filter((t) => !overrides[t.key]?.removed)

  const openEdit = (t: Txn) => {
    setSheetTxn(t)
    setSheetFrom(t.from)
    setSheetTo(t.to)
    setSheetDigits(t.amount ? String(Math.round(t.amount / 10000)) : "")
  }
  const openAdd = () => {
    setSheetTxn({ key: `custom-${customTxns.length}`, from: "", to: "", amount: 0, isAuto: false, isNew: true })
    setSheetFrom("")
    setSheetTo("")
    setSheetDigits("")
  }
  const closeSheet = () => setSheetTxn(null)

  const saveSheet = () => {
    if (!sheetTxn) return
    const amt = parseInt(sheetDigits || "0", 10) * 10000
    if (!sheetFrom || !sheetTo || amt <= 0) {
      showToast("⚠️", "Invalid", "Pick From, To and an amount")
      return
    }
    if (sheetTxn.isNew) {
      setCustomTxns((prev) => [...prev, { key: sheetTxn.key, from: sheetFrom, to: sheetTo, amount: amt, isAuto: false }])
    } else if (sheetTxn.key.startsWith("auto-")) {
      setOverrides((prev) => ({ ...prev, [sheetTxn.key]: { from: sheetFrom, to: sheetTo, amount: amt } }))
    } else {
      setCustomTxns((prev) => prev.map((t) => (t.key === sheetTxn.key ? { ...t, from: sheetFrom, to: sheetTo, amount: amt } : t)))
    }
    closeSheet()
  }

  const removeSheet = () => {
    if (!sheetTxn) return
    if (!sheetTxn.isNew && !sheetTxn.key.startsWith("auto-")) {
      setCustomTxns((prev) => prev.filter((t) => t.key !== sheetTxn.key))
    } else if (!sheetTxn.isNew) {
      setOverrides((prev) => ({ ...prev, [sheetTxn.key]: { from: sheetTxn.from, to: sheetTxn.to, amount: 0, removed: true } }))
    }
    closeSheet()
  }

  // No deep links — copy to clipboard only, per the app-wide no-deep-links
  // interaction principle. Same placeholder-results-link status as web (see
  // that file's comment): the per-player results link can't resolve to
  // anyone's data yet without the phone-claim flow.
  const resultsText = () =>
    [
      `🃏 ${game.name} — ${game.date}`,
      ``,
      `Settle Up (${visibleTxns.length} payments):`,
      ...visibleTxns.map((t) => `• ${t.from} → ${t.to}: ${fmtB(t.amount)}`),
      ...(visibleTxns.length === 0 ? ["• Everyone's even!"] : []),
      ``,
      `See your own results: https://straddle-pro.vercel.app/g/${game.id}/results`,
      `(sign in with the phone number you played under)`,
    ].join("\n")

  const copySettlement = async () => {
    try {
      await Clipboard.setStringAsync(resultsText())
      showToast("📋", "Copied", "Settlement summary ready to paste")
    } catch {
      showToast("📋", "Couldn't copy", "Please try again")
    }
  }

  const endGame = async () => {
    if (ending) return
    setEnding(true)
    try {
      await Clipboard.setStringAsync(resultsText())
    } catch {
      /* best-effort */
    }
    try {
      await onClose(visibleTxns.map(({ from, to, amount }) => ({ from, to, amount })))
    } catch (err: any) {
      showToast("⚠️", "Couldn't end game", err?.message || "Please try again")
    } finally {
      setEnding(false)
    }
  }

  const medals = ["🥇", "🥈", "🥉"]

  return (
    <View className="flex-1 bg-felt-bg">
      <ScrollView>
        {/* Header */}
        <View className="px-5 pt-14 pb-6 border-b border-felt-border">
          <Pressable onPress={onBack} className="flex-row items-center gap-1.5 mb-5">
            <Text className="text-zinc-400 text-sm">✕</Text>
            <Text className="text-zinc-400 text-sm">Back to cash-outs</Text>
          </Pressable>
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-white text-xl font-black tracking-tight">Settlement</Text>
              <Text className="text-zinc-400 text-sm mt-1">
                {game.name} · {game.date}
              </Text>
            </View>
            <Text className="text-amber-500 text-2xl">🏆</Text>
          </View>
          <View className="flex-row gap-2 mt-4 flex-wrap">
            {[`${fmtB(totalIn)} pot`, rake > 0 ? `${fmtB(rake)} rake` : null, `${players.length} players`, `${visibleTxns.length} payments`]
              .filter(Boolean)
              .map((s) => (
                <Text key={s as string} className="text-[10px] font-bold text-zinc-500 bg-felt-surface border border-felt-border rounded-full px-3 py-1">
                  {s}
                </Text>
              ))}
          </View>
        </View>

        {/* Balance */}
        <View className={cn("flex-row items-center gap-3 px-5 py-3 border-b", balanced ? "bg-emerald-500/5 border-emerald-500/10" : "bg-red-500/5 border-red-500/10")}>
          <Text className={cn("text-sm", balanced ? "text-emerald-500" : "text-red-500")}>{balanced ? "✓" : "⚠"}</Text>
          <Text className={cn("text-sm font-semibold flex-1 flex-wrap", balanced ? "text-emerald-400" : "text-red-400")}>
            {balanced ? "All accounts balanced" : `Buy-ins and cash-outs don't add up — off by ${fmtB(Math.abs(delta))}. Go back to check entries before settling.`}
          </Text>
        </View>

        {/* Leaderboard */}
        <SL>Results</SL>
        <View className="px-5 gap-2 mb-2">
          {positions.map((pos: any, rank: number) => {
            const p = players.find((x: Player) => x.name === pos.name)
            return (
              <View
                key={pos.name}
                className={cn(
                  "bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex-row items-center gap-3 border-l-2",
                  pos.net > 0 ? "border-l-emerald-500" : pos.net < 0 ? "border-l-red-500" : ""
                )}
              >
                <Text className="text-xl w-7 text-center">{rank < 3 ? medals[rank] : `#${rank + 1}`}</Text>
                <Av name={pos.name} size={32} />
                <View className="flex-1">
                  <Text className="font-semibold text-zinc-100 text-sm">{pos.name}</Text>
                  <Text className="text-xs text-zinc-400 font-mono mt-0.5">
                    In {fmtB(totalBuyinsFor(p))} · Out {fmtB(p.cashoutAmount || 0)}
                  </Text>
                </View>
                <NumB value={pos.net} sign size="text-sm" className={pos.net > 0 ? "text-emerald-400" : pos.net < 0 ? "text-red-400" : "text-zinc-400"} />
              </View>
            )
          })}
        </View>

        {/* Payments */}
        <SL>Payments — {visibleTxns.length}</SL>

        {visibleTxns.length === 0 ? (
          <Text className="text-center py-8 text-zinc-400 text-sm">🎉 Everyone is even</Text>
        ) : (
          <View className="px-5 gap-2.5 mb-3">
            {visibleTxns.map((t) => (
              <Pressable key={t.key} onPress={() => openEdit(t)} className="flex-row items-center gap-3 bg-felt-surface border border-felt-border rounded-2xl px-3.5 py-3">
                <View className="flex-1">
                  <Text className="text-[13px] font-semibold text-zinc-100">
                    {t.from} <Text className="text-zinc-400">→</Text> {t.to}
                  </Text>
                  <Text className="text-[10px] text-zinc-400 font-mono mt-0.5">{!t.isAuto ? "custom" : "not yet paid"}</Text>
                </View>
                <NumB value={t.amount} size="text-[14.5px]" className="text-white" />
                <Text className="text-[9.5px] font-extrabold px-2 py-0.5 rounded-md tracking-wide bg-amber-500/15 text-amber-400">DUE</Text>
              </Pressable>
            ))}
          </View>
        )}

        {visibleTxns.length > 0 && (
          <View className="px-5 mb-4">
            <View className="flex-row items-center gap-3 bg-felt-surface border border-felt-border rounded-xl px-4 py-3">
              <Text className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Settled</Text>
              <ProgressBar value={0} className="flex-1" />
              <Text className="font-mono text-sm font-bold text-emerald-400">0/{visibleTxns.length}</Text>
            </View>
          </View>
        )}

        <View className="px-5 mb-4">
          <Pressable onPress={openAdd} className="w-full border border-dashed border-felt-border rounded-xl py-3 items-center flex-row justify-center gap-2">
            <Text className="text-zinc-400 text-sm font-medium">+ Add Custom Payment</Text>
          </Pressable>
        </View>

        {/* Actions */}
        <View className="px-5 gap-3 pb-10">
          <Pressable onPress={copySettlement} className="w-full h-12 bg-gold rounded-xl items-center justify-center flex-row gap-2">
            <Text className="text-white font-bold text-sm">Copy settlement summary</Text>
          </Pressable>
          <Pressable
            disabled={ending}
            onPress={endGame}
            className={cn("w-full h-12 rounded-xl items-center justify-center border border-felt-border", ending ? "bg-felt-surface-2/60" : "bg-felt-surface-2")}
          >
            <Text className="text-zinc-200 font-bold text-sm">{ending ? "Ending…" : "End Game & Send Results"}</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* Edit / add payment sheet */}
      <AppSheet
        open={!!sheetTxn}
        onClose={closeSheet}
        title={sheetTxn?.isNew ? "Add payment" : "Edit payment"}
        subtitle={sheetTxn && !sheetTxn.isNew ? `was ${sheetTxn.from} → ${sheetTxn.to}` : undefined}
      >
        {sheetTxn && (
          <View className="gap-1">
            <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500 mb-1.5">From</Text>
            <View className="flex-row flex-wrap gap-1.5 mb-3">
              {players.map((p: Player) => (
                <Pressable
                  key={p.name}
                  onPress={() => setSheetFrom(p.name)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-full border",
                    sheetFrom === p.name ? "bg-gold/15 border-gold/40" : "bg-felt-surface-2/70 border-felt-border"
                  )}
                >
                  <Text className={cn("text-[11px] font-semibold", sheetFrom === p.name ? "text-gold-light" : "text-zinc-400")}>{p.name}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500 mb-1.5">To</Text>
            <View className="flex-row flex-wrap gap-1.5 mb-3">
              {players.map((p: Player) => (
                <Pressable
                  key={p.name}
                  onPress={() => setSheetTo(p.name)}
                  className={cn(
                    "px-2.5 py-1.5 rounded-full border",
                    sheetTo === p.name ? "bg-gold/15 border-gold/40" : "bg-felt-surface-2/70 border-felt-border"
                  )}
                >
                  <Text className={cn("text-[11px] font-semibold", sheetTo === p.name ? "text-gold-light" : "text-zinc-400")}>{p.name}</Text>
                </Pressable>
              ))}
            </View>

            <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500 mb-1.5">Amount</Text>
            <View className="bg-felt-surface-2/60 border border-felt-border rounded-2xl px-4 py-3 items-end mb-3">
              <NumB value={parseInt(sheetDigits || "0", 10) * 10000} size="text-[26px]" className="text-white" />
            </View>

            <Keypad
              onDigit={(d) => setSheetDigits((prev) => (prev === "0" ? "" : prev) + d)}
              onBackspace={() => setSheetDigits((prev) => prev.slice(0, -1))}
              onClear={() => setSheetDigits("")}
            />

            <View className="flex-row gap-2.5 mt-3">
              <Pressable onPress={removeSheet} className="flex-1 h-11 rounded-xl bg-red-500/10 border border-red-500/30 items-center justify-center">
                <Text className="text-red-300 font-bold text-sm">Remove</Text>
              </Pressable>
              <Pressable onPress={saveSheet} className="flex-1 h-11 rounded-xl bg-gold items-center justify-center">
                <Text className="text-white font-bold text-sm">Save</Text>
              </Pressable>
            </View>
          </View>
        )}
      </AppSheet>
    </View>
  )
}

