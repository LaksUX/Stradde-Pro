/// <reference types="nativewind/types" />

// TypeScript has no built-in notion of importing a .css file for its side
// effects (which is all NativeWind/Metro actually do with it) — this quiets
// "cannot find module" for those imports without pretending they export
// anything real.
declare module "*.css"
