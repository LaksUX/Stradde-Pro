// ─── Shared app state — ported from web App.jsx's App Root ────────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 3] expo-router screens
// don't get prop-drilled from a shared root the way App.jsx's screens do —
// this Context is the nearest equivalent: one place holding auth/profile,
// the account's active + past games, roster, and the mutation handlers
// every screen needs (refreshAllGames, addToRoster, showToast,
// toggleSettlementPaid, handleCreateGame, handleCloseGame), same shape and
// same refetch-after-write strategy as the web App root. Mounted once in
// _layout.tsx, wrapping every route.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useRouter } from "expo-router"
import { supabase } from "@/lib/supabase"
import { ensureProfile } from "@/lib/auth"
import * as gamesApi from "@/lib/gamesApi"
import * as knownPlayersApi from "@/lib/knownPlayersApi"

type Toast = { icon: string; title: string; msg?: string } | null

type AppState = {
  authLoading: boolean
  session: any
  profile: any
  hostName: string | null
  isAdmin: boolean
  isApprovedHost: boolean
  activeGame: any
  pastGames: any[]
  gamesLoading: boolean
  roster: { name: string; phone: string }[]
  toast: Toast
  showToast: (icon: string, title: string, msg?: string) => void
  refreshAllGames: () => Promise<void>
  addToRoster: (name: string, phone: string) => void
  toggleSettlementPaid: (settlement: any) => Promise<void>
  handleCreateGame: (previewGame: any) => Promise<void>
  handleCloseGame: (transfers: any[]) => Promise<void>
  logout: () => Promise<void>
  // Game-detail selection — mirrors web's App-root selGame/selGameAsHost,
  // since expo-router has no built-in way to pass a whole object as a route
  // param the way a prop drill would.
  selGame: any
  selGameAsHost: boolean
  viewGameDetail: (game: any, asHost: boolean) => void
}

const AppStateContext = createContext<AppState | null>(null)

