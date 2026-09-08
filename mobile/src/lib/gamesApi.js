// ─── Game data — Supabase-backed (Phase 1, ported for mobile Phase 3) ──────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 3] Duplicated from the
// web app's src/lib/gamesApi.js rather than cross-imported, unlike
// src/core/money.js and src/core/settlement.js — this file imports `./
// supabase`, and that needs to resolve to *this platform's* client (mobile's
// expo-sqlite-backed one here, the browser one on web), not a single shared
// instance. src/core/{money,settlement}.js have no such platform-specific
// dependency, so those genuinely are shared unchanged via the `@core/*`
// alias (see metro.config.js). Keep this file's business logic in sync with
// the web version by hand if either changes — there's no automated sync.
//
// Same two ground rules as the web version:
// 1. No money math here — src/core/{money,settlement}.js own that, imported
//    via `@core/*`, not reimplemented.
// 2. No business-rule enforcement here either (e.g. "can't remove a player
//    once locked"). RLS is access control; callers (the screens) keep doing
//    that check client-side, same as web.
//
// Shapes match the LOCAL game/player shape used throughout the web App.jsx
// and src/core/*, same as the web version:
//   game:   { id, name, location, rake, status, lastBankCheckAt, bankChecks, players }
//   player: { id, name, phone, buyins: [{ id, amount, epoch }], cashoutAmount, cashedOutAt }

import { supabase } from "./supabase"
import { BANK } from "@core/money"

const toEpoch = (isoString) => (isoString ? new Date(isoString).getTime() : null)

function fmtDateDisplay(iso) {
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}
function fmtTimeDisplay(iso) {
  const d = new Date(iso)
  let h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, "0")} ${ap}`
}

function hydratePlayer(row) {
  return {
    id: row.id,
    name: row.display_name,
    phone: row.phone || "",
    profileId: row.profile_id,
    buyins: (row.buyins || [])
      .slice()
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map((b) => ({ id: b.id, amount: b.amount, epoch: toEpoch(b.created_at) })),
    cashoutAmount: row.cashout_amount,
    cashedOutAt: toEpoch(row.cashed_out_at),
    cashedOut: row.cashed_out_at != null,
  }
}

function hydrateGame(row) {
  const playerNameById = Object.fromEntries((row.game_players || []).map((p) => [p.id, p.display_name]))

  return {
    id: row.id,
    name: row.name,
    location: row.location || "",
    status: row.status,
    rake: row.rake || 0,
    buyinAmount: BANK,
    startedAt: toEpoch(row.started_at),
    endedAt: toEpoch(row.ended_at),
    date: row.started_at ? fmtDateDisplay(row.started_at) : "",
    time: row.started_at ? fmtTimeDisplay(row.started_at) : "",
    lastBankCheckAt: toEpoch(row.last_bank_check_at),
    bankChecks: (row.bank_checks || []).map((c) => toEpoch(c.checked_at)).sort((a, b) => a - b),
    players: (row.game_players || []).map(hydratePlayer),
    settlement: (row.settlements || []).map((s) => ({
      id: s.id,
      fromPlayerId: s.from_game_player_id,
      toPlayerId: s.to_game_player_id,
      from: playerNameById[s.from_game_player_id] || s.from_game_player_id,
      to: playerNameById[s.to_game_player_id] || s.to_game_player_id,
      amount: s.amount,
      note: s.note || "",
      isCustom: s.is_custom,
      paid: s.paid,
      paidAt: toEpoch(s.paid_at),
      paidBy: s.paid_by,
    })),
  }
}

const GAME_SELECT = `
  *,
  game_players ( *, buyins ( * ) ),
  bank_checks ( checked_at ),
  settlements ( * )
