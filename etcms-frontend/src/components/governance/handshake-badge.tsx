import { cn } from '../../lib/utils';
import { CheckCircle2, Clock, AlertOctagon, XCircle } from 'lucide-react';

interface HandshakeBadgeProps {
  status: 'confirmed' | 'pending_confirmation' | 'flagged_mismatch' | 'rejected';
  className?: string;
}

export function HandshakeBadge({ status, className }: HandshakeBadgeProps) {
  const configs = {
    confirmed: {
      label: 'Confirmed',
      icon: CheckCircle2,
      classes: 'bg-surface text-inservice border-subtle',
    },
    pending_confirmation: {
      label: 'Pending',
      icon: Clock,
      classes: 'bg-tier1-bg text-deprecated border-tier1-border',
    },
    flagged_mismatch: {
      label: 'Mismatch',
      icon: AlertOctagon,
      classes: 'bg-tier0-bg text-tier0 border-tier0-border',
    },
    rejected: {
      label: 'Rejected',
      icon: XCircle,
      classes: 'bg-surface-sunken text-retired border-hairline',
    },
  };

  const config = configs[status] || configs.pending_confirmation;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm text-2xs font-mono font-medium border select-none',
        config.classes,
        className
      )}
    >
      <Icon className="w-3 h-3 stroke-[1.5]" aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}
