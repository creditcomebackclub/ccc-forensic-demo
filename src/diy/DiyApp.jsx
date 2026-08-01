import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import Workspace from './pages/Workspace';
import { DEMO_AUDIT, DEMO_USER } from './demoData';

const STORAGE_KEY = 'fieldwork-diy-demo-v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function DiyApp() {
  const saved = useMemo(() => loadState(), []);
  const [screen, setScreen] = useState(saved?.screen || 'landing');
  const [user, setUser] = useState(saved?.user || null);
  const [audit, setAudit] = useState(saved?.audit || null);
  const [selectedIds, setSelectedIds] = useState(saved?.selectedIds || []);
  const [mailed, setMailed] = useState(saved?.mailed || []);
  const [step, setStep] = useState(saved?.step || 'upload');

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ screen, user, audit, selectedIds, mailed, step }),
    );
  }, [screen, user, audit, selectedIds, mailed, step]);

  const resetDemo = () => {
    localStorage.removeItem(STORAGE_KEY);
    setScreen('landing');
    setUser(null);
    setAudit(null);
    setSelectedIds([]);
    setMailed([]);
    setStep('upload');
  };

  const startDemo = () => setScreen('auth');

  const completeAuth = (profile) => {
    setUser({ ...DEMO_USER, ...profile });
    setScreen('app');
    setStep('upload');
  };

  const completeUpload = () => {
    setAudit(DEMO_AUDIT);
    setSelectedIds(DEMO_AUDIT.accounts.filter((a) => a.priority === 'high').map((a) => a.id));
    setStep('audit');
  };

  const goSelect = () => setStep('select');
  const goMail = () => setStep('mail');
  const completeMail = (letters) => {
    setMailed(letters);
    setStep('track');
  };

  return (
    <AnimatePresence mode="wait">
      {screen === 'landing' && (
        <motion.div key="landing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
          <Landing onStart={startDemo} onEnterApp={user ? () => setScreen('app') : null} />
        </motion.div>
      )}
      {screen === 'auth' && (
        <motion.div key="auth" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
          <Auth onBack={() => setScreen('landing')} onContinue={completeAuth} />
        </motion.div>
      )}
      {screen === 'app' && user && (
        <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <Workspace
            user={user}
            audit={audit}
            step={step}
            setStep={setStep}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            mailed={mailed}
            onUploadComplete={completeUpload}
            onReviewSelect={goSelect}
            onCompose={goMail}
            onMailed={completeMail}
            onReset={resetDemo}
            onHome={() => setScreen('landing')}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
