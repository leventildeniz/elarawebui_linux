// MSCHAPv2 (RFC 2759) — pure JS NT-Response computation.
// Used to authenticate against Microsoft NPS over RADIUS when the policy
// rejects PAP. We compute the 24-byte NT-Response from:
//   NTHash = MD4(UTF-16LE(password))
//   ChallengeHash = SHA1(PeerChallenge ‖ AuthChallenge ‖ Username)[0..7]
//   NTResponse = ChallengeResponse(ChallengeHash, NTHash)  (3× DES-ECB)
// We also verify the server's MS-CHAP2-Success "Authenticator-Response"
// (RFC 2759 §8.7) for mutual authentication.

import { createHash, createCipheriv, randomBytes } from "node:crypto";

// ---- MD4 (pure JS — Node disables it via openssl-legacy in many builds) ----
function md4(input) {
  // Pad message: append 0x80, zeros, then 64-bit little-endian length in bits.
  const msg = Buffer.from(input);
  const bitLen = BigInt(msg.length) * 8n;
  const padLen = (msg.length % 64 < 56 ? 56 : 120) - (msg.length % 64);
  const padded = Buffer.concat([msg, Buffer.alloc(padLen + 8)]);
  padded[msg.length] = 0x80;
  padded.writeBigUInt64LE(bitLen, padded.length - 8);

  let A = 0x67452301 >>> 0, B = 0xefcdab89 >>> 0,
      C = 0x98badcfe >>> 0, D = 0x10325476 >>> 0;

  const rotl = (x, n) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const F = (x, y, z) => ((x & y) | (~x & z)) >>> 0;
  const G = (x, y, z) => ((x & y) | (x & z) | (y & z)) >>> 0;
  const H = (x, y, z) => (x ^ y ^ z) >>> 0;

  for (let i = 0; i < padded.length; i += 64) {
    const X = new Array(16);
    for (let j = 0; j < 16; j++) X[j] = padded.readUInt32LE(i + j * 4);
    let [a, b, c, d] = [A, B, C, D];
    // Round 1
    const r1 = [3, 7, 11, 19];
    for (let j = 0; j < 16; j++) {
      const k = j;
      const s = r1[j % 4];
      const v = (a + F(b, c, d) + X[k]) >>> 0;
      [a, d, c, b] = [d, c, b, rotl(v, s)];
    }
    // Round 2
    const r2 = [3, 5, 9, 13];
    const o2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
    for (let j = 0; j < 16; j++) {
      const k = o2[j];
      const s = r2[j % 4];
      const v = (a + G(b, c, d) + X[k] + 0x5a827999) >>> 0;
      [a, d, c, b] = [d, c, b, rotl(v, s)];
    }
    // Round 3
    const r3 = [3, 9, 11, 15];
    const o3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
    for (let j = 0; j < 16; j++) {
      const k = o3[j];
      const s = r3[j % 4];
      const v = (a + H(b, c, d) + X[k] + 0x6ed9eba1) >>> 0;
      [a, d, c, b] = [d, c, b, rotl(v, s)];
    }
    A = (A + a) >>> 0; B = (B + b) >>> 0;
    C = (C + c) >>> 0; D = (D + d) >>> 0;
  }
  const out = Buffer.alloc(16);
  out.writeUInt32LE(A, 0); out.writeUInt32LE(B, 4);
  out.writeUInt32LE(C, 8); out.writeUInt32LE(D, 12);
  return out;
}

// ---- DES helpers (RFC 2759 §6.0) ----
// Convert a 7-byte block into an 8-byte DES key (parity bits set to 0).
function expandDesKey(buf7) {
  const k = Buffer.alloc(8);
  k[0] =  buf7[0] & 0xfe;
  k[1] = ((buf7[0] << 7) | (buf7[1] >> 1)) & 0xfe;
  k[2] = ((buf7[1] << 6) | (buf7[2] >> 2)) & 0xfe;
  k[3] = ((buf7[2] << 5) | (buf7[3] >> 3)) & 0xfe;
  k[4] = ((buf7[3] << 4) | (buf7[4] >> 4)) & 0xfe;
  k[5] = ((buf7[4] << 3) | (buf7[5] >> 5)) & 0xfe;
  k[6] = ((buf7[5] << 2) | (buf7[6] >> 6)) & 0xfe;
  k[7] = ( buf7[6] << 1) & 0xfe;
  // Set odd parity (some DES impls require it; OpenSSL does not, but harmless).
  for (let i = 0; i < 8; i++) {
    let p = 1;
    for (let b = 1; b < 8; b++) if ((k[i] >> b) & 1) p ^= 1;
    k[i] = (k[i] & 0xfe) | p;
  }
  return k;
}

