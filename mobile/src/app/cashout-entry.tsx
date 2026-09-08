// ─── Cash-out Entry — ported from web App.jsx's CashoutEntryScreen ────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 3] Step 3 of the game
// lifecycle (buy-ins -> cash-outs -> settlement -> closed — see
// REQUIREMENTS.md -> Game lifecycle). No buy-in editing here; buy-ins are
// frozen for the duration of this step, same as web. "Back to buy-ins" is
// always available (nothing here has finally locked yet) and flips the
// game's status back to "live". "Review & Continue" opens the end-of-game
// review (rake + uncashed-player acknowledgement, ported inline below as
// EndGameReviewDialog rather than web's separate EndGameModal, since this
// codebase keeps small dialogs colocated with their screen) and, on
// confirm, carries the reviewed rake forward and moves to /settlement — no
// status change happens there; step 3 -> step 4 isn't a stored transition.
import { useState } from "react"
import { View, Text, ScrollView, Pressable, TextInput } from "react-native"
import { useRouter } from "expo-router"
import { useAppState } from "@/lib/AppContext"
import * as gamesApi from "@/lib/gamesApi"
import { fmtB, fmtNet, computeBankroll } from "@core/money"
import { totalBuyinsFor } from "@core/settlement"
import { NumB, Dot, Av, AppSheet, AppDialog, Keypad, SL, cn } from "@/components/game-ui"

type Game = any
type Player = any

export default function CashoutEntryRoute() {
  const router = useRouter()
  const { authLoading, gamesLoading, activeGame, showToast, refreshAllGames } = useAppState()

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
        <Text className="text-zinc-400 text-sm text-center leading-relaxed">No game is in cash-outs right now.</Text>
        <Pressable onPress={() => router.replace("/")} className="mt-5 h-11 px-5 rounded-xl bg-felt-surface-2 border border-felt-border items-center justify-center">
          <Text className="text-zinc-300 text-sm font-semibold">Back</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <CashoutEntryBody
      game={activeGame}
      showToast={showToast}
      onMutated={refreshAllGames}
      onBackHome={() => router.replace("/")}
      onBackToBuyins={async () => {
        await gamesApi.setGameStatus(activeGame.id, "live")
        await refreshAllGames()
        router.replace("/live-game" as never)
      }}
      onContinue={async (rakeAmt: number) => {
        await gamesApi.updateRake(activeGame.id, rakeAmt)
        await refreshAllGames()
        router.push("/settlement" as never)
      }}
    />
  )
}

