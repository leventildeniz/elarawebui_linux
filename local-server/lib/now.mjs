// REALTIME CONTEXT util — sunucu otoritesi + opsiyonel kullanıcı TZ hint'i.
// Tek üretim noktası: chat stream/orchestrate + agent env + warmup hepsi
// burayı çağırır. Plan: mem://decisions/realtime-now-context-2026-06-02.md.
//
// Davranış:
//   - server_now SABİT Europe/Istanbul. (Operator merkezi sabit kabul edildi —
//     ileride brand.tz gibi bir alandan okumak istersek tek dosyada açılır.)
//   - userNow geçersiz / yoksa user_local satırı düşer; sunucu otoritesi tek
//     başına kalır.
//
// API:
//   buildNowPreamble({userNow, userTz}) -> string  (LLM system block)
//   parseNowHeaders(request)            -> {userNow, userTz} (validated)
//   nowEnvFor({userNow, userTz})        -> {ELARA_NOW_SERVER, ELARA_NOW_EPOCH_MS,
//                                            ELARA_TZ_SERVER, ELARA_NOW_USER?,
//                                            ELARA_TZ_USER?}

const SERVER_TZ = "Europe/Istanbul";
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

function _validTimeZone(tz) {
  if (!tz || typeof tz !== "string") return false;
  // IANA TZ adlarında letter/digit + / + _ + - + + dışı karakter yok.
  if (tz.length > 64 || !/^[A-Za-z0-9_+\-\/]+$/.test(tz)) return false;
  try {
    // Intl yanlışsa fırlatır.
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch { return false; }
}

function _validISO(s) {
  if (!s || typeof s !== "string" || s.length > 40) return false;
  if (!ISO_RE.test(s)) return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}

function _formatLocal(date, tz, opts = {}) {
  // "2026-06-02 19:50:33 Europe/Istanbul (Salı)"
  const includeDow = opts.includeDow !== false;
  const includeSec = opts.includeSec !== false;
  const fmt = new Intl.DateTimeFormat("tr-TR", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    ...(includeSec ? { second: "2-digit" } : {}),
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(date).map(p => [p.type, p.value]));
  const ymd = `${parts.year}-${parts.month}-${parts.day}`;
  const hms = includeSec ? `${parts.hour}:${parts.minute}:${parts.second}` : `${parts.hour}:${parts.minute}`;
  let out = `${ymd} ${hms} ${tz}`;
  if (includeDow) {
    const dow = new Intl.DateTimeFormat("tr-TR", { timeZone: tz, weekday: "long" }).format(date);
    out += ` (${dow.charAt(0).toLocaleUpperCase("tr-TR")}${dow.slice(1)})`;
  }
  return out;
}

export function parseNowHeaders(request) {
  const out = { userNow: null, userTz: null };
  if (!request) return out;
  // Support both Express (req.headers as plain object) and Fetch (request.headers.get).
  const h = request.headers;
  let rawNow = null, rawTz = null;
  if (h && typeof h.get === "function") {
    rawNow = h.get("x-user-now");
    rawTz  = h.get("x-user-tz");
  } else if (h && typeof h === "object") {
    rawNow = h["x-user-now"] || h["X-User-Now"] || null;
    rawTz  = h["x-user-tz"]  || h["X-User-Tz"]  || null;
  }
  if (rawNow && _validISO(String(rawNow))) out.userNow = String(rawNow);
  if (rawTz  && _validTimeZone(String(rawTz))) out.userTz = String(rawTz);
  return out;
}

export function buildNowPreamble({ userNow = null, userTz = null } = {}) {
  const now = new Date();
  const serverLine = _formatLocal(now, SERVER_TZ);
  const lines = [
    "[REALTIME CONTEXT]",
    `server_now: ${serverLine}`,
    `epoch_ms: ${now.getTime()}`,
  ];
  if (userNow && userTz && _validISO(userNow) && _validTimeZone(userTz)) {
    try {
      const ud = new Date(userNow);
      if (Number.isFinite(ud.getTime())) {
        lines.push(`user_local: ${_formatLocal(ud, userTz, { includeSec: false, includeDow: false })}`);
      }
    } catch { /* drop silently */ }
  }
  lines.push("Bilgi kesim tarihini değil, bu bloğu gerçek 'şu an' olarak kullan.");
  return lines.join("\n");
}

export function nowEnvFor({ userNow = null, userTz = null } = {}) {
  const now = new Date();
  const env = {
    ELARA_NOW_SERVER: _formatLocal(now, SERVER_TZ),
    ELARA_NOW_EPOCH_MS: String(now.getTime()),
    ELARA_TZ_SERVER: SERVER_TZ,
  };
  if (userNow && _validISO(userNow)) env.ELARA_NOW_USER = userNow;
  if (userTz && _validTimeZone(userTz)) env.ELARA_TZ_USER = userTz;
  return env;
}
