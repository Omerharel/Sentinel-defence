import { useEffect, useState } from 'react';

export function isLocalHostHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function isNextDevClient(): boolean {
  return process.env.NODE_ENV === 'development';
}

/**
 * כפתור Demo — `false` לפני mount.
 * ב־`next dev` מכל hostname; בפרודקשן רק localhost / 127.0.0.1.
 */
export function useIsLocalHost(): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    setV(isNextDevClient() || isLocalHostHostname(window.location.hostname));
  }, []);
  return v;
}
