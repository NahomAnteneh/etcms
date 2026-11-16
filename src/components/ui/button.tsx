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
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed select-none cursor-pointer';

    const variants = {
      primary: 'bg-accent hover:bg-accent-hover text-white shadow-sm border border-transparent font-semibold',
      secondary: 'bg-surface hover:bg-hover active:bg-selected text-primary border border-control shadow-sm',
      destructive: 'bg-tier0 hover:brightness-90 active:brightness-75 text-white shadow-sm border border-transparent font-semibold',
      ghost: 'bg-transparent hover:bg-hover active:bg-selected text-secondary hover:text-primary',
      outline: 'bg-transparent border border-hairline hover:border-control hover:bg-hover text-primary',
    };

    const sizes = {
      sm: 'text-2xs px-2.5 py-1 gap-1.5 h-7 rounded-sm',
      md: 'text-xs px-3 py-1.5 gap-2 h-8 rounded-md',
      lg: 'text-sm px-4 py-2 gap-2.5 h-9 rounded-md',
      icon: 'h-8 w-8 p-0 rounded-md',
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        {...props}
      >
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1 stroke-[1.5]" aria-hidden="true" />}
        {children}
      </button>
    );
  }
);
Button.displayName = 'Button';
