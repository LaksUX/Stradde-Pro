// ─── Create Game — ported from web App.jsx's CreateGameScreen ─────────────
// [decision, docs/MOBILE_MIGRATION_PLAN.md -> Phase 3] Two steps, same as
// web: configure name/date/time/location + players, "Start Game" builds a
// local preview object (not yet persisted) and shows the invite-preview
// step; "Continue to Live Game" is what actually calls gamesApi.createGame
// via AppStateContext's handleCreateGame, same real-persistence boundary as
// web. Date/Time fields are preview-only — the persisted game always
// starts "now" (games.started_at, DB default) — same documented
// simplification as web (see docs/MOBILE_MIGRATION_PLAN.md Phase 1 notes).
// The invite link is a stub, same as web: it doesn't route anywhere real
// yet, no phone verification.
//
// "Contacts" source tab imports real device contacts via expo-contacts,
// added 2026-09-08 — see the useEffect below for the load/permission flow.
// Web has no equivalent (no Contacts API in a browser without a much
// heavier picker integration); this is a mobile-only capability, same
// spirit as push notifications being native-only.
import { useState, useEffect } from "react"
import { View, Text, ScrollView, Pressable, TextInput, Linking } from "react-native"
import { useRouter } from "expo-router"
import * as Clipboard from "expo-clipboard"
// expo-contacts split into a new class-based API and a legacy function-
// based one (this file uses the legacy shape: requestPermissionsAsync,
// getContactsAsync, Fields.Name/PhoneNumbers). Importing the default entry
// point still works but logs a deprecation warning on every call; the
// explicit /legacy import is Expo's own documented way to keep using this
// shape without the warning, since a rewrite to the new Contact class API
// is a bigger, riskier change than this feature needs right now.
// https://docs.expo.dev/guides/sdk-libraries-migration/contacts/
import * as Contacts from "expo-contacts/legacy"
import { useAppState } from "@/lib/AppContext"
import { BANK } from "@core/money"
import { Av, SegTabs, cn } from "@/components/game-ui"

const nowStr = () => {
  const d = new Date()
  let h = d.getHours(),
    m = d.getMinutes()
  const ap = h >= 12 ? "PM" : "AM"
  h = h % 12 || 12
  return `${h}:${String(m).padStart(2, "0")} ${ap}`
}

type DraftPlayer = { name: string; phone: string; startBuyins: number }

