// policy-cache.mjs — per-user provider policy resolver + TTL cache + warmup.
// Extracted from server.mjs 2026-05-30 (Batch B turn 2).
// Kills the 500ms prep.provider_policy.timeout on hot path. TTL 5dk;
// invalidated explicitly by user/template write paths via *Clear/*DeleteUser.

const PROVIDER_POLICY_TTL_MS = 300_000;
const providerPolicyCache = new Map(); // key: lower(username) → { value, exp }

let _pool = null;
export function initProviderPolicyCache({ pool }) { _pool = pool; }

export function providerPolicyCacheClear() { providerPolicyCache.clear(); }
export function providerPolicyCacheDeleteUser(username) {
  if (username) providerPolicyCache.delete(String(username).toLowerCase());
}

// Senkron cache lookup — hot-path için. Cache miss → null; caller fallback
// kullanır ({ canOverride:false, allowed:null }). Arka planda fire-and-forget warm.
export function getProviderPolicyCachedSync(username) {
  if (!username) return null;
  const key = String(username).toLowerCase();
  const hit = providerPolicyCache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  getEffectiveProviderPolicyForUser(username).catch(() => {});
  return null;
}

export async function getEffectiveProviderPolicyForUser(username) {
  if (!username) return { allowed: null, canOverride: true };
  if (!_pool) return { allowed: null, canOverride: true };
  const key = String(username).toLowerCase();
  const now = Date.now();
  const hit = providerPolicyCache.get(key);
  if (hit && hit.exp > now) return hit.value;
  try {
    const { rows } = await _pool.query(
      "SELECT allowed_providers, can_override_provider, template_id FROM app_users WHERE lower(username)=lower($1) LIMIT 1",
      [username]
    );
    const u = rows[0];
    if (!u) {
      const v = { allowed: null, canOverride: true };
      providerPolicyCache.set(key, { value: v, exp: now + PROVIDER_POLICY_TTL_MS });
      return v;
    }
    let allowed = Array.isArray(u.allowed_providers) ? [...u.allowed_providers] : [];
    let canOverride = u.can_override_provider !== false;
    if (u.template_id) {
      const t = (await _pool.query("SELECT allowed_providers, can_override_provider FROM app_templates WHERE id=$1", [u.template_id])).rows[0];
      if (t) {
        const tplAllowed = Array.isArray(t.allowed_providers) ? t.allowed_providers : [];
        if (tplAllowed.length) {
          allowed = allowed.length ? allowed.filter(id => tplAllowed.includes(id)) : tplAllowed;
        }
        if (t.can_override_provider === false) canOverride = false;
      }
    }
    const v = { allowed: allowed.length ? allowed : null, canOverride };
    providerPolicyCache.set(key, { value: v, exp: now + PROVIDER_POLICY_TTL_MS });
    return v;
  } catch { return { allowed: null, canOverride: true }; }
}

// Boot warmup — son 7 günde aktif kullanıcıların provider policy'sini önceden cache'le.
// İlk istek prep.provider_policy.timeout görmesin. Best-effort.
export async function warmProviderPolicyCache() {
  if (!_pool) return 0;
  try {
    const { rows } = await _pool.query(
      "SELECT username FROM app_users WHERE (last_login_at IS NULL OR last_login_at > now() - interval '7 days') AND username IS NOT NULL LIMIT 100"
    );
    if (!rows.length) return 0;
    const results = await Promise.allSettled(
      rows.map(r => getEffectiveProviderPolicyForUser(r.username))
    );
    return results.filter(x => x.status === "fulfilled").length;
  } catch { return 0; }
}
