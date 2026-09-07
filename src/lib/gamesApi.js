// ─── Game data — Supabase-backed (Phase 1) ─────────────────────────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 1] Every function here
// reads/writes the real database, RLS included — this is the layer that
// replaces src/lib/gameStore.js's localStorage read/write once App.jsx is
// wired to it (that wiring is the next step, not done yet; see the plan doc
// for why it's a separate pass).
//
// Two ground rules this file follows on purpose:
// 1. No money math here. Balance checks, overpay detection, and settlement
//    computation stay in src/core/{money,settlement}.js — tested once,
//    reused everywhere. This file only ever persists numbers the core
//    modules already produced; it never recomputes or re-validates them.
//    Reimplementing that logic a second time (in SQL) is exactly the kind
//    of duplication that has broken this project's math twice before.
// 2. No business-rule enforcement here either (e.g. "can't remove a player
//    once locked"). RLS's job is access control — who can see/touch which
//    rows — not game rules. Callers (App.jsx, once wired) keep doing that
//    check client-side, same as today.
//
// Shapes in and out of this file match the LOCAL game/player shape already
// used throughout App.jsx and src/core/*, so wiring a screen to this layer
// later is "call this instead of setState", not a data-model rewrite:
//   game:   { id, name, location, rake, status, lastBankCheckAt, bankChecks, players }
//   player: { id, name, phone, buyins: [{ id, amount, epoch }], cashoutAmount, cashedOutAt }
// `epoch` is a plain ms timestamp (Date.now()-shaped), matching what
// src/core/settlement.js's lockedCountFor already expects.

import { supabase } from "./supabase"
import { BANK } from "@/core/money"

const toEpoch = (isoString) => (isoString ? new Date(isoString).getTime() : null)

// [decision, REQUIREMENTS.md -> "dates/times must be stored as real
// timestamps, format at the display layer"] games.started_at is the only
// timestamp stored — game.date/game.time below are DERIVED display strings,
// computed fresh on every hydrate, in the exact format App.jsx has always
// rendered (see its own nowStr()/toLocaleDateString usage). This is what
// lets every existing `{game.date}` / `{game.time}` render call site in
// App.jsx keep working completely unchanged, while the actual stored value
// underneath is a real timestamp, not a locale string.
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
    // Derived, not stored separately — "cashed out" has always just meant
    // "has a cash-out timestamp" at the DB layer. Kept as a plain boolean
    // here because nearly every render call site in App.jsx already checks
    // `p.cashedOut` as a boolean flag.
    cashedOut: row.cashed_out_at != null,
  }
}

