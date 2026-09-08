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
// Two real limitations, not bugs in this code:
// 1. Since Expo SDK 53, Expo Go on Android no longer supports *remote* push
//    notifications at all (local/foreground notifications still work) —
//    getExpoPushTokenAsync() will throw or the resulting token won't
//    receive anything when running via Expo Go. A real end-to-end test
//    needs a development build (EAS Build), not Expo Go. See
//    https://expo.dev/changelog/sdk-53 (Notifications section).
// 2. getExpoPushTokenAsync() needs an EAS `projectId` (app.json's
//    `extra.eas.projectId`), which isn't configured yet — this project has
//    never run `eas init`/`eas build`. Without it this registers nothing
//    and resolves to null rather than throwing, so it's safe to call
//    speculatively (see registerForPushNotificationsAsync's early return).
import { Platform } from "react-native"
import * as Device from "expo-device"
import * as Notifications from "expo-notifications"
import Constants from "expo-constants"

// Foreground behavior — same shape regardless of what eventually sends a
// notification: show it, don't badge/sound-spam a money app by default.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
})

export async function registerForPushNotificationsAsync(): Promise<string | null> {
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
    // See header note #1 — expected to fail under Expo Go on Android
    // (SDK 53+) even with permission granted and a projectId configured.
    console.log("Push notifications: couldn't get an Expo push token", err)
    return null
  }
}
