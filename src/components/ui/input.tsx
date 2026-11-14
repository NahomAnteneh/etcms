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
          'flex h-8 w-full rounded border bg-obsidian-950/60 px-3 py-1 text-xs text-obsidian-100 placeholder:text-obsidian-500 transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50 font-sans',
          error
            ? 'border-red-500/80 focus-visible:ring-red-500 text-red-200'
            : 'border-obsidian-700 focus-visible:border-blue-500/80 focus-visible:ring-blue-500/40',
          className
        )}
        {...props}
      />
    );
  }
);
Input.displayName = 'Input';
