import { Link } from 'react-router';
import { Icon, type IconName } from '../components/Icon.tsx';
import { useMe } from '../lib/me.ts';

export default function More({ items }: { items: { to: string; label: string; icon: IconName }[] }) {
  const me = useMe();
  return (
    <>
      <div className="page-head"><h1>More</h1></div>
      <div className="list">
        {items.map((i) => <Link key={i.to} to={i.to} className="list-item"><Icon name={i.icon} /><strong>{i.label}</strong><span className="spacer" /><Icon name="chevronRight" /></Link>)}
      </div>
      <p className="muted small" style={{ marginTop: 'var(--sp-6)' }}>Signed in as {me.email} ({me.role}). <a href="/cdn-cgi/access/logout">Sign out</a></p>
    </>
  );
}
