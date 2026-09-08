import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

// [M3 Expressive restyle, 2026-09-08] Not currently imported anywhere in
// App.jsx (the app's real buttons are plain <button>s hand-styled per
// screen), but kept in sync with the token/shape system in case future
// work adopts it. Shape moved to fully pill (rounded-full, Contacts-app
// action-button style) instead of rounded-xl; default height bumped for a
// bigger touch target; light-mode leftover colors (slate-700, white/10,
// etc., which never matched this dark app) replaced with felt-consistent
// values.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-gold text-white shadow hover:bg-gold-dark active:scale-[0.98]",
        destructive: "bg-red-600 text-white shadow hover:bg-red-700",
        outline: "border border-felt-outline bg-felt-surface-2 text-white hover:bg-felt-surface-3",
        secondary: "bg-felt-surface-2 text-zinc-100 hover:bg-felt-surface-3 border border-felt-border",
        ghost: "hover:bg-felt-surface-2 text-zinc-300",
        link: "text-gold-light underline-offset-4 hover:underline",
        green: "bg-emerald-600 text-white shadow hover:bg-emerald-700",
        gold: "bg-gold-vivid text-[#241a05] shadow hover:brightness-95",
        whatsapp: "bg-[#25d366] text-white shadow hover:bg-[#1fb958]",
        danger: "bg-red-600 text-white shadow-lg hover:bg-red-700",
      },
      size: {
        default: "h-12 px-6",
        sm: "h-9 px-4 text-xs",
        lg: "h-14 px-8 text-base",
        xl: "h-16 px-8 text-base w-full",
        icon: "h-11 w-11 rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props}
    />
  )
})
Button.displayName = "Button"

export { Button, buttonVariants }