export function useAppState() {
  const ctx = useContext(AppStateContext)
  if (!ctx) throw new Error("useAppState() called outside <AppStateProvider>")
  return ctx
}

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [authLoading, setAuthLoading] = useState(true)
  const [session, setSession] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [activeGame, setActiveGame] = useState<any>(null)
  const [pastGames, setPastGames] = useState<any[]>([])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [roster, setRoster] = useState<{ name: string; phone: string }[]>([])
  const [toast, setToast] = useState<Toast>(null)
  const [selGame, setSelGame] = useState<any>(null)
  const [selGameAsHost, setSelGameAsHost] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const togglingRef = useRef<Set<string>>(new Set())

  const accountId = session?.user?.id || null
  const hostName = profile?.display_name || null
  const isAdmin = profile?.role === "admin"
  const isApprovedHost = profile?.role === "host" && profile?.approved === true

  // Auth bootstrap — same shape as web's App root: pick up an existing
  // session, then keep listening for sign-in/out.
  useEffect(() => {
    let mounted = true
    const hydrate = async (nextSession: any) => {
      setSession(nextSession)
      if (nextSession?.user) {
        try {
          const p = await ensureProfile(nextSession.user)
          if (mounted) setProfile(p)
        } catch (e) {
          console.error("Failed to load/create profile", e)
          if (mounted) setProfile(null)
        }
      } else {
        setProfile(null)
      }
      if (mounted) setAuthLoading(false)
    }
    supabase.auth.getSession().then(({ data }: any) => hydrate(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event: any, nextSession: any) => {
      hydrate(nextSession)
    })
    return () => {
      mounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [])

  const showToast = useCallback((icon: string, title: string, msg?: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current)
    setToast({ icon, title, msg })
    toastTimer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  const refreshAllGames = useCallback(
    async (id?: string) => {
      const uid = id ?? accountId
      if (!uid) return
      const games = await gamesApi.fetchHostedGames(uid)
      const withHostName = games.map((g: any) => ({ ...g, hostName }))
      const active = withHostName.find((g: any) => g.status !== "closed") || null
      setActiveGame(active)
      setPastGames(withHostName.filter((g: any) => g !== active))
    },
    [accountId, hostName]
  )

  useEffect(() => {
    let cancelled = false
    if (!accountId) {
      setActiveGame(null)
      setPastGames([])
      setGamesLoading(false)
      return
    }
    setGamesLoading(true)
    gamesApi
      .fetchHostedGames(accountId)
      .then((games: any[]) => {
        if (cancelled) return
        const withHostName = games.map((g: any) => ({ ...g, hostName }))
        const active = withHostName.find((g: any) => g.status !== "closed") || null
        setActiveGame(active)
        setPastGames(withHostName.filter((g: any) => g !== active))
      })
      .catch((err: any) => {
        console.error("Failed to load games", err)
        if (!cancelled) showToast("⚠️", "Couldn't load your games", err.message || "Check your connection")
      })
      .finally(() => {
        if (!cancelled) setGamesLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  useEffect(() => {
    let cancelled = false
    if (!accountId) {
      setRoster([])
      return
    }
    knownPlayersApi
      .fetchRoster(accountId)
      .then((list: any[]) => {
        if (!cancelled) setRoster(list)
      })
      .catch((err: any) => {
        if (!cancelled) showToast("⚠️", "Couldn't load your roster", err?.message || "Please try again")
      })
    return () => {
      cancelled = true
    }
  }, [accountId, showToast])

  const addToRoster = useCallback(
    (name: string, phone: string) => {
      const n = (name || "").trim()
      const ph = (phone || "").trim()
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
      knownPlayersApi.upsertRosterEntry(accountId, n, ph).catch((err: any) => {
        showToast("⚠️", "Couldn't save to your roster", err?.message || "Please try again")
      })
    },
    [accountId, showToast]
  )

  const toggleSettlementPaid = useCallback(
    async (settlement: any) => {
      if (togglingRef.current.has(settlement.id)) return
      togglingRef.current.add(settlement.id)
      try {
        await gamesApi.setSettlementPaid(settlement.id, !settlement.paid, accountId)
        await refreshAllGames()
      } catch (err: any) {
        showToast("⚠️", "Couldn't update payment status", err?.message || "Please try again")
      } finally {
        togglingRef.current.delete(settlement.id)
      }
    },
    [accountId, refreshAllGames, showToast]
  )

  const handleCreateGame = useCallback(
    async (previewGame: any) => {
      try {
        const created = await gamesApi.createGame({
          hostId: accountId,
          name: previewGame.name,
          location: previewGame.location,
          rake: 0,
          players: previewGame.players.map((p: any) => ({ name: p.name, phone: p.phone, startBuyins: p.startBuyins || 1 })),
        })
        setActiveGame({ ...created, hostName })
        router.replace("/live-game" as never)
        showToast("🃏", "Game Started", created.name)
      } catch (err: any) {
        showToast("⚠️", "Couldn't start game", err?.message || "Please try again")
        throw err
      }
    },
    [accountId, hostName, router, showToast]
  )

  const handleCloseGame = useCallback(
    async (transfers: any[]) => {
      if (!activeGame) {
        router.replace("/" as never)
        return
      }
      try {
        const idByName = Object.fromEntries(activeGame.players.map((p: any) => [p.name, p.id]))
        const withIds = (transfers || [])
          .map((t: any) => ({ fromPlayerId: idByName[t.from], toPlayerId: idByName[t.to], amount: t.amount }))
          .filter((t: any) => t.fromPlayerId && t.toPlayerId)
        await gamesApi.writeSettlement(activeGame.id, withIds)
        await gamesApi.closeGame(activeGame.id, { rake: activeGame.rake })
        await refreshAllGames()
        router.replace("/" as never)
        showToast("🏁", "Saved", "Results added to your dashboard")
      } catch (err: any) {
        showToast("⚠️", "Couldn't close game", err?.message || "Please try again")
      }
    },
    [activeGame, refreshAllGames, router, showToast]
  )

  const logout = useCallback(async () => {
    await supabase.auth.signOut()
    router.replace("/" as never)
  }, [router])

  const viewGameDetail = useCallback((game: any, asHost: boolean) => {
    setSelGame(game)
    setSelGameAsHost(asHost)
    router.push("/game-detail" as never)
  }, [router])

  const value: AppState = {
    authLoading,
    session,
    profile,
    hostName,
    isAdmin,
    isApprovedHost,
    activeGame,
    pastGames,
    gamesLoading,
    roster,
    toast,
    showToast,
    refreshAllGames,
    addToRoster,
    toggleSettlementPaid,
    handleCreateGame,
    handleCloseGame,
    logout,
    selGame,
    selGameAsHost,
    viewGameDetail,
  }

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>
}