export default function CreateGameRoute() {
  const router = useRouter()
  const { pastGames, roster, addToRoster, showToast, handleCreateGame } = useAppState()

  const lastGame = pastGames[0]
  const [name, setName] = useState(lastGame?.name || "")
  const [date, setDate] = useState(new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" }))
  const [time, setTime] = useState(nowStr())
  const [location, setLocation] = useState(lastGame?.location || "")
  const [players, setPlayers] = useState<DraftPlayer[]>([])
  const [nameInput, setNameInput] = useState("")
  const [phoneInput, setPhoneInput] = useState("")
  const [source, setSource] = useState(roster.length > 0 ? "Your players" : "Type in")
  const [createdGame, setCreatedGame] = useState<any>(null)
  const [copied, setCopied] = useState(false)
  const [creating, setCreating] = useState(false)

  const notAdded = roster.filter((r) => !players.find((p) => p.name.toLowerCase() === r.name.toLowerCase()))

  // ─── Device contacts import ────────────────────────────────────────────
  // Lazy-loaded the first time the "Contacts" tab is opened (not on mount —
  // no reason to prompt for the permission before the user asks for it).
  // "denied" covers both a fresh no-tap-through and the OS remembering an
  // earlier denial (which iOS/Android won't re-prompt for — only Settings
  // can flip it back), so the fallback there points at Settings directly.
  const [contactsStatus, setContactsStatus] = useState<"idle" | "loading" | "granted" | "denied" | "error">("idle")
  const [deviceContacts, setDeviceContacts] = useState<{ id: string; name: string; phone: string }[]>([])
  const [contactsSearch, setContactsSearch] = useState("")

  useEffect(() => {
    if (source !== "Contacts" || contactsStatus !== "idle") return
    let cancelled = false
    setContactsStatus("loading")
    // Deliberately NOT depending on contactsStatus below (only `source`) —
    // this effect itself sets contactsStatus to "loading" a few lines up,
    // and if that were a dependency, the resulting re-render would re-run
    // this very effect, whose cleanup marks THIS in-flight request
    // `cancelled` before requestPermissionsAsync()/getContactsAsync() ever
    // resolve. The status check above still reads the current value fine
    // without needing to react to its own changes — this was the actual
    // bug behind "stuck on Loading your contacts…" (2026-09-08).
    ;(async () => {
      try {
        const { status } = await Contacts.requestPermissionsAsync()
        if (cancelled) return
        if (status !== "granted") {
          setContactsStatus("denied")
          return
        }
        const { data } = await Contacts.getContactsAsync({
          fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers],
        })
        if (cancelled) return
        const withPhones = data
          .map((c) => {
            const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(" ")
            const rawPhone = c.phoneNumbers && c.phoneNumbers.length > 0 ? c.phoneNumbers[0].number : ""
            return { id: c.id || name, name, phone: (rawPhone || "").replace(/[^\d+]/g, "") }
          })
          .filter((c) => c.name && c.phone)
          .sort((a, b) => a.name.localeCompare(b.name))
        setDeviceContacts(withPhones)
        setContactsStatus("granted")
      } catch (err) {
        console.log("Loading device contacts failed:", err)
        if (!cancelled) setContactsStatus("error")
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see comment above
  }, [source])

  const filteredContacts = contactsSearch.trim()
    ? deviceContacts.filter((c) => c.name.toLowerCase().includes(contactsSearch.trim().toLowerCase()))
    : deviceContacts
  const contactsNotAdded = filteredContacts.filter((c) => !players.find((p) => p.name.toLowerCase() === c.name.toLowerCase()))
  const contactsToShow = contactsSearch.trim() ? contactsNotAdded : contactsNotAdded.slice(0, 40)

  const addPlayer = (n: string, ph: string) => {
    const t = n.trim(),
      phone = (ph || "").trim()
    if (!t || !phone || players.find((p) => p.name.toLowerCase() === t.toLowerCase())) return
    setPlayers((prev) => [...prev, { name: t, phone, startBuyins: 1 }])
    addToRoster(t, phone)
    setNameInput("")
    setPhoneInput("")
  }

  const removePlayer = (n: string) => setPlayers((prev) => prev.filter((p) => p.name !== n))

  const adjustStartBuyins = (n: string, delta: number) =>
    setPlayers((prev) => prev.map((p) => (p.name === n ? { ...p, startBuyins: Math.min(12, Math.max(1, (p.startBuyins || 1) + delta)) } : p)))

  const canStart = !!name.trim() && players.length > 0

  const handleStart = () => {
    if (!canStart) return
    const game = {
      id: Date.now(),
      name: name.trim(),
      date,
      time,
      location,
      buyinAmount: BANK,
      rake: 0,
      status: "live",
      players: players.map((p) => ({ name: p.name, phone: p.phone, startBuyins: p.startBuyins || 1 })),
    }
    setCreatedGame(game)
  }

  const inviteText = () => {
    const g = createdGame
    return [
      `🃏 ${g.name} ♠`,
      g.location ? `📍 ${g.location}` : null,
      `🕘 ${g.date}${g.time ? `, ${g.time}` : ""}`,
      ``,
      `You're invited! Players:`,
      ...g.players.map((p: any) => `• ${p.name}`),
      ``,
      `https://straddle-pro.vercel.app/g/${g.id}`,
    ]
      .filter((l) => l !== null)
      .join("\n")
  }

  const copyInvite = async () => {
    try {
      await Clipboard.setStringAsync(inviteText())
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const startLiveGame = async () => {
    if (creating) return
    setCreating(true)
    try {
      await handleCreateGame(createdGame)
    } catch {
      // handleCreateGame already reported it via showToast
    } finally {
      setCreating(false)
    }
  }

  if (createdGame) {
    return (
      <View className="flex-1 bg-felt-bg">
        <ScrollView>
          <View className="px-5 pt-14 pb-6 border-b border-felt-border">
            <View className="flex-row items-center gap-2">
              <Text className="text-emerald-400 text-lg">✓</Text>
              <Text className="text-white text-xl font-black tracking-tight">Game Created</Text>
            </View>
            <Text className="text-zinc-400 text-sm mt-1">Invite your players, then jump into the game</Text>
          </View>

          <View className="px-5 pt-5 gap-4 pb-10">
            <View className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-[18px]">
              <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500 mb-2">Invite Preview</Text>
              <View className="bg-felt-bg/60 border border-felt-border rounded-2xl p-3.5">
                <Text className="text-[13px] leading-relaxed text-zinc-300">{inviteText()}</Text>
              </View>
              <Text className="text-[10.5px] text-zinc-400 mt-2 leading-relaxed">
                Stub: this link doesn't route anywhere real yet and phones aren't verified — anyone with the link could open it once a real join page
                exists.
              </Text>
            </View>

            <Pressable onPress={copyInvite} className="w-full h-12 bg-[#25d366] rounded-full items-center justify-center">
              <Text className="text-white font-bold text-sm">{copied ? "Copied!" : "Copy WhatsApp invite link"}</Text>
            </Pressable>

            <Pressable
              disabled={creating}
              onPress={startLiveGame}
              className={cn("w-full h-12 rounded-full items-center justify-center", creating ? "bg-gold/50" : "bg-gold")}
            >
              <Text className="text-[#241a05] font-bold text-sm">{creating ? "Starting…" : "Continue to Live Game"}</Text>
            </Pressable>
          </View>
        </ScrollView>
      </View>
    )
  }

  return (
    <View className="flex-1 bg-felt-bg">
      <ScrollView>
        {/* Header */}
        <View className="px-5 pt-14 pb-6 border-b border-felt-border">
          <Pressable onPress={() => router.replace("/")} className="flex-row items-center gap-1.5 mb-5">
            <Text className="text-zinc-500 text-sm">✕</Text>
            <Text className="text-zinc-500 text-sm">Cancel</Text>
          </Pressable>
          <Text className="text-white text-xl font-black tracking-tight">New Game</Text>
          <Text className="text-zinc-400 text-sm mt-1">Configure the session</Text>
        </View>

        <View className="px-5 pt-5 gap-5 pb-10">
          {/* Game info */}
          <View className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-[18px] gap-4">
            <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500">Game Details</Text>
            <View className="gap-3">
              <DInput label="Game Name" placeholder="e.g. Friday Night Felts" value={name} onChangeText={setName} />
              <View className="flex-row gap-3">
                <View className="flex-1">
                  <DInput label="Date" value={date} onChangeText={setDate} />
                </View>
                <View className="flex-1">
                  <DInput label="Time" value={time} onChangeText={setTime} />
                </View>
              </View>
              <DInput label="Location (optional)" placeholder="e.g. Raj's place" value={location} onChangeText={setLocation} />
            </View>
          </View>

          {/* Players */}
          <View className="bg-felt-surface-2 border border-felt-outline rounded-3xl p-[18px]">
            <Text className="text-[10px] font-bold tracking-[2px] uppercase text-zinc-500 mb-3">
              Add players{players.length > 0 ? ` · ${players.length} in` : ""}
            </Text>

            {players.length > 0 && (
              <View className="flex-row flex-wrap gap-1.5 mb-3.5">
                {players.map((p) => (
                  <View key={p.name} className="flex-row items-center gap-2 bg-felt-surface-3 border border-felt-outline rounded-full pl-1 pr-1.5 py-1">
                    <Av name={p.name} size={26} />
                    <View>
                      <Text className="text-[12.5px] font-semibold text-zinc-200">{p.name}</Text>
                      <Text className="text-[9.5px] font-mono text-zinc-500">{p.phone}</Text>
                    </View>
                    <View className="flex-row items-center gap-1 bg-felt-bg/60 border border-felt-border rounded-full pl-1.5 pr-0.5 py-0.5 ml-0.5">
                      <Pressable
                        onPress={() => adjustStartBuyins(p.name, -1)}
                        disabled={(p.startBuyins || 1) <= 1}
                        className="w-4 h-4 rounded-full items-center justify-center"
                      >
                        <Text className={cn("text-xs font-bold", (p.startBuyins || 1) <= 1 ? "text-zinc-600" : "text-zinc-400")}>−</Text>
                      </Pressable>
                      <Text className="text-[11px] font-mono font-bold text-zinc-300 w-3 text-center">{p.startBuyins || 1}</Text>
                      <Pressable
                        onPress={() => adjustStartBuyins(p.name, 1)}
                        disabled={(p.startBuyins || 1) >= 12}
                        className="w-4 h-4 rounded-full items-center justify-center"
                      >
                        <Text className={cn("text-xs font-bold", (p.startBuyins || 1) >= 12 ? "text-zinc-600" : "text-zinc-400")}>+</Text>
                      </Pressable>
                    </View>
                    <Pressable onPress={() => removePlayer(p.name)} className="w-[18px] h-[18px] rounded-full bg-zinc-700 items-center justify-center ml-0.5">
                      <Text className="text-[10px] font-bold text-zinc-400">✕</Text>
                    </Pressable>
                  </View>
                ))}
              </View>
            )}

            <SegTabs tabs={["Your players", "Contacts", "Type in"]} active={source} onChange={setSource} />

            <View className="mt-3">
              {source === "Your players" &&
                (notAdded.length > 0 ? (
                  <View>
                    <Text className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider mb-2">Tap to add · name + saved number</Text>
                    <View className="flex-row flex-wrap gap-1.5">
                      {notAdded.map((r) => (
                        <Pressable
                          key={r.name}
                          onPress={() => {
                            if (r.phone) addPlayer(r.name, r.phone)
                            else {
                              setSource("Type in")
                              setNameInput(r.name)
                            }
                          }}
                          className="flex-row items-center gap-1.5 px-3 py-2 border border-dashed border-felt-outline rounded-full"
                        >
                          <Text className="text-gold-light font-bold text-xs">+</Text>
                          <Text className="text-zinc-400 text-xs font-medium">{r.name}</Text>
                          {!r.phone && <Text className="text-amber-500 text-[10px]">· add #</Text>}
                        </Pressable>
                      ))}
                    </View>
                  </View>
                ) : (
                  <Text className="text-center py-5 text-zinc-400 text-xs font-medium">Everyone from your history is already added</Text>
                ))}

              {source === "Contacts" && (
                <View>
                  {contactsStatus === "loading" && (
                    <Text className="text-center py-6 text-zinc-400 text-xs font-medium">Loading your contacts…</Text>
                  )}
                  {contactsStatus === "denied" && (
                    <View className="items-center py-5 gap-2.5 px-2">
                      <Text className="text-center text-zinc-400 text-xs font-medium leading-relaxed">
                        Contacts access was denied. Enable it in Settings to import players from your phone.
                      </Text>
                      <Pressable
                        onPress={() => Linking.openSettings()}
                        className="px-4 h-9 rounded-full bg-felt-surface-3 border border-felt-outline items-center justify-center"
                      >
                        <Text className="text-zinc-300 text-xs font-bold">Open Settings</Text>
                      </Pressable>
                    </View>
                  )}
                  {contactsStatus === "error" && (
                    <Text className="text-center py-6 text-zinc-400 text-xs font-medium">Couldn't load contacts — try again in a moment.</Text>
                  )}
                  {contactsStatus === "granted" && (
                    <View>
                      <TextInput
                        className="w-full h-12 bg-felt-surface-2 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm mb-2.5"
                        placeholder="Search contacts…"
                        placeholderTextColor="#a1a1aa"
                        value={contactsSearch}
                        onChangeText={setContactsSearch}
                      />
                      {deviceContacts.length === 0 ? (
                        <Text className="text-center py-5 text-zinc-400 text-xs font-medium">No contacts with phone numbers found</Text>
                      ) : contactsToShow.length === 0 ? (
                        <Text className="text-center py-5 text-zinc-400 text-xs font-medium">
                          {contactsSearch.trim() ? "No matches" : "Everyone from your contacts is already added"}
                        </Text>
                      ) : (
                        <ScrollView className="max-h-72" nestedScrollEnabled showsVerticalScrollIndicator={false}>
                          <View className="gap-1.5">
                            {contactsToShow.map((c) => (
                              <Pressable
                                key={c.id}
                                onPress={() => addPlayer(c.name, c.phone)}
                                className="flex-row items-center gap-2.5 bg-felt-surface-3/70 border border-felt-outline rounded-2xl px-3 py-2.5"
                              >
                                <Av name={c.name} size={28} />
                                <View className="flex-1">
                                  <Text className="text-[12.5px] font-semibold text-zinc-200">{c.name}</Text>
                                  <Text className="text-[10px] font-mono text-zinc-500">{c.phone}</Text>
                                </View>
                                <Text className="text-gold-light font-bold text-base">+</Text>
                              </Pressable>
                            ))}
                          </View>
                          {!contactsSearch.trim() && contactsNotAdded.length > 40 && (
                            <Text className="text-center text-[10.5px] text-zinc-500 mt-2 mb-1">
                              Showing 40 of {contactsNotAdded.length} — search to find more
                            </Text>
                          )}
                        </ScrollView>
                      )}
                    </View>
                  )}
                </View>
              )}

              {source === "Type in" && (
                <View className="gap-2">
                  <TextInput
                    className="w-full h-12 bg-felt-surface-2 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm"
                    placeholder="Player's name…"
                    placeholderTextColor="#a1a1aa"
                    value={nameInput}
                    onChangeText={setNameInput}
                  />
                  <View className="flex-row gap-2 items-center">
                    <TextInput
                      className="flex-1 h-12 bg-felt-surface-2 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm"
                      placeholder="Phone number (required)…"
                      placeholderTextColor="#a1a1aa"
                      keyboardType="phone-pad"
                      value={phoneInput}
                      onChangeText={setPhoneInput}
                      onSubmitEditing={() => addPlayer(nameInput, phoneInput)}
                    />
                    {nameInput.trim() && phoneInput.trim() && (
                      <Pressable onPress={() => addPlayer(nameInput, phoneInput)} className="px-4 h-10 bg-gold rounded-full items-center justify-center">
                        <Text className="text-[#241a05] text-xs font-bold">Add</Text>
                      </Pressable>
                    )}
                  </View>
                  {nameInput.trim() && !phoneInput.trim() && (
                    <Text className="text-[10.5px] text-amber-500 font-medium">Phone number is required to add a player</Text>
                  )}
                </View>
              )}
            </View>
          </View>

          <Pressable disabled={!canStart} onPress={handleStart} className={cn("w-full h-[52px] rounded-full items-center justify-center py-3.5", !canStart ? "bg-gold/40" : "bg-gold")}>
            <Text className="text-[#241a05] font-bold text-sm">
              Start Game
              {!name.trim() ? " · add a game name" : players.length === 0 ? " · add at least 1 player" : ` · ${players.length} players`}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  )
}

function DInput({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label?: string
  value: string
  onChangeText: (v: string) => void
  placeholder?: string
}) {
  return (
    <View>
      {label && <Text className="text-[10px] font-bold tracking-[1.5px] uppercase text-zinc-500 mb-1.5">{label}</Text>}
      <TextInput
        className="w-full h-12 bg-felt-surface-2 border border-felt-border rounded-2xl px-4 text-zinc-100 text-sm"
        placeholder={placeholder}
        placeholderTextColor="#a1a1aa"
        value={value}
        onChangeText={onChangeText}
      />
    </View>
  )
}
