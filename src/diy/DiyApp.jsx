import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { FieldworkProvider, useFieldwork } from './state';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import About from './pages/About';
import Contact from './pages/Contact';
import Terms from './pages/legal/Terms';
import Privacy from './pages/legal/Privacy';
import Croa from './pages/legal/Croa';
import AppShell from './layout/AppShell';
import Dashboard from './pages/Dashboard';
import CampaignWizard from './pages/CampaignWizard';
import Campaigns from './pages/Campaigns';
import Documents from './pages/Documents';
import Responses from './pages/Responses';
import Billing from './pages/Billing';
import Settings from './pages/Settings';
import DemoReel from './pages/DemoReel';

function RequireAuth({ children }) {
  const { user, authReady } = useFieldwork();
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--fw-paper)] text-[var(--fw-muted)]">
        Loading workspace…
      </div>
    );
  }
  if (!user) return <Navigate to="/signup" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { user, authReady } = useFieldwork();
  if (!authReady) return null;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

export default function DiyApp() {
  return (
    <FieldworkProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="/privacy" element={<Privacy />} />
          <Route path="/croa" element={<Croa />} />
          <Route path="/reel/:sceneId" element={<DemoReel />} />
          <Route
            path="/signup"
            element={(
              <PublicOnly>
                <Auth />
              </PublicOnly>
            )}
          />
          <Route
            path="/login"
            element={(
              <PublicOnly>
                <Auth />
              </PublicOnly>
            )}
          />
          <Route
            path="/app"
            element={(
              <RequireAuth>
                <AppShell />
              </RequireAuth>
            )}
          >
            <Route index element={<Dashboard />} />
            <Route path="campaign/new" element={<CampaignWizard />} />
            <Route path="campaigns" element={<Campaigns />} />
            <Route path="documents" element={<Documents />} />
            <Route path="responses" element={<Responses />} />
            <Route path="billing" element={<Billing />} />
            <Route path="settings" element={<Settings />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
    </FieldworkProvider>
  );
}
