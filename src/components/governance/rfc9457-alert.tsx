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
    <div className="bg-red-950/40 border border-red-800/80 rounded-lg p-4 shadow-md backdrop-blur-xs text-obsidian-100">
      <div className="flex items-start gap-3">
        {isConflict || isPrecondition ? (
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
        ) : isForbidden ? (
          <ShieldX className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        ) : (
          <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        )}

        <div className="flex-1 space-y-2">
          <div className="flex items-baseline justify-between">
            <h4 className="text-sm font-semibold text-red-200">
              {problem.title} <span className="text-xs font-mono text-red-400/80">({problem.status})</span>
            </h4>
            {onDismiss && (
              <button
                onClick={onDismiss}
                className="text-obsidian-400 hover:text-obsidian-200 text-xs font-medium"
              >
                Dismiss
              </button>
            )}
          </div>

          <p className="text-xs text-obsidian-300 leading-relaxed">{problem.detail}</p>

          {/* Conflict: Blocking Dependent CIs */}
          {isConflict && problem.dependent_cis && problem.dependent_cis.length > 0 && (
            <div className="mt-3 pt-3 border-t border-red-900/40">
              <span className="text-xs font-medium text-amber-300 flex items-center gap-1.5 mb-2">
                <Database className="w-3.5 h-3.5" />
                Active Upstream Dependents ({problem.dependent_cis.length}):
              </span>
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {problem.dependent_cis.map((dep) => (
                  <div
                    key={dep.ci_id}
                    className="flex items-center justify-between text-xs bg-obsidian-900/60 border border-obsidian-800 px-2.5 py-1.5 rounded"
                  >
                    <div className="flex items-center gap-2">
                      <Server className="w-3 h-3 text-obsidian-400" />
                      <span className="font-medium text-obsidian-200">{dep.name}</span>
                      <span className="text-2xs font-mono text-obsidian-400 uppercase bg-obsidian-800 px-1 py-0.5 rounded">
                        {dep.ci_class}
                      </span>
                    </div>
                    {onNavigateToCI && (
                      <button
                        onClick={() => onNavigateToCI(dep.ci_id)}
                        className="text-blue-400 hover:text-blue-300 text-2xs font-medium underline underline-offset-2"
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
            <div className="mt-3 pt-3 border-t border-red-900/40 space-y-1">
              <span className="text-xs font-medium text-red-300">Schema Violations:</span>
              <ul className="list-disc list-inside text-xs text-red-200 space-y-0.5">
                {Object.entries(problem.node_errors).map(([field, errors]) => (
                  <li key={field}>
                    <span className="font-mono text-2xs text-obsidian-400">{field}:</span>{' '}
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
                Try Again
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
