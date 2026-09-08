import * as React from "react"
import { cn } from "@/lib/utils"

// [M3 Expressive restyle, 2026-09-08] Not currently imported anywhere in
// App.jsx (screens use the app's own DInput), kept in sync. Taller (h-12)
// with felt-consistent dark styling instead of the light-mode white/slate
// leftovers.
const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-12 w-full rounded-2xl border border-felt-border bg-felt-surface-2 px-4 py-2 text-sm font-medium text-zinc-100 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-zinc-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:border-transparent disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})
Input.displayName = "Input"

export { Input }
