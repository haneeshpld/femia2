import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { AppEnv, Env } from './env.ts';
import { errorResponse } from './lib/http.ts';
import { accountRoutes } from './routes/account.ts';
import { adminRoutes } from './routes/admin.ts';
import { authRoutes } from './routes/auth.ts';
import { paymentRoutes } from './routes/payments.ts';
import { publicRoutes } from './routes/public.ts';
import { scheduled } from './cron.ts';

const app = new Hono<AppEnv>();

// Production traffic arrives same-origin via the storefront/admin proxies (service bindings), so CORS only matters in dev.
app.use('*', async (c, next) => {
  if (c.env.ENVIRONMENT !== 'development') return next();
  return cors({ origin: [c.env.PUBLIC_SITE_URL, c.env.ADMIN_URL], credentials: true, allowHeaders: ['Content-Type', 'X-Dev-User'] })(c, next);
});
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
});

app.route('/', publicRoutes);
app.route('/', paymentRoutes);
app.route('/admin', adminRoutes);
app.route('/auth', authRoutes);
app.route('/account', accountRoutes);
app.notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404));
app.onError(errorResponse);

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;

export { app };
