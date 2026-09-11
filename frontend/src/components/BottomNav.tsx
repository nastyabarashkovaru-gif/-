import { NavLink } from 'react-router-dom';

const items = [
  { to: '/participants', icon: '👥', label: 'Участники' },
  { to: '/rating', icon: '🏆', label: 'Рейтинг' },
  { to: '/progress', icon: '🔥', label: 'Прогресс' },
  { to: '/profile', icon: '👤', label: 'Профиль' },
];

export default function BottomNav() {
  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="icon">{item.icon}</span>
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
