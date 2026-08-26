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
      "fixed inset-0 z-[90] bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
))
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName

// Sheet always slides up from the bottom, matching the app's existing
// bottom-sheet UX (side="bottom" is the only variant used in this app).
const SheetContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <SheetPortal>
    <SheetOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-[90] left-1/2 -translate-x-1/2 bottom-0 w-full max-w-[430px] sm:max-w-md bg-felt-surface border border-felt-border border-b-0 rounded-t-3xl px-4.5 pt-2.5 pb-6 shadow-[0_-20px_50px_-20px_rgba(0,0,0,0.7)] animate-sheet-up",
        className
      )}
      {...props}
    >
      <div className="w-9 h-1 rounded-full bg-zinc-700 mx-auto mb-3.5" />
      {children}
    </DialogPrimitive.Content>
  </SheetPortal>
))
SheetContent.displayName = DialogPrimitive.Content.displayName

const SheetHeader = ({ className, avatar, title, subtitle, onClose, ...props }) => (
  <div className={cn("flex items-center gap-2.5 mb-4", className)} {...props}>
    {avatar}
    <div className="flex-1 min-w-0">
      {title && <div className="text-[16.5px] font-extrabold tracking-tight text-white truncate">{title}</div>}
      {subtitle && <div className="text-[11.5px] text-zinc-500 font-mono mt-0.5">{subtitle}</div>}
    </div>
    <DialogPrimitive.Close className="w-7 h-7 rounded-lg bg-felt-surface-2 border border-felt-border flex items-center justify-center text-zinc-400 hover:text-white transition-colors shrink-0">
      <X className="w-3.5 h-3.5" />
    </DialogPrimitive.Close>
  </div>
)

export { Sheet, SheetTrigger, SheetClose, SheetPortal, SheetOverlay, SheetContent, SheetHeader }
