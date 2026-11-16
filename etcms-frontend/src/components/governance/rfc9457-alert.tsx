import { AlertCircle, AlertTriangle, ShieldX, Database, Server } from 'lucide-react';
import type { ProblemDetails } from '../../api/client';
import { Button } from '../ui/button';

interface RFC9457AlertProps {
  problem: ProblemDetails | null | undefined;
  onDismiss?: () => void;
  onRetry?: () => void;
  onNavigateToCI?: (ciId: string) => void;
}

export function RFC9457Alert({ problem, onDismiss, onRetry, onNavigateToCI }: RFC9457AlertProps) {
  if (!problem) return null;

  const isConflict = problem.status === 409;
  const isPrecondition = problem.status === 412;
  const isForbidden = problem.status === 403;
  const isValidation = problem.status === 422;

  return (
    <div className="bg-tier0-bg border border-tier0-border rounded-md p-4 text-primary">
      <div className="flex items-start gap-3">
        {isConflict || isPrecondition ? (
          <AlertTriangle className="w-5 h-5 text-tier1 shrink-0 mt-0.5 stroke-[1.5]" />
        ) : isForbidden ? (
          <ShieldX className="w-5 h-5 text-tier0 shrink-0 mt-0.5 stroke-[1.5]" />
        ) : (
          <AlertCircle className="w-5 h-5 text-tier0 shrink-0 mt-0.5 stroke-[1.5]" />
        )}

        <div className="flex-1 space-y-2">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-tier0">
              {problem.title} <span className="text-xs font-mono text-secondary">({problem.status})</span>
            </h4>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-muted hover:text-primary text-xs font-medium cursor-pointer"
              >
                Dismiss
              </button>
            )}
          </div>

          <p className="text-xs text-secondary leading-relaxed">{problem.detail}</p>

          {/* Conflict: Blocking Dependent CIs */}
          {isConflict && problem.dependent_cis && problem.dependent_cis.length > 0 && (
            <div className="mt-3 pt-3 border-t border-tier0-border">
              <span className="text-xs font-medium text-tier1 flex items-center gap-1.5 mb-2">
                <Database className="w-3.5 h-3.5 stroke-[1.5]" />
                Active Upstream Dependents ({problem.dependent_cis.length}):
              </span>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {problem.dependent_cis.map((dep) => (
                  <div
                    key={dep.ci_id}
                    className="flex items-center justify-between text-xs bg-surface border border-hairline px-2.5 py-1.5 rounded-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Server className="w-3 h-3 text-muted stroke-[1.5]" />
                      <span className="font-medium text-primary">{dep.name}</span>
                      <span className="text-2xs font-mono text-muted uppercase bg-surface-sunken px-1 py-0.5 rounded-sm">
                        {dep.ci_class}
                      </span>
                    </div>
                    {onNavigateToCI && (
                      <button
                        onClick={() => onNavigateToCI(dep.ci_id)}
                        className="text-accent hover:text-accent-hover text-2xs font-mono font-medium underline underline-offset-2 cursor-pointer"
                      >
                        Inspect CI
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Validation Node Errors */}
          {isValidation && problem.node_errors && Object.keys(problem.node_errors).length > 0 && (
            <div className="mt-3 pt-3 border-t border-tier0-border space-y-1">
              <span className="text-xs font-medium text-tier0">Schema Violations:</span>
              <ul className="list-disc list-inside text-xs text-secondary space-y-0.5">
                {Object.entries(problem.node_errors).map(([field, errors]) => (
                  <li key={field}>
                    <span className="font-mono text-2xs text-muted">{field}:</span>{' '}
                    {errors.join(', ')}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          {onRetry && (
            <div className="pt-2 flex gap-2">
              <Button size="sm" variant="secondary" onClick={onRetry}>
                Retry Action
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
