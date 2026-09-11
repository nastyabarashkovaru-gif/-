import { Navigate, Route, Routes } from 'react-router-dom';
import { UserProvider, useUser } from './context/UserContext';
import BottomNav from './components/BottomNav';
import OnboardingPage from './pages/OnboardingPage';
import ParticipantsPage from './pages/ParticipantsPage';
import ParticipantProfilePage from './pages/ParticipantProfilePage';
import RatingPage from './pages/RatingPage';
import ProfilePage from './pages/ProfilePage';
import ProgressPage from './pages/ProgressPage';
import FinalPage from './pages/FinalPage';
import AdminLoginPage from './pages/admin/AdminLoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import AdminUserDetail from './pages/admin/AdminUserDetail';
import AdminPayments from './pages/admin/AdminPayments';
import DevLogin from './components/DevLogin';

function MainApp() {
  const { user, loading, error } = useUser();

  if (loading) {
    return (
      <div className="center-screen">
        <h2>Загрузка…</h2>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="center-screen">
        <h2>Не удалось войти</h2>
        <p>Открой приложение через Telegram, чтобы продолжить.</p>
        <DevLogin />
      </div>
    );
  }

  if (!user.onboardingCompleted) {
    return (
      <div className="app-shell">
        <Routes>
          <Route path="*" element={<OnboardingPage />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<Navigate to="/progress" replace />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/participants" element={<ParticipantsPage />} />
        <Route path="/participants/:id" element={<ParticipantProfilePage />} />
        <Route path="/rating" element={<RatingPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/final" element={<FinalPage />} />
        <Route path="*" element={<Navigate to="/progress" replace />} />
      </Routes>
      <BottomNav />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/admin" element={<AdminDashboard />} />
      <Route path="/admin/users/:id" element={<AdminUserDetail />} />
      <Route path="/admin/payments" element={<AdminPayments />} />
      <Route
        path="/*"
        element={
          <UserProvider>
            <MainApp />
          </UserProvider>
        }
      />
    </Routes>
  );
}
