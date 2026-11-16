import { cn } from '../../lib/utils';
import { CircleDot } from 'lucide-react';

export type LifecycleState =
  | 'synced'
  | 'out_of_sync'
  | 'in_service'
  | 'planned'
  | 'deprecated'
  | 'retired'
  | string;

interface LifecycleBadgeProps {
  state: LifecycleState;
  className?: string;
}

export function LifecycleBadge({ state, className }: LifecycleBadgeProps) {
  const configs: Record<string, { label: string; textColor: string; dotColor: string }> = {
    synced: {
      label: 'Synced',
      textColor: 'text-synced',
      dotColor: 'text-synced fill-synced',
    },
    out_of_sync: {
      label: 'Out of Sync',
      textColor: 'text-outofsync',
      dotColor: 'text-outofsync fill-outofsync',
    },
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

  const config = configs[state] || {
    label: state ? state.replace(/_/g, ' ') : 'Unknown',
    textColor: 'text-retired',
    dotColor: 'text-retired fill-retired',
  };

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
