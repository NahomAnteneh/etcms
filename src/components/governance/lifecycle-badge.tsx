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
      dotColor: 'text-emerald-400 fill-emerald-400',
      classes: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
    },
    planned: {
      label: 'Planned',
      dotColor: 'text-sky-400 fill-sky-400',
      classes: 'bg-sky-950/40 text-sky-400 border-sky-800/50',
    },
    deprecated: {
      label: 'Deprecated',
      dotColor: 'text-amber-400 fill-amber-400',
      classes: 'bg-amber-950/40 text-amber-400 border-amber-800/50',
    },
    retired: {
      label: 'Retired',
      dotColor: 'text-obsidian-500 fill-obsidian-500',
      classes: 'bg-obsidian-850 text-obsidian-400 border-obsidian-700',
    },
  };

  const config = configs[state] || configs.retired;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-2xs font-mono font-medium border select-none',
        config.classes,
        className
      )}
    >
      <CircleDot className={cn('w-2.5 h-2.5 stroke-[2]', config.dotColor)} aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}
