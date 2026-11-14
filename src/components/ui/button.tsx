import React from 'react';
import { cn } from '../../lib/utils';
import { Loader2 } from 'lucide-react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'destructive' | 'ghost' | 'outline';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', isLoading = false, disabled, children, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-obsidian-900 disabled:opacity-50 disabled:cursor-not-allowed select-none';

    const variants = {
      primary: 'bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white shadow-sm shadow-blue-900/20 border border-blue-500/30',
      secondary: 'bg-obsidian-800 hover:bg-obsidian-750 active:bg-obsidian-700 text-obsidian-100 border border-obsidian-600 shadow-sm',
      destructive: 'bg-red-600 hover:bg-red-500 active:bg-red-700 text-white border border-red-500/30 shadow-sm shadow-red-900/20',
      ghost: 'hover:bg-obsidian-800 active:bg-obsidian-750 text-obsidian-300 hover:text-obsidian-100',
      outline: 'border border-obsidian-600 hover:border-obsidian-500 hover:bg-obsidian-800/50 text-obsidian-200 active:bg-obsidian-800',
    };

    const sizes = {
      sm: 'text-xs px-2.5 py-1 gap-1.5 h-7',
      md: 'text-sm px-3.5 py-1.5 gap-2 h-9',
      lg: 'text-base px-4 py-2 gap-2.5 h-10',
      icon: 'h-8 w-8 p-0',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
