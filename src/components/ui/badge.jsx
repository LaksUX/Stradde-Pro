import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

// [M3 Expressive restyle, 2026-09-08] default/neutral variants replaced
// their light-mode slate leftovers with felt-consistent values; live/gold/
// custom bumped to the new bolder gold-vivid/mint tones.
const badgeVariants = cva(
  "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold font-mono transition-colors",
  {
    variants: {
      variant: {
        default: "bg-felt-surface-2 text-zinc-300 border border-felt-border",
        positive: "bg-mint-container text-mint-light border border-mint/40",
        negative: "bg-red-500/15 text-red-400 border border-red-500/30",
        neutral: "bg-felt-surface-2 text-zinc-500 border border-felt-border",
        gold: "bg-gold-vivid/15 text-gold-light border border-gold-vivid/40",
        indigo: "bg-gold/10 text-gold-light border border-gold/30",
        live: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
        custom: "bg-gold/10 text-gold-light border border-gold/30",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

const Badge = React.forwardRef(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
))
Badge.displayName = "Badge"

export { Badge, badgeVariants }
