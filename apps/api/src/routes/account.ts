import { Hono } from 'hono';
import { AddressInput, ProfileUpdate } from '@femia/contracts';
import type { AppEnv } from '../env.ts';
import { readJson } from '../lib/http.ts';
import { requireCustomer } from '../lib/auth.ts';
import { clearSessionCookie } from '../lib/security.ts';
import { customerOrders, deleteAddress, getCustomer, listAddresses, saveAddress, toProfile } from '../services/customers.ts';
import { revokeAllStatement } from '../services/sessions.ts';

/** The shopper's own account. Every route needs a shopper session; nothing here is cached. */
export const accountRoutes = new Hono<AppEnv>();
accountRoutes.use('*', requireCustomer);

accountRoutes.get('/me', async (c) => {
  const id = c.get('customer').id;
  const [customer, addresses] = await Promise.all([getCustomer(c.env.DB, id), listAddresses(c.env.DB, id)]);
  return c.json({ customer: toProfile(customer), addresses });
});

accountRoutes.patch('/me', async (c) => {
  const v = await readJson(c, ProfileUpdate);
  const id = c.get('customer').id;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE customers SET name = ?, phone = ?, marketing = ?, updated_at = ? WHERE id = ?').bind(v.name, v.phone, v.marketing ? 1 : 0, new Date().toISOString(), id),
    v.marketing
      ? // signed in, so this is the owner of the email asking: it may re-subscribe
      c.env.DB.prepare('INSERT INTO newsletter_subscribers (email, source) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET unsubscribed_at = NULL').bind(c.get('customer').email, 'account')
      : c.env.DB.prepare('DELETE FROM newsletter_subscribers WHERE email = ?').bind(c.get('customer').email),
  ]);
  return c.json({ customer: toProfile(await getCustomer(c.env.DB, id)) });
});

accountRoutes.get('/orders', async (c) => c.json(await customerOrders(c.env.DB, c.get('customer').id)));

accountRoutes.post('/addresses', async (c) => c.json({ addresses: await saveAddress(c.env.DB, c.get('customer').id, await readJson(c, AddressInput)) }, 201));
accountRoutes.put('/addresses/:id', async (c) => c.json({ addresses: await saveAddress(c.env.DB, c.get('customer').id, await readJson(c, AddressInput), c.req.param('id')) }));
accountRoutes.delete('/addresses/:id', async (c) => c.json({ addresses: await deleteAddress(c.env.DB, c.get('customer').id, c.req.param('id')) }));

/** Lost phone? Signs out every browser, including this one. */
accountRoutes.post('/sign-out-everywhere', async (c) => {
  await revokeAllStatement(c.env.DB, 'customer', c.get('customer').id).run();
  clearSessionCookie(c, 'customer');
  return c.json({ ok: true });
});
