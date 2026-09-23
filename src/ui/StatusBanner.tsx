import type { ReactNode } from 'react';

interface Props {
  tone?: 'success' | 'error' | 'warn' | 'info';
  children: ReactNode;
}

export function StatusBanner({ tone = 'info', children }: Props) {
  if (!children) return null;
  return <div className={`banner ${tone}`}>{children}</div>;
}
