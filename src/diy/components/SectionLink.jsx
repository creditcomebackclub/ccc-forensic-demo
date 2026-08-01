import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * In-page section links that work with HashRouter.
 * Plain href="#pricing" steals the router hash and breaks navigation.
 */
export function SectionLink({ section, className, children, onClick }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <a
      href={`#/?section=${section}`}
      className={className}
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
        if (location.pathname === '/') {
          document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          navigate({ pathname: '/', search: `?section=${section}` });
        }
      }}
    >
      {children}
    </a>
  );
}

/** Call once on the landing page to honor ?section= / navigate scroll targets. */
export function useLandingSectionScroll() {
  const location = useLocation();

  useEffect(() => {
    const fromState = location.state?.scrollTo;
    const fromQuery = new URLSearchParams(location.search).get('section');
    const id = fromState || fromQuery;
    if (!id) return undefined;

    const t = window.setTimeout(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    return () => window.clearTimeout(t);
  }, [location.pathname, location.search, location.state]);
}
