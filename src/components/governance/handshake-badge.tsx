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
      classes: 'bg-emerald-950/40 text-emerald-400 border-emerald-800/50',
    },
    pending_confirmation: {
      label: 'Pending',
      icon: Clock,
      classes: 'bg-amber-950/40 text-amber-400 border-amber-800/50 animate-pulse',
    },
    flagged_mismatch: {
      label: 'Mismatch',
      icon: AlertOctagon,
      classes: 'bg-red-950/40 text-red-400 border-red-800/50',
    },
    rejected: {
      label: 'Rejected',
      icon: XCircle,
      classes: 'bg-obsidian-850 text-obsidian-500 border-obsidian-700',
    },
  };

  const config = configs[status] || configs.pending_confirmation;
  const Icon = config.icon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-2xs font-mono font-medium border select-none',
        config.classes,
        className
      )}
    >
      <Icon className="w-3 h-3 stroke-[2]" aria-hidden="true" />
      <span>{config.label}</span>
    </span>
  );
}
