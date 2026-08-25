import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-indigo-600 text-white shadow hover:bg-indigo-700 active:scale-[0.98]",
        destructive: "bg-red-600 text-white shadow hover:bg-red-700",
        outline: "border border-white/20 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm",
        secondary: "bg-white/10 text-slate-700 hover:bg-slate-100 border border-slate-200",
        ghost: "hover:bg-slate-100 text-slate-600",
        link: "text-indigo-600 underline-offset-4 hover:underline",
        green: "bg-emerald-600 text-white shadow hover:bg-emerald-700",
        gold: "bg-amber-600 text-white shadow hover:bg-amber-700",
        whatsapp: "bg-[#25d366] text-white shadow hover:bg-[#1fb958]",
        danger: "bg-red-600 text-white shadow-lg hover:bg-red-700",
      },
      size: {
        default: "h-11 px-5",
        sm: "h-8 px-3 text-xs rounded-lg",
        lg: "h-13 px-8 text-base",
        xl: "h-14 px-8 text-base w-full",
        icon: "h-9 w-9 rounded-lg",
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
