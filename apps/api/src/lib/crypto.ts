/** AES-GCM encryption for gateway keys at rest. Key = SECRETS_KEY (base64, 32 bytes). */
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

async function key(secret: string) {
  return crypto.subtle.importKey('raw', unb64(secret), 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(secret: string, plaintext: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(secret), new TextEncoder().encode(plaintext));
  return { iv: b64(iv), ciphertext: b64(new Uint8Array(ct)) };
}

export async function decrypt(secret: string, iv: string, ciphertext: string) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(secret), unb64(ciphertext));
  return new TextDecoder().decode(pt);
}

export async function hmacSha256Hex(secret: string, message: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare. */
export function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
