import { useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { useFieldwork } from '../state';

/**
 * Marketing “try the product” entry — starts a guest tour with sample data.
 * Isolated from real Fieldwork logins (separate localStorage key).
 */
export default function GuestDemoEntry() {
  const { enterGuestDemo, isGuestDemo, authReady } = useFieldwork();

  useEffect(() => {
    enterGuestDemo();
  }, [enterGuestDemo]);

  if (!authReady && !isGuestDemo) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--fw-paper)] text-[var(--fw-muted)]">
        Starting demo…
      </div>
    );
  }

  return <Navigate to="/app/campaign/new" replace />;
}