`

export async function fetchGame(gameId) {
  const { data, error } = await supabase.from("games").select(GAME_SELECT).eq("id", gameId).single()
  if (error) throw error
  return hydrateGame(data)
}

export async function fetchHostedGames(hostId) {
  const { data, error } = await supabase
    .from("games")
    .select(GAME_SELECT)
    .eq("host_id", hostId)
    .order("started_at", { ascending: false })
  if (error) throw error
  return (data || []).map(hydrateGame)
}

export async function fetchPlayedGames(profileId) {
  const { data, error } = await supabase
    .from("games")
    .select(GAME_SELECT)
    .order("started_at", { ascending: false })
  if (error) throw error
  return (data || [])
    .map(hydrateGame)
    .filter((g) => g.players.some((p) => p.profileId === profileId))
}

export async function createGame({ hostId, name, location, rake = 0, players = [] }) {
  const { data: game, error: gameError } = await supabase
    .from("games")
    .insert({ host_id: hostId, name, location: location || null, rake })
    .select()
    .single()
  if (gameError) throw gameError

  if (players.length) {
    const { data: gpRows, error: gpError } = await supabase
      .from("game_players")
      .insert(
        players.map((p) => ({
          game_id: game.id,
          display_name: p.name,
          phone: p.phone || null,
          known_player_id: p.knownPlayerId || null,
        }))
      )
      .select()
    if (gpError) throw gpError

    const buyinRows = gpRows.flatMap((gp, i) =>
      Array.from({ length: players[i].startBuyins || 1 }, () => ({
        game_player_id: gp.id,
        amount: BANK,
      }))
    )
    if (buyinRows.length) {
      const { error: buyinError } = await supabase.from("buyins").insert(buyinRows)
      if (buyinError) throw buyinError
    }
  }

  return fetchGame(game.id)
}

// JSDoc here (not on the web copy) purely so TS's inference for .js modules
// picks up the full param shape at call sites — without it, TS infers the
// destructured options type only from the one property with a default
// (`startBuyins`), and flags `name`/`phone` as unknown properties in mobile
// call sites written in .tsx.
/**
 * @param {string} gameId
 * @param {{ name: string, phone?: string, startBuyins?: number, knownPlayerId?: string }} [player]
 */
export async function addPlayer(gameId, { name, phone, startBuyins = 1, knownPlayerId } = {}) {
  const { data: gp, error: gpError } = await supabase
    .from("game_players")
    .insert({ game_id: gameId, display_name: name, phone: phone || null, known_player_id: knownPlayerId || null })
    .select()
    .single()
  if (gpError) throw gpError

  const buyinRows = Array.from({ length: startBuyins }, () => ({ game_player_id: gp.id, amount: BANK }))
  if (buyinRows.length) {
    const { error: buyinError } = await supabase.from("buyins").insert(buyinRows)
    if (buyinError) throw buyinError
  }
  return gp.id
}

export async function editPlayer(gamePlayerId, { name, phone }) {
  const patch = {}
  if (name != null) patch.display_name = name
  if (phone != null) patch.phone = phone || null
  const { error } = await supabase.from("game_players").update(patch).eq("id", gamePlayerId)
  if (error) throw error
}

export async function removePlayer(gamePlayerId) {
  const { error } = await supabase.from("game_players").delete().eq("id", gamePlayerId)
  if (error) throw error
}

export async function addBuyin(gamePlayerId, amount = BANK) {
  const { data, error } = await supabase
    .from("buyins")
    .insert({ game_player_id: gamePlayerId, amount })
    .select()
    .single()
  if (error) throw error
  return { id: data.id, amount: data.amount, epoch: toEpoch(data.created_at) }
}

export async function addBuyins(gamePlayerId, count, amount = BANK) {
  if (count <= 0) return []
  const { data, error } = await supabase
    .from("buyins")
    .insert(Array.from({ length: count }, () => ({ game_player_id: gamePlayerId, amount })))
    .select()
  if (error) throw error
  return data.map((d) => ({ id: d.id, amount: d.amount, epoch: toEpoch(d.created_at) }))
}

export async function removeBuyin(buyinId) {
  const { error } = await supabase.from("buyins").delete().eq("id", buyinId)
  if (error) throw error
}

export async function removeBuyins(buyinIds) {
  if (!buyinIds.length) return
  const { error } = await supabase.from("buyins").delete().in("id", buyinIds)
  if (error) throw error
}

export async function setCashout(gamePlayerId, amount) {
  const { error } = await supabase
    .from("game_players")
    .update({ cashout_amount: amount, cashed_out_at: new Date().toISOString() })
    .eq("id", gamePlayerId)
  if (error) throw error
}

export async function clearCashout(gamePlayerId) {
  const { error } = await supabase
    .from("game_players")
    .update({ cashout_amount: null, cashed_out_at: null })
    .eq("id", gamePlayerId)
  if (error) throw error
}

export async function runBankCheck(gameId) {
  const { data, error } = await supabase.rpc("run_bank_check", { p_game_id: gameId })
  if (error) throw error
  return toEpoch(data)
}

export async function setGameStatus(gameId, status) {
  const { error } = await supabase.from("games").update({ status }).eq("id", gameId)
  if (error) throw error
}

export async function updateRake(gameId, rake) {
  const { error } = await supabase.from("games").update({ rake }).eq("id", gameId)
  if (error) throw error
}

export async function closeGame(gameId, { rake } = {}) {
  const patch = { status: "closed", ended_at: new Date().toISOString() }
  if (rake != null) patch.rake = rake
  const { error } = await supabase.from("games").update(patch).eq("id", gameId)
  if (error) throw error
}

export async function writeSettlement(gameId, transfers) {
  const { error: delError } = await supabase.from("settlements").delete().eq("game_id", gameId)
  if (delError) throw delError
  if (!transfers.length) return
  const { error: insError } = await supabase.from("settlements").insert(
    transfers.map((t) => ({
      game_id: gameId,
      from_game_player_id: t.fromPlayerId,
      to_game_player_id: t.toPlayerId,
      amount: t.amount,
      note: t.note || null,
      is_custom: !!t.isCustom,
    }))
  )
  if (insError) throw insError
}

export async function setSettlementPaid(settlementId, paid, paidByAccountId) {
  const { error } = await supabase
    .from("settlements")
    .update({ paid, paid_at: paid ? new Date().toISOString() : null, paid_by: paid ? paidByAccountId : null })
    .eq("id", settlementId)
  if (error) throw error
}

export async function claimMyPlayerRows() {
  const { data, error } = await supabase.rpc("claim_my_player_rows")
  if (error) throw error
  return data
}
