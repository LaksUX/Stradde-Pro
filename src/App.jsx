import { useState, useRef, useEffect } from "react"
import {
  Plus, Minus, ChevronDown, ChevronUp, Undo2, ArrowRight,
  Trophy, Clock, Users, TrendingUp, TrendingDown, Edit3, Check,
  Share2, X, LayoutDashboard, Gamepad2, Home, RotateCcw,
  CheckCircle2, AlertCircle, ChevronsRight, Coins, Hash,
  LogOut, ChevronRight, Wallet,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Progress } from "@/components/ui/progress"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { supabase } from "@/lib/supabase"
import { ensureProfile } from "@/lib/auth"

// ─── Helpers ──────────────────────────────────────────────────────────────────
const nowStr = () => {
  const d = new Date()
  let h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, "0")} ${ap}`
}

// 1 Bank = 1000 units internally. fmtB(1000) → "1B", fmtB(2500) → "2.5B"
const fmtB = (n) => {
  const abs = Math.abs(n)
  const b = abs / 1000
  if (b >= 1000) return `${(b / 1000).toFixed(b % 1000 === 0 ? 0 : 1)}KB`
  if (b === Math.floor(b)) return `${b}B`
  return `${b.toFixed(1)}B`
}

const fmtNet = (n) => {
  if (n === 0) return "Even"
  return `${n > 0 ? "+" : "−"}${fmtB(Math.abs(n))}`
}

const totalBuyinsFor = (p) => p.buyins.reduce((s, b) => s + b.amount, 0)

const avGrad = (name) => {
  const g = [
    ["#7c3aed","#4f46e5"], ["#0891b2","#0e7490"], ["#059669","#0d9488"],
    ["#dc2626","#b91c1c"], ["#db2777","#9d174d"], ["#d97706","#b45309"],
    ["#7c3aed","#db2777"], ["#2563eb","#1d4ed8"],
  ]
  let h = 0
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h)
  const [a, b] = g[Math.abs(h) % g.length]
  return `linear-gradient(135deg, ${a}, ${b})`
}

const initials = (n) => n.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()

// ─── Seed data ────────────────────────────────────────────────────────────────
const SEED_PAST_GAMES = [
  {
    id: 1, name: "Friday Night Felts", date: "Apr 11",
    buyinAmount: 1000, rake: 1000,
    players: [
      { name: "Raj K.",   buyins: [{ts:"8:00 PM",amount:1000},{ts:"9:15 PM",amount:1000}], cashedOut:true, cashoutAmount:2500 },
      { name: "Priya S.", buyins: [{ts:"8:00 PM",amount:1000},{ts:"8:45 PM",amount:1000}], cashedOut:true, cashoutAmount:1000 },
      { name: "Arjun M.", buyins: [{ts:"8:00 PM",amount:1000},{ts:"8:30 PM",amount:1000},{ts:"9:10 PM",amount:1000}], cashedOut:true, cashoutAmount:5500 },
      { name: "Neha R.",  buyins: [{ts:"8:00 PM",amount:1000},{ts:"9:30 PM",amount:1000}], cashedOut:true, cashoutAmount:0 },
      { name: "Dev P.",   buyins: [{ts:"8:00 PM",amount:1000},{ts:"9:00 PM",amount:1000}], cashedOut:true, cashoutAmount:2000 },
      { name: "Sana T.",  buyins: [{ts:"8:00 PM",amount:1000}], cashedOut:true, cashoutAmount:0 },
      { name: "Karan B.", buyins: [{ts:"8:00 PM",amount:1000},{ts:"8:20 PM",amount:1000}], cashedOut:true, cashoutAmount:2000 },
    ],
  },
  {
    id: 2, name: "Saturday Shootout", date: "Apr 5",
    buyinAmount: 1000, rake: 0,
    players: [
      { name: "Raj K.",   buyins: [{ts:"7:30 PM",amount:1000},{ts:"9:00 PM",amount:1000}], cashedOut:true, cashoutAmount:1000 },
      { name: "Priya S.", buyins: [{ts:"7:30 PM",amount:1000}], cashedOut:true, cashoutAmount:4000 },
      { name: "Arjun M.", buyins: [{ts:"7:30 PM",amount:1000},{ts:"8:50 PM",amount:1000}], cashedOut:true, cashoutAmount:2000 },
      { name: "Neha R.",  buyins: [{ts:"7:30 PM",amount:1000},{ts:"8:20 PM",amount:1000}], cashedOut:true, cashoutAmount:0 },
      { name: "Dev P.",   buyins: [{ts:"7:30 PM",amount:1000},{ts:"9:10 PM",amount:1000}], cashedOut:true, cashoutAmount:3000 },
    ],
  },
  {
    id: 3, name: "Sunday Deep Stack", date: "Mar 30",
    buyinAmount: 1000, rake: 2000,
    players: [
      { name: "Raj K.",   buyins: [{ts:"6:00 PM",amount:1000},{ts:"7:30 PM",amount:1000},{ts:"9:00 PM",amount:1000}], cashedOut:true, cashoutAmount:7000 },
      { name: "Priya S.", buyins: [{ts:"6:00 PM",amount:1000},{ts:"7:00 PM",amount:1000},{ts:"8:30 PM",amount:1000}], cashedOut:true, cashoutAmount:1000 },
      { name: "Arjun M.", buyins: [{ts:"6:00 PM",amount:1000},{ts:"8:00 PM",amount:1000},{ts:"9:15 PM",amount:1000}], cashedOut:true, cashoutAmount:4000 },
      { name: "Neha R.",  buyins: [{ts:"6:00 PM",amount:1000},{ts:"7:45 PM",amount:1000},{ts:"9:20 PM",amount:1000}], cashedOut:true, cashoutAmount:0 },
      { name: "Dev P.",   buyins: [{ts:"6:00 PM",amount:1000},{ts:"7:15 PM",amount:1000},{ts:"8:45 PM",amount:1000}], cashedOut:true, cashoutAmount:5000 },
    ],
  },
]

const KNOWN_PLAYERS = [...new Set(SEED_PAST_GAMES.flatMap(g => g.players.map(p => p.name)))]

// ─── Avatar ───────────────────────────────────────────────────────────────────
function Av({ name, size = 36 }) {
  return (
    <div
      className="rounded-xl flex items-center justify-center font-bold text-white shrink-0 select-none"
      style={{
        width: size, height: size,
        background: avGrad(name),
        fontSize: size <= 28 ? 10 : size <= 38 ? 12 : 14,
        letterSpacing: "0.05em",
      }}
    >
      {initials(name)}
    </div>
  )
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className="fixed bottom-28 left-1/2 -translate-x-1/2 z-[100] px-4">
      <div className="flex items-center gap-3 bg-zinc-800 border border-zinc-700 text-white px-4 py-3 rounded-2xl shadow-2xl shadow-black/50 max-w-[320px]">
        <span className="text-lg leading-none">{toast.icon}</span>
        <div>
          <div className="text-sm font-semibold text-zinc-100">{toast.title}</div>
          {toast.msg && <div className="text-xs text-zinc-400 mt-0.5">{toast.msg}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────
function SL({ children, action }) {
  return (
    <div className="flex items-center justify-between px-5 mb-2.5 mt-6">
      <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">{children}</span>
      {action}
    </div>
  )
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen({ onSendMagicLink }) {
  const [email, setEmail] = useState("")
  const [status, setStatus] = useState("idle") // idle | sending | sent | error
  const [error, setError] = useState("")

  const submit = async () => {
    if (!email.trim() || status === "sending") return
    setStatus("sending")
    setError("")
    try {
      await onSendMagicLink(email.trim())
      setStatus("sent")
    } catch (e) {
      setStatus("error")
      setError(e?.message || "Something went wrong. Try again.")
    }
  }

  if (status === "sent") {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(202,160,67,0.18),transparent)]" />
        <div className="relative z-10 w-full max-w-[320px] text-center">
          <div className="text-[48px] leading-none mb-5">✉️</div>
          <h1 className="text-white text-2xl font-black tracking-tight">Check your email</h1>
          <p className="text-zinc-500 text-sm mt-2 font-medium">
            We sent a magic link to <span className="text-zinc-300">{email}</span>. Open it on this device to sign in.
          </p>
          <button
            onClick={() => setStatus("idle")}
            className="mt-6 text-indigo-400-light text-sm font-bold hover:text-indigo-400-light transition-colors"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 px-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(202,160,67,0.18),transparent)]" />
      <div className="relative z-10 w-full max-w-[320px]">
        <div className="text-center mb-10">
          <div className="text-[48px] leading-none mb-5">♠</div>
          <h1 className="text-white text-3xl font-black tracking-tight">Poker Night</h1>
          <p className="text-zinc-500 text-sm mt-2 font-medium">Sign in with your email</p>
        </div>
        <div className="flex flex-col gap-3">
          <input
            className="w-full h-12 bg-zinc-900 border border-zinc-800 rounded-xl px-4 text-white text-sm font-medium placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
            placeholder="you@example.com"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submit()}
            autoFocus
          />
          <button
            disabled={!email.trim() || status === "sending"}
            onClick={submit}
            className="w-full h-12 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm"
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
          {status === "error" && (
            <p className="text-red-400 text-xs font-medium text-center">{error}</p>
          )}
        </div>
      </div>
    </div>
  )
}


function PendingApprovalScreen({ onLogout }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-zinc-950 px-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(202,160,67,0.18),transparent)]" />
      <div className="relative z-10 w-full max-w-[320px] text-center">
        <div className="text-[48px] leading-none mb-5">⏳</div>
        <h1 className="text-white text-2xl font-black tracking-tight">Pending approval</h1>
        <p className="text-zinc-500 text-sm mt-3 font-medium leading-relaxed">
          Your account is set up. Ask the app admin to approve you as a host to create games.
        </p>
        <button
          onClick={onLogout}
          className="mt-8 w-full h-12 bg-zinc-900 border border-zinc-800 hover:border-zinc-800 text-zinc-300 font-bold rounded-xl transition-colors text-sm"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

// ─── Admin ────────────────────────────────────────────────────────────────────
function AdminScreen({ onBack }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [busyId, setBusyId] = useState(null)

  const load = async () => {
    setLoading(true)
    setError("")
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .neq("role", "admin")
      .order("created_at", { ascending: false })
    if (error) setError(error.message)
    else setProfiles(data || [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const setApproval = async (row, role, approved) => {
    setBusyId(row.id)
    const { error } = await supabase
      .from("profiles")
      .update({ role, approved })
      .eq("id", row.id)
    if (error) {
      setError(error.message)
    } else {
      setProfiles(prev => prev.map(p => p.id === row.id ? { ...p, role, approved } : p))
    }
    setBusyId(null)
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 pb-10">
      <div className="relative px-5 pt-14 pb-7 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(202,160,67,0.12),transparent_60%)]" />
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <div className="text-zinc-500 text-xs font-medium mb-1">Admin</div>
            <div className="text-white text-2xl font-black tracking-tight">Approvals</div>
          </div>
          <button onClick={onBack} className="mt-1 p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-5 flex flex-col gap-2.5">
        {loading && <div className="text-zinc-500 text-sm text-center py-8">Loading…</div>}
        {error && <div className="text-red-400 text-xs font-medium">{error}</div>}
        {!loading && profiles.length === 0 && (
          <div className="text-zinc-500 text-sm text-center py-8">No accounts yet.</div>
        )}
        {profiles.map(row => {
          const isApprovedHost = row.role === "host" && row.approved
          return (
            <div key={row.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white font-bold text-sm truncate">{row.display_name || row.email}</div>
                  {row.phone && <div className="text-zinc-500 text-xs mt-0.5">{row.phone}</div>}
                  <div className="text-zinc-600 text-[10px] mt-1 font-mono truncate">{row.id}</div>
                </div>
                <span
                  className={cn(
                    "shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full border",
                    isApprovedHost
                      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-400 border-zinc-800"
                  )}
                >
                  {row.role}{row.approved ? " · approved" : ""}
                </span>
              </div>
              <div className="flex gap-2 mt-3">
                {!isApprovedHost ? (
                  <button
                    disabled={busyId === row.id}
                    onClick={() => setApproval(row, "host", true)}
                    className="flex-1 h-9 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    Approve as host
                  </button>
                ) : (
                  <button
                    disabled={busyId === row.id}
                    onClick={() => setApproval(row, row.role, false)}
                    className="flex-1 h-9 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs font-bold rounded-lg transition-colors"
                  >
                    Revoke approval
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function HomeScreen({ hostName, activeGame, pastGames, onNavigate, onLogout }) {
  const [view, setView] = useState("host") // host | player
  const recent = pastGames.slice(0, 6)

  const playerGames = pastGames.filter(g => g.players.some(p => p.name === hostName))
  const overallNet = playerGames.reduce((sum, g) => {
    const h = g.players.find(p => p.name === hostName)
    return sum + (h ? (h.cashoutAmount || 0) - totalBuyinsFor(h) : 0)
  }, 0)
  const wins = playerGames.filter(g => {
    const h = g.players.find(p => p.name === hostName)
    return h && (h.cashoutAmount || 0) - totalBuyinsFor(h) > 0
  }).length

  const list = view === "host" ? recent : playerGames.slice(0, 6)

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 pb-28">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-7 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.12),transparent_60%)]" />
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="text-zinc-500 text-xs font-medium mb-1">Welcome back</div>
            <div className="text-white text-2xl font-black tracking-tight">{hostName} <span className="text-zinc-600">♠</span></div>
          </div>
          <button onClick={onLogout} className="mt-1 p-2 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300 transition-colors">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="px-5 flex flex-col gap-3">
        {/* Active game */}
        {activeGame && (
          <button
            onClick={() => onNavigate("live-game")}
            className="w-full text-left rounded-2xl bg-gradient-to-br from-emerald-900/80 to-zinc-900 border border-emerald-800/50 p-4 relative overflow-hidden group"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_bottom_right,rgba(16,185,129,0.1),transparent_60%)]" />
            <div className="relative z-10">
              <div className="flex items-center gap-2 mb-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-blink" />
                <span className="text-[10px] font-bold tracking-[0.15em] uppercase text-emerald-400">Live Game</span>
              </div>
              <div className="text-white font-bold text-base">{activeGame.name}</div>
              <div className="text-emerald-400/70 text-xs mt-1 font-medium">
                {activeGame.players.length} players · {fmtB(activeGame.buyinAmount)}/bank · Tap to manage
              </div>
            </div>
          </button>
        )}

        {/* New game */}
        <button
          onClick={() => onNavigate("create-game")}
          className="w-full text-left rounded-2xl bg-zinc-900 border border-zinc-800 hover:border-indigo-500/50 p-4 flex items-center gap-4 transition-all group"
        >
          <div className="w-11 h-11 rounded-xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center group-hover:bg-indigo-600/30 transition-colors">
            <Plus className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <div className="text-white font-bold text-sm">New Game</div>
            <div className="text-zinc-500 text-xs mt-0.5">Set up players & buy-ins</div>
          </div>
          <ChevronRight className="w-4 h-4 text-zinc-700 ml-auto group-hover:text-zinc-500 transition-colors" />
        </button>
      </div>

      <div className="px-5 mt-1">
        <div className="flex bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          <button
            onClick={() => setView("host")}
            className={cn("flex-1 text-xs font-bold py-2 rounded-lg transition-colors", view === "host" ? "bg-indigo-600 text-white" : "text-zinc-500 hover:text-zinc-300")}
          >
            Host
          </button>
          <button
            onClick={() => setView("player")}
            className={cn("flex-1 text-xs font-bold py-2 rounded-lg transition-colors", view === "player" ? "bg-indigo-600 text-white" : "text-zinc-500 hover:text-zinc-300")}
          >
            Player
          </button>
        </div>
      </div>

      {view === "player" && playerGames.length > 0 && (
        <div className="px-5 mt-3">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex items-center justify-between">
            <div>
              <div className="text-[10px] font-bold tracking-[0.13em] uppercase text-zinc-500">Overall Result</div>
              <div className={cn("font-mono text-2xl font-extrabold mt-1", overallNet > 0 ? "text-emerald-400" : overallNet < 0 ? "text-red-400" : "text-zinc-300")}>
                {fmtNet(overallNet)}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] font-bold tracking-[0.13em] uppercase text-zinc-500">Games Played</div>
              <div className="text-zinc-200 font-mono text-lg font-bold mt-1">{playerGames.length} <span className="text-zinc-600 text-xs font-normal">· {wins}W</span></div>
            </div>
          </div>
        </div>
      )}

      {list.length > 0 && (
        <>
          <SL>{view === "host" ? "Games You Hosted" : "Games You Played"}</SL>
          <div className="px-5 flex flex-col gap-2">
            {list.map(g => {
              const h = g.players.find(p => p.name === hostName)
              const net = h ? h.cashoutAmount - totalBuyinsFor(h) : null
              return (
                <button
                  key={g.id}
                  onClick={() => onNavigate("game-detail", g)}
                  className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl px-4 py-3.5 flex items-center gap-3 transition-colors text-left"
                >
                  <div className={cn(
                    "w-1 h-9 rounded-full shrink-0",
                    net === null ? "bg-zinc-700" : net > 0 ? "bg-emerald-500" : net < 0 ? "bg-red-500" : "bg-zinc-600"
                  )} />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-zinc-100 text-sm truncate">{g.name}</div>
                    <div className="text-zinc-600 text-xs mt-0.5">{g.date} · {g.players.length} players</div>
                  </div>
                  {net !== null && (
                    <div className={cn("font-mono text-sm font-bold shrink-0", net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-600")}>
                      {fmtNet(net)}
                    </div>
                  )}
                  <ChevronRight className="w-4 h-4 text-zinc-700 shrink-0" />
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Create Game ──────────────────────────────────────────────────────────────
function CreateGameScreen({ pastGames, onCancel, onCreate }) {
  const [name, setName]         = useState("")
  const [date, setDate]         = useState(new Date().toLocaleDateString("en-IN", { day:"numeric", month:"short" }))
  const [time, setTime]         = useState(nowStr())
  const [location, setLocation] = useState("")
  const [buyinBanks, setBuyinBanks] = useState(1)
  const [players, setPlayers]   = useState([])
  const [nameInput, setNameInput] = useState("")

  const knownNames = [...new Set(pastGames.flatMap(g => g.players.map(p => p.name)))]
  const notAdded   = knownNames.filter(n => !players.find(p => p.name === n))
  const suggestions = nameInput.trim()
    ? notAdded.filter(n => n.toLowerCase().includes(nameInput.toLowerCase()))
    : []

  const addPlayer = (n) => {
    const t = n.trim()
    if (!t || players.find(p => p.name.toLowerCase() === t.toLowerCase())) return
    setPlayers(prev => [...prev, { name: t }])
    setNameInput("")
  }

  const removePlayer = (n) => setPlayers(prev => prev.filter(p => p.name !== n))

  const handleCreate = () => {
    if (!name.trim()) return
    onCreate({
      id: Date.now(),
      name: name.trim(), date, time, location,
      buyinAmount: buyinBanks * 1000,
      rake: 0,
      players: players.map(p => ({
        name: p.name,
        buyins: [{ ts: nowStr(), amount: buyinBanks * 1000 }],
        cashedOut: false, cashoutAmount: null,
      })),
    })
  }

  return (
    <div className="min-h-screen bg-zinc-950 pb-8">
      {/* Header */}
      <div className="px-5 pt-14 pb-6 border-b border-zinc-900">
        <button onClick={onCancel} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm mb-5 transition-colors">
          <X className="w-4 h-4" /> Cancel
        </button>
        <div className="text-white text-xl font-bold">New Game</div>
        <div className="text-zinc-500 text-sm mt-1">Configure the session</div>
      </div>

      <div className="px-5 pt-5 flex flex-col gap-5">
        {/* Game info */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 flex flex-col gap-4">
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">Game Details</div>
          <div className="flex flex-col gap-3">
            <DInput label="Game Name" placeholder="e.g. Friday Night Felts" value={name} onChange={e => setName(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <DInput label="Date" value={date} onChange={e => setDate(e.target.value)} />
              <DInput label="Time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            <DInput label="Location (optional)" placeholder="e.g. Raj's place" value={location} onChange={e => setLocation(e.target.value)} />
          </div>
        </div>

        {/* Buy-in */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500 mb-4">Buy-in per Player</div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-0 bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
              <button
                onClick={() => setBuyinBanks(b => Math.max(1, b - 1))}
                className="w-11 h-11 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
              >
                <Minus className="w-4 h-4" />
              </button>
              <div className="w-16 h-11 flex flex-col items-center justify-center border-x border-zinc-700">
                <span className="font-mono font-bold text-white text-lg leading-none">{buyinBanks}</span>
                <span className="text-[9px] text-zinc-600 mt-0.5 font-medium">BANKS</span>
              </div>
              <button
                onClick={() => setBuyinBanks(b => b + 1)}
                className="w-11 h-11 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 5, 10].map(b => (
                <button
                  key={b}
                  onClick={() => setBuyinBanks(b)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors",
                    buyinBanks === b
                      ? "bg-indigo-600 text-white border-indigo-600"
                      : "bg-transparent text-zinc-500 border-zinc-700 hover:border-zinc-500 hover:text-zinc-300"
                  )}
                >
                  {b}B
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Players */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-4">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">Players</div>
            {players.length > 0 && (
              <span className="font-mono text-xs text-indigo-400 font-bold">{players.length} added</span>
            )}
          </div>

          {/* Search input */}
          <div className="relative mb-3">
            <input
              className="w-full h-11 bg-zinc-800 border border-zinc-700 rounded-xl px-4 pr-20 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
              placeholder="Search or add new player…"
              value={nameInput}
              onChange={e => setNameInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addPlayer(nameInput)}
            />
            {nameInput.trim() && (
              <button
                onClick={() => addPlayer(nameInput)}
                className="absolute right-2 top-1/2 -translate-y-1/2 px-3 h-7 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg transition-colors"
              >
                Add
              </button>
            )}
          </div>

          {/* Autocomplete */}
          {suggestions.length > 0 && (
            <div className="border border-zinc-700 rounded-xl overflow-hidden mb-3 divide-y divide-zinc-800">
              {suggestions.slice(0, 5).map(n => (
                <button key={n} onClick={() => addPlayer(n)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-zinc-800 transition-colors text-left"
                >
                  <Av name={n} size={28} />
                  <span className="text-sm font-medium text-zinc-200 flex-1">{n}</span>
                  <Plus className="w-4 h-4 text-zinc-600" />
                </button>
              ))}
            </div>
          )}

          {/* Quick add chips */}
          {!nameInput && notAdded.length > 0 && (
            <div className="mb-3">
              <div className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider mb-2">Quick add</div>
              <div className="flex flex-wrap gap-1.5">
                {notAdded.map(n => (
                  <button key={n} onClick={() => addPlayer(n)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-600 text-zinc-300 hover:text-white rounded-lg text-xs font-medium transition-all"
                  >
                    <Av name={n} size={16} />
                    {n.split(" ")[0]}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Added list */}
          {players.length > 0 && (
            <div className="flex flex-col gap-1.5">
              {players.map((p, i) => (
                <div key={p.name} className="flex items-center gap-3 bg-zinc-800/60 rounded-xl px-3 py-2.5 border border-zinc-700/50">
                  <span className="font-mono text-xs text-zinc-600 w-4">{i + 1}</span>
                  <Av name={p.name} size={28} />
                  <span className="flex-1 text-zinc-200 text-sm font-medium">{p.name}</span>
                  <span className="font-mono text-xs text-amber-500">{buyinBanks}B</span>
                  <button onClick={() => removePlayer(p.name)}
                    className="w-6 h-6 rounded-lg flex items-center justify-center text-zinc-700 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {players.length === 0 && !nameInput && (
            <div className="text-center py-5 text-zinc-700 text-xs font-medium">
              Add players above or pick from history
            </div>
          )}
        </div>

        <button
          disabled={!name.trim()}
          onClick={handleCreate}
          className="w-full h-13 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 py-3.5"
        >
          <Gamepad2 className="w-4 h-4" />
          Start Game{players.length > 0 ? ` · ${players.length} players` : ""}
        </button>
      </div>
    </div>
  )
}

// ─── Dark input helper ────────────────────────────────────────────────────────
function DInput({ label, ...props }) {
  return (
    <div>
      {label && <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500 mb-1.5">{label}</div>}
      <input
        className="w-full h-11 bg-zinc-800 border border-zinc-700 rounded-xl px-4 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all"
        {...props}
      />
    </div>
  )
}

// ─── End Game Modal ───────────────────────────────────────────────────────────
function EndGameModal({ game, onConfirm, onClose }) {
  const [rake, setRake] = useState(String((game.rake || 0) / 1000))
  const players  = game.players
  const totalIn  = players.reduce((s, p) => s + totalBuyinsFor(p), 0)
  const totalOut = players.reduce((s, p) => s + (p.cashoutAmount || 0), 0)
  const uncashed = players.filter(p => !p.cashedOut)
  const rakeAmt  = (parseFloat(rake) || 0) * 1000
  const diff     = totalOut - (totalIn - rakeAmt)
  const balanced = Math.abs(diff) < 1

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[340px] bg-zinc-900 border-zinc-800 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-white">End Game & Settle</DialogTitle>
          <DialogDescription className="text-zinc-500">Review accounts before settlement.</DialogDescription>
        </DialogHeader>

        {uncashed.length > 0 && (
          <div className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3">
            <AlertCircle className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
            <div className="text-xs text-amber-300">
              {uncashed.map(p => p.name).join(", ")} {uncashed.length > 1 ? "haven't" : "hasn't"} cashed out.
            </div>
          </div>
        )}

        <div>
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500 mb-1.5">Rake (Banks)</div>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" step="1" placeholder="0" value={rake}
              onChange={e => setRake(e.target.value)}
              className="flex-1 h-11 bg-zinc-800 border border-zinc-700 rounded-xl px-4 text-zinc-100 text-sm font-mono outline-none focus:border-indigo-500 transition-all"
            />
            <span className="text-zinc-500 text-sm font-bold w-6">B</span>
          </div>
        </div>

        <div className={cn("rounded-xl p-3.5 space-y-2.5 border", balanced ? "bg-emerald-500/10 border-emerald-500/20" : "bg-red-500/10 border-red-500/20")}>
          <div className={cn("text-xs font-bold uppercase tracking-wider flex items-center gap-1.5", balanced ? "text-emerald-400" : "text-red-400")}>
            {balanced ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
            {balanced ? "Balanced" : "Discrepancy"}
          </div>
          {[
            ["Bought In", fmtB(totalIn)],
            rakeAmt > 0 ? ["Rake", fmtB(rakeAmt)] : null,
            ["Cashed Out", fmtB(totalOut)],
            !balanced ? ["Off by", fmtB(Math.abs(diff))] : null,
          ].filter(Boolean).map(([l, v]) => (
            <div key={l} className="flex justify-between">
              <span className="text-zinc-500 text-sm">{l}</span>
              <span className="font-mono text-sm font-semibold text-zinc-200">{v}</span>
            </div>
          ))}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-11 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-300 font-semibold rounded-xl text-sm transition-colors">Cancel</button>
          <button
            disabled={!balanced}
            onClick={() => onConfirm(rakeAmt)}
            className="flex-1 h-11 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
          >
            Settle Up
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Live Game ────────────────────────────────────────────────────────────────
function LiveGameScreen({ game, onUpdateGame, undoStack, onUndo, onNavigate, showToast }) {
  const [cashoutFor, setCashoutFor]   = useState(null)   // player name
  const [cashoutBanks, setCashoutBanks] = useState(0)    // number of banks (0.5 increments)
  const [expanded, setExpanded]       = useState({})
  const [showEnd, setShowEnd]         = useState(false)
  const [newName, setNewName]         = useState("")
  const [editingRake, setEditingRake] = useState(false)
  const [rakeVal, setRakeVal]         = useState("")

  const players  = game.players
  const totalIn  = players.reduce((s, p) => s + totalBuyinsFor(p), 0)
  const cashedOut = players.filter(p => p.cashedOut)
  const totalOut = cashedOut.reduce((s, p) => s + (p.cashoutAmount || 0), 0)
  const active   = players.filter(p => !p.cashedOut).length

  const updatePlayers = (updated) => onUpdateGame({ ...game, players: updated })

  const openCashout = (name, currentBanks = 0) => {
    setCashoutFor(name)
    setCashoutBanks(currentBanks)
  }

  const addPlayer = () => {
    const n = newName.trim()
    if (!n) return
    if (players.find(p => p.name.toLowerCase() === n.toLowerCase())) {
      showToast("⚠️", "Already added", `${n} is in the game`); return
    }
    updatePlayers([...players, { name: n, buyins: [{ ts: nowStr(), amount: game.buyinAmount }], cashedOut: false, cashoutAmount: null }])
    setNewName("")
    showToast("🃏", "Player Added", `${n} — ${fmtB(game.buyinAmount)}`)
  }

  const addBuyin = (idx) => {
    const p = players[idx]
    if (p.cashedOut) return
    const ts = nowStr()
    const updated = [...players]
    updated[idx] = { ...p, buyins: [...p.buyins, { ts, amount: game.buyinAmount, isNew: true }] }
    updatePlayers(updated)
    showToast("🏦", "Rebuy", `${p.name} +${fmtB(game.buyinAmount)} · ${ts}`)
    setTimeout(() => {
      onUpdateGame(prev => prev.map((pp, i) =>
        i === idx ? { ...pp, buyins: pp.buyins.map(b => ({ ...b, isNew: false })) } : pp
      ))
    }, 4000)
  }

  const remBuyin = (idx) => {
    const p = players[idx]
    if (p.buyins.length <= 1) return
    const updated = [...players]
    updated[idx] = { ...p, buyins: p.buyins.slice(0, -1) }
    updatePlayers(updated)
    showToast("↩️", "Removed", `${p.name} — ${p.buyins.length - 1} buyin(s)`)
  }

  const confirmCashout = (idx) => {
    const val = Math.round(cashoutBanks * 1000)
    if (val < 0) return
    const updated = [...players]
    const p = updated[idx]
    const net = val - totalBuyinsFor(p)
    updated[idx] = { ...p, cashedOut: true, cashoutAmount: val }
    updatePlayers(updated)
    setCashoutFor(null); setCashoutBanks(0)
    showToast(net >= 0 ? "🟢" : "🔴", `${p.name} cashed out`, `${fmtB(val)} · Net ${fmtNet(net)}`)
  }

  const saveRake = () => {
    onUpdateGame({ ...game, rake: (parseFloat(rakeVal) || 0) * 1000 })
    setEditingRake(false)
  }

  const handleEndGame = (rake) => {
    onUpdateGame({ ...game, rake })
    setShowEnd(false)
    onNavigate("settlement")
  }

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 pb-28">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-5 overflow-hidden border-b border-zinc-900">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.08),transparent_60%)]" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-blink" />
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400">Live</span>
            </div>
            {undoStack.length > 0 && (
              <button onClick={onUndo} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg transition-colors">
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </button>
            )}
          </div>
          <div className="text-white text-xl font-bold">{game.name}</div>
          <div className="text-zinc-500 text-xs mt-1">{game.date}{game.time ? ` · ${game.time}` : ""} · {fmtB(game.buyinAmount)}/bank</div>
        </div>
      </div>

      {/* Bank tracker */}
      <div className="px-5 pt-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
          <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-600 mb-1">In Play</div>
          <div className="font-mono text-3xl font-black text-white mb-4 tracking-tight">{fmtB(totalIn - totalOut)}</div>
          <div className="grid grid-cols-3 gap-4 pb-4 border-b border-zinc-800">
            {[
              { label: "Total In", value: fmtB(totalIn), color: "text-emerald-400" },
              { label: "Cashed Out", value: fmtB(totalOut), color: "text-amber-400" },
              { label: "Active", value: `${active}/${players.length}`, color: "text-zinc-300" },
            ].map(({ label, value, color }) => (
              <div key={label}>
                <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-700 mb-1">{label}</div>
                <div className={cn("font-mono text-sm font-bold", color)}>{value}</div>
              </div>
            ))}
          </div>
          {/* Rake */}
          <div className="flex items-center gap-3 pt-3.5">
            <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-700">Rake</div>
            {editingRake ? (
              <div className="flex items-center gap-2 flex-1">
                <input
                  type="number" min="0" step="0.5" autoFocus value={rakeVal}
                  onChange={e => setRakeVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") saveRake(); if (e.key === "Escape") setEditingRake(false) }}
                  className="w-20 h-7 bg-zinc-800 border border-zinc-700 rounded-lg px-2.5 text-white text-xs font-mono outline-none focus:border-indigo-500 transition-all"
                  placeholder="0"
                />
                <span className="text-zinc-600 text-xs">B</span>
                <button onClick={saveRake} className="text-xs text-emerald-400 font-bold hover:text-emerald-300">✓</button>
                <button onClick={() => setEditingRake(false)} className="text-xs text-zinc-600 hover:text-zinc-400">✕</button>
              </div>
            ) : (
              <div className="flex items-center gap-2 flex-1">
                <span className="font-mono text-sm font-bold text-amber-400">{fmtB(game.rake || 0)}</span>
                <button
                  onClick={() => { setRakeVal(String((game.rake || 0) / 1000)); setEditingRake(true) }}
                  className="text-[10px] text-zinc-700 hover:text-zinc-400 border border-zinc-800 px-2 py-0.5 rounded-md transition-colors ml-1"
                >
                  {game.rake ? "edit" : "+ add"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Add player */}
      <div className="px-5 mt-4 flex gap-2">
        <input
          className="flex-1 h-11 bg-zinc-900 border border-zinc-800 rounded-xl px-4 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-zinc-600 transition-all"
          placeholder="Add player by name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === "Enter" && addPlayer()}
        />
        <button onClick={addPlayer} className="w-11 h-11 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Players */}
      <SL>Players — {players.length}</SL>

      {players.length === 0 && (
        <div className="text-center py-8 text-zinc-700 text-sm">Add players above to start tracking</div>
      )}

      <div className="px-5 flex flex-col gap-2.5">
        {players.map((p, i) => {
          const tIn = totalBuyinsFor(p)
          const net = p.cashedOut ? (p.cashoutAmount - tIn) : null
          const isShowingCO = cashoutFor === p.name
          const isExp = expanded[i]
          const tInBanks = tIn / 1000

          return (
            <div
              key={p.name}
              className={cn(
                "bg-zinc-900 border rounded-2xl overflow-hidden transition-all",
                p.cashedOut
                  ? net > 0 ? "border-l-[3px] border-l-emerald-500 border-zinc-800/50"
                  : net < 0 ? "border-l-[3px] border-l-red-500 border-zinc-800/50"
                  : "border-zinc-800/50"
                  : isShowingCO ? "border-indigo-500/40 shadow-lg shadow-indigo-500/5"
                  : "border-zinc-800"
              )}
            >
              {/* Main row */}
              <div className="flex items-center gap-3 px-4 py-3.5">
                <Av name={p.name} size={38} />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn("font-semibold text-sm", p.cashedOut ? "text-zinc-500" : "text-zinc-100")}>{p.name}</span>
                    {p.cashedOut && (
                      <span className={cn(
                        "text-[10px] font-bold px-1.5 py-0.5 rounded-md",
                        net > 0 ? "bg-emerald-500/15 text-emerald-400" : net < 0 ? "bg-red-500/15 text-red-400" : "bg-zinc-800 text-zinc-500"
                      )}>
                        {net > 0 ? "WIN" : net < 0 ? "LOSS" : "EVEN"}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-zinc-600 mt-0.5 font-mono flex items-center gap-2">
                    <span>{p.buyins.length}× · {fmtB(tIn)}</span>
                    {p.cashedOut && <span className="text-zinc-700">→ {fmtB(p.cashoutAmount || 0)}</span>}
                    {!p.cashedOut && (
                      <button
                        onClick={() => setExpanded(e => ({ ...e, [i]: !e[i] }))}
                        className="flex items-center gap-0.5 text-zinc-700 hover:text-zinc-400 transition-colors"
                      >
                        {isExp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                  </div>
                </div>

                {/* Right actions */}
                <div className="flex items-center gap-2 shrink-0">
                  {p.cashedOut ? (
                    isShowingCO ? (
                      <button onClick={() => { setCashoutFor(null); setCashoutBanks(0) }}
                        className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    ) : (
                      <>
                        <div className={cn("font-mono text-base font-black", net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-600")}>
                          {fmtNet(net)}
                        </div>
                        <button
                          onClick={() => openCashout(p.name, (p.cashoutAmount || 0) / 1000)}
                          className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )
                  ) : isShowingCO ? (
                    <button onClick={() => { setCashoutFor(null); setCashoutBanks(0) }}
                      className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <>
                      {/* Rebuy counter */}
                      <div className="flex items-center bg-zinc-800 border border-zinc-700 rounded-xl overflow-hidden">
                        <button onClick={() => remBuyin(i)}
                          className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-400/10 transition-colors">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <div className="w-9 h-8 flex items-center justify-center font-mono text-xs font-black text-amber-400 bg-amber-400/5 border-x border-zinc-700">
                          {p.buyins.length}
                        </div>
                        <button onClick={() => addBuyin(i)}
                          className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-emerald-400 hover:bg-emerald-400/10 transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {/* Cash out button */}
                      <button
                        onClick={() => openCashout(p.name, 0)}
                        className="h-8 px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition-colors whitespace-nowrap"
                      >
                        <Wallet className="w-3 h-3" /> Cash Out
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Buyin history */}
              {!p.cashedOut && isExp && (
                <div className="px-4 pb-3.5 pt-0.5 border-t border-zinc-800/60 bg-zinc-950/50">
                  <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-zinc-700 mb-2.5">Buy-in History</div>
                  <div className="space-y-2">
                    {p.buyins.map((b, bi) => (
                      <div key={bi} className={cn("flex items-center gap-2.5 text-xs", b.isNew && "animate-pop")}>
                        <div className={cn("w-1.5 h-1.5 rounded-full shrink-0", bi === 0 ? "bg-zinc-600" : b.isNew ? "bg-emerald-400" : "bg-amber-500")} />
                        <span className="font-mono text-zinc-600 w-16 shrink-0">{b.ts}</span>
                        <span className={cn("font-medium", b.isNew ? "text-emerald-400" : "text-zinc-400")}>
                          {bi === 0 ? "Initial" : `Rebuy #${bi}`} · {fmtB(b.amount)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Cashout Panel ── */}
              {isShowingCO && (
                <div className="border-t border-zinc-800 bg-zinc-950">
                  <div className="px-4 pt-4 pb-1">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                        {p.cashedOut ? "Edit Cashout" : "Cash Out"}
                      </span>
                      <span className="text-xs text-zinc-600 font-mono">In: {fmtB(tIn)}</span>
                    </div>

                    {/* Quick presets */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                      <button
                        onClick={() => setCashoutBanks(tInBanks)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 py-2.5 rounded-xl border text-xs font-bold transition-all",
                          cashoutBanks === tInBanks
                            ? "bg-zinc-700 border-zinc-600 text-white"
                            : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                        )}
                      >
                        <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">1:1 · Even</span>
                        <span className="font-mono text-sm">{fmtB(tIn)}</span>
                      </button>
                      <button
                        onClick={() => setCashoutBanks(tInBanks * 2)}
                        className={cn(
                          "flex flex-col items-center gap-0.5 py-2.5 rounded-xl border text-xs font-bold transition-all",
                          cashoutBanks === tInBanks * 2
                            ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300"
                            : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                        )}
                      >
                        <span className="text-[9px] font-semibold text-zinc-600 uppercase tracking-wider">1:2 · Double</span>
                        <span className="font-mono text-sm">{fmtB(tIn * 2)}</span>
                      </button>
                    </div>

                    {/* Stepper */}
                    <div className="flex items-center gap-3 mb-2">
                      <button
                        onClick={() => setCashoutBanks(b => Math.max(0, parseFloat((b - 0.5).toFixed(1))))}
                        className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 flex items-center justify-center transition-colors"
                      >
                        <Minus className="w-4 h-4 text-zinc-300" />
                      </button>
                      <div className="flex-1 text-center">
                        <div className="font-mono text-3xl font-black text-white leading-none">{cashoutBanks}B</div>
                        <div className={cn("text-xs font-medium mt-1.5", cashoutBanks * 1000 - tIn > 0 ? "text-emerald-400" : cashoutBanks * 1000 - tIn < 0 ? "text-red-400" : "text-zinc-600")}>
                          Net {cashoutBanks * 1000 === tIn ? "Even" : cashoutBanks * 1000 > tIn ? `+${fmtB(cashoutBanks * 1000 - tIn)}` : `−${fmtB(tIn - cashoutBanks * 1000)}`}
                        </div>
                      </div>
                      <button
                        onClick={() => setCashoutBanks(b => parseFloat((b + 0.5).toFixed(1)))}
                        className="w-12 h-12 rounded-xl bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 flex items-center justify-center transition-colors"
                      >
                        <Plus className="w-4 h-4 text-zinc-300" />
                      </button>
                    </div>
                  </div>

                  <div className="px-4 pb-4">
                    <button
                      onClick={() => confirmCashout(i)}
                      className="w-full h-11 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
                    >
                      <Check className="w-4 h-4" /> Confirm Cash Out · {cashoutBanks}B
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {players.length > 0 && (
        <div className="px-5 mt-5">
          <button
            onClick={() => setShowEnd(true)}
            className="w-full h-12 bg-red-600/80 hover:bg-red-600 border border-red-500/30 text-white font-bold rounded-xl text-sm transition-colors"
          >
            End Game & Settle
          </button>
        </div>
      )}

      {showEnd && <EndGameModal game={game} onConfirm={handleEndGame} onClose={() => setShowEnd(false)} />}
    </div>
  )
}

