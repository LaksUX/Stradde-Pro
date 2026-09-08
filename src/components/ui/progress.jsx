import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"
import { cn } from "@/lib/utils"

// [M3 Expressive restyle, 2026-09-08] Thicker bar (h-2.5 vs h-2) and the
// felt-surface-2 track (was generic slate-100, a light-mode leftover that
// never matched this dark app) so the unfilled portion reads as part of
// the felt system instead of a stray light gray.
const Progress = React.forwardRef(({ className, value, indicatorClassName, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn("relative h-2.5 w-full overflow-hidden rounded-full bg-felt-surface-2", className)}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className={cn("h-full w-full flex-1 bg-mint transition-all duration-300", indicatorClassName)}
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
