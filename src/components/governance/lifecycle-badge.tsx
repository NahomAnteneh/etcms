import { cn } from '../../lib/utils';
import { CircleDot } from 'lucide-react';

interface LifecycleBadgeProps {
  state: 'in_service' | 'planned' | 'deprecated' | 'retired';
  className?: string;
}

export function LifecycleBadge({ state, className }: LifecycleBadgeProps) {
  const configs = {
    in_service: {
      label: 'In Service',
      textColor: 'text-inservice',
      dotColor: 'text-inservice fill-inservice',
    },
    planned: {
      label: 'Planned',
      textColor: 'text-planned',
      dotColor: 'text-planned fill-planned',
    },
    deprecated: {
      label: 'Deprecated',
      textColor: 'text-deprecated',
      dotColor: 'text-deprecated fill-deprecated',
    },
    retired: {
      label: 'Retired',
      textColor: 'text-retired',
      dotColor: 'text-retired fill-retired',
    },
  };

  const config = configs[state] || configs.retired;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 text-2xs font-mono font-medium select-none bg-transparent',
        config.textColor,
        className
      )}
    >
      <CircleDot className={cn('w-2.5 h-2.5 stroke-[1.5]', config.dotColor)} aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}