// ─── Settlement ───────────────────────────────────────────────────────────────
function SettlementScreen({ game, onClose, onBack, showToast }) {
  const [settled, setSettled]       = useState({})
  const [customTxns, setCustomTxns] = useState([])
  const [showAddTxn, setShowAddTxn] = useState(false)
  const [editingTxn, setEditingTxn] = useState(null)
  const [ctFrom, setCtFrom]         = useState("")
  const [ctTo, setCtTo]             = useState("")
  const [ctAmt, setCtAmt]           = useState("")

  const players = game.players
  const rake    = game.rake || 0
  const totalIn  = players.reduce((s, p) => s + totalBuyinsFor(p), 0)
  const totalOut = players.reduce((s, p) => s + (p.cashoutAmount || 0), 0)
  const delta    = totalOut - (totalIn - rake)
  const balanced = Math.abs(delta) < 1

  const positions = players.map(p => ({
    name: p.name,
    net: Math.round((p.cashoutAmount || 0) - totalBuyinsFor(p)),
  }))

  const baseTxns = (() => {
    const debtors   = positions.filter(p => p.net < 0).map(p => ({ ...p, rem: -p.net })).sort((a, b) => b.rem - a.rem)
    const creditors = positions.filter(p => p.net > 0).map(p => ({ ...p, rem: p.net })).sort((a, b) => b.rem - a.rem)
    const out = []
    let di = 0, ci = 0
    while (di < debtors.length && ci < creditors.length) {
      const d = debtors[di], c = creditors[ci]
      const amt = Math.min(d.rem, c.rem)
      if (amt > 0) out.push({ from: d.name, to: c.name, amount: Math.round(amt) })
      d.rem -= amt; c.rem -= amt
      if (d.rem < 1) di++; if (c.rem < 1) ci++
    }
    return out
  })()

  const [overrides, setOverrides] = useState(() =>
    Object.fromEntries(baseTxns.map((t, i) => [`auto-${i}`, { from: t.from, to: t.to, amount: t.amount }]))
  )

  const allTxns = [
    ...baseTxns.map((t, i) => {
      const key = `auto-${i}`
      const ov = overrides[key]
      return { key, from: ov?.from ?? t.from, to: ov?.to ?? t.to, amount: ov?.amount ?? t.amount, isAuto: true }
    }),
    ...customTxns,
  ]

  const settledCount = Object.values(settled).filter(Boolean).length

  const saveEdit = () => {
    const amt = (parseFloat(editingTxn.amount) || 0) * 1000
    if (editingTxn.key.startsWith("auto-")) {
      setOverrides(prev => ({ ...prev, [editingTxn.key]: { from: editingTxn.from.trim(), to: editingTxn.to.trim(), amount: amt } }))
    } else {
      setCustomTxns(prev => prev.map(t => t.key === editingTxn.key ? { ...t, from: editingTxn.from.trim(), to: editingTxn.to.trim(), amount: amt } : t))
    }
    setEditingTxn(null)
  }

  const addCustom = () => {
    const amt = (parseFloat(ctAmt) || 0) * 1000
    if (!ctFrom.trim() || !ctTo.trim() || amt <= 0) { showToast("⚠️", "Invalid", "Fill all fields"); return }
    const key = `custom-${customTxns.length}`
    setCustomTxns(prev => [...prev, { from: ctFrom.trim(), to: ctTo.trim(), amount: amt, key, isAuto: false }])
    setCtFrom(""); setCtTo(""); setCtAmt(""); setShowAddTxn(false)
  }

  const shareWA = () => {
    const lines = [
      `🃏 *${game.name}* — ${game.date}`,
      ``,
      `*Settle Up (${allTxns.length} payments):*`,
      ...allTxns.map(t => `• ${t.from} → ${t.to}: *${fmtB(t.amount)} Banks*`),
      ...(allTxns.length === 0 ? ["• Everyone's even!"] : []),
      ``,
      `Pot: ${fmtB(totalIn)}${rake > 0 ? ` · Rake: ${fmtB(rake)}` : ""} · Out: ${fmtB(totalOut)}`,
    ]
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank")
  }

  const reminderWA = (t) => {
    const msg = `Hey ${t.from}! Please send *${fmtB(t.amount)} Banks* to ${t.to} to settle ${game.name} 🃏`
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, "_blank")
  }

  const medals = ["🥇", "🥈", "🥉"]

  return (
    <div className="min-h-screen bg-zinc-950 pb-8">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-6 border-b border-zinc-900 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(251,191,36,0.06),transparent_60%)]" />
        <div className="relative z-10">
          <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 text-sm mb-5 transition-colors">
            <X className="w-4 h-4" /> Back to game
          </button>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-white text-xl font-bold">Settlement</div>
              <div className="text-zinc-500 text-sm mt-1">{game.name} · {game.date}</div>
            </div>
            <Trophy className="w-6 h-6 text-amber-500" />
          </div>
          <div className="flex gap-2 mt-4 flex-wrap">
            {[`${fmtB(totalIn)} pot`, rake > 0 ? `${fmtB(rake)} rake` : null, `${players.length} players`, `${allTxns.length} payments`].filter(Boolean).map(s => (
              <span key={s} className="text-[10px] font-bold text-zinc-500 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1">{s}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Balance */}
      <div className={cn("flex items-center gap-3 px-5 py-3 border-b", balanced ? "bg-emerald-500/5 border-emerald-500/10" : "bg-red-500/5 border-red-500/10")}>
        {balanced ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
        <span className={cn("text-sm font-semibold", balanced ? "text-emerald-400" : "text-red-400")}>
          {balanced ? "All accounts balanced" : `Discrepancy: ${fmtB(Math.abs(delta))} — go back to fix cashouts`}
        </span>
      </div>

      {/* Leaderboard */}
      <SL>Results</SL>
      <div className="px-5 flex flex-col gap-2 mb-2">
        {positions.slice().sort((a, b) => b.net - a.net).map((pos, rank) => {
          const p = players.find(x => x.name === pos.name)
          return (
            <div key={pos.name} className={cn(
              "bg-zinc-900 border rounded-xl px-4 py-3 flex items-center gap-3 border-l-2",
              pos.net > 0 ? "border-l-emerald-500 border-zinc-800" : pos.net < 0 ? "border-l-red-500 border-zinc-800" : "border-zinc-800"
            )}>
              <div className="text-xl w-7 text-center shrink-0">{rank < 3 ? medals[rank] : `#${rank + 1}`}</div>
              <Av name={pos.name} size={32} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-zinc-100 text-sm">{pos.name}</div>
                <div className="text-xs text-zinc-600 font-mono mt-0.5">In {fmtB(totalBuyinsFor(p))} · Out {fmtB(p.cashoutAmount || 0)}</div>
              </div>
              <div className={cn("font-mono text-sm font-black", pos.net > 0 ? "text-emerald-400" : pos.net < 0 ? "text-red-400" : "text-zinc-600")}>
                {pos.net > 0 ? "+" : ""}{fmtNet(pos.net)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Payments */}
      <SL>Payments — {allTxns.length}</SL>

      {allTxns.length === 0 ? (
        <div className="text-center py-8 text-zinc-600 text-sm">🎉 Everyone is even</div>
      ) : (
        <div className="px-5 flex flex-col gap-3 mb-3">
          {allTxns.map(t => {
            const done = settled[t.key]
            if (editingTxn?.key === t.key) {
              return (
                <div key={t.key} className="bg-zinc-900 border-2 border-indigo-500/40 rounded-2xl p-4 space-y-3">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Edit Payment</div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">From</div>
                      <input value={editingTxn.from} onChange={e => setEditingTxn(p => ({ ...p, from: e.target.value }))}
                        className="w-full h-9 bg-zinc-800 border border-zinc-700 rounded-lg px-3 text-zinc-100 text-sm outline-none focus:border-indigo-500" />
                    </div>
                    <div>
                      <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">To</div>
                      <input value={editingTxn.to} onChange={e => setEditingTxn(p => ({ ...p, to: e.target.value }))}
                        className="w-full h-9 bg-zinc-800 border border-zinc-700 rounded-lg px-3 text-zinc-100 text-sm outline-none focus:border-indigo-500" />
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">Amount (Banks)</div>
                    <input type="number" min="0" step="0.5" value={editingTxn.amount}
                      onChange={e => setEditingTxn(p => ({ ...p, amount: e.target.value }))}
                      className="w-full h-9 bg-zinc-800 border border-zinc-700 rounded-lg px-3 text-zinc-100 text-sm font-mono outline-none focus:border-indigo-500" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditingTxn(null)} className="flex-1 h-9 bg-zinc-800 border border-zinc-700 text-zinc-400 font-semibold rounded-lg text-sm hover:bg-zinc-700 transition-colors">Cancel</button>
                    <button onClick={saveEdit} className="flex-1 h-9 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-sm transition-colors">Save</button>
                  </div>
                </div>
              )
            }

            return (
              <div key={t.key} className={cn("bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden transition-all", done && "opacity-40")}>
                <div className="px-4 pt-4 pb-3">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-1.5">
                      {!t.isAuto && <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-md">custom</span>}
                      {done && <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md"><Check className="w-2.5 h-2.5" />paid</span>}
                    </div>
                    <button onClick={() => setEditingTxn({ key: t.key, from: t.from, to: t.to, amount: String(t.amount / 1000) })}
                      className="w-7 h-7 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-600 hover:text-zinc-300 transition-colors">
                      <Edit3 className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="flex items-center">
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <Av name={t.from} size={42} />
                      <div className="text-xs font-bold text-red-400 text-center max-w-[72px] truncate">{t.from}</div>
                      <div className="text-[9px] text-zinc-700 uppercase tracking-wider font-bold">pays</div>
                    </div>
                    <div className="flex flex-col items-center gap-1 flex-1">
                      <div className="font-mono text-2xl font-black text-amber-400 leading-none">{fmtB(t.amount)}</div>
                      <div className="text-zinc-700 text-base">→</div>
                    </div>
                    <div className="flex flex-col items-center gap-2 flex-1">
                      <Av name={t.to} size={42} />
                      <div className="text-xs font-bold text-emerald-400 text-center max-w-[72px] truncate">{t.to}</div>
                      <div className="text-[9px] text-zinc-700 uppercase tracking-wider font-bold">receives</div>
                    </div>
                  </div>
                </div>

                <div className="flex items-center px-4 py-2.5 border-t border-zinc-800">
                  <button onClick={() => reminderWA(t)}
                    className="flex items-center gap-1.5 text-[11px] text-zinc-600 hover:text-[#25d366] transition-colors font-medium">
                    <Share2 className="w-3.5 h-3.5" /> Remind
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => setSettled(prev => ({ ...prev, [t.key]: !prev[t.key] }))}
                    className={cn(
                      "flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all",
                      done ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20" : "bg-zinc-800 text-zinc-500 border border-zinc-700 hover:border-zinc-600 hover:text-zinc-300"
                    )}
                  >
                    <Check className="w-3.5 h-3.5" /> {done ? "Paid" : "Mark paid"}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Progress */}
      {allTxns.length > 0 && (
        <div className="px-5 mb-4">
          <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
            <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-wider">Settled</span>
            <Progress value={allTxns.length ? (settledCount / allTxns.length) * 100 : 0} className="flex-1 bg-zinc-800" indicatorClassName="bg-emerald-500" />
            <span className="font-mono text-sm font-bold text-emerald-400">{settledCount}/{allTxns.length}</span>
          </div>
        </div>
      )}

      {/* Add custom */}
      {showAddTxn ? (
        <div className="mx-5 mb-4 bg-zinc-900 border border-indigo-500/30 rounded-2xl p-4 space-y-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-400">Add Custom Payment</div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">From</div>
              <input placeholder="Who pays" value={ctFrom} onChange={e => setCtFrom(e.target.value)}
                className="w-full h-9 bg-zinc-800 border border-zinc-700 rounded-lg px-3 text-zinc-100 text-sm outline-none focus:border-indigo-500" />
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">To</div>
              <input placeholder="Who receives" value={ctTo} onChange={e => setCtTo(e.target.value)}
                className="w-full h-9 bg-zinc-800 border border-zinc-700 rounded-lg px-3 text-zinc-100 text-sm outline-none focus:border-indigo-500" />
            </div>
          </div>
          <div>
            <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-600 mb-1.5">Amount (Banks)</div>
            <input type="number" placeholder="0" value={ctAmt} onChange={e => setCtAmt(e.target.value)}
              className="w-full h-9 bg-zinc-800 border border-zinc-700 rounded-lg px-3 text-zinc-100 text-sm font-mono outline-none focus:border-indigo-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowAddTxn(false)} className="flex-1 h-9 bg-zinc-800 border border-zinc-700 text-zinc-400 font-semibold rounded-lg text-sm hover:bg-zinc-700 transition-colors">Cancel</button>
            <button onClick={addCustom} className="flex-1 h-9 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg text-sm transition-colors">Add</button>
          </div>
        </div>
      ) : (
        <div className="px-5 mb-4">
          <button onClick={() => setShowAddTxn(true)}
            className="w-full border border-dashed border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/50 rounded-xl py-3 text-sm text-zinc-700 hover:text-zinc-500 font-medium transition-all flex items-center justify-center gap-2">
            <Plus className="w-4 h-4" /> Add Custom Payment
          </button>
        </div>
      )}

      {/* Actions */}
      <div className="px-5 flex flex-col gap-3">
        <button onClick={shareWA}
          className="w-full h-12 bg-[#25d366] hover:bg-[#20bc58] text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
          <Share2 className="w-4 h-4" /> Share via WhatsApp
        </button>
        <button onClick={onClose}
          className="w-full h-12 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 font-bold rounded-xl text-sm transition-colors">
          Save to History & Close
        </button>
      </div>
    </div>
  )
}

// ─── History ──────────────────────────────────────────────────────────────────
function HistoryScreen({ hostName, pastGames, onSelectGame }) {
  const nets = pastGames.map(g => {
    const h = g.players.find(p => p.name === hostName)
    return h ? h.cashoutAmount - totalBuyinsFor(h) : 0
  })
  const total    = pastGames.length
  const totalNet = nets.reduce((s, n) => s + n, 0)
  const wins     = nets.filter(n => n > 0).length

  return (
    <div className="flex flex-col min-h-screen bg-zinc-950 pb-28">
      <div className="relative px-5 pt-14 pb-6 border-b border-zinc-900 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.08),transparent_60%)]" />
        <div className="relative z-10">
          <div className="text-white text-2xl font-bold">Dashboard</div>
          <div className="text-zinc-600 text-sm mt-1">Your history as host</div>
        </div>
      </div>

      <div className="px-5 pt-5 grid grid-cols-2 gap-3 mb-2">
        {[
          { label: "Games", value: String(total), sub: "played" },
          { label: "Record", value: `${wins}W/${total - wins}L`, sub: "win/loss" },
          { label: "Win Rate", value: `${total ? Math.round((wins / total) * 100) : 0}%`, sub: "of games" },
          { label: "Net", value: fmtNet(totalNet), sub: totalNet >= 0 ? "profit" : "loss", green: totalNet > 0, red: totalNet < 0 },
        ].map(s => (
          <div key={s.label} className={cn(
            "bg-zinc-900 border rounded-2xl px-4 py-3.5",
            s.green ? "border-emerald-800/40" : s.red ? "border-red-900/40" : "border-zinc-800"
          )}>
            <div className="text-[9px] font-bold uppercase tracking-[0.2em] text-zinc-600 mb-1">{s.label}</div>
            <div className={cn("font-mono text-xl font-black", s.green ? "text-emerald-400" : s.red ? "text-red-400" : "text-zinc-100")}>
              {s.value}
            </div>
            <div className="text-[10px] text-zinc-700 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      <SL>Game History</SL>

      {pastGames.length === 0 ? (
        <div className="text-center py-12 text-zinc-700 text-sm">No past games yet</div>
      ) : (
        <div className="px-5 flex flex-col gap-2">
          {pastGames.map(g => {
            const h = g.players.find(p => p.name === hostName)
            const net = h ? h.cashoutAmount - totalBuyinsFor(h) : null
            return (
              <button key={g.id} onClick={() => onSelectGame(g)}
                className="w-full bg-zinc-900 border border-zinc-800 hover:border-zinc-700 rounded-xl px-4 py-3.5 flex items-center gap-3 transition-colors text-left">
                <div className={cn("w-1 h-9 rounded-full shrink-0", net === null ? "bg-zinc-700" : net > 0 ? "bg-emerald-500" : net < 0 ? "bg-red-500" : "bg-zinc-600")} />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-zinc-100 text-sm truncate">{g.name}</div>
                  <div className="text-zinc-600 text-xs mt-0.5">{g.date} · {g.players.length} players</div>
                </div>
                {net !== null && <div className={cn("font-mono text-sm font-bold shrink-0", net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-600")}>{fmtNet(net)}</div>}
                <ChevronRight className="w-4 h-4 text-zinc-700 shrink-0" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Game Detail ──────────────────────────────────────────────────────────────
function GameDetailScreen({ game, onBack }) {
  const totalIn  = game.players.reduce((s, p) => s + totalBuyinsFor(p), 0)
  const totalOut = game.players.reduce((s, p) => s + (p.cashoutAmount || 0), 0)
  const rake     = game.rake || 0
  const positions = game.players.map(p => ({ name: p.name, net: Math.round((p.cashoutAmount || 0) - totalBuyinsFor(p)) }))
  const txns = (() => {
    const d = positions.filter(p => p.net < 0).map(p => ({ ...p, rem: -p.net })).sort((a, b) => b.rem - a.rem)
    const c = positions.filter(p => p.net > 0).map(p => ({ ...p, rem: p.net })).sort((a, b) => b.rem - a.rem)
    const out = []; let di = 0, ci = 0
    while (di < d.length && ci < c.length) {
      const dd = d[di], cc = c[ci], amt = Math.min(dd.rem, cc.rem)
      if (amt > 0) out.push({ from: dd.name, to: cc.name, amount: Math.round(amt) })
      dd.rem -= amt; cc.rem -= amt
      if (dd.rem < 1) di++; if (cc.rem < 1) ci++
    }
    return out
  })()
  const medals = ["🥇", "🥈", "🥉"]

  return (
    <div className="min-h-screen bg-zinc-950 pb-8">
      <div className="relative px-5 pt-14 pb-6 border-b border-zinc-900 overflow-hidden">
        <div className="relative z-10">
          <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 text-sm mb-5 transition-colors">
            <X className="w-4 h-4" /> Back
          </button>
          <div className="text-white text-xl font-bold">{game.name}</div>
          <div className="text-zinc-500 text-sm mt-1">{game.date} · {game.players.length} players</div>
          <div className="flex gap-2 mt-3 flex-wrap">
            {[`${fmtB(totalIn)} in`, rake > 0 ? `${fmtB(rake)} rake` : null, `${fmtB(totalOut)} out`].filter(Boolean).map(s => (
              <span key={s} className="text-[10px] font-semibold text-zinc-600 bg-zinc-900 border border-zinc-800 rounded-full px-3 py-1">{s}</span>
            ))}
          </div>
        </div>
      </div>

      <SL>Results</SL>
      <div className="px-5 flex flex-col gap-2 mb-2">
        {positions.slice().sort((a, b) => b.net - a.net).map((pos, rank) => {
          const p = game.players.find(x => x.name === pos.name)
          return (
            <div key={pos.name} className={cn("bg-zinc-900 border rounded-xl px-4 py-3 flex items-center gap-3 border-l-2", pos.net > 0 ? "border-l-emerald-500 border-zinc-800" : pos.net < 0 ? "border-l-red-500 border-zinc-800" : "border-zinc-800")}>
              <div className="text-lg w-6 text-center shrink-0">{rank < 3 ? medals[rank] : `#${rank + 1}`}</div>
              <Av name={pos.name} size={30} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-zinc-200 text-sm">{pos.name}</div>
                <div className="text-xs text-zinc-600 font-mono">In {fmtB(totalBuyinsFor(p))} · Out {fmtB(p.cashoutAmount || 0)}</div>
              </div>
              <div className={cn("font-mono text-sm font-black", pos.net > 0 ? "text-emerald-400" : pos.net < 0 ? "text-red-400" : "text-zinc-600")}>
                {pos.net > 0 ? "+" : ""}{fmtNet(pos.net)}
              </div>
            </div>
          )
        })}
      </div>

      <SL>Payments — {txns.length}</SL>
      {txns.length === 0 ? <div className="text-center py-6 text-zinc-600 text-sm">Everyone was even</div> : (
        <div className="px-5 flex flex-col gap-2">
          {txns.map((t, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 flex items-center gap-3">
              <Av name={t.from} size={28} />
              <span className="text-sm font-semibold text-red-400">{t.from}</span>
              <ChevronsRight className="w-4 h-4 text-zinc-700 shrink-0" />
              <span className="font-mono text-sm font-bold text-amber-400 flex-1">{fmtB(t.amount)}</span>
              <Av name={t.to} size={28} />
              <span className="text-sm font-semibold text-emerald-400">{t.to}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────
function BottomNav({ screen, onNavigate, showLive }) {
  const items = [
    { id: "home", icon: Home, label: "Home" },
    showLive && { id: "live-game", icon: Gamepad2, label: "Live", live: true },
    { id: "history", icon: LayoutDashboard, label: "History" },
  ].filter(Boolean)

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] z-40 px-3 pb-5">
      <div className="bg-zinc-900/95 backdrop-blur-xl border border-zinc-800 rounded-2xl px-2 py-2 flex items-center shadow-2xl shadow-black/50">
        {items.map(item => {
          const Icon = item.icon
          const active = screen === item.id
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)}
              className={cn("flex-1 flex flex-col items-center gap-1.5 py-2 rounded-xl transition-all", active ? "bg-indigo-600" : "text-zinc-600 hover:text-zinc-400")}>
              <div className="relative">
                <Icon className={cn("w-5 h-5", active ? "text-white" : "")} />
                {item.live && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border-2 border-zinc-900" />}
              </div>
              <span className={cn("text-[10px] font-bold", active ? "text-white" : "")}>{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authLoading, setAuthLoading] = useState(true)
  const [session, setSession]     = useState(null)
  const [profile, setProfile]     = useState(null)
  const [screen, setScreen]       = useState("home")
  const [activeGame, setActiveGame] = useState(null)
  const [undoStack, setUndoStack] = useState([])
  const [pastGames, setPastGames] = useState(SEED_PAST_GAMES)
  const [selGame, setSelGame]     = useState(null)
  const [toast, setToast]         = useState(null)
  const toastRef = useRef(null)

  // Auth bootstrap: pick up any existing session on load (so we don't flash
  // the login screen), then keep listening for sign-in/sign-out/magic-link
  // redirects.
  useEffect(() => {
    let mounted = true

    const hydrate = async (nextSession) => {
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

    supabase.auth.getSession().then(({ data }) => hydrate(data.session))

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      hydrate(nextSession)
    })

    return () => {
      mounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [])

  const sendMagicLink = async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) throw error
  }

  const hostName = profile?.display_name || null

  const showToast = (icon, title, msg) => {
    clearTimeout(toastRef.current)
    setToast({ icon, title, msg })
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  const navigate = (s, data) => {
    if (s === "game-detail" && data) setSelGame(data)
    setScreen(s)
  }

  const logout = async () => { await supabase.auth.signOut(); setScreen("home") }

  const updateGamePlayers = (updated) => {
    if (typeof updated === "function") {
      setActiveGame(prev => ({ ...prev, players: updated(prev.players) }))
    } else {
      setUndoStack(s => [...s.slice(-9), activeGame])
      setActiveGame(updated)
    }
  }

  const handleUndo = () => {
    if (!undoStack.length) return
    setActiveGame(undoStack[undoStack.length - 1])
    setUndoStack(s => s.slice(0, -1))
  }

  const handleCreateGame = (game) => {
    setActiveGame(game); setUndoStack([]); navigate("live-game")
    showToast("🃏", "Game Started", game.name)
  }

  const handleCloseGame = () => {
    if (activeGame) { setPastGames(prev => [{ ...activeGame, id: Date.now() }, ...prev]); setActiveGame(null); setUndoStack([]) }
    setScreen("history")
    showToast("🏁", "Saved", "Results added to your dashboard")
  }

  const isFullScreen = ["create-game", "settlement", "game-detail", "admin"].includes(screen)

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-950">
        <div className="text-zinc-600 text-sm font-medium">Loading…</div>
      </div>
    )
  }

  if (!session || !profile) return <LoginScreen onSendMagicLink={sendMagicLink} />

  const isAdmin = profile.role === "admin"
  const isApprovedHost = profile.role === "host" && profile.approved === true

  if (screen === "admin" && isAdmin) {
    return <AdminScreen onBack={() => navigate("home")} />
  }

  // Every non-admin account that isn't an approved host lands on the pending
  // screen for now. There's no player-only "just gets added to games by a
  // host" flow wired up yet (no games depend on real DB players yet) — that's
  // a separate future pass, so plain players see this too in the meantime.
  if (!isAdmin && !isApprovedHost) {
    return <PendingApprovalScreen onLogout={logout} />
  }

  return (
    <div className="w-full max-w-[390px] min-h-screen bg-zinc-950 mx-auto relative">
      {screen === "home"        && <HomeScreen hostName={hostName} activeGame={activeGame} pastGames={pastGames} onNavigate={navigate} onLogout={logout} isAdmin={isAdmin} />}
      {screen === "create-game" && <CreateGameScreen pastGames={pastGames} onCancel={() => navigate("home")} onCreate={handleCreateGame} />}
      {screen === "live-game" && activeGame && <LiveGameScreen game={activeGame} onUpdateGame={updateGamePlayers} undoStack={undoStack} onUndo={handleUndo} onNavigate={navigate} showToast={showToast} />}
      {screen === "settlement" && activeGame && <SettlementScreen game={activeGame} onClose={handleCloseGame} onBack={() => navigate("live-game")} showToast={showToast} />}
      {screen === "history"     && <HistoryScreen hostName={hostName} pastGames={pastGames} onSelectGame={g => navigate("game-detail", g)} />}
      {screen === "game-detail" && selGame && <GameDetailScreen game={selGame} onBack={() => navigate("history")} />}
      {!isFullScreen && <BottomNav screen={screen} onNavigate={navigate} showLive={!!activeGame} />}
      <Toast toast={toast} />
    </div>
  )
}
