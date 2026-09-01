// Sovereign user preferences sync. Pulls /api/me/prefs on login + every 30s
// (visible-tab only) and on visibilitychange. Pushes any local theme/font/
// locale/customPalette/chatOrder change with an 800 ms debounce.
//
// Goal: when the same operator logs in on Mac and Dell, every preference
// (theme color, font family, font size, custom palette, UI language, chat
// pin/order) is mirrored across machines within ~30 s.
//
// localStorage stays as an OFFLINE cache only — the server is authoritative.

import { useEffect, useRef } from "react";
import { useAuth } from "./auth";
import { useTheme, type ThemeName, type Mode, type FontFamily, type CustomPalette } from "./theme";
import { useI18n } from "./i18n";
import { UserPrefsAPI } from "./api-client";
import { useChatStreamingFlag, useVisiblePoll } from "./use-visible-poll";

const PUSH_DEBOUNCE_MS = 800;

type ServerPrefs = {
  theme?: ThemeName;
  mode?: Mode;
  font?: FontFamily;
  fontSize?: number;
  customPalette?: CustomPalette;
  locale?: "tr" | "en";
  chatOrder?: { pinned: string[]; recent: string[] };
  sidebar?: { collapsed?: boolean };
};

export function UserPrefsProvider({ children }: { children: React.ReactNode }) {
  const { user, ready } = useAuth();
  const { theme, setTheme, mode, setMode, font, setFont, fontSize, setFontSize, custom, setCustom } = useTheme();
  const { locale, setLocale } = useI18n();
  const chatStreaming = useChatStreamingFlag();

  const userKey = user?.username ?? null;
  const lastAppliedRef = useRef<string>("");      // JSON.stringify of last server snapshot we wrote
  const lastPushedRef = useRef<string>("");       // last payload we pushed
  const pushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justAppliedRef = useRef<boolean>(false);  // suppress next push that originates from a pull

  // -------- pull --------
  const pull = async () => {
    if (!userKey) return;
    const r = await UserPrefsAPI.get();
    if (!r.ok) return;
    const p = (r.prefs ?? {}) as ServerPrefs;
    const snap = JSON.stringify(p);
    if (snap === lastAppliedRef.current) return;
    lastAppliedRef.current = snap;
    justAppliedRef.current = true;
    if (p.theme) setTheme(p.theme);
    if (p.mode) setMode(p.mode);
    if (p.font) setFont(p.font);
    if (typeof p.fontSize === "number") setFontSize(p.fontSize);
    if (p.customPalette) setCustom(p.customPalette);
    if (p.locale === "tr" || p.locale === "en") setLocale(p.locale);
    // chatOrder/sidebar are read by their own consumers via the same API.
    // Reset the suppression flag on the next tick so user-initiated changes
    // after this point are pushed normally.
    setTimeout(() => { justAppliedRef.current = false; }, 0);
  };

  useEffect(() => {
    if (!ready || !userKey) return;
    void pull();
    // visibilitychange → pull immediately on tab focus
    const onVis = () => { if (document.visibilityState === "visible") void pull(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, userKey]);

  useVisiblePoll(() => { void pull(); }, 30_000, !chatStreaming && !!userKey);

  // -------- push (debounced) --------
  useEffect(() => {
    if (!userKey || !ready) return;
    if (justAppliedRef.current) return; // change came from a pull, do not echo
    const payload: ServerPrefs = { theme, mode, font, fontSize, customPalette: custom, locale };
    const snap = JSON.stringify(payload);
    if (snap === lastPushedRef.current) return;
    if (pushTimerRef.current) clearTimeout(pushTimerRef.current);
    pushTimerRef.current = setTimeout(async () => {
      lastPushedRef.current = snap;
      const r = await UserPrefsAPI.put(payload as Record<string, unknown>);
      if (r.ok) lastAppliedRef.current = JSON.stringify(r.prefs);
    }, PUSH_DEBOUNCE_MS);
    return () => { if (pushTimerRef.current) clearTimeout(pushTimerRef.current); };
  }, [userKey, ready, theme, mode, font, fontSize, custom, locale]);

  return <>{children}</>;
}
