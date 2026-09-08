// ─── Push notification registration — Phase 4 client half ─────────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 4] This is the CLIENT
// half only: request permission, obtain an Expo push token, and hand it to
// pushTokensApi.savePushToken() to store against the signed-in profile.
// What actually SENDS a settlement-reminder notification is deliberately
// not built here — that's server-side (a Supabase Edge Function on a
// schedule, per the migration plan), and needs real product decisions this
// pass didn't make (what counts as a reminder, how often, opt-out). This
// file only makes sure a token exists to send to, once that exists.
//
// [bug fix, 2026-09-08] `expo-notifications` is NOT statically imported at
// module scope here anymore. On Android, SDK 53+ removed remote push
// support from Expo Go — but critically, the package throws just from
// being IMPORTED under Expo Go on Android, not only when its push APIs are
// called. A top-level `import * as Notifications from "expo-notifications"`
// crashed this module at load time, which crashed AppContext.tsx (which
// imports it), which crashed _layout.tsx (which imports AppContext) — the
// whole app's module graph failed to evaluate, and every route showed up
// as "missing default export" as a downstream symptom, not a real routing
// problem. Fix: check the environment first using only safe-to-import
// modules (expo-constants, react-native's Platform), and `require()`
// expo-notifications lazily — only once we've confirmed we're not in the
// one environment where merely loading it throws.
//
// Two real limitations, not bugs in this code:
// 1. Since Expo SDK 53, Expo Go on Android no longer supports *remote* push
//    notifications at all — this function returns null immediately rather
//    than attempting registration there. A real end-to-end test needs a
//    development build (EAS Build), not Expo Go.
//    https://docs.expo.dev/develop/development-builds/introduction/
// 2. getExpoPushTokenAsync() needs an EAS `projectId` (app.json's
//    `extra.eas.projectId`), which isn't configured yet — this project has
//    never run `eas init`/`eas build`. Without it this registers nothing
//    and resolves to null rather than throwing.
import { Platform } from "react-native"
import Constants, { ExecutionEnvironment } from "expo-constants"

const isExpoGoAndroid = Platform.OS === "android" && Constants.executionEnvironment === ExecutionEnvironment.StoreClient

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (isExpoGoAndroid) {
    // See this file's header note #1 and the [bug fix] note above — do not
    // import expo-notifications at all in this environment.
    console.log("Push notifications: unavailable in Expo Go on Android (SDK 53+) — skipping")
    return null
  }

  // Lazy require, only reached once we've ruled out the one environment
  // where loading this module throws — see header note.
  const Device = require("expo-device")
  const Notifications = require("expo-notifications")

  if (!Device.isDevice) {
    // Simulators/emulators can't receive push at all.
    return null
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId
  if (!projectId) {
    // No EAS project configured yet — see this file's header note #2.
    // Not an error state; just nothing to register against yet.
    console.log("Push notifications: no EAS projectId configured, skipping registration")
    return null
  }

  // Foreground behavior — show it, don't badge/sound-spam a money app by
  // default. Configured here (lazily, on first real registration attempt)
  // rather than at module scope, for the same import-safety reason as
  // everything else in this function.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  })

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    })
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync()
  let finalStatus = existingStatus
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync()
    finalStatus = status
  }
  if (finalStatus !== "granted") {
    return null
  }

  try {
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId })
    return token
  } catch (err) {
    // Expected to still be able to fail here even past all the guards
    // above (e.g. a development build with a misconfigured projectId).
    console.log("Push notifications: couldn't get an Expo push token", err)
    return null
  }
}
