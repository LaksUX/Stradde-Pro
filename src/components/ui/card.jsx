import * as React from "react"
import { cn } from "@/lib/utils"

// [M3 Expressive restyle, 2026-09-08] Not currently imported anywhere in
// App.jsx (screens build their own card-like rows inline), kept in sync
// for future use. Rounder corners (3xl) and felt-surface-2/felt-outline
// instead of the light-mode white/slate leftovers, matching the
// Contacts-app "rounded card-per-row container" look used across the rest
// of the redesign.
const Card = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("rounded-3xl bg-felt-surface-2 border border-felt-outline overflow-hidden", className)} {...props} />
))
Card.displayName = "Card"

const CardHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col space-y-1 p-5", className)} {...props} />
))
CardHeader.displayName = "CardHeader"

const CardTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h3 ref={ref} className={cn("font-extrabold text-base leading-none tracking-tight text-white", className)} {...props} />
))
CardTitle.displayName = "CardTitle"

const CardContent = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-5 pt-0", className)} {...props} />
))
CardContent.displayName = "CardContent"

const CardFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex items-center p-5 pt-0", className)} {...props} />
))
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardTitle, CardContent, CardFooter }
