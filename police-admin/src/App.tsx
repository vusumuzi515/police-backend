import { Navigate, Route, Routes } from 'react-router-dom';
import { NoticesProvider } from './store/NoticesContext';
import { AuthProvider } from './store/AuthContext';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { NoticesPage } from './pages/NoticesPage';
import { NoticeEditPage } from './pages/NoticeEditPage';
import { LiveViewPage } from './pages/LiveViewPage';
import { ReportsPage } from './pages/ReportsPage';
import { MonitoringPage } from './pages/MonitoringPage';
import { SettingsPage } from './pages/SettingsPage';
import { useState } from 'react';
import { clearAuthSession } from './services/api';

function AppRoutes() {
  const [authed, setAuthed] = useState(
    () => sessionStorage.getItem('police-admin-auth') === '1',
  );

  const login = () => {
    sessionStorage.setItem('police-admin-auth', '1');
    setAuthed(true);
  };

  const logout = () => {
    clearAuthSession();
    setAuthed(false);
  };

  if (!authed) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage onLogin={login} />} />
      </Routes>
    );
  }

  return (
    <AuthProvider logout={logout}>
      <NoticesProvider>
        <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/notices" element={<NoticesPage />} />
          <Route path="/notices/new" element={<NoticeEditPage />} />
          <Route path="/notices/:id" element={<NoticeEditPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/live" element={<LiveViewPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </NoticesProvider>
    </AuthProvider>
  );
}

export default function App() {
  return <AppRoutes />;
}
