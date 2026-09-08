// ─── Net trend chart — ported from web App.jsx's NetTrendChart ────────────
// Uses react-native-svg for the actual line/area chart, same geometry math
// as web. Simplified from web's version: no draw-in animation (requestAnimationFrame
// + CSS stroke-dashoffset/opacity transitions) — renders the finished chart
// immediately. That's a deliberate "ship the data visualization, skip the
// polish for now" trim, not a missing feature; can revisit later.
//
// [decision, M3 Expressive restyle, 2026-09-08] "Up" swapped from generic
// Tailwind emerald to the app's own mint (M3 secondary) so a positive trend
// reads as brand-colored, not a stock green; "down" stays on red/error —
// that's a semantic (danger) color, not a brand hue, so it's deliberately
// left alone. The zero-line dash color moved from generic zinc to
// felt-outline so it reads as part of the felt system rather than a
// leftover default gray.
import { View, Text } from "react-native"
import Svg, { Defs, LinearGradient, Stop, Line, Path, Circle } from "react-native-svg"
import { totalBuyinsFor } from "@core/settlement"
import { NumB } from "./game-ui"

export function NetTrendChart({ pastGames, hostName }: { pastGames: any[]; hostName: string | null }) {
  const W = 340,
    H = 120,
    PAD = 12

  const chrono = [...pastGames].reverse()
  let running = 0
  const points = chrono.map((g) => {
    const h = g.players.find((p: any) => p.name === hostName)
    const net = h ? (h.cashoutAmount || 0) - totalBuyinsFor(h) : 0
    running += net
    return { label: g.date, cum: running }
  })

  if (points.length < 2) {
    return (
      <View className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-4 py-6 items-center">
        <Text className="text-zinc-400 text-xs font-medium text-center">Play a couple more games to see your trend</Text>
      </View>
    )
  }

  const vals = points.map((p) => p.cum)
  const min = Math.min(0, ...vals),
    max = Math.max(0, ...vals)
  const range = max - min || 1
  const x = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2)
  const y = (v: number) => H - PAD - ((v - min) / range) * (H - PAD * 2)
  const zeroY = y(0)

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(i).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(" ")
  const areaPath = `${linePath} L ${x(points.length - 1).toFixed(1)} ${zeroY.toFixed(1)} L ${x(0).toFixed(1)} ${zeroY.toFixed(1)} Z`

  const last = vals[vals.length - 1]
  const up = last >= 0
  const lineColor = up ? "#b7e1cd" : "#f87171"
  const fillColor = up ? "#3b9169" : "#ef4444"

  return (
    <View className="bg-felt-surface-2 border border-felt-outline rounded-3xl px-4 pt-4 pb-3">
      <View className="flex-row items-center justify-between mb-2">
        <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500">Net Trend</Text>
        <NumB value={last} sign size="text-sm" className={up ? "text-mint-light" : "text-red-400"} />
      </View>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        <Defs>
          <LinearGradient id="netFillG" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={fillColor} stopOpacity={0.28} />
            <Stop offset="100%" stopColor={fillColor} stopOpacity={0} />
          </LinearGradient>
        </Defs>
        <Line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="#4d6658" strokeWidth={1} strokeDasharray="3 3" />
        <Path d={areaPath} fill="url(#netFillG)" />
        <Path d={linePath} fill="none" stroke={lineColor} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <Circle key={i} cx={x(i)} cy={y(p.cum)} r={i === points.length - 1 ? 3.5 : 2.5} fill={lineColor} />
        ))}
      </Svg>
    </View>
  )
}
