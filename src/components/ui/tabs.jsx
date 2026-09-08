import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"
import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

// [M3 Expressive restyle, 2026-09-08] Taller pill track + felt-outline
// border so the segmented control reads as a bolder, more prominent
// grouped container (Contacts-app inspiration), not a thin hairline strip.
const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-11 items-center justify-center rounded-full bg-felt-surface-2 border border-felt-outline p-1 text-muted-foreground w-full",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

// Active tab moved from gold (primary — already the dominant CTA color
// everywhere else on screen) to bloom (tertiary), matching the native
// pass's reasoning: a tab selector in the same hue as every button reads
// as "another button," not a distinct control, and this gives the app a
// real secondary/tertiary role instead of an all-gold look.
const TabsTrigger = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex-1 inline-flex items-center justify-center whitespace-nowrap rounded-full py-2.5 text-[13px] font-bold ring-offset-background transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
      "text-zinc-400 hover:text-zinc-200 data-[state=active]:bg-bloom data-[state=active]:text-white data-[state=active]:shadow-md",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-2 ring-offset-background focus-visible:outline-none", className)}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
