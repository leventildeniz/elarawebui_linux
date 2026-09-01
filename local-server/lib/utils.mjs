// local-server/lib/utils.mjs
export function isUuid(id) {
  if (!id || typeof id !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

export async function dummyFlushCache() {
  console.log("[utils] Dummy flushModelKvCache called");
  return true;
}
