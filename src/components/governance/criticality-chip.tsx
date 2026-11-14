import { cn } from '../../lib/utils';
import { ShieldAlert, AlertTriangle, Info, Minus } from 'lucide-react';

interface CriticalityChipProps {
  tier: 'tier_0' | 'tier_1' | 'tier_2' | 'tier_3';
  showLabel?: boolean;
  className?: string;
}

export function CriticalityChip({ tier, showLabel = true, className }: CriticalityChipProps) {
  const configs = {
    tier_0: {
      label: 'Tier 0 — Critical',
      short: 'T0',
      classes: 'bg-red-950/60 text-red-400 border-red-700/60 shadow-xs shadow-red-950',
      icon: ShieldAlert,
    },
    tier_1: {
      label: 'Tier 1 — High',
      short: 'T1',
      classes: 'bg-amber-950/60 text-amber-400 border-amber-700/60 shadow-xs shadow-amber-950',
      icon: AlertTriangle,
    },
    tier_2: {
      label: 'Tier 2 — Standard',
      short: 'T2',
      classes: 'bg-blue-950/60 text-blue-400 border-blue-700/60 shadow-xs shadow-blue-950',
      icon: Info,
    },
    tier_3: {
      label: 'Tier 3 — Low',
      short: 'T3',
      classes: 'bg-obsidian-800 text-obsidian-400 border-obsidian-600',
      icon: Minus,
    },
  };

  const config = configs[tier] || configs.tier_3;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs font-mono font-medium border select-none',
        config.classes,
        className
      )}
      title={`Criticality: ${config.label}`}
    >
      <Icon className="w-3 h-3 stroke-[2.2]" aria-hidden="true" />
      <span>{showLabel ? config.short : ''}</span>
    </span>
  );
}
