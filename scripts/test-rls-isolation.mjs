// ─── RLS access-control proof (Phase 1, non-negotiable per the migration plan) ──
//
// docs/MOBILE_MIGRATION_PLAN.md, Phase 1: "write and run an explicit check
// (a script or a test, not eyeballing the UI) that a non-host account
// genuinely cannot read another player's buy-ins/cash-out for a game it
// didn't host. This is the one place in the whole migration where 'looks
// right in the app' is not sufficient evidence."
//
// This script does exactly that, against your REAL Supabase project (there's
// no local Postgres in this setup) — it signs in as two real accounts and
// tries to break the rule from the outside, the same way an attacker or a
// bug would.
//
// ── One-time setup ──
// 1. Apply supabase/migrations/20260907_phase1_game_data_and_rls.sql in the
//    Supabase SQL editor first — this script exercises tables/policies that
//    migration creates.
// 2. You need TWO real accounts that can sign in to this app (any two email
//    addresses you control work fine with the current email-magic-link
//    auth). Sign in as each one in the browser, then in the browser
//    devtools console (while signed in) run:
//      const { data } = await window.supabase?.auth.getSession() ?? {}
//    — or, if that's not exposed on window, temporarily add
//      `window.supabase = supabase` next to the client export in
//      src/lib/supabase.js, reload, sign in, run the line above, and revert
//      the one-line change. Either way you want `data.session.access_token`.
// 3. Put both tokens in a LOCAL, UNTRACKED file — never commit real tokens:
//      # .env.rls-test.local  (already gitignored, see .gitignore)
//      SUPABASE_TEST_HOST_JWT=eyJ...
//      SUPABASE_TEST_PLAYER_JWT=eyJ...
// 4. Run: node --env-file=.env.rls-test.local scripts/test-rls-isolation.mjs
//    (Node 20.6+; on older Node, `export $(cat .env.rls-test.local | xargs)`
//    first instead.)
//
// The script cleans up the game it creates when it's done, pass or fail.

import { createClient } from "@supabase/supabase-js"
import fs from "fs"

const env = Object.fromEntries(
  fs.readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY
const hostJwt = process.env.SUPABASE_TEST_HOST_JWT
const playerJwt = process.env.SUPABASE_TEST_PLAYER_JWT

if (!url || !anonKey) {
  console.error("Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local")
  process.exit(1)
}
if (!hostJwt || !playerJwt) {
  console.error("Missing SUPABASE_TEST_HOST_JWT / SUPABASE_TEST_PLAYER_JWT — see the setup steps at the top of this file.")
  process.exit(1)
}

function clientAs(jwt) {
  return createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } })
}

const asHost = clientAs(hostJwt)
const asPlayer = clientAs(playerJwt)

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? " — " + detail : ""}`)
  }
}

async function main() {
  const { data: { user: hostUser }, error: hostAuthErr } = await asHost.auth.getUser()
  const { data: { user: playerUser }, error: playerAuthErr } = await asPlayer.auth.getUser()
  if (hostAuthErr || !hostUser) throw new Error("SUPABASE_TEST_HOST_JWT didn't resolve to a user — token likely expired, get a fresh one")
  if (playerAuthErr || !playerUser) throw new Error("SUPABASE_TEST_PLAYER_JWT didn't resolve to a user — token likely expired, get a fresh one")
  if (hostUser.id === playerUser.id) throw new Error("Both tokens are the same account — this test needs two different accounts")

  console.log(`Host account:   ${hostUser.id}`)
  console.log(`Player account: ${playerUser.id}\n`)

  console.log("Setting up: host creates a game with two players, one linked to the player account...")
  const { data: game, error: gameErr } = await asHost
    .from("games").insert({ host_id: hostUser.id, name: "RLS isolation test game" }).select().single()
  if (gameErr) throw new Error(`Host couldn't even create a test game — is the host account approved (profiles.role/approved)? ${gameErr.message}`)

  const { data: players, error: gpErr } = await asHost
    .from("game_players")
    .insert([
      { game_id: game.id, display_name: "Host's own row", profile_id: hostUser.id },
      { game_id: game.id, display_name: "Test player (secret numbers)", profile_id: playerUser.id },
    ])
    .select()
  if (gpErr) throw new Error(`Host couldn't add players: ${gpErr.message}`)

  const secretPlayerRow = players.find((p) => p.profile_id === playerUser.id)
  const hostPlayerRow = players.find((p) => p.profile_id === hostUser.id)

  const { error: buyinErr } = await asHost.from("buyins").insert([
    { game_player_id: secretPlayerRow.id, amount: 30000 },
    { game_player_id: hostPlayerRow.id, amount: 10000 },
  ])
  if (buyinErr) throw new Error(`Host couldn't add buy-ins: ${buyinErr.message}`)

  await asHost.from("game_players").update({ cashout_amount: 0 }).eq("id", secretPlayerRow.id)

  console.log("\nRunning checks as the PLAYER account (should see only its own row, nothing else)...\n")

  // 1. The player CAN read their own game_players row.
  const { data: ownRow } = await asPlayer.from("game_players").select("*").eq("id", secretPlayerRow.id).maybeSingle()
  check("player can read their own game_players row", !!ownRow)

  // 2. The player CANNOT read the host's game_players row in the same game.
  const { data: otherRow } = await asPlayer.from("game_players").select("*").eq("id", hostPlayerRow.id).maybeSingle()
  check("player cannot read the OTHER player's game_players row", otherRow == null, otherRow ? `got back: ${JSON.stringify(otherRow)}` : undefined)

  // 3. The player CANNOT read the other player's buy-ins.
  const { data: otherBuyins } = await asPlayer.from("buyins").select("*").eq("game_player_id", hostPlayerRow.id)
  check("player cannot read the OTHER player's buyins", !otherBuyins || otherBuyins.length === 0, otherBuyins ? `got ${otherBuyins.length} row(s)` : undefined)

  // 4. The player CAN read their own buy-ins.
  const { data: ownBuyins } = await asPlayer.from("buyins").select("*").eq("game_player_id", secretPlayerRow.id)
  check("player can read their own buyins", ownBuyins && ownBuyins.length === 1)

  // 5. The player CANNOT overwrite the other player's cashout via a direct update.
  const { data: updated } = await asPlayer.from("game_players").update({ cashout_amount: 999999 }).eq("id", hostPlayerRow.id).select()
  check("player cannot write the OTHER player's cashout_amount", !updated || updated.length === 0, updated ? `update affected ${updated.length} row(s)` : undefined)

  // 6. The player CANNOT list all game_players for the game and see everyone.
  const { data: allInGame } = await asPlayer.from("game_players").select("*").eq("game_id", game.id)
  const leaked = (allInGame || []).some((r) => r.id === hostPlayerRow.id)
  check("querying the whole game's player list doesn't leak the other player's row", !leaked, leaked ? "the other player's row came back in a broad query" : undefined)

  console.log("\nCleaning up test game...")
  await asHost.from("games").delete().eq("id", game.id)

  console.log(`\n${failures === 0 ? "PASS" : "FAIL"} — ${failures} check(s) failed.`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error("\nScript error (not a policy failure — the test itself couldn't run):", err.message)
  process.exit(2)
})
