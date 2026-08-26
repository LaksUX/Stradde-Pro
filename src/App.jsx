import { useState, useRef, useEffect } from "react"
import {
  Plus, Minus, ChevronDown, ChevronUp, Undo2, ArrowRight,
  Trophy, Clock, Users, TrendingUp, TrendingDown, Edit3, Check,
  Share2, X, LayoutDashboard, Gamepad2, Home, RotateCcw,
  CheckCircle2, AlertCircle, ChevronsRight, Coins, Hash,
  LogOut, ChevronRight,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { supabase } from "@/lib/supabase"
import { ensureProfile } from "@/lib/auth"
import { Progress } from "@/components/ui/progress"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Sheet, SheetContent, SheetHeader } from "@/components/ui/sheet"
import { loadRoster, upsertRoster } from "@/lib/roster"

// ─── Helpers ──────────────────────────────────────────────────────────────────
const nowStr = () => {
  const d = new Date()
  let h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, "0")} ${ap}`
}

// 1 Bank = 1000 internal units. All amounts are shown as plain bank-unit
// numbers — no currency symbol anywhere. "banks"/"bank" is a small muted
// unit label next to the number (singular only when the value is exactly 1).
// DISPLAY ONLY rounds to the nearest whole bank — underlying stored/computed
// values (buyins, cashouts, rake, settlement math) stay at full precision;
// only what's shown on screen is rounded here.
const fmtBankNum = (n) => String(Math.round(Math.abs(n) / 1000))

// Legacy plain-text formatters (still used for WhatsApp share text, toasts).
const fmtB = (n) => `${fmtBankNum(n)} ${Math.abs(n) / 1000 === 1 ? "bank" : "banks"}`
const fmtNet = (n) => {
  if (n === 0) return "Even"
  return `${n > 0 ? "+" : "−"}${fmtB(Math.abs(n))}`
}

// ─── Bank-unit number display: bold bright number + small muted unit ──────────
function NumB({ value, sign = false, size = "text-sm", className }) {
  const bankCount = Math.abs(value) / 1000
  const label = bankCount === 1 ? "bank" : "banks"
  const prefix = sign ? (value > 0 ? "+" : value < 0 ? "−" : "") : ""
  return (
    <span className={cn("inline-flex items-baseline gap-1 font-mono", className)}>
      <b className={cn("font-extrabold tabular-nums", size)}>{prefix}{fmtBankNum(value)}</b>
      <span className="text-[0.62em] font-semibold text-zinc-500 tracking-wide font-sans">{label}</span>
    </span>
  )
}

// ─── Bottom sheet: shadcn Sheet (Dialog primitive, slide-in-from-bottom) ──────
// Thin app-shaped wrapper around the shared Sheet/SheetContent/SheetHeader so
// call sites don't need to know about Radix's open/onOpenChange plumbing.
function AppSheet({ open, onClose, title, subtitle, avatar, children }) {
  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <SheetContent onOpenAutoFocus={(e) => e.preventDefault()}>
        <SheetHeader title={title} subtitle={subtitle} avatar={avatar} />
        {children}
      </SheetContent>
    </Sheet>
  )
}

// ─── Segmented tabs wrapper (shadcn Tabs — used inside sheets and create-game) ─
function SegTabs({ tabs, active, onChange }) {
  return (
    <Tabs value={active} onValueChange={onChange} className="mb-4">
      <TabsList>
        {tabs.map(t => <TabsTrigger key={t} value={t}>{t}</TabsTrigger>)}
      </TabsList>
    </Tabs>
  )
}

// ─── Calculator-style numeric keypad ───────────────────────────────────────────
function Keypad({ onDigit, onBackspace, onClear }) {
  const keys = ["7","8","9","4","5","6","1","2","3","⌫","0","C"]
  return (
    <div className="grid grid-cols-3 gap-2">
      {keys.map(k => (
        <button
          key={k}
          onClick={() => k === "⌫" ? onBackspace() : k === "C" ? onClear() : onDigit(k)}
          className={cn(
            "h-11.5 rounded-xl flex items-center justify-center text-base font-bold font-mono transition-colors",
            (k === "⌫" || k === "C")
              ? "bg-felt-surface-2 text-zinc-300 hover:bg-zinc-700"
              : "bg-felt-surface-2/70 border border-felt-border text-zinc-100 hover:bg-zinc-700"
          )}
        >
          {k}
        </button>
      ))}
    </div>
  )
}

// ─── Buy-in slider (0–30, ticks every 5, shadcn/Radix Slider) ─────────────────
// `min` floors the draggable range at the player's already-locked buy-in
// count — locked buy-ins (past the 1-min edit window) can never be removed.
// Once EVERY current buy-in is locked (value === min, i.e. no unlocked room
// left to add or remove), the slider becomes fully non-interactive rather
// than just floored-but-still-draggable — a locked state should read as
// genuinely locked, not merely clamped. It re-enables the moment a fresh
// unlocked buy-in exists (value > min).
function BuyinSlider({ value, onChange, max = 30, min = 0 }) {
  const locked = min > 0 && value === min
  return (
    <div className="px-1">
      <div className="relative">
        {min > 0 && (
          <div
            className="absolute top-1/2 -translate-y-1/2 h-2 rounded-l-full bg-gold-dark/70 pointer-events-none z-10"
            style={{ left: 0, width: `${(min / max) * 100}%` }}
          />
        )}
        <Slider
          value={[value]}
          min={min}
          max={max}
          step={1}
          disabled={locked}
          onValueChange={([v]) => onChange(Math.max(min, v))}
        />
      </div>
      <div className="flex justify-between mt-2 px-0.5">
        {[0,5,10,15,20,25,30].map(t => (
          <span key={t} className="text-[10px] font-mono text-zinc-600">{t}</span>
        ))}
      </div>
      {locked && (
        <div className="text-center text-[10.5px] text-zinc-600 mt-1.5">
          All buy-ins locked — no more can be removed from here
        </div>
      )}
    </div>
  )
}

const totalBuyinsFor = (p) => p.buyins.reduce((s, b) => s + b.amount, 0)

// ─── Deterministic settlement (debt simplification) ───────────────────────────
// Winners are paid by losers, biggest matched against biggest, rake excluded
// (rake never appears as a transfer). Ties on remaining net — both the
// initial sort and mid-simplification remainders — are broken by ascending
// player name, since this local-state model has no numeric player id. This
// guarantees the same inputs always produce the same transfer list.
function computeSettlement(players) {
  const positions = players.map(p => ({
    name: p.name,
    net: Math.round((p.cashoutAmount || 0) - totalBuyinsFor(p)),
  }))
  const byNetThenName = (a, b) => (b.rem - a.rem) || a.name.localeCompare(b.name)
  const debtors   = positions.filter(p => p.net < 0).map(p => ({ ...p, rem: -p.net })).sort(byNetThenName)
  const creditors = positions.filter(p => p.net > 0).map(p => ({ ...p, rem: p.net })).sort(byNetThenName)
  const out = []
  let di = 0, ci = 0
  while (di < debtors.length && ci < creditors.length) {
    const d = debtors[di], c = creditors[ci]
    const amt = Math.min(d.rem, c.rem)
    if (amt > 0) out.push({ from: d.name, to: c.name, amount: Math.round(amt) })
    d.rem -= amt; c.rem -= amt
    if (d.rem < 1) di++
    if (c.rem < 1) ci++
  }
  return out
}

// Rounding tolerance for the settlement invariant check — amounts round to
// the nearest 100 units on screen, so allow half that as noise.
const BALANCE_TOLERANCE = 50

// ─── Small status dot (replaces text pills/badges for in-play/settled state) ──
function Dot({ color, className }) {
  const map = {
    indigo: "bg-gold-light shadow-[0_0_6px_rgba(224,187,92,0.7)]",
    emerald: "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.7)]",
    red: "bg-red-400 shadow-[0_0_6px_rgba(248,113,113,0.7)]",
    zinc: "bg-zinc-600",
  }
  return <span className={cn("w-2 h-2 rounded-full shrink-0", map[color] || map.zinc, className)} />
}

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
    buyinAmount: 1000, rake: 1000, status: "closed",
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
    buyinAmount: 1000, rake: 0, status: "closed",
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
    buyinAmount: 1000, rake: 2000, status: "closed",
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
      <div className="flex items-center gap-3 bg-felt-surface-2 border border-felt-border text-white px-4 py-3 rounded-2xl shadow-2xl shadow-black/50 max-w-[320px] sm:max-w-sm">
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
      <div className="flex flex-col items-center justify-center min-h-screen bg-felt-bg px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(202,160,67,0.18),transparent)]" />
        <div className="relative z-10 w-full max-w-[320px] text-center">
          <div className="text-[48px] leading-none mb-5">✉️</div>
          <h1 className="text-white text-2xl font-black tracking-tight">Check your email</h1>
          <p className="text-zinc-500 text-sm mt-2 font-medium">
            We sent a magic link to <span className="text-zinc-300">{email}</span>. Open it on this device to sign in.
          </p>
          <button
            onClick={() => setStatus("idle")}
            className="mt-6 text-gold-light text-sm font-bold hover:text-gold-light transition-colors"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-felt-bg px-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(202,160,67,0.18),transparent)]" />
      <div className="relative z-10 w-full max-w-[320px]">
        <div className="text-center mb-10">
          <div className="text-[48px] leading-none mb-5">♠</div>
          <h1 className="text-white text-3xl font-black tracking-tight">Poker Night</h1>
          <p className="text-zinc-500 text-sm mt-2 font-medium">Sign in with your email</p>
        </div>
        <div className="flex flex-col gap-3">
          <input
            className="w-full h-12 bg-felt-surface border border-felt-border rounded-xl px-4 text-white text-sm font-medium placeholder:text-zinc-600 outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 transition-all"
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
            className="w-full h-12 bg-gold hover:bg-gold disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-sm"
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

// ─── Pending approval ─────────────────────────────────────────────────────────
function PendingApprovalScreen({ onLogout }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-felt-bg px-6">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,rgba(202,160,67,0.18),transparent)]" />
      <div className="relative z-10 w-full max-w-[320px] text-center">
        <div className="text-[48px] leading-none mb-5">⏳</div>
        <h1 className="text-white text-2xl font-black tracking-tight">Pending approval</h1>
        <p className="text-zinc-500 text-sm mt-3 font-medium leading-relaxed">
          Your account is set up. Ask the app admin to approve you as a host to create games.
        </p>
        <button
          onClick={onLogout}
          className="mt-8 w-full h-12 bg-felt-surface border border-felt-border hover:border-felt-border text-zinc-300 font-bold rounded-xl transition-colors text-sm"
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
  const [revokeTarget, setRevokeTarget] = useState(null) // row pending revoke confirmation

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
    <div className="flex flex-col min-h-screen bg-felt-bg pb-10">
      <div className="relative px-5 pt-14 pb-7 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(202,160,67,0.12),transparent_60%)]" />
        <div className="relative z-10 flex items-center justify-between">
          <div>
            <div className="text-zinc-500 text-xs font-medium mb-1">Admin</div>
            <div className="text-white text-2xl font-black tracking-tight">Approvals</div>
          </div>
          <button onClick={onBack} className="mt-1 p-2 rounded-xl bg-felt-surface border border-felt-border text-zinc-500 hover:text-zinc-300 transition-colors">
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
            <div key={row.id} className="bg-felt-surface border border-felt-border rounded-2xl p-4">
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
                      : "bg-felt-surface-2 text-zinc-400 border-felt-border"
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
                    className="flex-1 h-9 bg-gold hover:bg-gold disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    Approve as host
                  </button>
                ) : (
                  <button
                    disabled={busyId === row.id}
                    onClick={() => setRevokeTarget(row)}
                    className="flex-1 h-9 bg-felt-surface-2 hover:bg-zinc-700 disabled:opacity-40 text-zinc-300 text-xs font-bold rounded-lg transition-colors"
                  >
                    Revoke approval
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Revoke confirmation — this local-state build has no live-games join
          yet (game screens aren't wired to Supabase, see Known Gaps), so we
          can't name specific in-progress games here; the copy says so
          explicitly rather than silently omitting the check the spec asks
          for. */}
      <Dialog open={!!revokeTarget} onOpenChange={(o) => { if (!o) setRevokeTarget(null) }}>
        <DialogContent className="max-w-[340px] sm:max-w-md bg-felt-surface border-felt-border text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-white">Revoke host approval?</DialogTitle>
            <DialogDescription className="text-zinc-500">
              {revokeTarget?.display_name || revokeTarget?.email} will no longer be able to create games. This build can't yet check whether they have a live game in progress — confirm you're not pulling approval mid-game.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <button onClick={() => setRevokeTarget(null)} className="flex-1 h-11 bg-felt-surface-2 hover:bg-zinc-700 border border-felt-border text-zinc-300 font-semibold rounded-xl text-sm transition-colors">Cancel</button>
            <button
              onClick={() => { setApproval(revokeTarget, revokeTarget.role, false); setRevokeTarget(null) }}
              className="flex-1 h-11 bg-red-600/80 hover:bg-red-600 text-white font-bold rounded-xl text-sm transition-colors"
            >
              Revoke
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Animated net-over-time line chart (hand-rolled SVG, no chart library) ────
function NetTrendChart({ pastGames, hostName }) {
  const W = 340, H = 120, PAD = 12
  const pathRef = useRef(null)
  const [drawn, setDrawn] = useState(false)

  // Oldest → newest, cumulative net for the host across recent games.
  const chrono = [...pastGames].reverse()
  let running = 0
  const points = chrono.map(g => {
    const h = g.players.find(p => p.name === hostName)
    const net = h ? (h.cashoutAmount || 0) - totalBuyinsFor(h) : 0
    running += net
    return { label: g.date, cum: running }
  })

  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(true))
    return () => cancelAnimationFrame(id)
  }, [pastGames.length, hostName])

  if (points.length < 2) {
    return (
      <div className="bg-felt-surface border border-felt-border rounded-2xl px-4 py-6 text-center text-zinc-700 text-xs font-medium">
        Play a couple more games to see your trend
      </div>
    )
  }

  const vals = points.map(p => p.cum)
  const min = Math.min(0, ...vals), max = Math.max(0, ...vals)
  const range = max - min || 1
  const x = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2)
  const y = (v) => H - PAD - ((v - min) / range) * (H - PAD * 2)
  const zeroY = y(0)

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(" ")
  const areaPath = `${linePath} L ${x(points.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`

  const last = vals[vals.length - 1]
  const up = last >= 0

  return (
    <div className="bg-felt-surface border border-felt-border rounded-2xl px-4 pt-4 pb-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">Net Trend</div>
        <NumB value={last} sign size="text-sm" className={up ? "text-emerald-400" : "text-red-400"} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
        <defs>
          <linearGradient id="netFillG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "#10b981" : "#ef4444"} stopOpacity="0.28" />
            <stop offset="100%" stopColor={up ? "#10b981" : "#ef4444"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#3f3f46" strokeWidth="1" strokeDasharray="3 3" />
        <path d={areaPath} fill="url(#netFillG)" opacity={drawn ? 1 : 0} style={{ transition: "opacity 0.6s ease 0.4s" }} />
        <path
          ref={pathRef}
          d={linePath}
          fill="none"
          stroke={up ? "#34d399" : "#f87171"}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={1000}
          strokeDasharray={1000}
          strokeDashoffset={drawn ? 0 : 1000}
          style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(0.4,0,0.2,1)" }}
        />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)} cy={y(p.cum)} r={i === points.length - 1 ? 3.5 : 2.5}
            fill={up ? "#34d399" : "#f87171"}
            opacity={drawn ? 1 : 0}
            style={{ transition: `opacity 0.3s ease ${0.6 + i * 0.05}s` }}
          />
        ))}
      </svg>
    </div>
  )
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function HostStatsView({ pastGames }) {
  const gamesHosted = pastGames.length
  const uniquePlayers = new Set(pastGames.flatMap(g => g.players.map(p => p.name))).size
  const totalRake = pastGames.reduce((s, g) => s + (g.rake || 0), 0)
  const totalPot = pastGames.reduce((s, g) => s + g.players.reduce((ps, p) => ps + totalBuyinsFor(p), 0), 0)
  const avgPot = gamesHosted ? Math.round(totalPot / gamesHosted) : 0

  return (
    <div className="px-5 flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-felt-surface border border-felt-border rounded-2xl p-3.5">
          <div className="text-[9px] font-bold tracking-[0.13em] uppercase text-zinc-500">Games Hosted</div>
          <div className="text-white font-mono text-2xl font-extrabold mt-1 tracking-tight">{gamesHosted}</div>
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl p-3.5">
          <div className="text-[9px] font-bold tracking-[0.13em] uppercase text-zinc-500">Players Hosted</div>
          <div className="text-white font-mono text-2xl font-extrabold mt-1 tracking-tight">{uniquePlayers}</div>
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl p-3.5">
          <div className="text-[9px] font-bold tracking-[0.13em] uppercase text-zinc-500">Rake Collected</div>
          <NumB value={totalRake} size="text-2xl" className="mt-1 text-amber-400" />
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl p-3.5">
          <div className="text-[9px] font-bold tracking-[0.13em] uppercase text-zinc-500">Avg Pot / Game</div>
          <NumB value={avgPot} size="text-2xl" className="mt-1 text-zinc-100" />
        </div>
      </div>
      {gamesHosted === 0 && (
        <div className="text-zinc-600 text-xs text-center py-6">Host a game to see stats here.</div>
      )}
    </div>
  )
}

function HomeScreen({ hostName, activeGame, pastGames, onNavigate, onLogout, isAdmin }) {
  // Dashboard stats/lists only ever reflect closed games — a live game in
  // progress doesn't count toward hosting totals or the trend chart yet, and
  // it already has its own separate "active game" card above, so it's
  // excluded here to avoid double-showing it.
  const closedGames = pastGames.filter(g => g.status !== "live")
  const recent = closedGames.slice(0, 6)
  const [view, setView] = useState("player") // player | host
  return (
    <div className="flex flex-col min-h-screen bg-felt-bg pb-28">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-7 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(202,160,67,0.12),transparent_60%)]" />
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="text-zinc-500 text-xs font-medium mb-1">Welcome back</div>
            <div className="text-white text-2xl font-black tracking-tight">{hostName} <span className="text-zinc-600">♠</span></div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {isAdmin && (
              <button onClick={() => onNavigate("admin")} className="p-2 rounded-xl bg-felt-surface border border-felt-border text-zinc-500 hover:text-gold-light transition-colors" title="Admin approvals">
                <Users className="w-4 h-4" />
              </button>
            )}
            <button onClick={onLogout} className="p-2 rounded-xl bg-felt-surface border border-felt-border text-zinc-500 hover:text-zinc-300 transition-colors">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
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
      </div>

      <div className="px-5 mt-1">
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="player">My Player Stats</TabsTrigger>
            <TabsTrigger value="host">My Hosting Stats</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {view === "host" && (
        <>
          {/* New game — hosting-only action, lives in the Hosting tab rather
              than being shown universally on both tabs. */}
          <div className="px-5 mt-3">
            <button
              onClick={() => onNavigate("create-game")}
              className="w-full text-left rounded-2xl bg-felt-surface border border-felt-border hover:border-gold/50 p-4 flex items-center gap-4 transition-all group"
            >
              <div className="w-11 h-11 rounded-xl bg-gold/20 border border-gold/30 flex items-center justify-center group-hover:bg-gold/30 transition-colors">
                <Plus className="w-5 h-5 text-gold-light" />
              </div>
              <div>
                <div className="text-white font-bold text-sm">New Game</div>
                <div className="text-zinc-500 text-xs mt-0.5">Set up players & buy-ins</div>
              </div>
              <ChevronRight className="w-4 h-4 text-zinc-700 ml-auto group-hover:text-zinc-500 transition-colors" />
            </button>
          </div>
          <SL>Hosting Overview</SL>
          <HostStatsView pastGames={closedGames} />
        </>
      )}

      {view === "player" && closedGames.length > 0 && (() => {
        // Different stakes aren't comparable on one line — a win at one bank
        // size doesn't mean the same thing as a win at another — so each
        // distinct buy-in level gets its own trend chart rather than being
        // blended into a single misleading combined line.
        const stakeGroups = {}
        for (const g of closedGames) {
          const key = g.buyinAmount || 0
          ;(stakeGroups[key] ||= []).push(g)
        }
        const stakes = Object.keys(stakeGroups).map(Number).sort((a, b) => b - a)
        return (
          <>
            <SL>Net Trend{stakes.length > 1 ? ` — by stake` : ""}</SL>
            <div className="px-5 flex flex-col gap-3">
              {stakes.map(stake => (
                <div key={stake}>
                  {stakes.length > 1 && (
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
                      {fmtB(stake)} / bank stakes
                    </div>
                  )}
                  <NetTrendChart pastGames={stakeGroups[stake]} hostName={hostName} />
                </div>
              ))}
            </div>
          </>
        )
      })()}

      {view === "player" && recent.length > 0 && (
        <>
          <SL>Recent Games</SL>
          <div className="px-5 flex flex-col gap-2">
            {recent.map(g => {
              const h = g.players.find(p => p.name === hostName)
              const net = h ? h.cashoutAmount - totalBuyinsFor(h) : null
              return (
                <button
                  key={g.id}
                  onClick={() => onNavigate("game-detail", g)}
                  className="w-full bg-felt-surface border border-felt-border hover:border-felt-border rounded-xl px-4 py-3.5 flex items-center gap-3 transition-colors text-left"
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
// Every player starts at exactly 1 buy-in, at the game-wide stake the host
// sets below. There is no per-player buy-in count/amount control at creation
// time — hosts add further buy-ins live during the game instead.

function CreateGameScreen({ pastGames, roster, addToRoster, onCancel, onCreate }) {
  const lastGame = pastGames[0]
  const [name, setName]         = useState(lastGame?.name || "")
  const [date, setDate]         = useState(new Date().toLocaleDateString("en-IN", { day:"numeric", month:"short" }))
  const [time, setTime]         = useState(nowStr())
  const [location, setLocation] = useState(lastGame?.location || "")
  // Stake (buy-in amount) — blank by default, deliberately not 0/1, so
  // "Start Game" stays disabled until the host sets a real value. Entered in
  // whole banks, stored in internal units (1 bank = 1000 units).
  const [stakeInput, setStakeInput] = useState("")
  const stakeAmount = (parseFloat(stakeInput) || 0) * 1000
  const [players, setPlayers]   = useState([])
  const [nameInput, setNameInput]   = useState("")
  const [phoneInput, setPhoneInput] = useState("")
  // Default to "Your players" when the shared roster has anyone in it — the
  // fast/default path per REQUIREMENTS.md → Roster.
  const [source, setSource]     = useState(roster.length > 0 ? "Your players" : "Type in")
  const [createdGame, setCreatedGame] = useState(null) // set after "Start Game" — shows the invite step
  const [copied, setCopied] = useState(false)

  const notAdded = roster.filter(r => !players.find(p => p.name.toLowerCase() === r.name.toLowerCase()))

  const addPlayer = (n, ph) => {
    const t = n.trim(), phone = (ph || "").trim()
    if (!t || !phone || players.find(p => p.name.toLowerCase() === t.toLowerCase())) return
    setPlayers(prev => [...prev, { name: t, phone }])
    addToRoster(t, phone)
    setNameInput(""); setPhoneInput("")
  }

  const removePlayer = (n) => setPlayers(prev => prev.filter(p => p.name !== n))

  const canStart = name.trim() && players.length > 0 && stakeAmount > 0

  const handleCreate = () => {
    if (!canStart) return
    const game = {
      id: Date.now(),
      name: name.trim(), date, time, location,
      buyinAmount: stakeAmount,
      rake: 0,
      status: "live",
      players: players.map(p => ({
        name: p.name, phone: p.phone,
        buyins: [{ ts: nowStr(), epoch: Date.now(), amount: stakeAmount }],
        cashedOut: false, cashoutAmount: null,
      })),
    }
    setCreatedGame(game)
  }

  const inviteText = () => {
    const g = createdGame
    return [
      `🃏 ${g.name} ♠`,
      g.location ? `📍 ${g.location}` : null,
      `🕘 ${g.date}${g.time ? `, ${g.time}` : ""}`,
      ``,
      `You're invited! Players:`,
      ...g.players.map(p => `• ${p.name}`),
      ``,
      `https://pokernight.app/g/${g.id}`,
    ].filter(l => l !== null).join("\n")
  }

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  // Step 2: game created — offer the (stubbed) WhatsApp invite text, then continue.
  if (createdGame) {
    return (
      <div className="min-h-screen bg-felt-bg pb-8">
        <div className="px-5 pt-14 pb-6 border-b border-felt-border">
          <div className="text-white text-xl font-bold flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" /> Game Created
          </div>
          <div className="text-zinc-500 text-sm mt-1">Invite your players, then jump into the game</div>
        </div>

        <div className="px-5 pt-5 flex flex-col gap-4">
          <div className="bg-felt-surface border border-felt-border rounded-2xl p-4">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500 mb-2">Invite Preview</div>
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-zinc-300 bg-felt-bg/60 border border-felt-border rounded-xl p-3">{inviteText()}</pre>
            <div className="text-[10.5px] text-zinc-600 mt-2 leading-relaxed">
              Stub: this link doesn't route anywhere real yet and phones aren't verified — anyone with the link could open it once a real join page exists.
            </div>
          </div>

          <button
            onClick={copyInvite}
            className="w-full h-12 bg-[#25d366] hover:bg-[#20bc58] text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" /> {copied ? "Copied!" : "Copy WhatsApp invite link"}
          </button>

          <button
            onClick={() => onCreate(createdGame)}
            className="w-full h-12 bg-gold hover:bg-gold text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2"
          >
            <Gamepad2 className="w-4 h-4" /> Continue to Live Game
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-felt-bg pb-8">
      {/* Header */}
      <div className="px-5 pt-14 pb-6 border-b border-felt-border">
        <button onClick={onCancel} className="flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm mb-5 transition-colors">
          <X className="w-4 h-4" /> Cancel
        </button>
        <div className="text-white text-xl font-bold">New Game</div>
        <div className="text-zinc-500 text-sm mt-1">Configure the session</div>
      </div>

      <div className="px-5 pt-5 flex flex-col gap-5">
        {/* Game info */}
        <div className="bg-felt-surface border border-felt-border rounded-2xl p-4 flex flex-col gap-4">
          <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">Game Details</div>
          <div className="flex flex-col gap-3">
            <DInput label="Game Name" placeholder="e.g. Friday Night Felts" value={name} onChange={e => setName(e.target.value)} />
            <div className="grid grid-cols-2 gap-3">
              <DInput label="Date" value={date} onChange={e => setDate(e.target.value)} />
              <DInput label="Time" value={time} onChange={e => setTime(e.target.value)} />
            </div>
            <DInput label="Location (optional)" placeholder="e.g. Raj's place" value={location} onChange={e => setLocation(e.target.value)} />
            <div>
              <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500 mb-1.5">Buy-in Amount (Banks)</div>
              <div className="flex items-center gap-2">
                <input
                  type="number" min="0" step="1" inputMode="decimal" placeholder="e.g. 2"
                  value={stakeInput}
                  onChange={e => setStakeInput(e.target.value)}
                  className="flex-1 h-11 bg-felt-surface-2 border border-felt-border rounded-xl px-4 text-zinc-100 text-sm font-mono placeholder:text-zinc-600 outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 transition-all"
                />
                <span className="text-zinc-500 text-sm font-bold w-10 shrink-0">/ buy-in</span>
              </div>
              <div className="text-[10.5px] text-zinc-600 mt-1.5 leading-relaxed">
                Every player starts with exactly 1 buy-in at this amount. One stake for the whole game — required before you can start.
              </div>
            </div>
          </div>
        </div>

        {/* Players */}
        <div className="bg-felt-surface border border-felt-border rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">
              Add players{players.length > 0 ? ` · ${players.length} in` : ""}
            </div>
          </div>

          {/* Selected players stay visible as chips regardless of active tab */}
          {players.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3.5">
              {players.map(p => (
                <span key={p.name} className="flex items-center gap-2 bg-felt-surface-2 border border-felt-border rounded-2xl pl-1 pr-1.5 py-1 text-[12.5px] font-semibold text-zinc-200">
                  <Av name={p.name} size={26} />
                  <span className="flex flex-col leading-tight">
                    <span>{p.name}</span>
                    <span className="text-[9.5px] font-mono font-normal text-zinc-500">{p.phone}</span>
                  </span>
                  <button onClick={() => removePlayer(p.name)}
                    className="w-4.5 h-4.5 rounded-full bg-zinc-700 text-zinc-400 hover:text-white flex items-center justify-center text-[10px] font-bold transition-colors ml-0.5">
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Segmented source tabs */}
          <SegTabs tabs={["Your players", "Contacts", "Type in"]} active={source} onChange={setSource} />

          {source === "Your players" && (
            notAdded.length > 0 ? (
              <div>
                <div className="text-[10px] text-zinc-600 font-semibold uppercase tracking-wider mb-2">Tap to add · name + saved number</div>
                <div className="flex flex-wrap gap-1.5">
                  {notAdded.map(r => (
                    <button key={r.name} onClick={() => r.phone ? addPlayer(r.name, r.phone) : (setSource("Type in"), setNameInput(r.name))}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-transparent hover:bg-felt-surface-2 border border-dashed border-felt-border hover:border-zinc-600 text-zinc-400 hover:text-white rounded-full text-xs font-medium transition-all"
                    >
                      <span className="text-gold-light font-bold">+</span> {r.name}
                      {!r.phone && <span className="text-amber-500 text-[10px]">· add #</span>}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-5 text-zinc-700 text-xs font-medium">
                Everyone from your history is already added
              </div>
            )
          )}

          {source === "Contacts" && (
            <div className="text-center py-6 text-zinc-600 text-xs font-medium leading-relaxed">
              Contacts access isn't wired up yet — this tab is a placeholder.
              <br />Use "Type in" for now.
            </div>
          )}

          {source === "Type in" && (
            <div className="flex flex-col gap-2">
              <input
                className="w-full h-11 bg-felt-surface-2 border border-felt-border rounded-xl px-4 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 transition-all"
                placeholder="Player's name…"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
              />
              <div className="relative">
                <input
                  className="w-full h-11 bg-felt-surface-2 border border-felt-border rounded-xl px-4 pr-20 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 transition-all"
                  placeholder="Phone number (required)…"
                  type="tel"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addPlayer(nameInput, phoneInput)}
                />
                {nameInput.trim() && phoneInput.trim() && (
                  <button
                    onClick={() => addPlayer(nameInput, phoneInput)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3 h-7 bg-gold hover:bg-gold text-white text-xs font-bold rounded-lg transition-colors"
                  >
                    Add
                  </button>
                )}
              </div>
              {nameInput.trim() && !phoneInput.trim() && (
                <div className="text-[10.5px] text-amber-500 font-medium">Phone number is required to add a player</div>
              )}
            </div>
          )}
        </div>

        <button
          disabled={!canStart}
          onClick={handleCreate}
          className="w-full h-13 bg-gold hover:bg-gold disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors flex items-center justify-center gap-2 py-3.5"
        >
          <Gamepad2 className="w-4 h-4" />
          Start Game{
            !name.trim() ? " · add a game name"
            : players.length === 0 ? " · add at least 1 player"
            : stakeAmount <= 0 ? " · set a buy-in amount"
            : ` · ${players.length} players`
          }
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
        className="w-full h-11 bg-felt-surface-2 border border-felt-border rounded-xl px-4 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 transition-all"
        {...props}
      />
    </div>
  )
}

// ─── End Game Modal ───────────────────────────────────────────────────────────
function EndGameModal({ game, onConfirm, onClose }) {
  const [rake, setRake] = useState(String((game.rake || 0) / 1000))
  const [ackUncashed, setAckUncashed] = useState(false)
  const players  = game.players
  const totalIn  = players.reduce((s, p) => s + totalBuyinsFor(p), 0)
  const totalOut = players.reduce((s, p) => s + (p.cashoutAmount || 0), 0)
  const uncashed = players.filter(p => !p.cashedOut)
  const rakeAmt  = (parseFloat(rake) || 0) * 1000
  // Invariant: sum(buy-ins) = sum(cash-outs) + rake. `diff` is how far off
  // that is; rake is host revenue skimmed off the table, never a per-player
  // transfer, so it never appears in the settlement transfers below.
  const diff     = totalIn - (totalOut + rakeAmt)
  const balanced = Math.abs(diff) < BALANCE_TOLERANCE
  const canProceed = balanced && (uncashed.length === 0 || ackUncashed)

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[340px] sm:max-w-md bg-felt-surface border-felt-border text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-white">End Game & Settle</DialogTitle>
          <DialogDescription className="text-zinc-500">Review accounts before settlement.</DialogDescription>
        </DialogHeader>

        {/* Explicit confirmation — closing doesn't require every player to
            have cashed out (they may have walked away), but the host must
            acknowledge that an uncashed player's buy-ins will count as a
            loss to the table before the button unlocks. */}
        {uncashed.length > 0 && (
          <label className="flex items-start gap-2.5 bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={ackUncashed}
              onChange={e => setAckUncashed(e.target.checked)}
              className="mt-0.5 shrink-0 accent-amber-500"
            />
            <div className="text-xs text-amber-300">
              {uncashed.length} player{uncashed.length > 1 ? "s have" : " has"} no cash-out recorded — their buy-ins will count as a loss to the table. Continue?
            </div>
          </label>
        )}

        <div>
          <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500 mb-1.5">Rake (Banks)</div>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" step="1" placeholder="0" value={rake}
              onChange={e => setRake(e.target.value)}
              className="flex-1 h-11 bg-felt-surface-2 border border-felt-border rounded-xl px-4 text-zinc-100 text-sm font-mono outline-none focus:border-gold transition-all"
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
          {!balanced && (
            <div className="text-xs text-red-300/90 pt-1 leading-relaxed">
              Buy-ins and cash-outs don't add up — off by {fmtB(Math.abs(diff))}. Check your entries before settling.
            </div>
          )}
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 h-11 bg-felt-surface-2 hover:bg-zinc-700 border border-felt-border text-zinc-300 font-semibold rounded-xl text-sm transition-colors">Cancel</button>
          <button
            disabled={!canProceed}
            onClick={() => onConfirm(rakeAmt)}
            className="flex-1 h-11 bg-gold hover:bg-gold disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors"
          >
            Settle Up
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Live Game ────────────────────────────────────────────────────────────────
const LOCK_MS = 60 * 1000 // buy-ins become un-editable 1 min after being added

function LiveGameScreen({ game, onUpdateGame, undoStack, onUndo, onNavigate, showToast, roster, addToRoster }) {
  const [sheetFor, setSheetFor] = useState(null)      // player name whose sheet is open
  const [cashoutOn, setCashoutOn] = useState(false)   // cash-out toggle inside the sheet
  const [sliderVal, setSliderVal] = useState(0)
  const [cashoutDigits, setCashoutDigits] = useState("")
  const [showEnd, setShowEnd]   = useState(false)
  const [addingPlayer, setAddingPlayer] = useState(false) // expandable "Add late player" section
  const [addMode, setAddMode]   = useState("roster") // roster | new
  const [newName, setNewName]   = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [rakeVisible, setRakeVisible] = useState(false)

  const [rakeInput, setRakeInput] = useState(String((game.rake || 0) / 1000))

  const players  = game.players
  const isClosed = game.status === "closed"
  const totalIn  = players.reduce((s, p) => s + totalBuyinsFor(p), 0)
  const cashedOut = players.filter(p => p.cashedOut)
  const totalOut = cashedOut.reduce((s, p) => s + (p.cashoutAmount || 0), 0)

  // Live bankroll-check invariant: buy-ins = cashed-out + rake + still in
  // play. Money still on the table mid-game is normal; the only real error
  // is paying out (cashouts + rake) more than ever came in. This never
  // blocks further buy-in/cash-out entry — only closing the game (below).
  const paidOut = totalOut + (game.rake || 0)
  const overpaid = paidOut - totalIn
  const overpayError = overpaid > BALANCE_TOLERANCE
  const stillIn = totalIn - totalOut

  const lockedCountFor = (p) => p.buyins.filter(b => !b.epoch || Date.now() - b.epoch >= LOCK_MS).length

  const updatePlayers = (updated) => { if (!isClosed) onUpdateGame({ ...game, players: updated }) }

  const commitRake = (v) => {
    if (isClosed) return
    const amt = Math.max(0, (parseFloat(v) || 0) * 1000)
    onUpdateGame({ ...game, rake: amt })
  }

  const removePlayer = (p) => {
    if (totalBuyinsFor(p) > 0) return // never valid once any buy-in exists
    updatePlayers(players.filter(pp => pp.name !== p.name))
    showToast("🗑️", "Player removed", p.name)
  }

  const openSheet = (p) => {
    setSheetFor(p.name)
    setCashoutOn(!!p.cashedOut)
    setSliderVal(p.buyins.length)
    setCashoutDigits(p.cashedOut ? String(Math.round((p.cashoutAmount || 0) / 1000)) : "")
  }
  const closeSheet = () => { setSheetFor(null); setCashoutDigits(""); setCashoutOn(false) }

  const sendCashoutDetails = async (p) => {
    const tIn = totalBuyinsFor(p)
    const text = [
      `🃏 ${game.name} — cash-out summary for ${p.name}`,
      `Buy-ins: ${fmtB(tIn)}`,
      p.cashedOut ? `Cashed out: ${fmtB(p.cashoutAmount || 0)}` : `Not cashed out yet`,
      p.cashedOut ? `Net: ${fmtNet((p.cashoutAmount || 0) - tIn)}` : null,
    ].filter(Boolean).join("\n")
    try {
      await navigator.clipboard.writeText(text)
      showToast("📋", "Cash-out details copied", `Ready to send to ${p.name} (stub — no push backend yet)`)
    } catch {
      showToast("📋", "Cash-out details ready", text)
    }
  }

  // Add-player: same shared roster as Create Game (see src/lib/roster.js).
  // A roster chip tap adds instantly; the "someone new" fallback requires
  // both name and phone, and also saves the new person to the roster.
  const addPlayerToGame = (n, phone) => {
    const t = n.trim()
    if (!t) return
    if (players.find(p => p.name.toLowerCase() === t.toLowerCase())) {
      showToast("⚠️", "Already added", `${t} is in the game`); return
    }
    updatePlayers([...players, { name: t, phone: (phone || "").trim(), buyins: [{ ts: nowStr(), epoch: Date.now(), amount: game.buyinAmount }], cashedOut: false, cashoutAmount: null }])
    showToast("🃏", "Player Added", `${t} — ${fmtB(game.buyinAmount)}`)
  }

  const addFromRoster = (r) => addPlayerToGame(r.name, r.phone)

  const addNewPlayer = () => {
    const n = newName.trim(), phone = newPhone.trim()
    if (!n || !phone) return
    addPlayerToGame(n, phone)
    addToRoster(n, phone)
    setNewName(""); setNewPhone("")
    setAddingPlayer(false)
    setAddMode("roster")
  }

  const notInGameRoster = roster.filter(r => !players.find(p => p.name.toLowerCase() === r.name.toLowerCase()))

  const confirmBuyins = () => {
    const idx = players.findIndex(p => p.name === sheetFor)
    if (idx < 0) return
    const p = players[idx]
    const currentCount = p.buyins.length
    // The slider can never be dragged below the player's already-locked
    // buy-in count (amounts past the 1-minute lock window) — see the
    // slider's `min` prop below, which enforces this at drag time too.
    const target = Math.max(sliderVal, lockedCountFor(p))
    if (target === currentCount) { closeSheet(); return }
    const updated = [...players]
    if (target > currentCount) {
      const added = Array.from({ length: target - currentCount }, () => ({ ts: nowStr(), epoch: Date.now(), amount: game.buyinAmount, isNew: true }))
      updated[idx] = { ...p, buyins: [...p.buyins, ...added] }
      showToast("🏦", "Buy-in added", `${p.name} · now ${target}×`)
      setTimeout(() => {
        onUpdateGame(prev => prev.map((pp, i) => i === idx ? { ...pp, buyins: pp.buyins.map(b => ({ ...b, isNew: false })) } : pp))
      }, 4000)
    } else {
      // removing only ever trims unlocked entries from the end
      updated[idx] = { ...p, buyins: p.buyins.slice(0, target) }
      showToast("↩️", "Buy-in removed", `${p.name} · now ${target}×`)
    }
    updatePlayers(updated)
    closeSheet()
  }

  const confirmCashout = () => {
    const idx = players.findIndex(p => p.name === sheetFor)
    if (idx < 0) return
    const p = players[idx]
    const val = parseInt(cashoutDigits || "0", 10) * 1000 // keypad digits are whole banks typed directly
    const updated = [...players]
    const net = val - totalBuyinsFor(p)
    updated[idx] = { ...p, cashedOut: true, cashoutAmount: val }
    updatePlayers(updated)
    closeSheet()
    showToast(net >= 0 ? "🟢" : "🔴", `${p.name} cashed out`, `${fmtB(val)} · Net ${fmtNet(net)}`)
  }

  const handleEndGame = (rake) => {
    onUpdateGame({ ...game, rake })
    setShowEnd(false)
    onNavigate("settlement")
  }

  const sheetPlayer = players.find(p => p.name === sheetFor)
  const sheetPlayerIn = sheetPlayer ? totalBuyinsFor(sheetPlayer) : 0
  const cashoutEntered = parseInt(cashoutDigits || "0", 10) * 1000
  const cashoutNet = cashoutEntered - sheetPlayerIn

  return (
    <div className="flex flex-col min-h-screen bg-felt-bg pb-28">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-5 overflow-hidden border-b border-felt-border">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.08),transparent_60%)]" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-blink" />
              <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400">Live</span>
            </div>
            {undoStack.length > 0 && (
              <button onClick={onUndo} className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 bg-felt-surface border border-felt-border px-3 py-1.5 rounded-lg transition-colors">
                <Undo2 className="w-3.5 h-3.5" /> Undo
              </button>
            )}
          </div>
          <div className="text-white text-xl font-bold">{game.name}</div>
          <div className="text-zinc-500 text-xs mt-1">{players.length} players · {game.date}{game.time ? ` · ${game.time}` : ""}</div>
        </div>
      </div>

      {/* Stats row */}
      <div className="px-5 pt-4 grid grid-cols-3 gap-2.5">
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">On table</div>
          <NumB value={totalIn - totalOut} size="text-[18px]" className="mt-1 text-white" />
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">Cashed out</div>
          <NumB value={totalOut} size="text-[18px]" className="mt-1 text-white" />
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">Rake</div>
            <button onClick={() => setRakeVisible(v => !v)} className="w-6 h-6 rounded-lg bg-felt-surface-2 border border-felt-border flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
              {rakeVisible ? <ChevronUp className="w-3 h-3" /> : <span className="text-[10px]">◐</span>}
            </button>
          </div>
          {rakeVisible ? (
            isClosed ? (
              <NumB value={game.rake || 0} size="text-[18px]" className="mt-1 text-amber-400" />
            ) : (
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number" min="0" step="1" inputMode="decimal"
                  value={rakeInput}
                  onChange={e => setRakeInput(e.target.value)}
                  onBlur={e => commitRake(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()}
                  className="w-full bg-transparent text-[18px] font-extrabold font-mono text-amber-400 outline-none border-b border-transparent focus:border-amber-400/40"
                />
              </div>
            )
          ) : (
            <div className="mt-1 text-[18px] font-extrabold tracking-[0.15em] text-zinc-600">•••</div>
          )}
        </div>
      </div>

      {/* Live bankroll check — a poker bankroll manager's core invariant:
          buy-ins = cashed-out + rake + whatever's still in play. Mid-game,
          money still on the table is normal, not an error — the only real
          error is paying out (cashouts + rake) more than ever came in. This
          never blocks further entry — only closing the game does, below.
          Rake edits above flow into `game.rake` and this recomputes on
          every render, so editing rake live-updates this banner too. */}
      <div className="px-5 pt-2.5">
        <div className={cn(
          "rounded-xl px-3.5 py-2 text-[11px] font-medium flex items-center gap-2",
          overpayError ? "bg-red-500/10 border border-red-500/30 text-red-300" : "bg-felt-surface-2/50 text-zinc-500"
        )}>
          {overpayError ? (
            <>
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Paid out <NumB value={overpaid} size="text-[11px]" className="inline-flex" /> more than total buy-ins — check entries
            </>
          ) : (
            <>
              <span className="text-emerald-400">●</span>
              Bankroll checks out · <NumB value={stillIn} size="text-[11px]" className="inline-flex" /> still in play
            </>
          )}
        </div>
      </div>

      {/* Add late player — same shared roster as Create Game: tap a chip to
          add instantly, or switch to "Someone new" for free-text + mandatory
          phone (which also saves them to the roster for next time). */}
      <div className="px-5 mt-4">
        {addingPlayer ? (
          <div className="bg-felt-surface border border-felt-border rounded-2xl p-3.5">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">Add late player</div>
              <button onClick={() => { setAddingPlayer(false); setAddMode("roster"); setNewName(""); setNewPhone("") }}
                className="w-6 h-6 rounded-lg bg-felt-surface-2 border border-felt-border flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex gap-1.5 mb-3">
              {["roster", "new"].map(m => (
                <button key={m} onClick={() => setAddMode(m)}
                  className={cn(
                    "flex-1 h-8 rounded-lg text-xs font-bold transition-colors",
                    addMode === m ? "bg-gold text-white" : "bg-felt-surface-2 text-zinc-400 hover:text-zinc-200"
                  )}>
                  {m === "roster" ? "Your players" : "Someone new"}
                </button>
              ))}
            </div>

            {addMode === "roster" && (
              notInGameRoster.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {notInGameRoster.map(r => (
                    <button key={r.name} onClick={() => addFromRoster(r)}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-transparent hover:bg-felt-surface-2 border border-dashed border-felt-border hover:border-zinc-600 text-zinc-400 hover:text-white rounded-full text-xs font-medium transition-all">
                      <span className="text-gold-light font-bold">+</span> {r.name}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-center py-3 text-zinc-700 text-xs font-medium">
                  Everyone in your roster is already in this game
                </div>
              )
            )}

            {addMode === "new" && (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  className="w-full h-10 bg-felt-surface-2 border border-felt-border rounded-xl px-3.5 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-gold transition-all"
                  placeholder="Player's name…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
                <input
                  className="w-full h-10 bg-felt-surface-2 border border-felt-border rounded-xl px-3.5 text-zinc-100 text-sm placeholder:text-zinc-600 outline-none focus:border-gold transition-all"
                  placeholder="Phone number (required)…"
                  type="tel"
                  value={newPhone}
                  onChange={e => setNewPhone(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addNewPlayer()}
                />
                {newName.trim() && !newPhone.trim() && (
                  <div className="text-[10.5px] text-amber-500 font-medium">Phone number is required to add a player</div>
                )}
                <button
                  disabled={!newName.trim() || !newPhone.trim()}
                  onClick={addNewPlayer}
                  className="w-full h-10 bg-gold hover:bg-gold disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-xl transition-colors"
                >
                  Add to game
                </button>
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => setAddingPlayer(true)}
            className="w-full h-11 bg-felt-surface border border-felt-border hover:border-felt-border rounded-xl text-zinc-400 hover:text-zinc-200 text-sm font-semibold transition-colors">
            + Add late player
          </button>
        )}
      </div>

      {/* Players list — plain rows, tap opens the sheet */}
      <SL>Players · tap any to open</SL>

      {players.length === 0 && (
        <div className="text-center py-8 text-zinc-700 text-sm">Add players above to start tracking</div>
      )}

      <div className="px-5 flex flex-col gap-2">
        {players.map((p) => {
          const tIn = totalBuyinsFor(p)
          const net = p.cashedOut ? (p.cashoutAmount - tIn) : null
          const locked = lockedCountFor(p)
          const allLocked = p.buyins.length > 0 && locked === p.buyins.length
          const hasLocked = !p.cashedOut && locked > 0
          // Status dot: locked/unlocked reflects the buy-in lock state, kept
          // distinct from cashed-out/settled (which is its own visual —
          // dimmed row + net figure — not conflated with this dot).
          const dotColor = p.cashedOut ? (net >= 0 ? "emerald" : "red") : allLocked ? "zinc" : "indigo"
          return (
            <div
              key={p.name}
              className={cn(
                "flex items-center gap-3 bg-felt-surface border border-felt-border rounded-2xl px-3.5 py-3 transition-opacity",
                p.cashedOut && "opacity-55"
              )}
            >
              <button onClick={() => openSheet(p)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <Av name={p.name} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-zinc-100">{p.name}</div>
                  <div className="text-[10.5px] text-zinc-600 mt-0.5 font-mono">
                    {p.buyins.length} buy-in{p.buyins.length === 1 ? "" : "s"}
                    {p.cashedOut ? " · cashed out" : hasLocked ? " · locked" : ""}
                  </div>
                </div>
                {p.cashedOut ? (
                  <NumB value={net} sign size="text-[17px]" className={net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-500"} />
                ) : (
                  <NumB value={tIn} size="text-[17px]" className="text-white" />
                )}
                <Dot color={dotColor} />
              </button>
              {p.cashedOut && (
                <button
                  onClick={(e) => { e.stopPropagation(); sendCashoutDetails(p) }}
                  title="Send cash-out details"
                  className="w-8 h-8 rounded-lg bg-felt-surface-2 border border-felt-border flex items-center justify-center text-zinc-500 hover:text-emerald-300 hover:border-emerald-500/40 transition-colors shrink-0"
                >
                  <Share2 className="w-3.5 h-3.5" />
                </button>
              )}
              {/* Remove player — only ever valid before any buy-in exists for
                  them (fixes an accidental add). Once a buy-in is recorded,
                  removal isn't a valid action any more, so it's genuinely
                  absent, not disabled-with-tooltip. */}
              {!isClosed && totalBuyinsFor(p) === 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); removePlayer(p) }}
                  title="Remove player (no buy-ins yet)"
                  className="w-8 h-8 rounded-lg bg-felt-surface-2 border border-felt-border flex items-center justify-center text-zinc-500 hover:text-red-300 hover:border-red-500/40 transition-colors shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {players.length > 0 && !isClosed && (
        <div className="px-5 mt-5">
          <button
            disabled={overpayError}
            onClick={() => setShowEnd(true)}
            className="w-full h-12 bg-red-600/80 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed border border-red-500/30 text-white font-bold rounded-xl text-sm transition-colors"
          >
            End Game & Settle
          </button>
          {overpayError && (
            <div className="text-[11px] text-red-300/90 text-center mt-2 leading-relaxed">
              Can't close while paid out exceeds total buy-ins — fix the entries above first.
            </div>
          )}
        </div>
      )}

      {showEnd && <EndGameModal game={game} onConfirm={handleEndGame} onClose={() => setShowEnd(false)} />}

      {/* Buy-in / Cash-out bottom sheet — buy-in is primary; cash-out is a
          small toggle below it, revealing the keypad inline when switched on. */}
      <AppSheet
        open={!!sheetFor}
        onClose={closeSheet}
        title={sheetPlayer?.name}
        subtitle={sheetPlayer ? `${sheetPlayer.buyins.length} buy-in${sheetPlayer.buyins.length === 1 ? "" : "s"} at the table` : ""}
        avatar={sheetPlayer && <Av name={sheetPlayer.name} size={36} />}
      >
        {sheetPlayer && (
          <div className="flex flex-col gap-3.5">
            {isClosed && (
              <div className="text-center text-[10.5px] text-zinc-600 -mt-1 mb-0.5">
                Game closed — figures are final and read-only
              </div>
            )}

            {!cashoutOn && (
              <>
                <div className="text-center pt-1 pb-0.5">
                  <div className="flex items-center justify-center gap-2">
                    <div className="font-mono text-[40px] font-extrabold tracking-tight text-white leading-none">{sliderVal}</div>
                    <Dot color="indigo" className="mt-3" />
                  </div>
                  <div className="text-[10.5px] font-bold tracking-wider uppercase text-zinc-600 mt-1">
                    buy-in{sliderVal === 1 ? "" : "s"} · <NumB value={sliderVal * game.buyinAmount} size="text-[11px]" className="text-zinc-400 inline-flex" />
                  </div>
                </div>
                {!isClosed && (
                  <>
                    <BuyinSlider value={sliderVal} onChange={setSliderVal} min={lockedCountFor(sheetPlayer)} />
                    <div className="text-center text-[11px] text-zinc-600">
                      Locks in <b className="text-zinc-400 font-semibold">1 min</b> — once locked it's permanent, no override
                    </div>
                    <button onClick={confirmBuyins} className="w-full h-12 bg-gold hover:bg-gold text-white font-bold rounded-xl text-sm transition-colors">
                      Confirm {sliderVal} buy-in{sliderVal === 1 ? "" : "s"}
                    </button>
                  </>
                )}
              </>
            )}

            {/* Cash-out: rare, one-time end-of-game action — a small toggle,
                not a peer tab of buy-in. Once switched on, buy-ins for this
                player are locked — no more can be added while cashing out.
                Cash-out (and rake) stay editable until the game closes;
                after close this whole sheet renders read-only. */}
            <div className="flex items-center justify-between bg-felt-surface-2/50 border border-felt-border rounded-xl px-3.5 py-2.5 mt-1">
              <span className="text-xs font-bold text-zinc-300">Cash out this player</span>
              <Switch checked={cashoutOn} onCheckedChange={setCashoutOn} disabled={isClosed} />
            </div>

            {cashoutOn && (
              <div className="flex flex-col gap-3.5">
                <div className="text-center text-[11px] text-zinc-500">
                  {sheetPlayerIn === 0 ? "no" : sheetPlayer.buyins.length} buy-in{sheetPlayer.buyins.length === 1 ? "" : "s"} · <NumB value={sheetPlayerIn} size="text-[11px]" className="text-zinc-400 inline-flex" /> in — locked while cashing out
                </div>
                <div className="text-center pt-1 pb-0.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600 mb-1">Cashing out</div>
                  <NumB value={cashoutEntered} size="text-[40px]" className="text-white justify-center" />
                </div>
                <div className="text-center text-[11.5px] font-mono -mt-1.5">
                  net <NumB value={cashoutNet} sign size="text-[11.5px]" className={cn("inline-flex", cashoutNet >= 0 ? "text-emerald-400" : "text-red-400")} />
                </div>
                {!isClosed && (
                  <>
                    <Keypad
                      onDigit={(d) => setCashoutDigits(prev => (prev === "0" ? "" : prev) + d)}
                      onBackspace={() => setCashoutDigits(prev => prev.slice(0, -1))}
                      onClear={() => setCashoutDigits("")}
                    />
                    <button onClick={confirmCashout} className="w-full h-12 bg-gold hover:bg-gold text-white font-bold rounded-xl text-sm transition-colors">
                      {sheetPlayer.cashedOut ? "Update cash out" : "Confirm cash out"}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </AppSheet>
    </div>
  )
}

// ─── Settlement ───────────────────────────────────────────────────────────────
function SettlementScreen({ game, onClose, onBack, showToast }) {
  const [settled, setSettled]       = useState({})
  const [customTxns, setCustomTxns] = useState([])
  const [sheetTxn, setSheetTxn]     = useState(null) // { key, from, to, amount, isNew }
  const [sheetFrom, setSheetFrom]   = useState("")
  const [sheetTo, setSheetTo]       = useState("")
  const [sheetDigits, setSheetDigits] = useState("")

  const players = game.players
  const rake    = game.rake || 0
  const totalIn  = players.reduce((s, p) => s + totalBuyinsFor(p), 0)
  const totalOut = players.reduce((s, p) => s + (p.cashoutAmount || 0), 0)
  // Same invariant as EndGameModal: sum(buy-ins) = sum(cash-outs) + rake.
  const delta    = totalIn - (totalOut + rake)
  const balanced = Math.abs(delta) < BALANCE_TOLERANCE

  const positions = players.map(p => ({
    name: p.name,
    net: Math.round((p.cashoutAmount || 0) - totalBuyinsFor(p)),
  }))

  const baseTxns = computeSettlement(players)

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

  const openEdit = (t) => {
    setSheetTxn(t)
    setSheetFrom(t.from)
    setSheetTo(t.to)
    setSheetDigits(t.amount ? String(Math.round(t.amount / 1000)) : "")
  }
  const openAdd = () => {
    setSheetTxn({ key: `custom-${customTxns.length}`, isNew: true })
    setSheetFrom(""); setSheetTo(""); setSheetDigits("")
  }
  const closeSheet = () => setSheetTxn(null)

  const saveSheet = () => {
    const amt = (parseInt(sheetDigits || "0", 10)) * 1000
    if (!sheetFrom || !sheetTo || amt <= 0) { showToast("⚠️", "Invalid", "Pick From, To and an amount"); return }
    if (sheetTxn.isNew) {
      setCustomTxns(prev => [...prev, { key: sheetTxn.key, from: sheetFrom, to: sheetTo, amount: amt, isAuto: false }])
    } else if (sheetTxn.key.startsWith("auto-")) {
      setOverrides(prev => ({ ...prev, [sheetTxn.key]: { from: sheetFrom, to: sheetTo, amount: amt } }))
    } else {
      setCustomTxns(prev => prev.map(t => t.key === sheetTxn.key ? { ...t, from: sheetFrom, to: sheetTo, amount: amt } : t))
    }
    closeSheet()
  }

  const removeSheet = () => {
    if (!sheetTxn.isNew && !sheetTxn.key.startsWith("auto-")) {
      setCustomTxns(prev => prev.filter(t => t.key !== sheetTxn.key))
    } else if (!sheetTxn.isNew) {
      // remove an auto-computed transfer entirely (e.g. already settled in cash)
      setOverrides(prev => ({ ...prev, [sheetTxn.key]: { from: sheetTxn.from, to: sheetTxn.to, amount: 0, removed: true } }))
    }
    closeSheet()
  }

  // No deep links (WhatsApp, SMS, etc.) — copy to clipboard only, per the
  // app-wide no-deep-links interaction principle. The host pastes this
  // wherever they actually want to send it.
  const copySettlement = async () => {
    const lines = [
      `🃏 ${game.name} — ${game.date}`,
      ``,
      `Settle Up (${allTxns.length} payments):`,
      ...allTxns.map(t => `• ${t.from} → ${t.to}: ${fmtB(t.amount)}`),
      ...(allTxns.length === 0 ? ["• Everyone's even!"] : []),
      ``,
      `Pot: ${fmtB(totalIn)}${rake > 0 ? ` · Rake: ${fmtB(rake)}` : ""} · Out: ${fmtB(totalOut)}`,
    ]
    const text = lines.join("\n")
    try {
      await navigator.clipboard.writeText(text)
      showToast("📋", "Copied", "Settlement summary ready to paste")
    } catch {
      showToast("📋", "Settlement summary", text)
    }
  }

  const medals = ["🥇", "🥈", "🥉"]
  const visibleTxns = allTxns.filter(t => !(overrides[t.key]?.removed))

  return (
    <div className="min-h-screen bg-felt-bg pb-8">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-6 border-b border-felt-border overflow-hidden">
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
            {[`${fmtB(totalIn)} pot`, rake > 0 ? `${fmtB(rake)} rake` : null, `${players.length} players`, `${visibleTxns.length} payments`].filter(Boolean).map(s => (
              <span key={s} className="text-[10px] font-bold text-zinc-500 bg-felt-surface border border-felt-border rounded-full px-3 py-1">{s}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Balance */}
      <div className={cn("flex items-center gap-3 px-5 py-3 border-b", balanced ? "bg-emerald-500/5 border-emerald-500/10" : "bg-red-500/5 border-red-500/10")}>
        {balanced ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />}
        <span className={cn("text-sm font-semibold", balanced ? "text-emerald-400" : "text-red-400")}>
          {balanced ? "All accounts balanced" : `Buy-ins and cash-outs don't add up — off by ${fmtB(Math.abs(delta))}. Go back to check entries before settling.`}
        </span>
      </div>

      {/* Leaderboard */}
      <SL>Results</SL>
      <div className="px-5 flex flex-col gap-2 mb-2">
        {positions.slice().sort((a, b) => b.net - a.net).map((pos, rank) => {
          const p = players.find(x => x.name === pos.name)
          return (
            <div key={pos.name} className={cn(
              "bg-felt-surface border rounded-xl px-4 py-3 flex items-center gap-3 border-l-2",
              pos.net > 0 ? "border-l-emerald-500 border-felt-border" : pos.net < 0 ? "border-l-red-500 border-felt-border" : "border-felt-border"
            )}>
              <div className="text-xl w-7 text-center shrink-0">{rank < 3 ? medals[rank] : `#${rank + 1}`}</div>
              <Av name={pos.name} size={32} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-zinc-100 text-sm">{pos.name}</div>
                <div className="text-xs text-zinc-600 font-mono mt-0.5">In {fmtB(totalBuyinsFor(p))} · Out {fmtB(p.cashoutAmount || 0)}</div>
              </div>
              <NumB value={pos.net} sign size="text-sm" className={pos.net > 0 ? "text-emerald-400" : pos.net < 0 ? "text-red-400" : "text-zinc-500"} />
            </div>
          )
        })}
      </div>

      {/* Payments — tap any to open the edit sheet */}
      <SL>Payments — {visibleTxns.length}</SL>

      {visibleTxns.length === 0 ? (
        <div className="text-center py-8 text-zinc-600 text-sm">🎉 Everyone is even</div>
      ) : (
        <div className="px-5 flex flex-col gap-2.5 mb-3">
          {visibleTxns.map(t => {
            const done = settled[t.key]
            return (
              <div key={t.key} className={cn("flex items-center gap-3 bg-felt-surface border border-felt-border rounded-2xl px-3.5 py-3 transition-opacity", done && "opacity-50")}>
                <button onClick={() => openEdit(t)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-zinc-100 flex items-center gap-1.5 truncate">
                      {t.from} <span className="text-zinc-600">→</span> {t.to}
                    </div>
                    <div className="text-[10px] text-zinc-600 font-mono mt-0.5">{!t.isAuto ? "custom" : done ? "settled" : "not yet paid"}</div>
                  </div>
                  <NumB value={t.amount} size="text-[14.5px]" className="text-white shrink-0" />
                </button>
                <span className={cn(
                  "text-[9.5px] font-extrabold px-2 py-0.5 rounded-md tracking-wide shrink-0",
                  done ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                )}>
                  {done ? "PAID" : "DUE"}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {/* Progress */}
      {visibleTxns.length > 0 && (
        <div className="px-5 mb-4">
          <div className="flex items-center gap-3 bg-felt-surface border border-felt-border rounded-xl px-4 py-3">
            <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-wider">Settled</span>
            <Progress value={visibleTxns.length ? (settledCount / visibleTxns.length) * 100 : 0} className="flex-1 bg-felt-surface-2" indicatorClassName="bg-emerald-500" />
            <span className="font-mono text-sm font-bold text-emerald-400">{settledCount}/{visibleTxns.length}</span>
          </div>
        </div>
      )}

      <div className="px-5 mb-4">
        <button onClick={openAdd}
          className="w-full border border-dashed border-felt-border hover:border-felt-border hover:bg-felt-surface/50 rounded-xl py-3 text-sm text-zinc-700 hover:text-zinc-500 font-medium transition-all flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Add Custom Payment
        </button>
      </div>

      {/* Actions */}
      <div className="px-5 flex flex-col gap-3">
        <button onClick={copySettlement}
          className="w-full h-12 bg-gold hover:bg-gold text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
          <Share2 className="w-4 h-4" /> Copy settlement summary
        </button>
        <button onClick={() => onClose(visibleTxns.map(({ from, to, amount }) => ({ from, to, amount })))}
          className="w-full h-12 bg-felt-surface-2 hover:bg-zinc-700 border border-felt-border text-zinc-200 font-bold rounded-xl text-sm transition-colors">
          Save to History & Close
        </button>
      </div>

      {/* Edit / add payment sheet */}
      <AppSheet
        open={!!sheetTxn}
        onClose={closeSheet}
        title={sheetTxn?.isNew ? "Add payment" : "Edit payment"}
        subtitle={sheetTxn && !sheetTxn.isNew ? `was ${sheetTxn.from} → ${sheetTxn.to}` : undefined}
      >
        {sheetTxn && (
          <div className="flex flex-col gap-1">
            <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500 mb-1.5">From</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {players.map(p => (
                <button key={p.name} onClick={() => setSheetFrom(p.name)}
                  className={cn(
                    "text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors",
                    sheetFrom === p.name ? "bg-gold/15 border-gold/40 text-gold-light" : "bg-felt-surface-2/70 border-felt-border text-zinc-400 hover:text-zinc-200"
                  )}>
                  {p.name}
                </button>
              ))}
            </div>

            <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500 mb-1.5">To</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {players.map(p => (
                <button key={p.name} onClick={() => setSheetTo(p.name)}
                  className={cn(
                    "text-[11px] font-semibold px-2.5 py-1.5 rounded-full border transition-colors",
                    sheetTo === p.name ? "bg-gold/15 border-gold/40 text-gold-light" : "bg-felt-surface-2/70 border-felt-border text-zinc-400 hover:text-zinc-200"
                  )}>
                  {p.name}
                </button>
              ))}
            </div>

            <div className="text-[10px] font-bold tracking-[0.15em] uppercase text-zinc-500 mb-1.5">Amount</div>
            <div className="bg-felt-surface-2/60 border border-felt-border rounded-2xl px-4 py-3 text-right mb-3">
              <NumB value={(parseInt(sheetDigits || "0", 10)) * 1000} size="text-[26px]" className="text-white justify-end" />
            </div>

            <Keypad
              onDigit={(d) => setSheetDigits(prev => (prev === "0" ? "" : prev) + d)}
              onBackspace={() => setSheetDigits(prev => prev.slice(0, -1))}
              onClear={() => setSheetDigits("")}
            />

            <div className="grid grid-cols-2 gap-2.5 mt-3">
              <button onClick={removeSheet} className="h-11 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 font-bold text-sm transition-colors hover:bg-red-500/15">
                Remove
              </button>
              <button onClick={saveSheet} className="h-11 rounded-xl bg-gold hover:bg-gold text-white font-bold text-sm transition-colors">
                Save
              </button>
            </div>
          </div>
        )}
      </AppSheet>
    </div>
  )
}

// ─── History ──────────────────────────────────────────────────────────────────

// ─── Game Detail ──────────────────────────────────────────────────────────────
// Role-aware: the host who ran this game sees the full breakdown (every
// player, total pot, rake). A viewer who only played in it — not the host —
// sees just their own buy-in/cash-out, nothing about anyone else's numbers.
function GameDetailScreen({ game, viewerName, onBack, onNavigateLive }) {
  const [rakeVisible, setRakeVisible] = useState(false)
  const isHost = !game.hostName || game.hostName === viewerName
  const totalIn  = game.players.reduce((s, p) => s + totalBuyinsFor(p), 0)
  const totalOut = game.players.reduce((s, p) => s + (p.cashoutAmount || 0), 0)
  const rake     = game.rake || 0

  if (!isHost) {
    const me = game.players.find(p => p.name === viewerName)
    const myIn = me ? totalBuyinsFor(me) : 0
    const myOut = me?.cashoutAmount || 0
    const myNet = myOut - myIn
    return (
      <div className="min-h-screen bg-felt-bg pb-8">
        <div className="relative px-5 pt-14 pb-6 border-b border-felt-border overflow-hidden">
          <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 text-sm mb-5 transition-colors">
            <X className="w-4 h-4" /> Back
          </button>
          <div className="text-white text-xl font-bold">{game.name}</div>
          <div className="text-zinc-500 text-sm mt-1">{game.date} · hosted by {game.hostName}</div>
        </div>
        <div className="px-5 pt-5 flex flex-col gap-2.5">
          <div className="bg-felt-surface border border-felt-border rounded-2xl p-4 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Your buy-ins</div>
            <NumB value={myIn} size="text-lg" className="text-white" />
          </div>
          <div className="bg-felt-surface border border-felt-border rounded-2xl p-4 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Your cash-out</div>
            <NumB value={myOut} size="text-lg" className="text-white" />
          </div>
          <div className="bg-felt-surface border border-felt-border rounded-2xl p-4 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-600">Your net</div>
            <NumB value={myNet} sign size="text-xl" className={myNet >= 0 ? "text-emerald-400" : "text-red-400"} />
          </div>
        </div>
      </div>
    )
  }
  const positions = game.players.map(p => ({ name: p.name, net: Math.round((p.cashoutAmount || 0) - totalBuyinsFor(p)) }))
  // A closed game's settlement was computed once at close time and stored —
  // it's read here, never recomputed, so history can't drift even if the
  // settlement logic changes later. A still-live game (viewed via its
  // in-progress card) computes a live preview instead.
  const isClosed = game.status === "closed"
  const txns = isClosed && game.settlement ? game.settlement : computeSettlement(game.players)
  const medals = ["🥇", "🥈", "🥉"]

  return (
    <div className="min-h-screen bg-felt-bg pb-8">
      <div className="relative px-5 pt-14 pb-6 border-b border-felt-border overflow-hidden">
        <div className="relative z-10">
          <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-600 hover:text-zinc-300 text-sm mb-5 transition-colors">
            <X className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-2">
            <div className="text-white text-xl font-bold">{game.name}</div>
            {isClosed ? (
              <span className="text-[9.5px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-md bg-felt-surface-2 text-zinc-400 border border-felt-border">Closed</span>
            ) : (
              <span className="text-[9.5px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-blink" /> Game in progress
              </span>
            )}
          </div>
          <div className="text-zinc-500 text-sm mt-1">{game.date} · {game.players.length} players</div>
          {!isClosed && (
            <button onClick={() => onNavigateLive?.()} className="mt-2 text-[11.5px] font-semibold text-gold-light hover:text-gold-light/80 transition-colors">
              Go to Live Game →
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-4 grid grid-cols-3 gap-2.5">
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">Pot</div>
          <NumB value={totalIn} size="text-[17px]" className="mt-1 text-white" />
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">Players</div>
          <div className="mt-1 text-[17px] font-extrabold text-white">{game.players.length}</div>
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-600">Rake</div>
            <button onClick={() => setRakeVisible(v => !v)} className="w-5 h-5 rounded-md bg-felt-surface-2 border border-felt-border flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors shrink-0">
              <span className="text-[9px]">◐</span>
            </button>
          </div>
          {rakeVisible ? (
            <NumB value={rake} size="text-[17px]" className="mt-1 text-amber-400" />
          ) : (
            <div className="mt-1 text-[17px] font-extrabold tracking-[0.15em] text-amber-500/70">•••</div>
          )}
        </div>
      </div>

      <SL>Results</SL>
      <div className="px-5 flex flex-col gap-2 mb-2">
        {positions.slice().sort((a, b) => b.net - a.net).map((pos, rank) => {
          const p = game.players.find(x => x.name === pos.name)
          return (
            <div key={pos.name} className={cn("bg-felt-surface border rounded-xl px-4 py-3 flex items-center gap-3 border-l-2", pos.net > 0 ? "border-l-emerald-500 border-felt-border" : pos.net < 0 ? "border-l-red-500 border-felt-border" : "border-felt-border")}>
              <div className="text-lg w-6 text-center shrink-0">{rank < 3 ? medals[rank] : `#${rank + 1}`}</div>
              <Av name={pos.name} size={30} />
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-zinc-200 text-sm">{pos.name}</div>
                <div className="text-xs text-zinc-600 font-mono">In {fmtB(totalBuyinsFor(p))} · Out {fmtB(p.cashoutAmount || 0)}</div>
              </div>
              <NumB value={pos.net} sign size="text-sm" className={pos.net > 0 ? "text-emerald-400" : pos.net < 0 ? "text-red-400" : "text-zinc-500"} />
            </div>
          )
        })}
      </div>

      <SL>Payments — {txns.length}</SL>
      {txns.length === 0 ? <div className="text-center py-6 text-zinc-600 text-sm">Everyone was even</div> : (
        <div className="px-5 flex flex-col gap-2">
          {txns.map((t, i) => (
            <div key={i} className="bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex items-center gap-3">
              <Av name={t.from} size={28} />
              <span className="text-sm font-semibold text-red-400">{t.from}</span>
              <ChevronsRight className="w-4 h-4 text-zinc-700 shrink-0" />
              <NumB value={t.amount} size="text-sm" className="text-amber-400 flex-1" />
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
  ].filter(Boolean)

  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[430px] sm:max-w-xl md:max-w-2xl z-40 px-3 sm:px-5 pb-5">
      <div className="bg-felt-surface/95 backdrop-blur-xl border border-felt-border rounded-2xl px-2 py-2 flex items-center shadow-2xl shadow-black/50">
        {items.map(item => {
          const Icon = item.icon
          const active = screen === item.id
          return (
            <button key={item.id} onClick={() => onNavigate(item.id)}
              className={cn("flex-1 flex flex-col items-center gap-1.5 py-2 rounded-xl transition-all", active ? "bg-gold" : "text-zinc-600 hover:text-zinc-400")}>
              <div className="relative">
                <Icon className={cn("w-5 h-5", active ? "text-white" : "")} />
                {item.live && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-500 border-2 border-felt-border" />}
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

  // Shared roster — single source of truth for "Your players", used by both
  // CreateGameScreen and LiveGameScreen's "Add late player" flow. Lifted to
  // App root so both screens read/write the same list. Seeded from
  // pastGames only if localStorage is empty (see src/lib/roster.js).
  const [roster, setRoster] = useState(() => loadRoster(SEED_PAST_GAMES))
  const addToRoster = (name, phone) => setRoster(prev => upsertRoster(prev, name, phone))

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
    setActiveGame({ ...game, hostName }); setUndoStack([]); navigate("live-game")
    showToast("🃏", "Game Started", game.name)
  }

  // The true "close" action: locks the game permanently (all buy-ins,
  // cash-outs, and rake for it become immutable) and stores the settlement
  // transfer list computed once here — closed games are never recomputed
  // live again, so history can't drift even if the settlement logic changes.
  const handleCloseGame = (settlement) => {
    if (activeGame) {
      setPastGames(prev => [{ ...activeGame, id: Date.now(), status: "closed", settlement: settlement || [] }, ...prev])
      setActiveGame(null)
      setUndoStack([])
    }
    setScreen("home")
    showToast("🏁", "Saved", "Results added to your dashboard")
  }

  const isFullScreen = ["create-game", "settlement", "game-detail", "admin"].includes(screen)

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-felt-bg">
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
    <div className="w-full max-w-[430px] sm:max-w-xl md:max-w-2xl min-h-screen bg-felt-bg mx-auto relative sm:px-2">
      {screen === "home"        && <HomeScreen hostName={hostName} activeGame={activeGame} pastGames={pastGames} onNavigate={navigate} onLogout={logout} isAdmin={isAdmin} />}
      {screen === "create-game" && <CreateGameScreen pastGames={pastGames} roster={roster} addToRoster={addToRoster} onCancel={() => navigate("home")} onCreate={handleCreateGame} />}
      {screen === "live-game" && activeGame && <LiveGameScreen game={activeGame} onUpdateGame={updateGamePlayers} undoStack={undoStack} onUndo={handleUndo} onNavigate={navigate} showToast={showToast} roster={roster} addToRoster={addToRoster} />}
      {screen === "settlement" && activeGame && <SettlementScreen game={activeGame} onClose={handleCloseGame} onBack={() => navigate("live-game")} showToast={showToast} />}
      {screen === "game-detail" && selGame && <GameDetailScreen game={selGame} viewerName={hostName} onBack={() => navigate("home")} onNavigateLive={() => navigate("live-game")} />}
      {!isFullScreen && <BottomNav screen={screen} onNavigate={navigate} showLive={!!activeGame} />}
      <Toast toast={toast} />
    </div>
  )
}
