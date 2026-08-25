import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-lg px-2.5 py-0.5 text-xs font-semibold font-mono transition-colors",
  {
    variants: {
      variant: {
        default: "bg-slate-100 text-slate-700",
        positive: "bg-emerald-50 text-emerald-700 border border-emerald-200",
        negative: "bg-red-50 text-red-700 border border-red-200",
        neutral: "bg-slate-100 text-slate-500",
        gold: "bg-amber-50 text-amber-700 border border-amber-200",
        indigo: "bg-indigo-50 text-indigo-700 border border-indigo-200",
        live: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30",
        custom: "bg-indigo-50 text-indigo-600 border border-indigo-200",
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
