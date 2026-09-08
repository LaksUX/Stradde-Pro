import { useState, useRef, useEffect } from "react"
import {
  Plus, Minus, ChevronDown, ChevronUp, ArrowRight,
  Trophy, Clock, Users, User, TrendingUp, TrendingDown, Edit3, Check,
  Share2, X, LayoutDashboard, Gamepad2, RotateCcw,
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
import * as knownPlayersApi from "@/lib/knownPlayersApi"
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 1] Game data now lives in
// Supabase, not localStorage — src/lib/gameStore.js and the paid-status
// migration shim in src/lib/settlementStatus.js are retired from the app's
// runtime path as of this wiring (gameStore.js itself is left in the repo
// only as a reference for the interim design it replaced; nothing imports
// it any more). Roster (src/lib/roster.js) is retired the same way, as of
// this pass — src/lib/knownPlayersApi.js is what the app actually calls now;
// roster.js is left in the repo only as a reference, nothing imports it.
import * as gamesApi from "@/lib/gamesApi"
// [decision, Phase 0 of docs/MOBILE_MIGRATION_PLAN.md] Money math and
// settlement logic live in src/core — dependency-free, tested, and meant to
// be reused unchanged by the future React Native rebuild. Don't re-add a
// local copy of any of these here; import from core instead, same as the
// tests do.
import { BANK, fmtBankNum, fmtB, fmtNet, computeBankroll } from "@/core/money"
import { totalBuyinsFor, lockedCountFor, computeSettlement } from "@/core/settlement"

// ─── Helpers ──────────────────────────────────────────────────────────────────
const nowStr = () => {
  const d = new Date()
  let h = d.getHours(), m = d.getMinutes()
  const ap = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, "0")} ${ap}`
}

// ─── Bank-unit number display: bold bright number + small muted unit ──────────
function NumB({ value, sign = false, size = "text-sm", className }) {
  const bankCount = Math.abs(value) / 10000
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
    <div className="grid grid-cols-3 gap-2.5">
      {keys.map(k => (
        <button
          key={k}
          onClick={() => k === "⌫" ? onBackspace() : k === "C" ? onClear() : onDigit(k)}
          className={cn(
            "h-14 rounded-2xl flex items-center justify-center text-lg font-bold font-mono transition-all active:scale-95",
            (k === "⌫" || k === "C")
              ? "bg-felt-surface-3 text-zinc-200 hover:bg-felt-surface-4"
              : "bg-felt-surface-2 border border-felt-border text-zinc-100 hover:bg-felt-surface-3"
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
// count — locked buy-ins (confirmed by a past bank check) can never be removed.
// Once EVERY current buy-in is locked (value === min, i.e. no unlocked room
// left to add or remove), the slider becomes fully non-interactive rather
// than just floored-but-still-draggable — a locked state should read as
// genuinely locked, not merely clamped. It re-enables the moment a fresh
// unlocked buy-in exists (value > min).
function BuyinSlider({ value, onChange, max = 30, min = 0 }) {
  // `min` floors the draggable range at the player's already-locked buy-in
  // count — locked entries can never be dragged away. The slider itself
  // must stay fully interactive above that floor: a host can always add
  // MORE buy-ins regardless of how many past ones are locked. Only the
  // downward direction below `min` is blocked, never the whole control.
  const allLocked = min > 0 && value === min
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
          onValueChange={([v]) => onChange(Math.max(min, v))}
        />
      </div>
      <div className="flex justify-between mt-2 px-0.5">
        {[0,5,10,15,20,25,30].map(t => (
          <span key={t} className="text-[10px] font-mono text-zinc-400">{t}</span>
        ))}
      </div>
      {min > 0 && (
        <div className="text-center text-[10.5px] text-zinc-400 mt-1.5">
          {allLocked
            ? "All buy-ins so far are locked — drag right to add more"
            : `First ${min} locked — can't go below that`}
        </div>
      )}
    </div>
  )
}

