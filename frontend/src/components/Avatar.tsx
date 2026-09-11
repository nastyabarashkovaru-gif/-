export default function Avatar({ url, size = 'md', name }: { url?: string | null; size?: 'md' | 'lg'; name?: string | null }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  if (url) {
    return <img className={`avatar ${size === 'lg' ? 'lg' : ''}`} src={url} alt={name || 'avatar'} />;
  }
  return (
    <div
      className={`avatar ${size === 'lg' ? 'lg' : ''}`}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, color: 'var(--accent)' }}
    >
      {initial}
    </div>
  );
}
