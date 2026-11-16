import React from 'react';
import { cn } from '../../lib/utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = 'text', error, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        className={cn(
          'flex h-8 w-full rounded-md border bg-surface px-3 py-1.5 text-xs text-primary placeholder:text-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 font-sans',
          error
            ? 'border-tier0 focus-visible:ring-tier0 text-tier0'
            : 'border-control focus-visible:border-accent',
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
