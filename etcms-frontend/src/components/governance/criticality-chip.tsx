import { cn } from '../../lib/utils';

interface CriticalityChipProps {
  tier: 'tier_0' | 'tier_1' | 'tier_2' | 'tier_3' | string;
  showLabel?: boolean;
  className?: string;
}

export function CriticalityChip({ tier, showLabel = true, className }: CriticalityChipProps) {
  const configs: Record<string, { label: string; short: string }> = {
    tier_0: {
      label: 'Tier 0 — Critical',
      short: 'T0',
    },
    tier_1: {
      label: 'Tier 1 — High',
      short: 'T1',
    },
    tier_2: {
      label: 'Tier 2 — Standard',
      short: 'T2',
    },
    tier_3: {
      label: 'Tier 3 — Low',
      short: 'T3',
    },
  };

  const config = configs[tier] || {
    label: tier ? tier.replace(/_/g, ' ') : 'Unknown',
    short: tier ? tier.toUpperCase().replace('TIER_', 'T') : 'T?',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-2xs font-mono font-medium border border-subtle bg-surface-sunken text-secondary select-none',
        className
      )}
      title={`Criticality: ${config.label}`}
    >
      <span>{showLabel ? config.short : ''}</span>
    </span>
  );
}
