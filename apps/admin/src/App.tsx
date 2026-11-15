import { lazy, Suspense, useEffect } from 'react';
import { NavLink, Route, Routes, useNavigate } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ApiError, get, post } from './lib/api.ts';
import { MeCtx, type Me } from './lib/me.ts';
import { Icon, type IconName } from './components/Icon.tsx';
import { ErrorBox, Skeleton, useToast } from './components/ui.tsx';
import { Dashboard } from './pages/Dashboard.tsx';

const Products = lazy(() => import('./pages/Products.tsx'));
const ProductWizard = lazy(() => import('./pages/ProductWizard.tsx'));
const Stock = lazy(() => import('./pages/Stock.tsx'));
const Catalog = lazy(() => import('./pages/Catalog.tsx'));
const Orders = lazy(() => import('./pages/Orders.tsx'));
const OrderDetail = lazy(() => import('./pages/OrderDetail.tsx'));
const NewOrder = lazy(() => import('./pages/NewOrder.tsx'));
const PrintOrder = lazy(() => import('./pages/PrintOrder.tsx'));
const Content = lazy(() => import('./pages/Content.tsx'));
const Media = lazy(() => import('./pages/Media.tsx'));
const Settings = lazy(() => import('./pages/Settings.tsx'));
const People = lazy(() => import('./pages/People.tsx'));
const PromptStudio = lazy(() => import('./pages/PromptStudio.tsx'));
const Festive = lazy(() => import('./pages/Festive.tsx'));
const Offers = lazy(() => import('./pages/Offers.tsx'));
const Auth = lazy(() => import('./pages/Auth.tsx'));
const Customers = lazy(() => import('./pages/Customers.tsx'));
const MyAccount = lazy(() => import('./pages/MyAccount.tsx'));
const More = lazy(() => import('./pages/More.tsx'));

type NavItem = { to: string; label: string; icon: IconName; perm?: string; badge?: number; end?: boolean };

