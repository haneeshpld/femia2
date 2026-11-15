import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { call, checkout, cookieFrom, E, seedBasics, seedProduct } from './helpers.ts';

beforeEach(seedBasics);
const CODE = '123456'; // development fixed code
const as = (cookie: string, extra: Record<string, string> = {}) => ({ Cookie: cookie, ...extra });
const noBypass = { 'X-Dev-User': 'none' };

async function shopper(email = `anu${Math.random().toString(36).slice(2, 7)}@example.com`) {
  const start = await call('POST', '/auth/customer/start', { email });
  expect(start.json).toMatchObject({ sent: true, delivery: 'fixed', devCode: CODE });
  const v = await call('POST', '/auth/customer/verify', { email, code: CODE });
  expect(v.json.status).toBe('new');
  const reg = await call('POST', '/auth/customer/register', { signupToken: v.json.signupToken, name: 'Anu Thomas', phone: '98470 12345' });
  expect(reg.status).toBe(201);
  return { email, cookie: cookieFrom(reg.setCookie) };
}

describe('shopper accounts', () => {
  it('signs up with a verified email code and keeps a session in an HttpOnly cookie', async () => {
    const email = 'new.shopper@example.com';
    await call('POST', '/auth/customer/start', { email });
    const wrong = await call('POST', '/auth/customer/verify', { email, code: '000000' });
    expect(wrong.json.error.message).toContain('4 tries left');
    // asking again straight away keeps the same code instead of refusing
    expect((await call('POST', '/auth/customer/start', { email })).json).toMatchObject({ sent: true, reused: true });
    const v = await call('POST', '/auth/customer/verify', { email, code: CODE });
    expect(v.json).toMatchObject({ status: 'new', email });
    const reg = await call('POST', '/auth/customer/register', { signupToken: v.json.signupToken, name: 'Meera Nair', phone: '9847055555' });
    expect(reg.setCookie).toMatch(/femia_c=.+HttpOnly/i);
    expect(reg.setCookie).toMatch(/SameSite=Lax/i);
    const me = await call('GET', '/account/me', undefined, as(cookieFrom(reg.setCookie)));
    expect(me.json.customer).toMatchObject({ email, name: 'Meera Nair', phone: '9847055555' });
    // the code can't be used twice, and a forged sign-up token is refused
    expect((await call('POST', '/auth/customer/verify', { email, code: CODE })).json.error.code).toBe('code_expired');
    expect((await call('POST', '/auth/customer/register', { signupToken: `${v.json.signupToken}x`, name: 'X Y', phone: '9847055555' })).status).toBe(400);
  });

  it('locks a code after five wrong tries and rate-limits new codes', async () => {
    const email = 'locky@example.com';
    await call('POST', '/auth/customer/start', { email });
    for (let i = 0; i < 5; i++) await call('POST', '/auth/customer/verify', { email, code: '111111' });
    expect((await call('POST', '/auth/customer/verify', { email, code: CODE })).json.error.code).toBe('code_locked');
    // a locked code is never reused: asking again sends a fresh one, up to 8 an hour per email
    expect((await call('POST', '/auth/customer/start', { email })).json).toMatchObject({ sent: true });
    expect((await call('POST', '/auth/customer/start', { email })).json).toMatchObject({ reused: true });
    for (let i = 0; i < 7; i++) { await E.DB.prepare("UPDATE otp_codes SET consumed_at = 'x' WHERE email = ?").bind(email).run(); await call('POST', '/auth/customer/start', { email }); }
    expect((await call('POST', '/auth/customer/start', { email })).status).toBe(429);
  });

  it('links orders, offers and addresses to the account, and old guest orders when they sign in', async () => {
    const { variantIds: [v] } = await seedProduct([10], 129900);
    const email = 'returning@example.com';
    const guest = await call('POST', '/orders', checkout(v!, 'cod', { customer: { name: 'Anu', phone: '9847012345', email } }));
    expect(guest.status).toBe(201);
    await call('POST', '/admin/offers', { kind: 'coupon', name: 'Once', code: 'ONCE100', discountType: 'amount', value: 10000, perCustomerLimit: 1 });

    await call('POST', '/auth/customer/start', { email });
    const verify = await call('POST', '/auth/customer/verify', { email, code: CODE });
    const reg = await call('POST', '/auth/customer/register', { signupToken: verify.json.signupToken, name: 'Anu Thomas', phone: '9847099999' });
    const cookie = cookieFrom(reg.setCookie);

    // checkout while signed in, with a coupon, saving the address
    const order = await call('POST', '/orders', checkout(v!, 'cod', { coupon: 'ONCE100', saveAddress: true, customer: { name: 'Anu Thomas', phone: '9847099999', email } }), as(cookie));
    expect(order.status).toBe(201);
    const mine = await call('GET', '/account/orders', undefined, as(cookie));
    expect(mine.json.orders.map((o: { number: string }) => o.number)).toEqual([order.json.order.number, guest.json.order.number]);
    expect(mine.json.orders[0]).toMatchObject({ current: true, url: expect.stringContaining('?token=') });
    expect(mine.json.offers).toEqual([expect.objectContaining({ code: 'ONCE100', amount: 10000, orderNumber: order.json.order.number })]);
    expect(mine.json.totals).toMatchObject({ orders: 2, saved: 10000 });
    expect((await call('GET', '/account/me', undefined, as(cookie))).json.addresses).toHaveLength(1);

    // the coupon is tied to the account: a new number doesn't get round "once per customer"
    const again = await call('POST', '/cart/quote', { lines: [{ variantId: v, qty: 1 }], coupon: 'ONCE100', phone: '9847000001' }, as(cookie));
    expect(again.json.coupon).toMatchObject({ applied: false, message: "You've already used ONCE100" });

    // admin sees the same picture
    const list = await call('GET', '/admin/customers?q=returning');
    expect(list.json[0]).toMatchObject({ email, orders: 2, offersUsed: 1 });
    const detail = await call('GET', `/admin/customers/${list.json[0].id}`);
    expect(detail.json).toMatchObject({ totals: { orders: 2 }, addresses: [expect.objectContaining({ pincode: '682036' })] });
  });

  it('manages addresses, profile and sign-out everywhere', async () => {
    const { cookie } = await shopper();
    const addr = { name: 'Anu', phone: '9847012345', line1: '12 Rose Villa', city: 'Kochi', pincode: '682036', label: 'Home' };
    const a1 = await call('POST', '/account/addresses', addr, as(cookie));
    expect(a1.json.addresses[0]).toMatchObject({ label: 'Home', isDefault: true });
    const a2 = await call('POST', '/account/addresses', { ...addr, line1: '4 MG Road', label: 'Work', isDefault: true }, as(cookie));
    expect(a2.json.addresses.map((a: { label: string; isDefault: boolean }) => [a.label, a.isDefault])).toEqual([['Work', true], ['Home', false]]);
    const del = await call('DELETE', `/account/addresses/${a2.json.addresses[0].id}`, undefined, as(cookie));
    expect(del.json.addresses).toEqual([expect.objectContaining({ label: 'Home', isDefault: true })]);
    const upd = await call('PATCH', '/account/me', { name: 'Anu T', phone: '9847011111', marketing: true }, as(cookie));
    expect(upd.json.customer).toMatchObject({ name: 'Anu T', phone: '9847011111', marketing: true });
    // a different site can't use the shopper's cookie
    expect((await call('PATCH', '/account/me', { name: 'Evil', phone: '9847011111' }, as(cookie, { Origin: 'https://evil.example' }))).status).toBe(403);
    await call('POST', '/account/sign-out-everywhere', {}, as(cookie));
    expect((await call('GET', '/account/me', undefined, as(cookie))).status).toBe(401);
  });
});