// ─── Small status dot (replaces text pills/badges for in-play/settled state) ──
function Dot({ color, className }) {
  const map = {
    indigo: "bg-gold-vivid shadow-[0_0_7px_rgba(227,167,28,0.8)]",
    emerald: "bg-emerald-400 shadow-[0_0_7px_rgba(52,211,153,0.8)]",
    red: "bg-red-400 shadow-[0_0_7px_rgba(248,113,113,0.8)]",
    zinc: "bg-felt-outline",
  }
  return <span className={cn("w-2.5 h-2.5 rounded-full shrink-0", map[color] || map.zinc, className)} />
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
    id: 1, name: "Friday Night Felts", date: "Sep 5", hostName: "Laks",
    buyinAmount: BANK, rake: 10000, status: "closed",
    players: [
      { name: "Laks", buyins: [{ts:"8:00 PM",amount:10000},{ts:"8:50 PM",amount:10000},{ts:"9:40 PM",amount:10000}], cashedOut: true, cashoutAmount: 55000 },
      { name: "Raj K.", buyins: [{ts:"8:00 PM",amount:10000},{ts:"9:15 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
      { name: "Priya S.", buyins: [{ts:"8:00 PM",amount:10000},{ts:"8:45 PM",amount:10000}], cashedOut: true, cashoutAmount: 40000 },
      { name: "Arjun M.", buyins: [{ts:"8:00 PM",amount:10000},{ts:"8:30 PM",amount:10000},{ts:"9:10 PM",amount:10000}], cashedOut: true, cashoutAmount: 0 },
      { name: "Neha R.", buyins: [{ts:"8:00 PM",amount:10000},{ts:"9:30 PM",amount:10000}], cashedOut: true, cashoutAmount: 15000 },
      { name: "Dev P.", buyins: [{ts:"8:00 PM",amount:10000},{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
      { name: "Sana T.", buyins: [{ts:"8:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
    ],
    settlement: [
      { from: "Arjun M.", to: "Laks", amount: 25000 },
      { from: "Arjun M.", to: "Priya S.", amount: 5000 },
      { from: "Dev P.", to: "Priya S.", amount: 10000 },
      { from: "Raj K.", to: "Priya S.", amount: 5000 },
    ],
  },
  {
    id: 2, name: "Saturday Shootout", date: "Aug 29", hostName: "Laks",
    buyinAmount: BANK, rake: 0, status: "closed",
    players: [
      { name: "Laks", buyins: [{ts:"7:30 PM",amount:10000},{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 5000 },
      { name: "Raj K.", buyins: [{ts:"7:30 PM",amount:10000}], cashedOut: true, cashoutAmount: 30000 },
      { name: "Priya S.", buyins: [{ts:"7:30 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
      { name: "Arjun M.", buyins: [{ts:"7:30 PM",amount:10000},{ts:"8:50 PM",amount:10000}], cashedOut: true, cashoutAmount: 20000 },
      { name: "Neha R.", buyins: [{ts:"7:30 PM",amount:10000}], cashedOut: true, cashoutAmount: 5000 },
    ],
    settlement: [
      { from: "Laks", to: "Raj K.", amount: 15000 },
      { from: "Neha R.", to: "Raj K.", amount: 5000 },
    ],
  },
  {
    id: 3, name: "Sunday Deep Stack", date: "Aug 23", hostName: "Laks",
    buyinAmount: BANK, rake: 20000, status: "closed",
    players: [
      { name: "Laks", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:30 PM",amount:10000},{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 30000 },
      { name: "Raj K.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:30 PM",amount:10000},{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 60000 },
      { name: "Priya S.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 0 },
      { name: "Arjun M.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"8:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
      { name: "Neha R.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:45 PM",amount:10000},{ts:"9:20 PM",amount:10000}], cashedOut: true, cashoutAmount: 20000 },
      { name: "Dev P.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:15 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
    ],
    settlement: [
      { from: "Priya S.", to: "Raj K.", amount: 20000 },
      { from: "Arjun M.", to: "Raj K.", amount: 10000 },
    ],
  },
  {
    id: 4, name: "Midweek Cash Game", date: "Aug 19", hostName: "Laks",
    buyinAmount: BANK, rake: 0, status: "closed",
    players: [
      { name: "Laks", buyins: [{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 20000 },
      { name: "Raj K.", buyins: [{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 20000 },
      { name: "Priya S.", buyins: [{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 0 },
      { name: "Arjun M.", buyins: [{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 0 },
    ],
    settlement: [
      { from: "Arjun M.", to: "Laks", amount: 10000 },
      { from: "Priya S.", to: "Raj K.", amount: 10000 },
    ],
  },
  {
    id: 5, name: "Weekend High Rollers", date: "Aug 9", hostName: "Laks",
    buyinAmount: BANK, rake: 30000, status: "closed",
    players: [
      { name: "Laks", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:00 PM",amount:10000},{ts:"8:00 PM",amount:10000},{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 60000 },
      { name: "Raj K.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:30 PM",amount:10000},{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
      { name: "Priya S.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"8:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 30000 },
      { name: "Arjun M.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"6:45 PM",amount:10000},{ts:"7:45 PM",amount:10000},{ts:"8:45 PM",amount:10000}], cashedOut: true, cashoutAmount: 0 },
      { name: "Neha R.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"8:15 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
      { name: "Dev P.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:15 PM",amount:10000},{ts:"8:30 PM",amount:10000}], cashedOut: true, cashoutAmount: 40000 },
      { name: "Sana T.", buyins: [{ts:"6:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 20000 },
      { name: "Karan B.", buyins: [{ts:"6:00 PM",amount:10000},{ts:"7:30 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
    ],
    settlement: [
      { from: "Arjun M.", to: "Laks", amount: 20000 },
      { from: "Arjun M.", to: "Dev P.", amount: 10000 },
      { from: "Arjun M.", to: "Priya S.", amount: 10000 },
      { from: "Raj K.", to: "Sana T.", amount: 10000 },
    ],
  },
  {
    id: 6, name: "Sana's Home Game", date: "Jul 28", hostName: "Sana T.",
    buyinAmount: BANK, rake: 10000, status: "closed",
    players: [
      { name: "Sana T.", buyins: [{ts:"8:00 PM",amount:10000},{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 30000 },
      { name: "Laks", buyins: [{ts:"8:00 PM",amount:10000},{ts:"9:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 5000 },
      { name: "Priya S.", buyins: [{ts:"8:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
      { name: "Dev P.", buyins: [{ts:"8:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 5000 },
    ],
    settlement: [
      { from: "Laks", to: "Sana T.", amount: 10000 },
    ],
  },
  {
    id: 7, name: "Old-School Friday", date: "Jun 14", hostName: "Laks",
    buyinAmount: BANK, rake: 0, status: "closed",
    players: [
      { name: "Laks", buyins: [{ts:"8:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 15000 },
      { name: "Raj K.", buyins: [{ts:"8:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 10000 },
      { name: "Priya S.", buyins: [{ts:"8:00 PM",amount:10000}], cashedOut: true, cashoutAmount: 5000 },
    ],
    settlement: [
      { from: "Priya S.", to: "Laks", amount: 5000 },
    ],
  },
]

const KNOWN_PLAYERS = [...new Set(SEED_PAST_GAMES.flatMap(g => g.players.map(p => p.name)))]

// ─── Avatar ───────────────────────────────────────────────────────────────────
// [M3 Expressive restyle, 2026-09-08] Switched from a rounded-square
// "squircle" to a fully circular avatar — the direct Android Contacts/Phone
// app cue for identity chips — and bumped default weight/tracking so
// initials read bolder at every size.
function Av({ name, size = 36 }) {
  return (
    <div
      className="rounded-full flex items-center justify-center font-extrabold text-white shrink-0 select-none"
      style={{
        width: size, height: size,
        background: avGrad(name),
        fontSize: size <= 28 ? 10.5 : size <= 38 ? 13 : 15,
        letterSpacing: "0.03em",
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
      <div className="flex items-center gap-3 bg-felt-surface-3 border border-felt-outline text-white px-4.5 py-3.5 rounded-2xl shadow-2xl shadow-black/50 max-w-[320px] sm:max-w-sm">
        <span className="text-xl leading-none">{toast.icon}</span>
        <div>
          <div className="text-sm font-bold text-zinc-100">{toast.title}</div>
          {toast.msg && <div className="text-xs text-zinc-400 mt-0.5">{toast.msg}</div>}
        </div>
      </div>
    </div>
  )
}

// ─── Section label ────────────────────────────────────────────────────────────
function SL({ children, action }) {
  return (
    <div className="flex items-center justify-between px-5 mb-2.5 mt-7">
      <span className="text-[11px] font-extrabold tracking-[0.2em] uppercase text-zinc-400">{children}</span>
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
          <div className="text-[56px] leading-none mb-5">✉️</div>
          <h1 className="text-white text-2xl font-black tracking-tight">Check your email</h1>
          <p className="text-zinc-400 text-sm mt-2 font-medium">
            We sent a magic link to <span className="text-zinc-300">{email}</span>. Open it on this device to sign in.
          </p>
          <button
            onClick={() => setStatus("idle")}
            className="mt-7 h-11 px-5 rounded-full bg-felt-surface-2 border border-felt-border text-gold-light text-sm font-bold hover:bg-felt-surface-3 transition-colors"
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
          <div className="text-[64px] leading-none mb-5">♠</div>
          <h1 className="text-white text-4xl font-black tracking-tight">Poker Night</h1>
          <p className="text-zinc-400 text-base mt-2 font-medium">Sign in with your email</p>
        </div>
        <div className="flex flex-col gap-3">
          <input
            className="w-full h-13 bg-felt-surface-2 border border-felt-border rounded-2xl px-4.5 text-white text-sm font-medium placeholder:text-zinc-400 outline-none focus:border-gold-vivid focus:ring-2 focus:ring-gold-vivid/25 transition-all"
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
            className="w-full h-13 bg-gold hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-full transition-all active:scale-[0.98] text-base"
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
        <div className="text-[56px] leading-none mb-5">⏳</div>
        <h1 className="text-white text-2xl font-black tracking-tight">Pending approval</h1>
        <p className="text-zinc-400 text-sm mt-3 font-medium leading-relaxed">
          Your account is set up. Ask the app admin to approve you as a host to create games.
        </p>
        <button
          onClick={onLogout}
          className="mt-8 w-full h-13 bg-felt-surface-2 border border-felt-border hover:bg-felt-surface-3 text-zinc-200 font-bold rounded-full transition-colors text-sm"
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
            <div className="text-zinc-400 text-xs font-medium mb-1">Admin</div>
            <div className="text-white text-2xl font-black tracking-tight">Approvals</div>
          </div>
          <button onClick={onBack} className="mt-1 w-10 h-10 flex items-center justify-center rounded-full bg-felt-surface-2 border border-felt-border text-zinc-400 hover:text-zinc-200 hover:bg-felt-surface-3 transition-colors">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>
      </div>

      <div className="px-5 flex flex-col gap-2.5">
        {loading && <div className="text-zinc-400 text-sm text-center py-8">Loading…</div>}
        {error && <div className="text-red-400 text-xs font-medium">{error}</div>}
        {!loading && profiles.length === 0 && (
          <div className="text-zinc-400 text-sm text-center py-8">No accounts yet.</div>
        )}
        {profiles.map(row => {
          const isApprovedHost = row.role === "host" && row.approved
          return (
            <div key={row.id} className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-white font-bold text-sm truncate">{row.display_name || row.email}</div>
                  {row.phone && <div className="text-zinc-400 text-xs mt-0.5">{row.phone}</div>}
                  <div className="text-zinc-400 text-[10px] mt-1 font-mono truncate">{row.id}</div>
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
                    className="flex-1 h-10.5 bg-gold hover:bg-gold-dark disabled:opacity-40 text-white text-xs font-bold rounded-full transition-all active:scale-[0.98]"
                  >
                    Approve as host
                  </button>
                ) : (
                  <button
                    disabled={busyId === row.id}
                    onClick={() => setRevokeTarget(row)}
                    className="flex-1 h-10.5 bg-felt-surface-3 hover:bg-felt-surface-4 disabled:opacity-40 text-zinc-300 text-xs font-bold rounded-full transition-colors"
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
        <DialogContent className="max-w-[340px] sm:max-w-md text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-white">Revoke host approval?</DialogTitle>
            <DialogDescription className="text-zinc-400">
              {revokeTarget?.display_name || revokeTarget?.email} will no longer be able to create games. This build can't yet check whether they have a live game in progress — confirm you're not pulling approval mid-game.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <button onClick={() => setRevokeTarget(null)} className="flex-1 h-12 bg-felt-surface-2 hover:bg-felt-surface-3 border border-felt-border text-zinc-300 font-bold rounded-full text-sm transition-colors">Cancel</button>
            <button
              onClick={() => { setApproval(revokeTarget, revokeTarget.role, false); setRevokeTarget(null) }}
              className="flex-1 h-12 bg-red-600/80 hover:bg-red-600 text-white font-bold rounded-full text-sm transition-all active:scale-[0.98]"
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
      <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-4 py-6 text-center text-zinc-400 text-xs font-medium">
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
    <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-4.5 pt-4.5 pb-3.5">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">Net Trend</div>
        <NumB value={last} sign size="text-sm" className={up ? "text-mint-light" : "text-red-400"} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto overflow-visible">
        <defs>
          <linearGradient id="netFillG" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={up ? "#3b9169" : "#ef4444"} stopOpacity="0.28" />
            <stop offset="100%" stopColor={up ? "#3b9169" : "#ef4444"} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#4d6658" strokeWidth="1" strokeDasharray="3 3" />
        <path d={areaPath} fill="url(#netFillG)" opacity={drawn ? 1 : 0} style={{ transition: "opacity 0.6s ease 0.4s" }} />
        <path
          ref={pathRef}
          d={linePath}
          fill="none"
          stroke={up ? "#b7e1cd" : "#f87171"}
          strokeWidth="2.75"
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
            cx={x(i)} cy={y(p.cum)} r={i === points.length - 1 ? 4 : 2.75}
            fill={up ? "#b7e1cd" : "#f87171"}
            opacity={drawn ? 1 : 0}
            style={{ transition: `opacity 0.3s ease ${0.6 + i * 0.05}s` }}
          />
        ))}
      </svg>
    </div>
  )
}

// ─── Home ─────────────────────────────────────────────────────────────────────
function HostStatsView({ pastGames, hostName }) {
  // Only games this account actually hosted count toward hosting stats —
  // a closed game someone else ran (Laks was just a player in it) belongs in
  // their Player stats, not here.
  const hosted = pastGames.filter(g => !g.hostName || g.hostName === hostName)
  const gamesHosted = hosted.length
  const uniquePlayers = new Set(hosted.flatMap(g => g.players.map(p => p.name))).size
  const totalRake = hosted.reduce((s, g) => s + (g.rake || 0), 0)
  const totalPot = hosted.reduce((s, g) => s + g.players.reduce((ps, p) => ps + totalBuyinsFor(p), 0), 0)
  const avgPot = gamesHosted ? Math.round(totalPot / gamesHosted) : 0

  return (
    <div className="px-5 flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-2.5">
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4">
          <div className="text-[9px] font-bold tracking-[0.13em] uppercase text-zinc-500">Games Hosted</div>
          <div className="text-white font-mono text-2xl font-extrabold mt-1 tracking-tight">{gamesHosted}</div>
        </div>
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4">
          <div className="text-[9px] font-bold tracking-[0.13em] uppercase text-zinc-500">Players Hosted</div>
          <div className="text-white font-mono text-2xl font-extrabold mt-1 tracking-tight">{uniquePlayers}</div>
        </div>
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4">
          <div className="text-[9px] font-bold tracking-[0.13em] uppercase text-zinc-500">Rake Collected</div>
          <NumB value={totalRake} size="text-2xl" className="mt-1 text-gold-vivid" />
        </div>
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4">
          <div className="text-[9px] font-bold tracking-[0.13em] uppercase text-zinc-500">Avg Pot / Game</div>
          <NumB value={avgPot} size="text-2xl" className="mt-1 text-zinc-100" />
        </div>
      </div>
      {gamesHosted === 0 && (
        <div className="text-zinc-400 text-xs text-center py-6">Host a game to see stats here.</div>
      )}
    </div>
  )
}

function HomeScreen({ hostName, activeGame, pastGames, onNavigate, onLogout, isAdmin, onTogglePaid }) {
  // Dashboard stats/lists only ever reflect closed games — a live game in
  // progress doesn't count toward hosting totals or the trend chart yet, and
  // it already has its own separate "active game" card above, so it's
  // excluded here to avoid double-showing it.
  const closedGames = pastGames.filter(g => g.status !== "live")
  const recent = closedGames.slice(0, 6)
  const hosted = closedGames.filter(g => !g.hostName || g.hostName === hostName)
  const recentHosted = hosted.slice(0, 6)

  // Host/Player is a filter on the two tabs below, not a separate screen —
  // it swaps which persona's analytics/settlements you're looking at, in
  // place, rather than navigating anywhere. Local to Home now that nothing
  // outside it (the bottom nav used to) needs to read or drive it.
  const [filter, setFilter] = useState("player") // "player" | "host"
  // Settlements is always the second tab, regardless of filter — both tabs
  // exist for either persona, only their contents differ.
  const [tab, setTab] = useState("overview") // "overview" | "settlements"

  return (
    <div className="flex flex-col min-h-screen bg-felt-bg pb-16">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-6 overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(202,160,67,0.12),transparent_60%)]" />
        <div className="relative z-10 flex items-start justify-between">
          <div>
            <div className="text-zinc-400 text-xs font-medium mb-1">Welcome back</div>
            <div className="text-white text-2xl font-black tracking-tight">{hostName} <span className="text-zinc-400">♠</span></div>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {isAdmin && (
              <button onClick={() => onNavigate("admin")} className="w-10 h-10 flex items-center justify-center rounded-full bg-felt-surface-2 border border-felt-border text-zinc-400 hover:text-gold-light hover:bg-felt-surface-3 transition-colors" title="Admin approvals">
                <Users className="w-4.5 h-4.5" />
              </button>
            )}
            <button onClick={onLogout} className="w-10 h-10 flex items-center justify-center rounded-full bg-felt-surface-2 border border-felt-border text-zinc-400 hover:text-zinc-200 hover:bg-felt-surface-3 transition-colors">
              <LogOut className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="px-5 flex flex-col gap-3">
        {/* Active game — visible no matter which tab/filter you're on below,
            so the live link is never more than a scroll-up away. A floating
            reminder (see LiveGameFab, App root) covers the rest of the page. */}
        {activeGame && (
          <button
            onClick={() => onNavigate(activeGame.status === "cashout" ? "cashout-entry" : "live-game")}
            className="w-full text-left rounded-3xl bg-gradient-to-br from-emerald-900/80 to-zinc-900 border border-emerald-700/60 p-4.5 relative overflow-hidden group active:scale-[0.99] transition-transform"
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

      {/* Host/Player filter — which persona's lens the tabs below use. */}
      <div className="px-5 mt-4">
        <div className="inline-flex items-center gap-1 bg-felt-surface-2 border border-felt-outline rounded-full p-1.5">
          <button
            onClick={() => setFilter("host")}
            className={cn("flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all", filter === "host" ? "bg-gold text-white shadow-md" : "text-zinc-400 hover:text-zinc-200")}
          >
            <LayoutDashboard className="w-4 h-4" /> Host
          </button>
          <button
            onClick={() => setFilter("player")}
            className={cn("flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-bold transition-all", filter === "player" ? "bg-gold text-white shadow-md" : "text-zinc-400 hover:text-zinc-200")}
          >
            <User className="w-4 h-4" /> Player
          </button>
        </div>
      </div>

      {/* Overview / Settlements — the same two tabs for either persona;
          Settlements is always second. Only the content inside changes with
          the filter above. */}
      <div className="px-5 mt-3">
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="settlements">Settlements</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {tab === "overview" && filter === "host" && (
        <>
          {/* New game — hosting-only action, lives under the Host filter
              rather than being shown universally. */}
          <div className="px-5 mt-4">
            <button
              onClick={() => onNavigate("create-game")}
              className="w-full text-left rounded-3xl bg-felt-surface-2 border border-felt-outline hover:border-gold/60 p-4.5 flex items-center gap-4 transition-all group active:scale-[0.99]"
            >
              <div className="w-12 h-12 rounded-full bg-gold/20 border border-gold/30 flex items-center justify-center group-hover:bg-gold/30 transition-colors shrink-0">
                <Plus className="w-5.5 h-5.5 text-gold-light" />
              </div>
              <div>
                <div className="text-white font-bold text-[15px]">New Game</div>
                <div className="text-zinc-400 text-xs mt-0.5">Set up players & buy-ins</div>
              </div>
              <ChevronRight className="w-4.5 h-4.5 text-zinc-400 ml-auto group-hover:text-zinc-300 transition-colors" />
            </button>
          </div>
          <SL>Hosting Overview</SL>
          <HostStatsView pastGames={closedGames} hostName={hostName} />
          {recentHosted.length > 0 && (
            <>
              {/* Only games this account actually hosted — same filter as
                  HostStatsView/Settlement Ledger. Distinct from Player's
                  Recent Games, which includes games hosted by someone else. */}
              <SL>Game History</SL>
              <div className="px-5 flex flex-col gap-2">
                {recentHosted.map(g => {
                  const h = g.players.find(p => p.name === hostName)
                  const net = h ? h.cashoutAmount - totalBuyinsFor(h) : null
                  return (
                    <button
                      key={g.id}
                      onClick={() => onNavigate("game-detail", g, true)}
                      className="w-full bg-felt-surface-2 border border-felt-outline hover:bg-felt-surface-3 rounded-2xl px-4.5 py-4 flex items-center gap-3 transition-colors text-left active:scale-[0.99]"
                    >
                      <div className={cn(
                        "w-1 h-9 rounded-full shrink-0",
                        net === null ? "bg-zinc-700" : net > 0 ? "bg-emerald-500" : net < 0 ? "bg-red-500" : "bg-zinc-600"
                      )} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-zinc-100 text-sm truncate">{g.name}</div>
                        <div className="text-zinc-400 text-xs mt-0.5">{g.date} · {g.players.length} players · {fmtB(g.rake || 0)} rake</div>
                      </div>
                      {net !== null && (
                        <div className={cn("font-mono text-sm font-bold shrink-0", net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-400")}>
                          {fmtNet(net)}
                        </div>
                      )}
                      <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}

      {tab === "overview" && filter === "player" && (
        closedGames.length === 0 ? (
          <div className="text-zinc-400 text-xs text-center py-10 px-5">Play a game to see your stats here.</div>
        ) : (
          <>
            {(() => {
              // Different stakes aren't comparable on one line — a win at one
              // bank size doesn't mean the same thing as a win at another —
              // so each distinct buy-in level gets its own trend chart
              // rather than being blended into a single misleading line.
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
            {recent.length > 0 && (
              <>
                <SL>Recent Games</SL>
                <div className="px-5 flex flex-col gap-2">
                  {recent.map(g => {
                    const h = g.players.find(p => p.name === hostName)
                    const net = h ? h.cashoutAmount - totalBuyinsFor(h) : null
                    return (
                      <button
                        key={g.id}
                        onClick={() => onNavigate("game-detail", g, false)}
                        className="w-full bg-felt-surface-2 border border-felt-outline hover:bg-felt-surface-3 rounded-2xl px-4.5 py-4 flex items-center gap-3 transition-colors text-left active:scale-[0.99]"
                      >
                        <div className={cn(
                          "w-1 h-9 rounded-full shrink-0",
                          net === null ? "bg-zinc-700" : net > 0 ? "bg-emerald-500" : net < 0 ? "bg-red-500" : "bg-zinc-600"
                        )} />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-zinc-100 text-sm truncate">{g.name}</div>
                          <div className="text-zinc-400 text-xs mt-0.5">{g.date} · {g.players.length} players</div>
                        </div>
                        {net !== null && (
                          <div className={cn("font-mono text-sm font-bold shrink-0", net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-400")}>
                            {fmtNet(net)}
                          </div>
                        )}
                        <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </>
        )
      )}

      {tab === "settlements" && (
        <>
          <SL>{filter === "host" ? "Settlement Ledger" : "My Settlements"}</SL>
          <div className="px-5">
            {filter === "host" ? (
              <SettlementLedgerSection hostName={hostName} closedGames={closedGames} onSelectGame={g => onNavigate("game-detail", g, true)} onTogglePaid={onTogglePaid} />
            ) : (
              <MySettlementsSection hostName={hostName} closedGames={closedGames} onSelectGame={g => onNavigate("game-detail", g, false)} onTogglePaid={onTogglePaid} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Create Game ──────────────────────────────────────────────────────────────
// [decision, supersedes the original "exactly 1 buy-in" rule] The host can
// set each player's STARTING BUY-IN COUNT here (1 by default, adjustable via
// a stepper on their chip) — real home games often don't start everyone at
// the same stack. This still never touches the fixed 1-bank-per-buy-in scale:
// a starting count of "3" is recorded as three separate 1-bank buy-in events
// (same shape as three rebuys entered live), not a single 3-bank unit, so
// every downstream calc that already treats buy-ins as a list of discrete
// events needed no changes. See REQUIREMENTS.md → Money model.

function CreateGameScreen({ pastGames, roster, addToRoster, onCancel, onCreate, showToast }) {
  const lastGame = pastGames[0]
  const [name, setName]         = useState(lastGame?.name || "")
  const [date, setDate]         = useState(new Date().toLocaleDateString("en-IN", { day:"numeric", month:"short" }))
  const [time, setTime]         = useState(nowStr())
  const [location, setLocation] = useState(lastGame?.location || "")
  const [players, setPlayers]   = useState([])
  const [nameInput, setNameInput]   = useState("")
  const [phoneInput, setPhoneInput] = useState("")
  // Default to "Your players" when the shared roster has anyone in it — the
  // fast/default path per REQUIREMENTS.md → Roster.
  const [source, setSource]     = useState(roster.length > 0 ? "Your players" : "Type in")
  const [createdGame, setCreatedGame] = useState(null) // set after "Start Game" — shows the invite step
  const [copied, setCopied] = useState(false)
  // [decision, Phase 1] Date/Time above are preview-only now — the actual
  // persisted game always starts "now" (games.started_at, DB default). The
  // free-text fields here still shape the invite-preview text and can't
  // reliably round-trip back into a real timestamp, so rather than silently
  // pretend a chosen date persists, this is a deliberate, documented
  // simplification: see docs/MOBILE_MIGRATION_PLAN.md Phase 1 notes.
  const [creating, setCreating] = useState(false)

  const notAdded = roster.filter(r => !players.find(p => p.name.toLowerCase() === r.name.toLowerCase()))

  const addPlayer = (n, ph) => {
    const t = n.trim(), phone = (ph || "").trim()
    if (!t || !phone || players.find(p => p.name.toLowerCase() === t.toLowerCase())) return
    setPlayers(prev => [...prev, { name: t, phone, startBuyins: 1 }])
    addToRoster(t, phone)
    setNameInput(""); setPhoneInput("")
  }

  const removePlayer = (n) => setPlayers(prev => prev.filter(p => p.name !== n))

  // Starting buy-in count stepper — clamped to a sane 1-12 range.
  const adjustStartBuyins = (n, delta) => setPlayers(prev => prev.map(p =>
    p.name === n ? { ...p, startBuyins: Math.min(12, Math.max(1, (p.startBuyins || 1) + delta)) } : p
  ))

  const canStart = name.trim() && players.length > 0

  const handleCreate = () => {
    if (!canStart) return
    const game = {
      id: Date.now(),
      name: name.trim(), date, time, location,
      buyinAmount: BANK,
      rake: 0,
      status: "live",
      lastBankCheckAt: null,
      bankChecks: [],
      players: players.map(p => ({
        name: p.name, phone: p.phone,
        buyins: Array.from({ length: p.startBuyins || 1 }, () => ({ ts: nowStr(), epoch: Date.now(), amount: BANK })),
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
      `https://straddle-pro.vercel.app/g/${g.id}`,
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
          <div className="text-zinc-400 text-sm mt-1">Invite your players, then jump into the game</div>
        </div>

        <div className="px-5 pt-5 flex flex-col gap-4">
          <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4.5">
            <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500 mb-2">Invite Preview</div>
            <pre className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-zinc-300 bg-felt-bg/60 border border-felt-border rounded-2xl p-3.5">{inviteText()}</pre>
            <div className="text-[10.5px] text-zinc-400 mt-2 leading-relaxed">
              Stub: this link doesn't route anywhere real yet and phones aren't verified — anyone with the link could open it once a real join page exists.
            </div>
          </div>

          <button
            onClick={copyInvite}
            className="w-full h-13 bg-[#25d366] hover:bg-[#20bc58] text-white font-bold rounded-full text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Share2 className="w-4 h-4" /> {copied ? "Copied!" : "Copy WhatsApp invite link"}
          </button>

          <button
            disabled={creating}
            onClick={async () => {
              setCreating(true)
              try { await onCreate(createdGame) } catch { /* handleCreateGame already reported it */ } finally { setCreating(false) }
            }}
            className="w-full h-13 bg-gold hover:bg-gold-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-full text-sm transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            <Gamepad2 className="w-4 h-4" /> {creating ? "Starting…" : "Continue to Live Game"}
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
        <div className="text-zinc-400 text-sm mt-1">Configure the session</div>
      </div>

      <div className="px-5 pt-5 flex flex-col gap-5">
        {/* Game info */}
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4.5 flex flex-col gap-4">
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

        {/* Players */}
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4.5">
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
                  {/* Starting buy-in count stepper — 1 by default, host-adjustable */}
                  <span className="flex items-center gap-1 bg-felt-bg/60 border border-felt-border rounded-full pl-1.5 pr-0.5 py-0.5 ml-0.5" title="Starting buy-ins">
                    <button onClick={() => adjustStartBuyins(p.name, -1)}
                      className="w-4 h-4 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-colors disabled:opacity-30"
                      disabled={(p.startBuyins || 1) <= 1}>
                      <Minus className="w-2.5 h-2.5" />
                    </button>
                    <span className="text-[11px] font-mono font-bold text-zinc-300 w-3 text-center tabular-nums">{p.startBuyins || 1}</span>
                    <button onClick={() => adjustStartBuyins(p.name, 1)}
                      className="w-4 h-4 rounded-full flex items-center justify-center text-zinc-400 hover:text-white transition-colors disabled:opacity-30"
                      disabled={(p.startBuyins || 1) >= 12}>
                      <Plus className="w-2.5 h-2.5" />
                    </button>
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
                <div className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-2">Tap to add · name + saved number</div>
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
              <div className="text-center py-5 text-zinc-400 text-xs font-medium">
                Everyone from your history is already added
              </div>
            )
          )}

          {source === "Contacts" && (
            <div className="text-center py-6 text-zinc-400 text-xs font-medium leading-relaxed">
              Contacts access isn't wired up yet — this tab is a placeholder.
              <br />Use "Type in" for now.
            </div>
          )}

          {source === "Type in" && (
            <div className="flex flex-col gap-2">
              <input
                className="w-full h-12 bg-felt-surface-3 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm placeholder:text-zinc-400 outline-none focus:border-gold-vivid focus:ring-2 focus:ring-gold-vivid/25 transition-all"
                placeholder="Player's name…"
                value={nameInput}
                onChange={e => setNameInput(e.target.value)}
              />
              <div className="relative">
                <input
                  className="w-full h-12 bg-felt-surface-3 border border-felt-border rounded-2xl px-4 pr-20 text-zinc-100 text-sm placeholder:text-zinc-400 outline-none focus:border-gold-vivid focus:ring-2 focus:ring-gold-vivid/25 transition-all"
                  placeholder="Phone number (required)…"
                  type="tel"
                  value={phoneInput}
                  onChange={e => setPhoneInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && addPlayer(nameInput, phoneInput)}
                />
                {nameInput.trim() && phoneInput.trim() && (
                  <button
                    onClick={() => addPlayer(nameInput, phoneInput)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 px-3.5 h-8 bg-gold hover:bg-gold-dark text-white text-xs font-bold rounded-full transition-colors"
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
          className="w-full h-14 bg-gold hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-black rounded-full transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          <Gamepad2 className="w-4 h-4" />
          Start Game{
            !name.trim() ? " · add a game name"
            : players.length === 0 ? " · add at least 1 player"
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
        className="w-full h-12 bg-felt-surface-2 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm placeholder:text-zinc-400 outline-none focus:border-gold-vivid focus:ring-2 focus:ring-gold-vivid/25 transition-all"
        {...props}
      />
    </div>
  )
}

// ─── End Cash-outs Modal ────────────────────────────────────────────────────
// Gates the step 3 -> step 4 transition (cash-out entry -> settlement) — see
// REQUIREMENTS.md -> Game lifecycle. This is the point the books must
// balance by, not the final close itself (settlement editing in step 4 can't
// reintroduce an imbalance, since it only touches transfers).
function EndGameModal({ game, onConfirm, onClose }) {
  const [rake, setRake] = useState(String((game.rake || 0) / 10000))
  const [ackUncashed, setAckUncashed] = useState(false)
  const players  = game.players
  const uncashed = players.filter(p => !p.cashedOut)
  const rakeAmt  = (parseFloat(rake) || 0) * 10000
  // Invariant: sum(buy-ins) = sum(cash-outs) + rake — see src/core/money.js.
  // Rake is host revenue skimmed off the table, never a per-player transfer,
  // so it never appears in the settlement transfers below.
  const { totalIn, totalOut, diff, balanced } = computeBankroll(players, rakeAmt)
  const canProceed = balanced && (uncashed.length === 0 || ackUncashed)

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-[340px] sm:max-w-md text-zinc-100">
        <DialogHeader>
          <DialogTitle className="text-white">Review & Continue</DialogTitle>
          <DialogDescription className="text-zinc-400">Review accounts before moving to settlement.</DialogDescription>
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
              className="flex-1 h-12 bg-felt-surface-2 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm font-mono outline-none focus:border-gold-vivid transition-all"
            />
            <span className="text-zinc-400 text-sm font-bold w-6">B</span>
          </div>
        </div>

        <div className={cn("rounded-2xl p-4 space-y-2.5 border", balanced ? "bg-emerald-500/10 border-emerald-500/20" : "bg-red-500/10 border-red-500/20")}>
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
              <span className="text-zinc-400 text-sm">{l}</span>
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
          <button onClick={onClose} className="flex-1 h-12 bg-felt-surface-2 hover:bg-felt-surface-3 border border-felt-border text-zinc-300 font-bold rounded-full text-sm transition-colors">Cancel</button>
          <button
            disabled={!canProceed}
            onClick={() => onConfirm(rakeAmt)}
            className="flex-1 h-12 bg-gold hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-full text-sm transition-all active:scale-[0.98]"
          >
            Continue →
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Live Game — Step 2: Buy-ins ────────────────────────────────────────────
// [decision] Buy-in tracking is now its own step (2 of 4 — see
// REQUIREMENTS.md -> Game lifecycle). Cash-out entry for the whole table
// moves to a dedicated screen (CashoutEntryScreen, step 3); the cash-out
// toggle that remains here is deliberately kept for the early-leaver case
// (2b) only — a player who quits mid-game can be settled right here without
// ending buy-ins for anyone else.

function LiveGameScreen({ game, onMutated, onNavigate, showToast, roster, addToRoster }) {
  const [sheetFor, setSheetFor] = useState(null)      // player name whose sheet is open
  const [cashoutOn, setCashoutOn] = useState(false)   // cash-out toggle inside the sheet (early-leaver case)
  const [sliderVal, setSliderVal] = useState(0)
  const [cashoutDigits, setCashoutDigits] = useState("")
  const [addingPlayer, setAddingPlayer] = useState(false) // expandable "Add late player" section
  const [addMode, setAddMode]   = useState("roster") // roster | new
  const [newName, setNewName]   = useState("")
  const [newPhone, setNewPhone] = useState("")
  const [rakeVisible, setRakeVisible] = useState(false)
  const [showBankCheck, setShowBankCheck] = useState(false)
  const [editingPlayer, setEditingPlayer] = useState(null) // player name being renamed
  const [editName, setEditName]   = useState("")
  const [editPhone, setEditPhone] = useState("")
  const [busy, setBusy] = useState(false) // one write in flight at a time — guards double-tap on confirm buttons

  const [rakeInput, setRakeInput] = useState(String((game.rake || 0) / 10000))

  const players  = game.players
  const isClosed = game.status === "closed"

  // Live bankroll-check invariant: buy-ins = cashed-out + rake + still in
  // play. Money still on the table mid-game is normal; the only real error
  // is paying out (cashouts + rake) more than ever came in. This never
  // blocks further buy-in/cash-out entry — only ending step 3 does (below).
  // See src/core/money.js -> computeBankroll.
  const { totalIn, totalOut, overpaid, overpayError, stillIn } = computeBankroll(players, game.rake || 0)

  // Every buy-in entered since the last confirmed bank check, across the
  // whole table — what a "Confirm Bank Check" tap is about to lock.
  const sinceLastCheck = players.reduce((s, p) => s + (p.buyins.length - lockedCountFor(p, game)), 0)
  const hoursSinceCheck = game.lastBankCheckAt ? (Date.now() - game.lastBankCheckAt) / 3.6e6 : null
  const checkOverdue = hoursSinceCheck === null || hoursSinceCheck >= 2

  // [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 1] Every mutation below
  // writes straight to Supabase via gamesApi, then calls onMutated() (App
  // root's refreshAllGames) to pull the fresh game back down — no local
  // optimistic state here any more. `run` is the shared wrapper: guards
  // against overlapping writes and reports failures the same way everywhere.
  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      await onMutated()
    } catch (err) {
      console.error(err)
      showToast("⚠️", "Couldn't save that", err?.message || "Please try again")
    } finally {
      setBusy(false)
    }
  }

  const commitRake = (v) => {
    if (isClosed) return
    const amt = Math.max(0, (parseFloat(v) || 0) * 10000)
    run(() => gamesApi.updateRake(game.id, amt))
  }

  // Removable exactly as long as none of a player's buy-ins have been locked
  // by a bank check yet — see REQUIREMENTS.md -> Roles inside a game.
  const removePlayer = (p) => {
    if (lockedCountFor(p, game) > 0) return
    run(async () => {
      await gamesApi.removePlayer(p.id)
      showToast("🗑️", "Player removed", p.name)
    })
  }

  const openEditPlayer = (p) => {
    setEditingPlayer(p.name)
    setEditName(p.name)
    setEditPhone(p.phone || "")
  }
  const closeEditPlayer = () => setEditingPlayer(null)
  // Correcting a name/phone typo is a record fix, not a money action, so it's
  // never gated by the buy-in lock the way removal is.
  const saveEditPlayer = () => {
    const n = editName.trim(), ph = editPhone.trim()
    if (!n) return
    if (players.find(p => p.name.toLowerCase() === n.toLowerCase() && p.name !== editingPlayer)) {
      showToast("⚠️", "Name already in use", n); return
    }
    const target = players.find(p => p.name === editingPlayer)
    if (!target) return
    run(async () => {
      await gamesApi.editPlayer(target.id, { name: n, phone: ph })
      closeEditPlayer()
      showToast("✏️", "Player updated", n)
    })
  }

  // Confirms a bank check: everything entered so far locks; nothing already
  // in progress in an open sheet is affected until it's confirmed there too.
  // run_bank_check (see supabase/schema.sql) bumps lastBankCheckAt and logs
  // the audit row atomically, server-side.
  const confirmBankCheck = () => {
    run(async () => {
      await gamesApi.runBankCheck(game.id)
      setShowBankCheck(false)
      showToast("🏦", "Bank check confirmed", `${sinceLastCheck} buy-in${sinceLastCheck === 1 ? "" : "s"} locked`)
    })
  }

  const handleEndBuyins = () => {
    run(async () => {
      await gamesApi.setGameStatus(game.id, "cashout")
      onNavigate("cashout-entry")
      showToast("➡️", "Buy-ins ended", "Enter cash-outs next")
    })
  }

  const openSheet = (p) => {
    setSheetFor(p.name)
    setCashoutOn(!!p.cashedOut)
    setSliderVal(p.buyins.length)
    setCashoutDigits(p.cashedOut ? String(Math.round((p.cashoutAmount || 0) / 10000)) : "")
  }
  const closeSheet = () => { setSheetFor(null); setCashoutDigits(""); setCashoutOn(false) }

  // Add-player: same shared roster as Create Game (see src/lib/roster.js).
  // A roster chip tap adds instantly; the "someone new" fallback requires
  // both name and phone, and also saves the new person to the roster.
  const addPlayerToGame = (n, phone) => {
    const t = n.trim()
    if (!t) return
    if (players.find(p => p.name.toLowerCase() === t.toLowerCase())) {
      showToast("⚠️", "Already added", `${t} is in the game`); return
    }
    run(async () => {
      await gamesApi.addPlayer(game.id, { name: t, phone: (phone || "").trim(), startBuyins: 1 })
      showToast("🃏", "Player Added", `${t} — ${fmtB(game.buyinAmount)}`)
    })
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
    const p = players.find(pp => pp.name === sheetFor)
    if (!p) return
    const currentCount = p.buyins.length
    // The slider can never be dragged below the player's already-locked
    // buy-in count (amounts locked by a past bank check) — see the slider's
    // `min` prop below, which enforces this at drag time too.
    const target = Math.max(sliderVal, lockedCountFor(p, game))
    if (target === currentCount) { closeSheet(); return }
    run(async () => {
      if (target > currentCount) {
        // One INSERT for every new buy-in, not a loop of separate round
        // trips — a single INSERT is atomic (all rows land or none do), so
        // a network blip mid-drag can't leave a half-added count on record.
        await gamesApi.addBuyins(p.id, target - currentCount, game.buyinAmount)
        showToast("🏦", "Buy-in added", `${p.name} · now ${target}×`)
      } else {
        // Removing only ever trims unlocked entries from the end — buyins
        // are hydrated oldest-first (see gamesApi.js), so the tail is
        // exactly the most-recently-added, still-unlocked ones. One DELETE
        // for all of them, same atomicity reasoning as the add branch.
        await gamesApi.removeBuyins(p.buyins.slice(target).map(b => b.id))
        showToast("↩️", "Buy-in removed", `${p.name} · now ${target}×`)
      }
      closeSheet()
    })
  }

  const confirmCashout = () => {
    const p = players.find(pp => pp.name === sheetFor)
    if (!p) return
    const val = parseInt(cashoutDigits || "0", 10) * 10000 // keypad digits are whole banks typed directly
    const net = val - totalBuyinsFor(p)
    run(async () => {
      await gamesApi.setCashout(p.id, val)
      closeSheet()
      showToast(net >= 0 ? "🟢" : "🔴", `${p.name} cashed out`, `${fmtB(val)} · Net ${fmtNet(net)}`)
    })
  }

  const sheetPlayer = players.find(p => p.name === sheetFor)
  const sheetPlayerIn = sheetPlayer ? totalBuyinsFor(sheetPlayer) : 0
  const cashoutEntered = parseInt(cashoutDigits || "0", 10) * 10000
  const cashoutNet = cashoutEntered - sheetPlayerIn

  return (
    <div className="flex flex-col min-h-screen bg-felt-bg pb-28">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-5 overflow-hidden border-b border-felt-border">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.08),transparent_60%)]" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              {/* The bottom nav no longer carries a "Home" destination (see
                  App root) — this is now the only way back to the dashboard
                  while a game stays running live in the background. */}
              <button onClick={() => onNavigate("home")} className="w-9 h-9 -ml-1.5 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-felt-surface-2 transition-colors" title="Back to Home — game keeps running">
                <ChevronDown className="w-4.5 h-4.5" />
              </button>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-blink" />
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-emerald-400">Live</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* [decision, Phase 1] Undo was a local-state convenience — it
                  rolled back the in-memory game object before anything was
                  actually saved. Now that every action here writes straight
                  to Supabase (see gamesApi.js), there's no in-memory snapshot
                  left to roll back to; a real undo would mean issuing an
                  equal-and-opposite database write per action, which is out
                  of scope for this pass. Each action here already requires
                  its own explicit confirm tap, which is most of what undo
                  was protecting against. See docs/MOBILE_MIGRATION_PLAN.md
                  Phase 1 notes. */}
              {/* Bank check — locks every buy-in entered so far once the host
                  confirms with the table. Badged once ~2hrs have passed since
                  the last one (or since the game started, if there's never
                  been one) as a nudge, not an enforced requirement. */}
              <button
                onClick={() => setShowBankCheck(true)}
                className={cn(
                  "flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-full border transition-colors",
                  checkOverdue
                    ? "bg-amber-500/10 border-amber-500/30 text-amber-300 hover:bg-amber-500/15"
                    : "bg-felt-surface-2 border-felt-outline text-zinc-300 hover:text-white"
                )}
              >
                <Coins className="w-3.5 h-3.5" /> Bank Check
              </button>
            </div>
          </div>
          <div className="text-white text-xl font-bold">{game.name}</div>
          <div className="text-zinc-400 text-xs mt-1">{players.length} players · {game.date}{game.time ? ` · ${game.time}` : ""}</div>
        </div>
      </div>

      {/* Stats row */}
      <div className="px-5 pt-4 grid grid-cols-3 gap-2.5">
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">On table</div>
          <NumB value={totalIn - totalOut} size="text-[18px]" className="mt-1 text-white" />
        </div>
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Cashed out</div>
          <NumB value={totalOut} size="text-[18px]" className="mt-1 text-white" />
        </div>
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Rake</div>
            <button onClick={() => setRakeVisible(v => !v)} className="w-6.5 h-6.5 rounded-full bg-felt-surface-3 border border-felt-border flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors shrink-0">
              {rakeVisible ? <ChevronUp className="w-3 h-3" /> : <span className="text-[10px]">◐</span>}
            </button>
          </div>
          {rakeVisible ? (
            isClosed ? (
              <NumB value={game.rake || 0} size="text-[18px]" className="mt-1 text-gold-vivid" />
            ) : (
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number" min="0" step="1" inputMode="decimal"
                  value={rakeInput}
                  onChange={e => setRakeInput(e.target.value)}
                  onBlur={e => commitRake(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && e.currentTarget.blur()}
                  className="w-full bg-transparent text-[18px] font-extrabold font-mono text-gold-vivid outline-none border-b border-transparent focus:border-gold-vivid/40"
                />
              </div>
            )
          ) : (
            <div className="mt-1 text-[18px] font-extrabold tracking-[0.15em] text-zinc-400">•••</div>
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
          <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-4">
            <div className="flex items-center justify-between mb-2.5">
              <div className="text-[10px] font-bold tracking-[0.2em] uppercase text-zinc-500">Add late player</div>
              <button onClick={() => { setAddingPlayer(false); setAddMode("roster"); setNewName(""); setNewPhone("") }}
                className="w-7 h-7 rounded-full bg-felt-surface-3 border border-felt-border flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex gap-1.5 mb-3 bg-felt-surface-3 rounded-full p-1">
              {["roster", "new"].map(m => (
                <button key={m} onClick={() => setAddMode(m)}
                  className={cn(
                    "flex-1 h-9 rounded-full text-xs font-bold transition-all",
                    addMode === m ? "bg-bloom text-white shadow-md" : "text-zinc-400 hover:text-zinc-200"
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
                <div className="text-center py-3 text-zinc-400 text-xs font-medium">
                  Everyone in your roster is already in this game
                </div>
              )
            )}

            {addMode === "new" && (
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  className="w-full h-11 bg-felt-surface-3 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm placeholder:text-zinc-400 outline-none focus:border-gold-vivid transition-all"
                  placeholder="Player's name…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                />
                <input
                  className="w-full h-11 bg-felt-surface-3 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm placeholder:text-zinc-400 outline-none focus:border-gold-vivid transition-all"
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
                  className="w-full h-11 bg-gold hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold rounded-full transition-all active:scale-[0.98]"
                >
                  Add to game
                </button>
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => setAddingPlayer(true)}
            className="w-full h-12 bg-felt-surface-2 border border-felt-border hover:border-felt-outline hover:bg-felt-surface-3 rounded-full text-zinc-300 hover:text-white text-sm font-bold transition-colors">
            + Add late player
          </button>
        )}
      </div>

      {/* Players list — plain rows, tap opens the sheet */}
      <SL>Players · tap any to open</SL>

      {players.length === 0 && (
        <div className="text-center py-8 text-zinc-400 text-sm">Add players above to start tracking</div>
      )}

      <div className="px-5 flex flex-col gap-2">
        {players.map((p) => {
          const tIn = totalBuyinsFor(p)
          const net = p.cashedOut ? (p.cashoutAmount - tIn) : null
          const locked = lockedCountFor(p, game)
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
                "flex items-center gap-3 bg-felt-surface-2 border border-felt-outline rounded-3xl px-4 py-3.5 transition-opacity",
                p.cashedOut && "opacity-55"
              )}
            >
              <button onClick={() => openSheet(p)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <Av name={p.name} size={36} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-sm text-zinc-100">{p.name}</div>
                  <div className="text-[10.5px] text-zinc-400 mt-0.5 font-mono">
                    {p.buyins.length} buy-in{p.buyins.length === 1 ? "" : "s"}
                    {p.cashedOut ? " · cashed out" : hasLocked ? " · locked" : ""}
                  </div>
                </div>
                {p.cashedOut ? (
                  <NumB value={net} sign size="text-[17px]" className={net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-400"} />
                ) : (
                  <NumB value={tIn} size="text-[17px]" className="text-white" />
                )}
                <Dot color={dotColor} />
              </button>
              {/* Edit — a record fix (name/phone), never gated by the buy-in
                  lock the way removal is. */}
              {!isClosed && (
                <button
                  onClick={(e) => { e.stopPropagation(); openEditPlayer(p) }}
                  title="Edit player"
                  className="w-9 h-9 rounded-full bg-felt-surface-3 border border-felt-border flex items-center justify-center text-zinc-400 hover:text-zinc-100 hover:border-felt-outline transition-colors shrink-0"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
              )}
              {/* Remove player — only ever valid while none of their buy-ins
                  have been locked by a bank check yet (fixes an accidental
                  add). Once one has, removal isn't a valid action any more,
                  so it's genuinely absent, not disabled-with-tooltip. */}
              {!isClosed && locked === 0 && (
                <button
                  onClick={(e) => { e.stopPropagation(); removePlayer(p) }}
                  title="Remove player (no locked buy-ins yet)"
                  className="w-9 h-9 rounded-full bg-felt-surface-3 border border-felt-border flex items-center justify-center text-zinc-400 hover:text-red-300 hover:border-red-500/40 transition-colors shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )
        })}
      </div>

      {players.length > 0 && !isClosed && (
        <div className="px-5 mt-5">
          <button
            disabled={busy}
            onClick={handleEndBuyins}
            className="w-full h-13 bg-red-600/80 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed border border-red-500/30 text-white font-bold rounded-full text-sm transition-all active:scale-[0.98]"
          >
            End Buy-ins →
          </button>
          <div className="text-[11px] text-zinc-500 text-center mt-2 leading-relaxed">
            Moves to cash-out entry for everyone still in — you can come back
            to buy-ins from there if it's too early.
          </div>
        </div>
      )}

      {/* Bank check — read-only summary of what's unlocked since the last
          one; adjustments happen by tapping into a player's own sheet, which
          stays fully editable until this is confirmed. */}
      <Dialog open={showBankCheck} onOpenChange={(o) => { if (!o) setShowBankCheck(false) }}>
        <DialogContent className="max-w-[340px] sm:max-w-md text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-white">Bank Check</DialogTitle>
            <DialogDescription className="text-zinc-400">
              Confirm buy-in counts with the table, then lock them in.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto">
            {players.map(p => {
              const unlockedCount = p.buyins.length - lockedCountFor(p, game)
              return (
                <div key={p.name} className="flex items-center justify-between bg-felt-surface-2 border border-felt-border rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Av name={p.name} size={28} />
                    <span className="text-sm font-semibold text-zinc-200 truncate">{p.name}</span>
                  </div>
                  <span className="text-xs font-mono text-zinc-400 shrink-0">
                    {p.buyins.length} total{unlockedCount > 0 ? ` · ${unlockedCount} new` : ""}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-3">
            <button onClick={() => setShowBankCheck(false)} className="flex-1 h-12 bg-felt-surface-2 hover:bg-felt-surface-3 border border-felt-border text-zinc-300 font-bold rounded-full text-sm transition-colors">Cancel</button>
            <button
              disabled={sinceLastCheck === 0 || busy}
              onClick={confirmBankCheck}
              className="flex-1 h-12 bg-gold hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-full text-sm transition-all active:scale-[0.98]"
            >
              Confirm & Lock {sinceLastCheck > 0 ? sinceLastCheck : ""}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit player — name/phone correction, not a money action. */}
      <Dialog open={!!editingPlayer} onOpenChange={(o) => { if (!o) closeEditPlayer() }}>
        <DialogContent className="max-w-[340px] sm:max-w-md text-zinc-100">
          <DialogHeader>
            <DialogTitle className="text-white">Edit player</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <DInput label="Name" value={editName} onChange={e => setEditName(e.target.value)} />
            <DInput label="Phone" value={editPhone} onChange={e => setEditPhone(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <button onClick={closeEditPlayer} className="flex-1 h-12 bg-felt-surface-2 hover:bg-felt-surface-3 border border-felt-border text-zinc-300 font-bold rounded-full text-sm transition-colors">Cancel</button>
            <button onClick={saveEditPlayer} disabled={!editName.trim() || busy} className="flex-1 h-12 bg-gold hover:bg-gold-dark disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-full text-sm transition-all active:scale-[0.98]">Save</button>
          </div>
        </DialogContent>
      </Dialog>

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
              <div className="text-center text-[10.5px] text-zinc-400 -mt-1 mb-0.5">
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
                  <div className="text-[10.5px] font-bold tracking-wider uppercase text-zinc-400 mt-1">
                    buy-in{sliderVal === 1 ? "" : "s"} · <NumB value={sliderVal * game.buyinAmount} size="text-[11px]" className="text-zinc-400 inline-flex" />
                  </div>
                </div>
                {!isClosed && (
                  <>
                    <BuyinSlider value={sliderVal} onChange={setSliderVal} min={lockedCountFor(sheetPlayer, game)} />
                    <div className="text-center text-[11px] text-zinc-400">
                      Locks at your <b className="text-zinc-400 font-semibold">next bank check</b> — once locked it's permanent, no override
                    </div>
                    <button disabled={busy} onClick={confirmBuyins} className="w-full h-13 bg-gold hover:bg-gold-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-full text-sm transition-all active:scale-[0.98]">
                      Confirm {sliderVal} buy-in{sliderVal === 1 ? "" : "s"}
                    </button>
                  </>
                )}
              </>
            )}

            {/* Early-leaver cash-out (2b) — for a player who quits mid-game,
                not the general end-of-night flow (that's step 3, the
                dedicated Cash-outs screen, reached via "End Buy-ins" below).
                A small toggle, not a peer tab of buy-in. Once switched on,
                buy-ins for this player are locked — no more can be added
                while cashing out. */}
            <div className="flex items-center justify-between bg-felt-surface-2 border border-felt-outline rounded-2xl px-4 py-3 mt-1">
              <span className="text-xs font-bold text-zinc-300">Leaving early? Cash out now</span>
              <Switch checked={cashoutOn} onCheckedChange={setCashoutOn} disabled={isClosed} />
            </div>

            {cashoutOn && (
              <div className="flex flex-col gap-3.5">
                <div className="text-center text-[11px] text-zinc-500">
                  {sheetPlayerIn === 0 ? "no" : sheetPlayer.buyins.length} buy-in{sheetPlayer.buyins.length === 1 ? "" : "s"} · <NumB value={sheetPlayerIn} size="text-[11px]" className="text-zinc-400 inline-flex" /> in — locked while cashing out
                </div>
                <div className="text-center pt-1 pb-0.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Cashing out</div>
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
                    <button disabled={busy} onClick={confirmCashout} className="w-full h-13 bg-gold hover:bg-gold-dark disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-full text-sm transition-all active:scale-[0.98]">
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

// ─── Live Game — Step 3: Cash-outs ──────────────────────────────────────────
// [decision] Once buy-ins end (step 2's "End Buy-ins"), buy-in totals are
// frozen and the host works through a plain list entering everyone's
// cash-out from a dedicated sheet — see REQUIREMENTS.md -> Game lifecycle.
// The bankroll-check math here is identical to step 2's; it just no longer
// shares a screen with buy-in editing.
function CashoutEntryScreen({ game, onMutated, onNavigate, showToast }) {
  const [sheetFor, setSheetFor] = useState(null)
  const [cashoutDigits, setCashoutDigits] = useState("")
  const [showEnd, setShowEnd] = useState(false)
  const [rakeVisible, setRakeVisible] = useState(false)
  const [rakeInput, setRakeInput] = useState(String((game.rake || 0) / 10000))
  const [busy, setBusy] = useState(false)

  const players  = game.players

  // Same invariant as step 2 — see there for the full explanation. Money
  // still on the table (players who haven't cashed out yet) is normal here
  // too; only paying out more than ever came in is an error.
  const { totalIn, totalOut, overpaid, overpayError, stillIn } = computeBankroll(players, game.rake || 0)

  // Same pattern as LiveGameScreen — see its own `run` for the full
  // explanation. Every write here goes to Supabase, then pulls the fresh
  // game back down via onMutated (App root's refreshAllGames).
  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    try {
      await fn()
      await onMutated()
    } catch (err) {
      console.error(err)
      showToast("⚠️", "Couldn't save that", err?.message || "Please try again")
    } finally {
      setBusy(false)
    }
  }

  const commitRake = (v) => {
    const amt = Math.max(0, (parseFloat(v) || 0) * 10000)
    run(() => gamesApi.updateRake(game.id, amt))
  }

  const openSheet = (p) => {
    setSheetFor(p.name)
    setCashoutDigits(p.cashedOut ? String(Math.round((p.cashoutAmount || 0) / 10000)) : "")
  }
  const closeSheet = () => { setSheetFor(null); setCashoutDigits("") }

  const confirmCashout = () => {
    const p = players.find(pp => pp.name === sheetFor)
    if (!p) return
    const val = parseInt(cashoutDigits || "0", 10) * 10000
    const net = val - totalBuyinsFor(p)
    run(async () => {
      await gamesApi.setCashout(p.id, val)
      closeSheet()
      showToast(net >= 0 ? "🟢" : "🔴", `${p.name} cashed out`, `${fmtB(val)} · Net ${fmtNet(net)}`)
    })
  }

  // Rake was already committed live (commitRake, same as step 2) — this
  // just carries the EndGameModal's final reviewed rake value forward in
  // case the host adjusted it there, then moves to settlement. No status
  // change happens here; step 3 -> step 4 isn't a stored transition (see
  // supabase/schema.sql's games.status comment).
  const handleReviewContinue = (rake) => {
    run(async () => {
      await gamesApi.updateRake(game.id, rake)
      setShowEnd(false)
      onNavigate("settlement")
    })
  }

  const backToBuyins = () => {
    run(async () => {
      await gamesApi.setGameStatus(game.id, "live")
      onNavigate("live-game")
    })
  }

  const sheetPlayer = players.find(p => p.name === sheetFor)
  const sheetPlayerIn = sheetPlayer ? totalBuyinsFor(sheetPlayer) : 0
  const cashoutEntered = parseInt(cashoutDigits || "0", 10) * 10000
  const cashoutNet = cashoutEntered - sheetPlayerIn

  return (
    <div className="flex flex-col min-h-screen bg-felt-bg pb-28">
      {/* Header */}
      <div className="relative px-5 pt-14 pb-5 overflow-hidden border-b border-felt-border">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(16,185,129,0.08),transparent_60%)]" />
        <div className="relative z-10">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <button onClick={() => onNavigate("home")} className="w-9 h-9 -ml-1.5 rounded-full flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-felt-surface-2 transition-colors" title="Back to Home — game keeps running">
                <ChevronDown className="w-4.5 h-4.5" />
              </button>
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-blink" />
                <span className="text-[10px] font-bold tracking-[0.2em] uppercase text-amber-400">Cash-outs</span>
              </div>
            </div>
            {/* Reversible — nothing here has finally locked yet (see
                REQUIREMENTS.md -> Game lifecycle), so going back to buy-ins
                is always available, not just for the first few seconds. */}
            <button disabled={busy} onClick={backToBuyins} className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-300 bg-felt-surface border border-felt-border px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <ChevronUp className="w-3.5 h-3.5" /> Back to buy-ins
            </button>
          </div>
          <div className="text-white text-xl font-bold">{game.name}</div>
          <div className="text-zinc-400 text-xs mt-1">{players.length} players · {game.date}{game.time ? ` · ${game.time}` : ""}</div>
        </div>
      </div>

      {/* Stats row — same three tiles as step 2 (3a: same calculations) */}
      <div className="px-5 pt-4 grid grid-cols-3 gap-2.5">
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">On table</div>
          <NumB value={totalIn - totalOut} size="text-[18px]" className="mt-1 text-white" />
        </div>
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Cashed out</div>
          <NumB value={totalOut} size="text-[18px]" className="mt-1 text-white" />
        </div>
        <div className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-3.5 py-3 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Rake</div>
            <button onClick={() => setRakeVisible(v => !v)} className="w-6.5 h-6.5 rounded-full bg-felt-surface-3 border border-felt-border flex items-center justify-center text-zinc-400 hover:text-zinc-200 transition-colors shrink-0">
              {rakeVisible ? <ChevronUp className="w-3 h-3" /> : <span className="text-[10px]">◐</span>}
            </button>
          </div>
          {rakeVisible ? (
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
          ) : (
            <div className="mt-1 text-[18px] font-extrabold tracking-[0.15em] text-zinc-400">•••</div>
          )}
        </div>
      </div>

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

      <SL>Players · tap any to cash out</SL>

      <div className="px-5 flex flex-col gap-2">
        {players.map((p) => {
          const tIn = totalBuyinsFor(p)
          const net = p.cashedOut ? (p.cashoutAmount - tIn) : null
          return (
            <button
              key={p.name}
              onClick={() => openSheet(p)}
              className={cn(
                "flex items-center gap-3 bg-felt-surface border border-felt-border rounded-2xl px-3.5 py-3 text-left transition-opacity",
                p.cashedOut && "opacity-55"
              )}
            >
              <Av name={p.name} size={36} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-zinc-100">{p.name}</div>
                <div className="text-[10.5px] text-zinc-400 mt-0.5 font-mono">
                  {tIn === 0 ? "no" : p.buyins.length} buy-in{p.buyins.length === 1 ? "" : "s"} in · {p.cashedOut ? "cashed out" : "not yet"}
                </div>
              </div>
              {p.cashedOut ? (
                <NumB value={net} sign size="text-[17px]" className={net > 0 ? "text-emerald-400" : net < 0 ? "text-red-400" : "text-zinc-400"} />
              ) : (
                <NumB value={tIn} size="text-[17px]" className="text-white" />
              )}
              <Dot color={p.cashedOut ? (net >= 0 ? "emerald" : "red") : "indigo"} />
            </button>
          )
        })}
      </div>

      {players.length > 0 && (
        <div className="px-5 mt-5">
          <button
            disabled={overpayError || busy}
            onClick={() => setShowEnd(true)}
            className="w-full h-12 bg-red-600/80 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed border border-red-500/30 text-white font-bold rounded-xl text-sm transition-colors"
          >
            Review & Continue →
          </button>
          {overpayError && (
            <div className="text-[11px] text-red-300/90 text-center mt-2 leading-relaxed">
              Can't continue while paid out exceeds total buy-ins — fix the entries above first.
            </div>
          )}
        </div>
      )}

      {showEnd && <EndGameModal game={game} onConfirm={handleReviewContinue} onClose={() => setShowEnd(false)} />}

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
          <div className="flex flex-col gap-3.5">
            <div className="text-center text-[11px] text-zinc-500">
              {sheetPlayerIn === 0 ? "no" : sheetPlayer.buyins.length} buy-in{sheetPlayer.buyins.length === 1 ? "" : "s"} · <NumB value={sheetPlayerIn} size="text-[11px]" className="text-zinc-400 inline-flex" /> in
            </div>
            <div className="text-center pt-1 pb-0.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">Cashing out</div>
              <NumB value={cashoutEntered} size="text-[40px]" className="text-white justify-center" />
            </div>
            <div className="text-center text-[11.5px] font-mono -mt-1.5">
              net <NumB value={cashoutNet} sign size="text-[11.5px]" className={cn("inline-flex", cashoutNet >= 0 ? "text-emerald-400" : "text-red-400")} />
            </div>
            <Keypad
              onDigit={(d) => setCashoutDigits(prev => (prev === "0" ? "" : prev) + d)}
              onBackspace={() => setCashoutDigits(prev => prev.slice(0, -1))}
              onClear={() => setCashoutDigits("")}
            />
            <button disabled={busy} onClick={confirmCashout} className="w-full h-12 bg-gold hover:bg-gold disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors">
              {sheetPlayer.cashedOut ? "Update cash out" : "Confirm cash out"}
            </button>
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
  // Same invariant as EndGameModal: sum(buy-ins) = sum(cash-outs) + rake.
  const { totalIn, totalOut, diff: delta, balanced } = computeBankroll(players, rake)

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
    setSheetDigits(t.amount ? String(Math.round(t.amount / 10000)) : "")
  }
  const openAdd = () => {
    setSheetTxn({ key: `custom-${customTxns.length}`, isNew: true })
    setSheetFrom(""); setSheetTo(""); setSheetDigits("")
  }
  const closeSheet = () => setSheetTxn(null)

  const saveSheet = () => {
    const amt = (parseInt(sheetDigits || "0", 10)) * 10000
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
  //
  // [decision] Includes a per-game results link, same stub status as the
  // invite link at creation (see REQUIREMENTS.md -> Invites): the text is
  // correct, but the link can't actually resolve to anyone's data yet, since
  // game data lives in the host's own browser storage rather than a shared
  // backend a second device could query. Real per-player results (gated by
  // sign-in + a claimed player row, see REQUIREMENTS.md) need the Supabase
  // migration first — this isn't a bug in this text, it's a placeholder for
  // what that migration unlocks.
  const resultsText = () => [
    `🃏 ${game.name} — ${game.date}`,
    ``,
    `Settle Up (${allTxns.length} payments):`,
    ...allTxns.map(t => `• ${t.from} → ${t.to}: ${fmtB(t.amount)}`),
    ...(allTxns.length === 0 ? ["• Everyone's even!"] : []),
    ``,
    `See your own results: https://straddle-pro.vercel.app/g/${game.id}/results`,
    `(sign in with the phone number you played under)`,
  ].join("\n")

  const copySettlement = async () => {
    const text = resultsText()
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
          <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-300 text-sm mb-5 transition-colors">
            <X className="w-4 h-4" /> Back to cash-outs
          </button>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-white text-xl font-bold">Settlement</div>
              <div className="text-zinc-400 text-sm mt-1">{game.name} · {game.date}</div>
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
                <div className="text-xs text-zinc-400 font-mono mt-0.5">In {fmtB(totalBuyinsFor(p))} · Out {fmtB(p.cashoutAmount || 0)}</div>
              </div>
              <NumB value={pos.net} sign size="text-sm" className={pos.net > 0 ? "text-emerald-400" : pos.net < 0 ? "text-red-400" : "text-zinc-400"} />
            </div>
          )
        })}
      </div>

      {/* Payments — tap any to open the edit sheet */}
      <SL>Payments — {visibleTxns.length}</SL>

      {visibleTxns.length === 0 ? (
        <div className="text-center py-8 text-zinc-400 text-sm">🎉 Everyone is even</div>
      ) : (
        <div className="px-5 flex flex-col gap-2.5 mb-3">
          {visibleTxns.map(t => {
            const done = settled[t.key]
            return (
              <div key={t.key} className={cn("flex items-center gap-3 bg-felt-surface border border-felt-border rounded-2xl px-3.5 py-3 transition-opacity", done && "opacity-50")}>
                <button onClick={() => openEdit(t)} className="flex-1 min-w-0 flex items-center gap-2.5 text-left">
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-zinc-100 flex items-center gap-1.5 truncate">
                      {t.from} <span className="text-zinc-400">→</span> {t.to}
                    </div>
                    <div className="text-[10px] text-zinc-400 font-mono mt-0.5">{!t.isAuto ? "custom" : done ? "settled" : "not yet paid"}</div>
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
            <span className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider">Settled</span>
            <Progress value={visibleTxns.length ? (settledCount / visibleTxns.length) * 100 : 0} className="flex-1 bg-felt-surface-2" indicatorClassName="bg-emerald-500" />
            <span className="font-mono text-sm font-bold text-emerald-400">{settledCount}/{visibleTxns.length}</span>
          </div>
        </div>
      )}

      <div className="px-5 mb-4">
        <button onClick={openAdd}
          className="w-full border border-dashed border-felt-border hover:border-felt-border hover:bg-felt-surface/50 rounded-xl py-3 text-sm text-zinc-400 hover:text-zinc-400 font-medium transition-all flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Add Custom Payment
        </button>
      </div>

      {/* Actions */}
      <div className="px-5 flex flex-col gap-3">
        <button onClick={copySettlement}
          className="w-full h-12 bg-gold hover:bg-gold text-white font-bold rounded-xl text-sm transition-colors flex items-center justify-center gap-2">
          <Share2 className="w-4 h-4" /> Copy settlement summary
        </button>
        <button
          onClick={async () => {
            // [decision] Ending the game also puts the results text (summary
            // + results link) on the clipboard, since "end the game" and
            // "send results" are one moment for the host, not two separate
            // actions — see REQUIREMENTS.md -> Invites.
            try { await navigator.clipboard.writeText(resultsText()) } catch { /* best-effort */ }
            onClose(visibleTxns.map(({ from, to, amount }) => ({ from, to, amount })))
          }}
          className="w-full h-12 bg-felt-surface-2 hover:bg-zinc-700 border border-felt-border text-zinc-200 font-bold rounded-xl text-sm transition-colors">
          End Game & Send Results
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
              <NumB value={(parseInt(sheetDigits || "0", 10)) * 10000} size="text-[26px]" className="text-white justify-end" />
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

// ─── Settlements — inline within Home's Player/Host tabs ──────────────────────
// Cross-game view — every other settlement surface (Settlement screen, Game
// Detail) only shows one game at a time. This answers "what do I actually
// owe right now" / "what's the full picture across everything I've hosted"
// by reading each closed game's already-computed, stored settlement list —
// never recomputed live, never includes a `live` game. Lives directly inside
// the Player/Hosting stats tabs on Home, not behind a separate screen.
function PaidToggle({ paid, onToggle }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      title={paid ? "Mark as pending" : "Mark as paid"}
      className={cn(
        "w-9 h-9 rounded-full border flex items-center justify-center shrink-0 transition-all active:scale-90",
        paid ? "bg-mint-container border-mint/50 text-mint-light" : "bg-felt-surface-2 border-felt-border text-zinc-500 hover:text-zinc-300"
      )}
    >
      <CheckCircle2 className="w-4.5 h-4.5" />
    </button>
  )
}

function MySettlementsSection({ hostName, closedGames, onSelectGame, onTogglePaid }) {
  const myLines = closedGames.flatMap(g =>
    (g.settlement || [])
      .map((t, idx) => ({ ...t, game: g, idx }))
      .filter(t => t.from === hostName || t.to === hostName)
  )
  const iOwe = myLines.filter(t => t.from === hostName)
  const owedToMe = myLines.filter(t => t.to === hostName)

  return (
    <div className="flex flex-col gap-2">
      {myLines.length === 0 && (
        <div className="text-zinc-400 text-xs text-center py-6">
          {closedGames.length === 0
            ? "No closed games yet — settlements show up here once a game ends."
            : "No settlements involve you yet in any closed game."}
        </div>
      )}
      {iOwe.length > 0 && (
        <>
          <div className="text-[10px] font-bold tracking-[0.13em] uppercase text-zinc-500 mt-1">You owe</div>
          {iOwe.map((t, i) => (
            <div key={i} className="w-full bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex items-center gap-3 hover:border-zinc-700 transition-colors">
              <button onClick={() => onSelectGame(t.game)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <Av name={t.to} size={28} />
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm font-semibold", t.paid ? "text-zinc-400 line-through" : "text-zinc-100")}>To {t.to}</div>
                  <div className="text-zinc-400 text-[10.5px] mt-0.5">{t.game.name} · {t.game.date}</div>
                </div>
              </button>
              <NumB value={t.amount} sign={false} size="text-base" className={t.paid ? "text-zinc-500" : "text-red-400"} />
              <PaidToggle paid={t.paid} onToggle={() => onTogglePaid(t)} />
            </div>
          ))}
        </>
      )}
      {owedToMe.length > 0 && (
        <>
          <div className="text-[10px] font-bold tracking-[0.13em] uppercase text-zinc-500 mt-2">Owed to you</div>
          {owedToMe.map((t, i) => (
            <div key={i} className="w-full bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex items-center gap-3 hover:border-zinc-700 transition-colors">
              <button onClick={() => onSelectGame(t.game)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                <Av name={t.from} size={28} />
                <div className="flex-1 min-w-0">
                  <div className={cn("text-sm font-semibold", t.paid ? "text-zinc-400 line-through" : "text-zinc-100")}>From {t.from}</div>
                  <div className="text-zinc-400 text-[10.5px] mt-0.5">{t.game.name} · {t.game.date}</div>
                </div>
              </button>
              <NumB value={t.amount} sign={false} size="text-base" className={t.paid ? "text-zinc-500" : "text-emerald-400"} />
              <PaidToggle paid={t.paid} onToggle={() => onTogglePaid(t)} />
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function SettlementLedgerSection({ hostName, closedGames, onSelectGame, onTogglePaid }) {
  const [drillPlayer, setDrillPlayer] = useState(null)
  const hostedClosed = closedGames.filter(g => !g.hostName || g.hostName === hostName)
  const allHostedLines = hostedClosed.flatMap(g => (g.settlement || []).map((t, idx) => ({ ...t, game: g, idx })))
  const hostedPlayers = [...new Set(allHostedLines.flatMap(t => [t.from, t.to]))].sort((a, b) => a.localeCompare(b))
  const drillLines = drillPlayer ? allHostedLines.filter(t => t.from === drillPlayer || t.to === drillPlayer) : allHostedLines

  return (
    <div className="flex flex-col gap-2">
      {hostedPlayers.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-1">
          <button onClick={() => setDrillPlayer(null)}
            className={cn("text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors", !drillPlayer ? "bg-gold text-white border-gold" : "bg-felt-surface-2 text-zinc-400 border-felt-border")}>
            All players
          </button>
          {hostedPlayers.map(p => (
            <button key={p} onClick={() => setDrillPlayer(p)}
              className={cn("text-[11px] font-bold px-2.5 py-1 rounded-full border transition-colors", drillPlayer === p ? "bg-gold text-white border-gold" : "bg-felt-surface-2 text-zinc-400 border-felt-border")}>
              {p}
            </button>
          ))}
        </div>
      )}
      {drillLines.length === 0 && (
        <div className="text-zinc-400 text-xs text-center py-6">
          {hostedClosed.length === 0
            ? "No games you've hosted have closed yet."
            : "No settlement lines to show."}
        </div>
      )}
      {drillLines.map((t, i) => (
        <div key={i} className="w-full bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex items-center gap-3 hover:border-zinc-700 transition-colors">
          <button onClick={() => onSelectGame(t.game)} className="flex-1 min-w-0 text-left">
            <div className={cn("text-sm font-semibold", t.paid ? "text-zinc-400 line-through" : "text-zinc-100")}>{t.from} → {t.to}</div>
            <div className="text-zinc-400 text-[10.5px] mt-0.5">{t.game.name} · {t.game.date}</div>
          </button>
          <NumB value={t.amount} size="text-base" className={t.paid ? "text-zinc-500" : "text-zinc-200"} />
          <PaidToggle paid={t.paid} onToggle={() => onTogglePaid(t)} />
        </div>
      ))}
    </div>
  )
}

// ─── Game Detail ──────────────────────────────────────────────────────────────
// Role-aware: the host who ran this game sees the full breakdown (every
// player, total pot, rake). A viewer who only played in it — not the host —
// sees just their own buy-in/cash-out, nothing about anyone else's numbers.
// `viewAsHost` is which lens you tapped in from (Host tab's Game History /
// Settlement Ledger vs Player tab's Recent Games / My Settlements) — not
// just "did this account technically host this game." Someone who hosts
// every one of their own games would otherwise see the full host breakdown
// every time they open a game from their Player tab, defeating the point of
// having a separate, restricted player view. Real host status still gates
// it (AND, not OR): the Player lens is always restricted, and the Host lens
// only ever shows full data for games you actually hosted.
function GameDetailScreen({ game, viewerName, viewAsHost, onBack, onNavigateLive, onTogglePaid }) {
  const [rakeVisible, setRakeVisible] = useState(false)
  const reallyHosted = !game.hostName || game.hostName === viewerName
  const isHost = viewAsHost && reallyHosted
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
          <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-300 text-sm mb-5 transition-colors">
            <X className="w-4 h-4" /> Back
          </button>
          <div className="text-white text-xl font-bold">{game.name}</div>
          <div className="text-zinc-400 text-sm mt-1">{game.date} · hosted by {game.hostName}</div>
        </div>
        <div className="px-5 pt-5 flex flex-col gap-2.5">
          <div className="bg-felt-surface border border-felt-border rounded-2xl p-4 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Your buy-ins</div>
            <NumB value={myIn} size="text-lg" className="text-white" />
          </div>
          <div className="bg-felt-surface border border-felt-border rounded-2xl p-4 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Your cash-out</div>
            <NumB value={myOut} size="text-lg" className="text-white" />
          </div>
          <div className="bg-felt-surface border border-felt-border rounded-2xl p-4 flex items-center justify-between">
            <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Your net</div>
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
          <button onClick={onBack} className="flex items-center gap-1.5 text-zinc-400 hover:text-zinc-300 text-sm mb-5 transition-colors">
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
          <div className="text-zinc-400 text-sm mt-1">{game.date} · {game.players.length} players</div>
          {!isClosed && (
            <button onClick={() => onNavigateLive?.()} className="mt-2 text-[11.5px] font-semibold text-gold-light hover:text-gold-light/80 transition-colors">
              Go to Live Game →
            </button>
          )}
        </div>
      </div>

      <div className="px-5 pt-4 grid grid-cols-3 gap-2.5">
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Pot</div>
          <NumB value={totalIn} size="text-[17px]" className="mt-1 text-white" />
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Players</div>
          <div className="mt-1 text-[17px] font-extrabold text-white">{game.players.length}</div>
        </div>
        <div className="bg-felt-surface border border-felt-border rounded-2xl px-3 py-2.5">
          <div className="flex items-center justify-between">
            <div className="text-[9.5px] font-bold uppercase tracking-wider text-zinc-400">Rake</div>
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
                <div className="text-xs text-zinc-400 font-mono">In {fmtB(totalBuyinsFor(p))} · Out {fmtB(p.cashoutAmount || 0)}</div>
              </div>
              <NumB value={pos.net} sign size="text-sm" className={pos.net > 0 ? "text-emerald-400" : pos.net < 0 ? "text-red-400" : "text-zinc-400"} />
            </div>
          )
        })}
      </div>

      <SL>Payments — {txns.length}</SL>
      {txns.length === 0 ? <div className="text-center py-6 text-zinc-400 text-sm">Everyone was even</div> : (
        <div className="px-5 flex flex-col gap-2">
          {txns.map((t, i) => (
            <div key={i} className="bg-felt-surface border border-felt-border rounded-xl px-4 py-3 flex items-center gap-3">
              <Av name={t.from} size={28} />
              <span className={cn("text-sm font-semibold", t.paid ? "text-zinc-500 line-through" : "text-red-400")}>{t.from}</span>
              <ChevronsRight className="w-4 h-4 text-zinc-400 shrink-0" />
              <NumB value={t.amount} size="text-sm" className={cn("flex-1", t.paid ? "text-zinc-500" : "text-amber-400")} />
              <Av name={t.to} size={28} />
              <span className={cn("text-sm font-semibold", t.paid ? "text-zinc-500 line-through" : "text-emerald-400")}>{t.to}</span>
              {/* Paid toggle only makes sense for a closed game's stored
                  settlement (stable id + index) — a live game's preview is
                  recomputed on the fly and has nothing to persist yet. */}
              {isClosed && onTogglePaid && (
                <PaidToggle paid={t.paid} onToggle={() => onTogglePaid(t)} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Bottom Nav ───────────────────────────────────────────────────────────────
// Host/Player moved into Home itself as a filter on its two tabs (see
// HomeScreen), so the bottom nav no longer needs to carry navigation at
// all — its only remaining job is a floating reminder that a game is live,
// shown on Home so it's reachable without scrolling back up to the Active
// Game card. Live Game itself has its own back-to-Home button in its
// header (see LiveGameScreen), so this never needs to appear there.
function LiveGameFab({ onClick }) {
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-40">
      <button
        onClick={onClick}
        className="flex items-center gap-2 bg-gold hover:bg-gold-dark text-white pl-3 pr-4 py-2.5 rounded-full shadow-2xl shadow-black/50 font-bold text-sm transition-colors"
      >
        <span className="relative w-2 h-2 shrink-0">
          <span className="absolute inset-0 rounded-full bg-white animate-blink" />
        </span>
        <Gamepad2 className="w-4 h-4" />
        Live Game
      </button>
    </div>
  )
}

// ─── App Root ─────────────────────────────────────────────────────────────────
export default function App() {
  const [authLoading, setAuthLoading] = useState(true)
  const [session, setSession]     = useState(null)
  const [profile, setProfile]     = useState(null)
  const [screen, setScreen]       = useState("home")
  // [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 1] Games live in
  // Supabase now, not localStorage — see refreshAllGames below. `activeGame`
  // is derived as "the one non-closed game this account hosts" (the local
  // model has only ever supported one at a time); `pastGames` is every
  // closed one. `gamesLoading` distinguishes "haven't fetched yet" from
  // "fetched, there's nothing" — there's a real network round trip now,
  // where local state never had that ambiguity.
  const [activeGame, setActiveGame] = useState(null)
  const [pastGames, setPastGames] = useState([])
  const [gamesLoading, setGamesLoading] = useState(true)
  const [selGame, setSelGame]     = useState(null)
  // Which lens a game-detail view was opened through — see GameDetailScreen.
  const [selGameAsHost, setSelGameAsHost] = useState(false)
  const [toast, setToast]         = useState(null)
  const toastRef = useRef(null)
  const togglingRef = useRef(new Set()) // in-flight settlement ids — see toggleSettlementPaid

  // Shared roster — single source of truth for "Your players", used by both
  // CreateGameScreen and LiveGameScreen's "Add late player" flow. Lifted to
  // App root so both screens read/write the same list. Fetched from Supabase
  // (known_players) below, once accountId is known — see addToRoster and the
  // fetch effect further down, near the games equivalents.
  const [roster, setRoster] = useState([])

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

  // Always point the magic link at the live site, never wherever the request
  // happened to be sent from — otherwise testing locally sends a link that
  // opens localhost on your phone, which doesn't exist there.
  const SITE_URL = import.meta.env.VITE_SITE_URL || window.location.origin
  const sendMagicLink = async (email) => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: SITE_URL },
    })
    if (error) throw error
  }

  const hostName = profile?.display_name || null

  const showToast = (icon, title, msg) => {
    clearTimeout(toastRef.current)
    setToast({ icon, title, msg })
    toastRef.current = setTimeout(() => setToast(null), 3000)
  }

  // ─── Game data (Supabase, Phase 1) ────────────────────────────────────────
  // [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 1] Refetch, not
  // realtime, for v1 — see that doc's "Open decision this phase forced."
  // Every mutation anywhere below writes via gamesApi.js, then calls
  // refreshAllGames() to pull the fresh server state back into
  // activeGame/pastGames — one source of truth, no optimistic-update-vs-
  // server-truth drift to reason about. `pastGames` includes every non-live
  // game (cashout OR closed) except whichever one is currently `activeGame`,
  // so a game that's mid-close (rare: a refresh landed between closeGame()
  // and the follow-up refresh) still shows up somewhere rather than
  // vanishing from both lists.
  const accountId = session?.user?.id || null

  const refreshAllGames = async (id = accountId) => {
    if (!id) return
    const games = await gamesApi.fetchHostedGames(id)
    const withHostName = games.map(g => ({ ...g, hostName }))
    const active = withHostName.find(g => g.status !== "closed") || null
    setActiveGame(active)
    setPastGames(withHostName.filter(g => g !== active))
  }

  useEffect(() => {
    let cancelled = false
    if (!accountId) {
      setActiveGame(null)
      setPastGames([])
      setGamesLoading(false)
      return
    }
    setGamesLoading(true)
    gamesApi.fetchHostedGames(accountId)
      .then(games => {
        if (cancelled) return
        const withHostName = games.map(g => ({ ...g, hostName }))
        const active = withHostName.find(g => g.status !== "closed") || null
        setActiveGame(active)
        setPastGames(withHostName.filter(g => g !== active))
      })
      .catch(err => {
        console.error("Failed to load games", err)
        if (!cancelled) showToast("⚠️", "Couldn't load your games", err.message || "Check your connection")
      })
      .finally(() => { if (!cancelled) setGamesLoading(false) })
    return () => { cancelled = true }
  }, [accountId])

  // A single place to report "a write to Supabase failed" — every mutation
  // handler below funnels its catch block through this, so the failure mode
  // is consistent (a toast, not a silently stuck UI) no matter which screen
  // it happened on.
  const reportError = (err, title = "Something went wrong") => {
    console.error(title, err)
    showToast("⚠️", title, err?.message || "Please try again")
  }

  // ─── Roster (Supabase known_players, Phase 1) ─────────────────────────────
  // Same refetch-after-write shape as game data above. addToRoster updates
  // local state optimistically first — a roster save is a low-stakes,
  // non-blocking side effect of adding a player, not something either caller
  // (CreateGameScreen's addPlayer, LiveGameScreen's addNewPlayer) awaits or
  // guards against failure for — so the roster chip should appear instantly
  // either way, with the real write happening in the background and only a
  // toast if it actually fails.
  useEffect(() => {
    let cancelled = false
    if (!accountId) { setRoster([]); return }
    knownPlayersApi.fetchRoster(accountId)
      .then(list => { if (!cancelled) setRoster(list) })
      .catch(err => { if (!cancelled) reportError(err, "Couldn't load your roster") })
    return () => { cancelled = true }
  }, [accountId])

  const addToRoster = (name, phone) => {
    const n = (name || "").trim()
    const ph = (phone || "").trim()
    if (!n) return
    setRoster(prev => {
      const idx = prev.findIndex(r => r.name.toLowerCase() === n.toLowerCase())
      if (idx >= 0) {
        const next = prev.slice()
        next[idx] = { ...next[idx], name: n, phone: ph || next[idx].phone || "" }
        return next
      }
      return [...prev, { name: n, phone: ph }]
    })
    if (!accountId) return
    knownPlayersApi.upsertRosterEntry(accountId, n, ph).catch(err => {
      reportError(err, "Couldn't save to your roster")
    })
  }

  const navigate = (s, data, asHost) => {
    if (s === "game-detail" && data) {
      setSelGame(data)
      setSelGameAsHost(!!asHost)
    }
    setScreen(s)
  }

  // Flips one settlement transfer's paid/pending status — the account
  // currently signed in can toggle any line (host or player lens), since
  // there's no separate logged-in "other side" to ask for confirmation yet.
  // `settlement.paid_by`/`paid_at` (set server-side by setSettlementPaid)
  // are the durable record of who flipped it and when — see
  // REQUIREMENTS.md -> Settlements ledger.
  //
  // `togglingRef` guards against a fast double-tap: the button itself isn't
  // visually disabled mid-request (this line renders in three different
  // list components), so without this a second tap before the first
  // request's refetch lands would read the same stale `settlement.paid` and
  // fire the exact same write twice instead of toggling back — silently
  // leaving the wrong status on a real-money ledger line.
  const toggleSettlementPaid = async (settlement) => {
    if (togglingRef.current.has(settlement.id)) return
    togglingRef.current.add(settlement.id)
    try {
      await gamesApi.setSettlementPaid(settlement.id, !settlement.paid, accountId)
      await refreshAllGames()
    } catch (err) {
      reportError(err, "Couldn't update payment status")
    } finally {
      togglingRef.current.delete(settlement.id)
    }
  }

  const logout = async () => { await supabase.auth.signOut(); setScreen("home") }

  // Persists the game the CreateGameScreen preview built (name/location/
  // players/starting buy-ins) and moves straight into Live Game once it's
  // actually in the database. Throws on failure so CreateGameScreen's own
  // button can reset its pending state — the toast here is the user-facing
  // half of that.
  const handleCreateGame = async (previewGame) => {
    try {
      const created = await gamesApi.createGame({
        hostId: accountId,
        name: previewGame.name,
        location: previewGame.location,
        rake: 0,
        players: previewGame.players.map(p => ({ name: p.name, phone: p.phone, startBuyins: p.startBuyins || 1 })),
      })
      setActiveGame({ ...created, hostName })
      navigate("live-game")
      showToast("🃏", "Game Started", created.name)
    } catch (err) {
      reportError(err, "Couldn't start game")
      throw err
    }
  }

  // The true "close" action: locks the game permanently (all buy-ins,
  // cash-outs, and rake for it become immutable) and stores the settlement
  // transfer list computed once here — closed games are never recomputed
  // live again, so history can't drift even if the settlement logic changes.
  // `transfers` is keyed by player NAME (SettlementScreen/computeSettlement's
  // shape) — resolved to game_player ids here, once, right before the write,
  // since that's the only shape gamesApi.writeSettlement accepts.
  const handleCloseGame = async (transfers) => {
    if (!activeGame) { setScreen("home"); return }
    try {
      const idByName = Object.fromEntries(activeGame.players.map(p => [p.name, p.id]))
      const withIds = (transfers || [])
        .map(t => ({ fromPlayerId: idByName[t.from], toPlayerId: idByName[t.to], amount: t.amount }))
        .filter(t => t.fromPlayerId && t.toPlayerId)
      await gamesApi.writeSettlement(activeGame.id, withIds)
      await gamesApi.closeGame(activeGame.id, { rake: activeGame.rake })
      await refreshAllGames()
      setScreen("home")
      showToast("🏁", "Saved", "Results added to your dashboard")
    } catch (err) {
      reportError(err, "Couldn't close game")
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-felt-bg">
        <div className="text-zinc-400 text-sm font-medium">Loading…</div>
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

  // Games load over the network now (Supabase, not localStorage) — this is
  // the window where accountId is known but the fetch hasn't resolved yet.
  // Gated here rather than earlier: Admin/PendingApproval above don't touch
  // game data at all, so there's no reason to block on it for those.
  if (gamesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-felt-bg">
        <div className="text-zinc-400 text-sm font-medium">Loading your games…</div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-[430px] sm:max-w-xl md:max-w-2xl min-h-screen bg-felt-bg mx-auto relative sm:px-2">
      {screen === "home"        && <HomeScreen hostName={hostName} activeGame={activeGame} pastGames={pastGames} onNavigate={navigate} onLogout={logout} isAdmin={isAdmin} onTogglePaid={toggleSettlementPaid} />}
      {screen === "create-game" && <CreateGameScreen pastGames={pastGames} roster={roster} addToRoster={addToRoster} onCancel={() => navigate("home")} onCreate={handleCreateGame} showToast={showToast} />}
      {screen === "live-game" && activeGame && <LiveGameScreen game={activeGame} onMutated={refreshAllGames} onNavigate={navigate} showToast={showToast} roster={roster} addToRoster={addToRoster} />}
      {screen === "cashout-entry" && activeGame && <CashoutEntryScreen game={activeGame} onMutated={refreshAllGames} onNavigate={navigate} showToast={showToast} />}
      {screen === "settlement" && activeGame && <SettlementScreen game={activeGame} onClose={handleCloseGame} onBack={() => navigate("cashout-entry")} showToast={showToast} />}
      {screen === "game-detail" && selGame && (
        <GameDetailScreen
          // Look the game up fresh from pastGames by id rather than using the
          // navigation-time snapshot directly — so toggling a settlement
          // line's paid status right here updates on screen immediately,
          // instead of only after leaving and reopening this game.
          game={pastGames.find(g => g.id === selGame.id) || selGame}
          viewerName={hostName}
          viewAsHost={selGameAsHost}
          onBack={() => navigate("home")}
          onNavigateLive={() => navigate("live-game")}
          onTogglePaid={toggleSettlementPaid}
        />
      )}
      {screen === "home" && !!activeGame && <LiveGameFab onClick={() => navigate(activeGame.status === "cashout" ? "cashout-entry" : "live-game")} />}
      <Toast toast={toast} />
    </div>
  )
}
