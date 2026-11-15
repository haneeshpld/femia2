import { lazy, Suspense, useEffect } from 'react';
import { NavLink, Route, Routes } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { get } from './lib/api.ts';
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
const Offers = lazy(() => import('./pages/Offers.tsx'));
const More = lazy(() => import('./pages/More.tsx'));

type NavItem = { to: string; label: string; icon: IconName; perm?: string; badge?: number; end?: boolean };

export function App() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => get<Me>('/admin/me'), staleTime: 5 * 60_000 });
  const dash = useQuery({ queryKey: ['dashboard'], queryFn: () => get('/admin/dashboard'), enabled: !!me.data?.permissions.includes('dashboard.view'), refetchInterval: 60_000 });
  const toast = useToast();
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW();

  useEffect(() => { if (needRefresh) toast({ text: 'A new version of Admin is ready.', action: { label: 'Update', run: () => updateServiceWorker(true) } }); }, [needRefresh]);
  useEffect(() => {
    const h = () => location.reload(); // Access session expired: reload re-runs the Access login
    window.addEventListener('femia:unauthenticated', h);
    return () => window.removeEventListener('femia:unauthenticated', h);
  }, []);

  if (me.isPending) return <div className="main"><Skeleton n={4} /></div>;
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
    { to: '/photos', label: 'Photos', icon: 'image', perm: 'media.write' },
    { to: '/prompt-studio', label: 'Prompt Studio', icon: 'wand', perm: 'media.write' },
    { to: '/settings', label: 'Settings', icon: 'settings', perm: 'settings.read' },
    { to: '/people', label: 'People', icon: 'users', perm: 'people.manage' },
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
          <div className="side__me">{me.data.name || me.data.email}<br />{me.data.role === 'owner' ? 'Owner' : 'Staff'}</div>
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
              <Route path="/orders" element={<Orders />} />
              <Route path="/orders/new" element={<NewOrder />} />
              <Route path="/orders/:number" element={<OrderDetail />} />
              <Route path="/orders/:number/print/:doc" element={<PrintOrder />} />
              <Route path="/content" element={<Content />} />
              <Route path="/photos" element={<Media />} />
              <Route path="/prompt-studio" element={<PromptStudio />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/people" element={<People />} />
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