function CashoutEntryBody({
  game,
  showToast,
  onMutated,
  onBackHome,
  onBackToBuyins,
  onContinue,
}: {
  game: Game
  showToast: (icon: string, title: string, msg?: string) => void
  onMutated: () => Promise<void>
  onBackHome: () => void
  onBackToBuyins: () => Promise<void>
  onContinue: (rakeAmt: number) => Promise<void>
}) {
  const [sheetFor, setSheetFor] = useState<string | null>(null)
  const [cashoutDigits, setCashoutDigits] = useState("")
  const [showEnd, setShowEnd] = useState(false)
  const [rakeVisible, setRakeVisible] = useState(false)
  const [rakeInput, setRakeInput] = useState(String((game.rake || 0) / 10000))
  const [busy, setBusy] = useState(false)

  const players: Player[] = game.players
  const { totalIn, totalOut, overpaid, overpayError, stillIn } = computeBankroll(players, game.rake || 0)

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
    const amt = Math.max(0, (parseFloat(v) || 0) * 10000)
    run(() => gamesApi.updateRake(game.id, amt))
  }

  const openSheet = (p: Player) => {
    setSheetFor(p.name)
    setCashoutDigits(p.cashedOut ? String(Math.round((p.cashoutAmount || 0) / 10000)) : "")
  }
  const closeSheet = () => {
    setSheetFor(null)
    setCashoutDigits("")
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

  const backToBuyins = () => {
    if (busy) return
    setBusy(true)
    onBackToBuyins()
      .catch((err: any) => {
        console.error(err)
        showToast("⚠️", "Couldn't go back to buy-ins", err?.message || "Please try again")
      })
      .finally(() => setBusy(false))
  }

  const handleReviewContinue = (rakeAmt: number) => {
    if (busy) return
    setBusy(true)
    onContinue(rakeAmt)
      .then(() => setShowEnd(false))
      .catch((err: any) => {
        console.error(err)
        showToast("⚠️", "Couldn't continue to settlement", err?.message || "Please try again")
      })
      .finally(() => setBusy(false))
  }

  const sheetPlayer = players.find((p) => p.name === sheetFor)
  const sheetPlayerIn = sheetPlayer ? totalBuyinsFor(sheetPlayer) : 0
  const cashoutEntered = parseInt(cashoutDigits || "0", 10) * 10000
  const cashoutNet = cashoutEntered - sheetPlayerIn

  return (
    <View className="flex-1 bg-felt-bg">
      <ScrollView>
        {/* Header */}
        <View className="px-5 pt-14 pb-5 border-b border-felt-border">
          <View className="flex-row items-center justify-between mb-4">
            <View className="flex-row items-center gap-3">
              <Pressable onPress={onBackHome} className="w-7 h-7 -ml-1 items-center justify-center">
                <Text className="text-zinc-400 text-base">⌄</Text>
              </Pressable>
              <View className="flex-row items-center gap-2">
                <View className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <Text className="text-[10px] font-bold tracking-[2px] uppercase text-amber-400">Cash-outs</Text>
              </View>
            </View>
            {/* Reversible — nothing here has finally locked yet, so going
                back to buy-ins is always available. */}
            <Pressable disabled={busy} onPress={backToBuyins} className="flex-row items-center gap-1.5 bg-felt-surface border border-felt-border px-3 py-1.5 rounded-lg">
              <Text className="text-zinc-400 text-xs">⌃</Text>
              <Text className="text-zinc-400 text-xs">Back to buy-ins</Text>
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
              <TextInput
                value={rakeInput}
                onChangeText={setRakeInput}
                onBlur={() => commitRake(rakeInput)}
                keyboardType="decimal-pad"
                className="mt-1 text-[18px] font-extrabold font-mono text-amber-400 p-0"
              />
            ) : (
              <Text className="mt-1 text-[18px] font-extrabold tracking-[3px] text-zinc-400">•••</Text>
            )}
          </View>
        </View>

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

        <SL>Players · tap any to cash out</SL>

        <View className="px-5 gap-2">
          {players.map((p: Player) => {
            const tIn = totalBuyinsFor(p)
            const net = p.cashedOut ? p.cashoutAmount - tIn : 0
            return (
              <Pressable
                key={p.id}
                onPress={() => openSheet(p)}
                className={cn("flex-row items-center gap-3 bg-felt-surface border border-felt-border rounded-2xl px-3.5 py-3", p.cashedOut && "opacity-55")}
              >
                <Av name={p.name} size={36} />
                <View className="flex-1">
                  <Text className="font-bold text-sm text-zinc-100">{p.name}</Text>
                  <Text className="text-[10.5px] text-zinc-400 mt-0.5 font-mono">
                    {tIn === 0 ? "no" : p.buyins.length} buy-in{p.buyins.length === 1 ? "" : "s"} in · {p.cashedOut ? "cashed out" : "not yet"}
                  </Text>
                </View>
                {p.cashedOut ? (
                  <NumB value={net} sign size="text-[17px]" className={net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-400"} />
                ) : (
                  <NumB value={tIn} size="text-[17px]" className="text-white" />
                )}
                <Dot color={p.cashedOut ? (net >= 0 ? "emerald" : "red") : "indigo"} />
              </Pressable>
            )
          })}
        </View>

        {players.length > 0 && (
          <View className="px-5 mt-5 pb-10">
            <Pressable
              disabled={overpayError || busy}
              onPress={() => setShowEnd(true)}
              className={cn("w-full h-12 rounded-xl items-center justify-center border", overpayError || busy ? "bg-red-600/40 border-red-500/20" : "bg-red-600/80 border-red-500/30")}
            >
              <Text className="text-white font-bold text-sm">Review & Continue →</Text>
            </Pressable>
            {overpayError && (
              <Text className="text-[11px] text-red-300/90 text-center mt-2 leading-relaxed">
                Can't continue while paid out exceeds total buy-ins — fix the entries above first.
              </Text>
            )}
          </View>
        )}
      </ScrollView>

      {showEnd && <EndGameReviewDialog game={game} busy={busy} onConfirm={handleReviewContinue} onClose={() => setShowEnd(false)} />}

      {/* Cash-out sheet — no buy-in editing here; buy-ins are frozen for the
          duration of this step. */}
      <AppSheet
        open={!!sheetFor}
        onClose={closeSheet}
        title={sheetPlayer?.name}
        subtitle={sheetPlayer ? `${sheetPlayer.buyins.length} buy-in${sheetPlayer.buyins.length === 1 ? "" : "s"} at the table` : ""}
        avatar={sheetPlayer && <Av name={sheetPlayer.name} size={36} />}
      >
        {sheetPlayer && (
          <View className="gap-3.5">
            <Text className="text-center text-[11px] text-zinc-500">
              {sheetPlayerIn === 0 ? "no" : sheetPlayer.buyins.length} buy-in{sheetPlayer.buyins.length === 1 ? "" : "s"} ·{" "}
              <NumB value={sheetPlayerIn} size="text-[11px]" className="text-zinc-400" /> in
            </Text>
            <View className="items-center pt-1 pb-0.5">
              <Text className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Cashing out</Text>
              <NumB value={cashoutEntered} size="text-[40px]" className="text-white" />
            </View>
            <Text className="text-center text-[11.5px] font-mono -mt-1.5">
              net <NumB value={cashoutNet} sign size="text-[11.5px]" className={cashoutNet >= 0 ? "text-emerald-400" : "text-red-400"} />
            </Text>
            <Keypad
              onDigit={(d) => setCashoutDigits((prev) => (prev === "0" ? "" : prev) + d)}
              onBackspace={() => setCashoutDigits((prev) => prev.slice(0, -1))}
              onClear={() => setCashoutDigits("")}
            />
            <Pressable disabled={busy} onPress={confirmCashout} className={cn("w-full h-12 rounded-xl items-center justify-center", busy ? "bg-gold/50" : "bg-gold")}>
              <Text className="text-white font-bold text-sm">{sheetPlayer.cashedOut ? "Update cash out" : "Confirm cash out"}</Text>
            </Pressable>
          </View>
        )}
      </AppSheet>
    </View>
  )
}