function hydrateGame(row) {
  // Settlement transfers are stored keyed by game_player id (from/to), but
  // every existing render/comparison in App.jsx works with player NAMES
  // (e.g. `t.from === hostName`). Resolve id -> name here, once, so nothing
  // downstream needs to know settlements are id-keyed in the database.
  const playerNameById = Object.fromEntries((row.game_players || []).map((p) => [p.id, p.display_name]))

  return {
    id: row.id,
    name: row.name,
    location: row.location || "",
    status: row.status,
    rake: row.rake || 0,
    // Fixed per REQUIREMENTS.md -> Money model ("every buy-in is always
    // exactly 1 bank; there is no host-set stake field") — not a stored
    // column, just BANK, kept as a field because App.jsx reads
    // `game.buyinAmount` throughout.
    buyinAmount: BANK,
    startedAt: toEpoch(row.started_at),
    endedAt: toEpoch(row.ended_at),
    date: row.started_at ? fmtDateDisplay(row.started_at) : "",
    time: row.started_at ? fmtTimeDisplay(row.started_at) : "",
    lastBankCheckAt: toEpoch(row.last_bank_check_at),
    bankChecks: (row.bank_checks || []).map((c) => toEpoch(c.checked_at)).sort((a, b) => a - b),
    players: (row.game_players || []).map(hydratePlayer),
    // Singular `settlement`, matching every existing App.jsx reference
    // (`game.settlement`) — not `settlements`.
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

// Fetches one game, hydrated into the local shape. RLS decides what comes
// back: the host gets every player/buy-in/settlement row; a non-host player
// gets only their own game_players/buyins rows and the settlements they're
// a party to — this function doesn't (and can't) tell the difference, it
// just hydrates whatever the database actually returned. That's the point:
// access control lives at the RLS layer, not here.
export async function fetchGame(gameId) {
  const { data, error } = await supabase.from("games").select(GAME_SELECT).eq("id", gameId).single()
  if (error) throw error
  return hydrateGame(data)
}

// Every game this account hosts, hydrated (for the Host tab / active-game
// resume). Ordered newest-started first.
export async function fetchHostedGames(hostId) {
  const { data, error } = await supabase
    .from("games")
    .select(GAME_SELECT)
    .eq("host_id", hostId)
    .order("started_at", { ascending: false })
  if (error) throw error
  return (data || []).map(hydrateGame)
}

// Every game this account has a claimed player row in (Player tab / "my
// results"), regardless of who hosted it. RLS's "games player read" +
// "game_players self read" policies are what make this return only the
// caller's own numbers even for games they don't host.
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

// Creates a game plus its initial players and their starting buy-ins in one
// call. `players` is [{ name, phone, startBuyins }] — startBuyins defaults
// to 1, matching CreateGameScreen's per-player stepper
// (REQUIREMENTS.md -> Money model, "starting buy-in COUNT").
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

// [decision, REQUIREMENTS.md -> "host can edit a player's name or phone
// number at any point before close"] Record-correction only — never touches
// buy-ins, so it's not gated by the lock the way removePlayer is.
export async function editPlayer(gamePlayerId, { name, phone }) {
  const patch = {}
  if (name != null) patch.display_name = name
  if (phone != null) patch.phone = phone || null
  const { error } = await supabase.from("game_players").update(patch).eq("id", gamePlayerId)
  if (error) throw error
}

// Caller must have already checked lockedCountFor(player, game) === 0 —
// this function does not re-check it (see file header: business rules stay
// client-side, not duplicated here).
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

// Bulk version of addBuyin — one INSERT statement for N rows instead of N
// separate round trips. A single INSERT is atomic (all rows land or none
// do), so a network blip partway through a multi-buy-in slider drag can no
// longer leave the game with some-but-not-all of the intended buy-ins added
// and no clear record of which.
export async function addBuyins(gamePlayerId, count, amount = BANK) {
  if (count <= 0) return []
  const { data, error } = await supabase
    .from("buyins")
    .insert(Array.from({ length: count }, () => ({ game_player_id: gamePlayerId, amount })))
    .select()
  if (error) throw error
  return data.map((d) => ({ id: d.id, amount: d.amount, epoch: toEpoch(d.created_at) }))
}

// Removes one buy-in (e.g. the slider stepping down). Caller must only ever
// pass an unlocked buy-in's id — same client-side-guard rule as removePlayer.
export async function removeBuyin(buyinId) {
  const { error } = await supabase.from("buyins").delete().eq("id", buyinId)
  if (error) throw error
}

// Bulk version of removeBuyin — one DELETE statement for N rows, same
// atomicity reasoning as addBuyins above.
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

// Atomic: bumps games.last_bank_check_at and appends a bank_checks row
// together, server-side (see supabase/schema.sql, run_bank_check). Returns
// the new lastBankCheckAt as an epoch ms number.
export async function runBankCheck(gameId) {
  const { data, error } = await supabase.rpc("run_bank_check", { p_game_id: gameId })
  if (error) throw error
  return toEpoch(data)
}

// Step transitions. Reversible ones (live <-> cashout) are plain updates —
// nothing about them is special at the data layer, matching
// REQUIREMENTS.md's "steps 2 and 3 are reversible."
export async function setGameStatus(gameId, status) {
  const { error } = await supabase.from("games").update({ status }).eq("id", gameId)
  if (error) throw error
}

export async function updateRake(gameId, rake) {
  const { error } = await supabase.from("games").update({ rake }).eq("id", gameId)
  if (error) throw error
}

// [decision, "the step-4 close is not reversible"] Sets status='closed' and
// ended_at together. Caller (App.jsx, once wired) is responsible for having
// already passed the balance check via src/core/money.js's computeBankroll
// — this function trusts that and just persists the final state.
export async function closeGame(gameId, { rake } = {}) {
  const patch = { status: "closed", ended_at: new Date().toISOString() }
  if (rake != null) patch.rake = rake
  const { error } = await supabase.from("games").update(patch).eq("id", gameId)
  if (error) throw error
}

// Replaces a game's settlement transfers wholesale. Used both at step-4
// entry (after computeSettlement runs) and whenever the host hand-edits a
// transfer — simplest correct approach while settlements are only ever
// written once per game (no reopen/recompute path exists yet; see
// REQUIREMENTS.md -> "not yet built: 30-minute reopen window", which is
// exactly what would make wholesale-replace unsafe and require a real diff
// instead — worth revisiting together).
// `transfers` is [{ fromPlayerId, toPlayerId, amount, note?, isCustom? }] —
// note this takes game_player ids, not names; translating computeSettlement's
// name-keyed output into ids (by matching player.name) is the caller's job.
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

// [decision, "claiming happens on login by phone match"] Call once right
// after ensureProfile() on every sign-in (see src/lib/auth.js). Idempotent —
// returns 0 when there's nothing new to claim.
export async function claimMyPlayerRows() {
  const { data, error } = await supabase.rpc("claim_my_player_rows")
  if (error) throw error
  return data
}
