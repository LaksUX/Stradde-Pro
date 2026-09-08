import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

const Sheet = DialogPrimitive.Root
const SheetTrigger = DialogPrimitive.Trigger
const SheetClose = DialogPrimitive.Close
const SheetPortal = DialogPrimitive.Portal

const SheetOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[90] bg-black/60 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

// [M3 Expressive restyle, 2026-09-08] Bumped to felt-surface-3 + felt-outline
// (same elevation tier as Dialog/Toast) so the sheet clearly reads as
// floating above the screen. Grab handle enlarged for a bigger, more
// obvious touch/drag affordance — Contacts-app sheets favor a chunkier
// handle over a hairline one.
const SheetContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-[90] left-1/2 -translate-x-1/2 bottom-0 w-full max-w-[430px] sm:max-w-md bg-felt-surface-3 border border-felt-outline border-b-0 rounded-t-[28px] px-4.5 pt-3 pb-6 shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.7)] animate-sheet-up",
        className
      )}
      {...props}
    >
      <div className="w-11 h-1.5 rounded-full bg-felt-outline mx-auto mb-4" />
      {children}
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = DialogPrimitive.Content.displayName

const SheetHeader = ({ className, avatar, title, subtitle, onClose, ...props }) => (
  <div className={cn("flex items-center gap-2.5 mb-4", className)} {...props}>
    {avatar}
    <div className="flex-1 min-w-0">
      {title && <div className="text-[17px] font-extrabold tracking-tight text-white truncate">{title}</div>}
      {subtitle && <div className="text-[11.5px] text-zinc-500 font-mono mt-0.5">{subtitle}</div>}
    </div>
    <DialogPrimitive.Close className="w-9 h-9 rounded-full bg-felt-surface-2 border border-felt-border flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0">
      <X className="w-4 h-4" />
    </DialogPrimitive.Close>
  </div>
)

export { Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay, SheetContent, SheetHeader }