function desEncrypt(key8, data8) {
  const c = createCipheriv("des-ecb", key8, null);
  c.setAutoPadding(false);
  return Buffer.concat([c.update(data8), c.final()]);
}

// ChallengeResponse: 21-byte NT-Hash (padded with zeros) split into 3×7,
// each used as DES key to encrypt the 8-byte ChallengeHash.
function challengeResponse(challenge8, ntHash16) {
  const z = Buffer.concat([ntHash16, Buffer.alloc(5)]); // 21 bytes
  const out = Buffer.alloc(24);
  desEncrypt(expandDesKey(z.slice(0, 7)),  challenge8).copy(out, 0);
  desEncrypt(expandDesKey(z.slice(7, 14)), challenge8).copy(out, 8);
  desEncrypt(expandDesKey(z.slice(14, 21)), challenge8).copy(out, 16);
  return out;
}

function utf16le(s) { return Buffer.from(String(s), "utf16le"); }

function challengeHash(peerChallenge16, authChallenge16, username) {
  const sha = createHash("sha1");
  sha.update(peerChallenge16);
  sha.update(authChallenge16);
  // RFC: strip any domain prefix "DOMAIN\user" → "user" (NPS sends bare user).
  const bare = String(username || "").split("\\").pop();
  sha.update(Buffer.from(bare, "utf8"));
  return sha.digest().slice(0, 8);
}

/** Compute the MS-CHAP2-Response (49 bytes incl. ident byte). */
export function buildMsChap2Response({ ident = 0, authChallenge, username, password }) {
  const peerChallenge = randomBytes(16);
  const ntHash = md4(utf16le(password));
  const ch = challengeHash(peerChallenge, authChallenge, username);
  const ntResponse = challengeResponse(ch, ntHash);
  // Layout: Ident(1) ‖ Flags(1) ‖ PeerChallenge(16) ‖ Reserved(8) ‖ NTResponse(24) ‖ Flags(1) [50 bytes per RFC]
  // RADIUS MS-CHAP2-Response (vendor 311 attr 25) is 50 bytes.
  const buf = Buffer.alloc(50);
  buf[0] = ident & 0xff;
  buf[1] = 0; // Flags
  peerChallenge.copy(buf, 2);
  // bytes 18..25 reserved (zero)
  ntResponse.copy(buf, 26);
  // byte 50? Actually total is 50 bytes per RFC 2548. We allocated 50.
  return { response: buf, peerChallenge, ntHash, ntResponse };
}

/** Verify NPS Authenticator-Response from MS-CHAP2-Success payload. */
export function verifyAuthenticatorResponse({
  successPayload,            // raw bytes of MS-CHAP2-Success VSA value
  ntHash, ntResponse, peerChallenge, authChallenge, username,
}) {
  if (!successPayload || successPayload.length < 42) return false;
  // MS-CHAP2-Success = Ident(1) ‖ "S=<auth-string>" (42 ASCII chars) ‖ optional " M=..."
  // Skip the 1-byte ident.
  const ascii = successPayload.slice(1).toString("ascii");
  const m = ascii.match(/S=([0-9A-Fa-f]{40})/);
  if (!m) return false;
  const serverResp = Buffer.from(m[1], "hex");
  // Compute expected: GenerateAuthenticatorResponse(NTHash, NTResponse, PeerChallenge, AuthChallenge, Username)
  const passwordHashHash = md4(ntHash);
  const magic1 = Buffer.from("4d616769632073657276657220746f20636c69656e74207369676e696e6720636f6e7374616e74", "hex");
  const magic2 = Buffer.from("50616420746f206d616b6520697420646f206d6f7265207468616e206f6e6520697465726174696f6e", "hex");
  const digest = createHash("sha1");
  digest.update(passwordHashHash); digest.update(ntResponse); digest.update(magic1);
  const ch = challengeHash(peerChallenge, authChallenge, username);
  const digest2 = createHash("sha1");
  digest2.update(digest.digest()); digest2.update(ch); digest2.update(magic2);
  const expected = digest2.digest();
  return expected.equals(serverResp);
}