// ─── Review & Continue dialog — ported from web's EndGameModal ────────────
// Rake input + an explicit acknowledgement when any player hasn't cashed
// out (their buy-ins count as a loss to the table). Rake never appears as
// a settlement transfer — it's host revenue skimmed off the table, per
// src/core/money.js's invariant (sum(buy-ins) = sum(cash-outs) + rake).
function EndGameReviewDialog({
  game,
  busy,
  onConfirm,
  onClose,
}: {
  game: Game
  busy: boolean
  onConfirm: (rakeAmt: number) => void
  onClose: () => void
}) {
  const [rake, setRake] = useState(String((game.rake || 0) / 10000))
  const [ackUncashed, setAckUncashed] = useState(false)
  const players: Player[] = game.players
  const uncashed = players.filter((p) => !p.cashedOut)
  const rakeAmt = (parseFloat(rake) || 0) * 10000
  const { totalIn, totalOut, diff, balanced } = computeBankroll(players, rakeAmt)
  const canProceed = balanced && (uncashed.length === 0 || ackUncashed) && !busy

  const rows: [string, string][] = [
    ["Bought In", fmtB(totalIn)],
    ...(rakeAmt > 0 ? ([["Rake", fmtB(rakeAmt)]] as [string, string][]) : []),
    ["Cashed Out", fmtB(totalOut)],
    ...(!balanced ? ([["Off by", fmtB(Math.abs(diff))]] as [string, string][]) : []),
  ]

  return (
    <AppDialog open onClose={onClose} title="Review & Continue" description="Review accounts before moving to settlement.">
      <View className="gap-3.5 mb-3">
        {uncashed.length > 0 && (
          <Pressable
            onPress={() => setAckUncashed((v) => !v)}
            className="flex-row items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3"
          >
            <View className={cn("w-4 h-4 rounded mt-0.5 border items-center justify-center", ackUncashed ? "bg-amber-500 border-amber-500" : "border-amber-500/50")}>
              {ackUncashed && <Text className="text-[10px] text-white font-bold">✓</Text>}
            </View>
            <Text className="text-xs text-amber-300 flex-1">
              {uncashed.length} player{uncashed.length > 1 ? "s have" : " has"} no cash-out recorded — their buy-ins will count as a loss to the table. Continue?
            </Text>
          </Pressable>
        )}

        <View>
          <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500 mb-1.5">Rake (Banks)</Text>
          <View className="flex-row items-center gap-2">
            <TextInput
              value={rake}
              onChangeText={setRake}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor="#a1a1aa"
              className="flex-1 h-11 bg-felt-surface-2 border border-felt-border rounded-xl px-4 text-zinc-100 text-sm font-mono"
            />
            <Text className="text-zinc-400 text-sm font-bold w-6">B</Text>
          </View>
        </View>

        <View className={cn("rounded-xl p-3.5 gap-2.5 border", balanced ? "bg-emerald-500/10 border-emerald-500/20" : "bg-red-500/10 border-red-500/20")}>
          <Text className={cn("text-xs font-bold uppercase tracking-wider", balanced ? "text-emerald-400" : "text-red-400")}>
            {balanced ? "✓ Balanced" : "⚠ Discrepancy"}
          </Text>
          {rows.map(([l, v]) => (
            <View key={l} className="flex-row justify-between">
              <Text className="text-zinc-400 text-sm">{l}</Text>
              <Text className="font-mono text-sm font-semibold text-zinc-200">{v}</Text>
            </View>
          ))}
          {!balanced && (
            <Text className="text-xs text-red-300/90 pt-1 leading-relaxed">
              Buy-ins and cash-outs don't add up — off by {fmtB(Math.abs(diff))}. Check your entries before settling.
            </Text>
          )}
        </View>
      </View>

      <View className="flex-row gap-3">
        <Pressable onPress={onClose} className="flex-1 h-11 bg-felt-surface-2 border border-felt-border rounded-xl items-center justify-center">
          <Text className="text-zinc-300 font-semibold text-sm">Cancel</Text>
        </Pressable>
        <Pressable
          disabled={!canProceed}
          onPress={() => onConfirm(rakeAmt)}
          className={cn("flex-1 h-11 rounded-xl items-center justify-center", !canProceed ? "bg-gold/40" : "bg-gold")}
        >
          <Text className="text-white font-bold text-sm">Continue →</Text>
        </Pressable>
      </View>
    </AppDialog>
  )
}
