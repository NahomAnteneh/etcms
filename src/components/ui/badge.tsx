import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
}

export function Badge({ className, variant = 'default', size = 'sm', children, ...props }: BadgeProps) {
  const baseStyles = 'inline-flex items-center font-medium font-mono uppercase tracking-wider rounded-sm border select-none';

  const variants = {
    default: 'bg-surface-sunken text-secondary border-subtle',
    neutral: 'bg-surface text-muted border-hairline',
    success: 'bg-surface text-inservice border-subtle',
    warning: 'bg-tier1-bg text-tier1 border-tier1-border',
    danger: 'bg-tier0-bg text-tier0 border-tier0-border',
    info: 'bg-tier2-bg text-tier2 border-tier2-border',
  };

  const sizes = {
    sm: 'text-2xs px-1.5 py-0.5',
    md: 'text-xs px-2 py-0.5',
  };

  return (
    <span className={cn(baseStyles, variants[variant], sizes[size], className)} {...props}>
      {children}
    </span>
  );
}