describe('admin team', () => {
  const pw = 'Silk&Zari-2026';
  async function signUp(email: string, name = 'Riya Menon') {
    const s = await call('POST', '/auth/admin/signup', { name, email, password: pw });
    expect(s.json).toMatchObject({ sent: true, devCode: CODE });
    return call('POST', '/auth/admin/signup/verify', { email, code: CODE, signupToken: s.json.signupToken });
  }
  async function login(email: string, password = pw) {
    await E.DB.prepare('DELETE FROM rate_limits').run(); // the 30-second resend cooldown
    const l = await call('POST', '/auth/admin/login', { email, password });
    if (l.status !== 200) return { ...l, cookie: '' };
    const v = await call('POST', '/auth/admin/login/verify', { challenge: l.json.challenge, code: CODE });
    return { ...v, cookie: cookieFrom(v.setCookie) };
  }

  it('new sign-ups wait for another admin to approve them, then sign in with password and code', async () => {
    const weak = await call('POST', '/auth/admin/signup', { name: 'Riya', email: 'riya@test.local', password: 'password123' });
    expect(weak.json.error.details.fields.password).toBe('That password is too common');
    const done = await signUp('riya@test.local');
    expect(done.json).toMatchObject({ status: 'pending' });
    expect((await call('POST', '/auth/admin/login', { email: 'riya@test.local', password: pw })).json.error.code).toBe('pending_approval');

    const users = await call('GET', '/admin/users');
    const riya = users.json.find((u: { email: string }) => u.email === 'riya@test.local');
    expect(riya).toMatchObject({ status: 'pending', hasPassword: 1 });
    expect((await call('POST', `/admin/users/${riya.id}/approve`, { roleId: 'staff' })).status).toBe(200);

    // password alone isn't enough: the emailed code finishes sign-in
    const step1 = await call('POST', '/auth/admin/login', { email: 'riya@test.local', password: pw });
    expect(step1.json).toMatchObject({ next: 'code' });
    expect(step1.setCookie).toBeNull();
    expect((await call('POST', '/admin/users', {}, as('femia_a=forged-token-value-that-is-long-enough-xx', noBypass))).status).toBe(401);
    const s = await login('riya@test.local');
    expect(s.setCookie).toMatch(/femia_a=.+HttpOnly/i);
    expect(s.setCookie).toMatch(/SameSite=Strict/i);
    const me = await call('GET', '/admin/me', undefined, as(s.cookie!, noBypass));
    expect(me.json).toMatchObject({ email: 'riya@test.local', role: 'staff' });
    expect((await call('GET', '/admin/users', undefined, as(s.cookie!, noBypass))).status).toBe(403); // staff can't manage people
    expect((await call('GET', '/admin/me', undefined, noBypass)).status).toBe(401);
  });

  it('locks the account after five wrong passwords without revealing which emails exist', async () => {
    await signUp('lock@test.local');
    const ghost = await call('POST', '/auth/admin/login', { email: 'nobody@test.local', password: 'Whatever-123' });
    const wrong = await call('POST', '/auth/admin/login', { email: 'lock@test.local', password: 'Wrong-password-1' });
    expect(ghost.json.error).toEqual(wrong.json.error);
    for (let i = 0; i < 4; i++) await call('POST', '/auth/admin/login', { email: 'lock@test.local', password: 'Wrong-password-1' });
    expect((await call('POST', '/auth/admin/login', { email: 'lock@test.local', password: pw })).json.error.code).toBe('locked');
  });

  it('invited people are pre-approved; the owner email starts as owner; the last owner stays', async () => {
    await call('POST', '/admin/users', { email: 'sana@test.local', name: 'Sana', roleId: 'staff' });
    expect((await signUp('sana@test.local', 'Sana K')).json).toMatchObject({ status: 'active' });

    // owner@test.local is the dev owner email; its row exists without a password, so signing up claims it
    const own = await signUp('owner@test.local', 'Femia Owner');
    expect(own.json.status).toBe('active');
    const s = await login('owner@test.local');
    const meOwner = await call('GET', '/admin/me', undefined, as(s.cookie!, noBypass));
    expect(meOwner.json.role).toBe('owner');
    expect((await call('PATCH', `/admin/users/${meOwner.json.id}`, { roleId: 'staff' }, as(s.cookie!, noBypass))).status).toBe(403);

    // password change signs other devices out
    const other = await login('owner@test.local');
    const ch = await call('POST', '/admin/account/password', { current: pw, next: 'Kasavu-Gold-77' }, as(s.cookie!, noBypass));
    expect(ch.status).toBe(200);
    expect((await call('GET', '/admin/me', undefined, as(other.cookie!, noBypass))).status).toBe(401);
    expect((await call('GET', '/admin/me', undefined, as(s.cookie!, noBypass))).status).toBe(200);
    const sessions = await call('GET', '/admin/account/sessions', undefined, as(s.cookie!, noBypass));
    expect(sessions.json).toEqual([expect.objectContaining({ current: true })]);
  });

  it('stores passwords and codes only as hashes', async () => {
    await signUp('hash@test.local');
    const u = await E.DB.prepare("SELECT password_hash FROM users WHERE email = 'hash@test.local'").first<{ password_hash: string }>();
    expect(u!.password_hash).toMatch(/^pbkdf2\$100000\$/);
    expect(u!.password_hash).not.toContain(pw);
    const codes = await E.DB.prepare("SELECT code_hash FROM otp_codes WHERE email = 'hash@test.local'").all<{ code_hash: string }>();
    expect(codes.results.every((r) => r.code_hash.length === 64 && r.code_hash !== CODE)).toBe(true);
  });
});

describe('sign-in codes on deployed sites', () => {
  const env = E as unknown as Record<string, string | undefined>;
  afterEach(() => { env.ENVIRONMENT = 'development'; delete env.FIXED_OTP_CODE; });

  it('a staging (test) site uses the owner’s fixed code for everyone and never reveals it', async () => {
    env.ENVIRONMENT = 'staging'; env.FIXED_OTP_CODE = '482916';
    const r = await call('POST', '/auth/customer/start', { email: 'stage@example.com' });
    expect(r.json).toMatchObject({ sent: true, delivery: 'fixed' });
    expect(r.json.devCode).toBeUndefined();
    expect((await call('POST', '/auth/customer/verify', { email: 'stage@example.com', code: '123456' })).json.error.code).toBe('code_wrong');
    expect((await call('POST', '/auth/customer/verify', { email: 'stage@example.com', code: '482916' })).json.status).toBe('new');
  });

  it('production keeps shopper sign-in closed until real emails work', async () => {
    env.ENVIRONMENT = 'production'; env.FIXED_OTP_CODE = '482916';
    expect((await call('POST', '/auth/customer/start', { email: 'prod@example.com' })).json.error.code).toBe('codes_unavailable');
  });
});