export function App() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/admin/me'), staleTime: 5 * 60_000, retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2 });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => get('/admin/dashboard'), enabled: !!me.data?.permissions.includes('dashboard.view'), refetchInterval: 60_000 });
  const toast = useToast();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => { if (needRefresh) toast({ text: 'A new version of Admin is ready.', action: { label: 'Update', run: () => updateServiceWorker(true) } }); }, [needRefresh]);
  useEffect(() => {
    // Session ended (signed out elsewhere, idle too long, access removed): show the sign-in screen.
    const h = () => { qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' }); void me.refetch(); };
    window.addEventListener('femia:unauthenticated', h);
    return () => window.removeEventListener('femia:unauthenticated', h);
  }, []);

  if (me.isPending) return <div className="main"><Skeleton n={4} /></div>;
  if (me.error instanceof ApiError && me.error.status === 401) {
    if (!/^\/(sign-in|sign-up|forgot)/.test(location.pathname)) try { sessionStorage.setItem('femia.after', location.pathname + location.search); } catch { /* ignore */ }
    const signedIn = () => {
      let to = '/';
      try { to = sessionStorage.getItem('femia.after') || '/'; sessionStorage.removeItem('femia.after'); } catch { /* ignore */ }
      if (/^\/(sign-in|sign-up|forgot)/.test(to)) to = '/';
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      void me.refetch().then(() => navigate(to, { replace: true }));
    };
    return <Suspense fallback={<div className="main"><Skeleton n={3} /></div>}><Auth onSignedIn={signedIn} /></Suspense>;
  }
  if (me.error) return <div className="main"><ErrorBox error={me.error} retry={() => me.refetch()} /></div>;

  const can = (p?: string) => !p || me.data.permissions.includes(p);
  const waiting = (dash.data?.ordersWaiting ?? 0) + (dash.data?.upiAwaitingVerification ?? 0);
  const nav: NavItem[] = [
    { to: '/', label: 'Home', icon: 'home', end: true },
    { to: '/orders', label: 'Orders', icon: 'bag', perm: 'orders.read', badge: waiting },
    { to: '/products', label: 'Products', icon: 'box', perm: 'catalog.read' },
    { to: '/stock', label: 'Stock', icon: 'layers', perm: 'stock.write' },
    { to: '/offers', label: 'Offers', icon: 'percent', perm: 'catalog.read' },
    { to: '/catalog', label: 'Catalog setup', icon: 'tag', perm: 'catalog.write' },
    { to: '/content', label: 'Homepage', icon: 'edit', perm: 'content.write' },
    { to: '/festive', label: 'Festive themes', icon: 'sparkle', perm: 'settings.read' },
    { to: '/photos', label: 'Photos', icon: 'image', perm: 'media.write' },
    { to: '/prompt-studio', label: 'Prompt Studio', icon: 'wand', perm: 'media.write' },
    { to: '/settings', label: 'Settings', icon: 'settings', perm: 'settings.read' },
    { to: '/customers', label: 'Customers', icon: 'users', perm: 'orders.read' },
    { to: '/people', label: 'Team', icon: 'shield', perm: 'people.manage' },
  ];
  const tabs: NavItem[] = [nav[0]!, nav[1]!, nav[2]!, nav[3]!, { to: '/more', label: 'More', icon: 'more' }];

  return (
    <MeCtx.Provider value={me.data}>
      <div className="app">
        <aside className="side">
          <a href="/" className="side__brand"><img src="/emblem.webp" alt="" /><img src="/wordmark.webp" alt="Femia" /><span>Admin</span></a>
          <nav className="nav" aria-label="Main">
            {nav.filter((n) => can(n.perm)).map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}{!!n.badge && <span className="nav__badge">{n.badge}</span>}</NavLink>
            ))}
          </nav>
          <div className="side__me">
            <NavLink to="/account" className="side__who"><span className="side__avatar" aria-hidden="true">{(me.data.name || me.data.email).trim()[0]?.toUpperCase()}</span>
              <span><strong>{me.data.name || me.data.email}</strong><small>{me.data.role === 'owner' ? 'Owner' : 'Staff'} · My account</small></span></NavLink>
            <button type="button" className="icon-btn" aria-label="Sign out" title="Sign out" onClick={async () => { await post('/auth/admin/sign-out').catch(() => {}); qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' }); navigate('/sign-in', { replace: true }); void me.refetch(); }}><Icon name="logout" /></button>
          </div>
        </aside>
        <main className="main" id="main">
          <Suspense fallback={<Skeleton n={4} />}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/products" element={<Products />} />
              <Route path="/products/new" element={<ProductWizard />} />
              <Route path="/products/:id" element={<ProductWizard />} />
              <Route path="/stock" element={<Stock />} />
              <Route path="/catalog" element={<Catalog />} />
              <Route path="/offers" element={<Offers />} />
              <Route path="/festive" element={<Festive />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/new" element={<NewOrder />} />
              <Route path="/orders/:number" element={<OrderDetail />} />
              <Route path="/orders/:number/print/:doc" element={<PrintOrder />} />
              <Route path="/content" element={<Content />} />
              <Route path="/photos" element={<Media />} />
              <Route path="/prompt-studio" element={<PromptStudio />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/people" element={<People />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/customers/:id" element={<Customers />} />
              <Route path="/account" element={<MyAccount />} />
              <Route path="/sign-in" element={<Dashboard />} />
              <Route path="/sign-up" element={<Dashboard />} />
              <Route path="/more" element={<More items={nav.slice(4).filter((n) => can(n.perm))} />} />
              <Route path="*" element={<div className="empty"><h2>Page not found</h2><a className="btn" href="/">Go home</a></div>} />
            </Routes>
          </Suspense>
        </main>
        <nav className="tabbar" aria-label="Main">
          {tabs.filter((n) => can(n.perm)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end}><Icon name={n.icon} />{n.label}{!!n.badge && <span className="nav__badge">{n.badge}</span>}</NavLink>
          ))}
        </nav>
      </div>
    </MeCtx.Provider>
  );
}
