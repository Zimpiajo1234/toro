import type { ReactNode } from 'react';

/** Small soft keycap used in control hints. */
export function Keycap({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return <kbd className={`keycap${wide ? ' keycap--wide' : ''}`}>{children}</kbd>;
}
