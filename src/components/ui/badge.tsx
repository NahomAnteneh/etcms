import React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  size?: 'sm' | 'md';
}

export function Badge({ className, variant = 'default', size = 'sm', children, ...props }: BadgeProps) {
  const baseStyles = 'inline-flex items-center font-medium font-mono uppercase tracking-wider rounded border select-none';

  const variants = {
    default: 'bg-obsidian-800 text-obsidian-300 border-obsidian-600',
    neutral: 'bg-obsidian-800/80 text-obsidian-400 border-obsidian-700',
    success: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/60 shadow-xs shadow-emerald-950/50',
    warning: 'bg-amber-950/40 text-amber-400 border-amber-800/60 shadow-xs shadow-amber-950/50',
    danger: 'bg-red-950/40 text-red-400 border-red-800/60 shadow-xs shadow-red-950/50',
    info: 'bg-blue-950/40 text-blue-400 border-blue-800/60 shadow-xs shadow-blue-950/50',
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
