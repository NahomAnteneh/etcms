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
      classes: 'bg-tier0-bg text-tier0 border-tier0-border',
      icon: ShieldAlert,
    },
    tier_1: {
      label: 'Tier 1 — High',
      short: 'T1',
      classes: 'bg-tier1-bg text-tier1 border-tier1-border',
      icon: AlertTriangle,
    },
    tier_2: {
      label: 'Tier 2 — Standard',
      short: 'T2',
      classes: 'bg-tier2-bg text-tier2 border-tier2-border',
      icon: Info,
    },
    tier_3: {
      label: 'Tier 3 — Low',
      short: 'T3',
      classes: 'bg-tier3-bg text-tier3 border-tier3-border',
      icon: Minus,
    },
  };

  const config = configs[tier] || configs.tier_3;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-2xs font-mono font-medium border select-none',
        config.classes,
        className
      )}
      title={`Criticality: ${config.label}`}
    >
      <Icon className="w-3 h-3 stroke-[1.5]" aria-hidden="true" />
      <span>{showLabel ? config.short : ''}</span>
    </span>
  );
}
