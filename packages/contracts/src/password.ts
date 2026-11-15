/**
 * Password rules for Admin accounts (zod-free so the sign-up screen can show the same checks live).
 * Length and a block list beat composition rules: 10+ characters, not a common password, not your name or email.
 */
const COMMON = new Set([
  'password', 'password1', 'password12', 'password123', 'passw0rd', 'qwerty', 'qwerty123', 'qwertyuiop', '123456', '1234567',
  '12345678', '123456789', '1234567890', '0123456789', '111111', '000000', 'abc123', 'abcdef', 'iloveyou', 'letmein', 'welcome',
  'welcome1', 'welcome123', 'admin', 'admin123', 'administrator', 'monkey', 'dragon', 'sunshine', 'princess', 'football',
  'baseball', 'superman', 'trustno1', 'whatever', 'starwars', 'passpass', 'changeme', 'secret', 'india123', 'kerala123',
  'femia', 'femia123', 'femiaadmin', 'boutique', 'boutique123', 'kochi123', 'qwertyui', 'asdfghjkl', 'zxcvbnm', '1q2w3e4r',
  '1qaz2wsx', 'q1w2e3r4', 'aaaaaaaaaa', 'ilovekerala',
]);

export const PASSWORD_MIN = 10;

export function passwordProblem(pw: string, ctx: { email?: string; name?: string } = {}): string | null {
  if (pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters`;
  if (pw.length > 128) return 'Use 128 characters or fewer';
  const low = pw.toLowerCase();
  if (COMMON.has(low) || COMMON.has(low.replace(/[^a-z0-9]/g, ''))) return 'That password is too common';
  if (/^(.)\1+$/.test(pw)) return 'Avoid repeating one character';
  const local = ctx.email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && low.includes(local)) return "Don't use your email in the password";
  const first = ctx.name?.trim().split(/\s+/)[0]?.toLowerCase();
  if (first && first.length >= 4 && low.includes(first)) return "Don't use your name in the password";
  return null;
}

/** 0–4, for the strength meter. */
export function passwordScore(pw: string): number {
  if (!pw) return 0;
  let kinds = 0;
  for (const re of [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/]) if (re.test(pw)) kinds++;
  const len = pw.length;
  let s = len >= 16 ? 3 : len >= 12 ? 2 : len >= PASSWORD_MIN ? 1 : 0;
  if (kinds >= 3) s++;
  if (passwordProblem(pw)) s = Math.min(s, 1);
  return Math.max(0, Math.min(4, s));
}
