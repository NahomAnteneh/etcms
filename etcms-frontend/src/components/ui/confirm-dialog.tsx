import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog';
import { Button } from './button';
import { Badge } from './badge';
import { AlertOctagon, ShieldAlert, Trash2, ArrowRight } from 'lucide-react';

export interface BlockingMetric {
  label: string;
  count: number;
}

export interface ConfirmDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  itemName: string;
  itemType: string;
  isBlocked?: boolean;
  blockReason?: string;
  blockingMetrics?: BlockingMetric[];
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  itemName,
  itemType,
  isBlocked = false,
  blockReason,
  blockingMetrics = [],
  confirmLabel = 'Delete',
  onConfirm,
  isLoading = false,
}: ConfirmDeleteDialogProps) {
  const displayTitle =
    title || (isBlocked ? `Deletion Blocked: ${itemType}` : `Delete ${itemType}`);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 bg-surface border border-hairline shadow-2xl">
        <DialogHeader className="space-y-2">
          <div className="flex items-center gap-2.5">
            <div
              className={`p-2 rounded-md ${
                isBlocked
                  ? 'bg-tier1-bg text-tier1 border border-tier1-border'
                  : 'bg-tier0-bg text-tier0 border border-tier0-border'
              }`}
            >
              {isBlocked ? (
                <ShieldAlert className="w-5 h-5 stroke-[1.75]" />
              ) : (
                <AlertOctagon className="w-5 h-5 stroke-[1.75]" />
              )}
            </div>
            <div>
              <DialogTitle className="text-sm font-semibold text-primary">
                {displayTitle}
              </DialogTitle>
              <div className="text-2xs text-secondary font-mono mt-0.5">
                Target: <span className="text-accent font-medium">{itemName}</span>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3.5 my-2">
          {isBlocked ? (
            <div className="space-y-3 rounded-md bg-canvas/70 border border-hairline p-3 text-xs">
              <div className="flex items-start gap-2 text-secondary">
                <span className="text-tier1 font-bold shrink-0">!</span>
                <p className="text-2xs leading-relaxed text-secondary">
                  {blockReason ||
                    `This ${itemType.toLowerCase()} is actively referenced in the configuration mesh. Parent items cannot be deleted while dependent items exist.`}
                </p>
              </div>

              {blockingMetrics.length > 0 && (
                <div className="pt-2 border-t border-hairline/60">
                  <div className="text-3xs uppercase font-mono tracking-wider text-muted mb-1.5">
                    Blocking Dependencies
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {blockingMetrics.map((m, idx) => (
                      <Badge
                        key={idx}
                        variant="warning"
                        className="text-3xs font-mono py-0.5 px-2"
                      >
                        {m.count} {m.label}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-3xs text-muted flex items-center gap-1.5 pt-1">
                <ArrowRight className="w-3 h-3 text-accent shrink-0" />
                <span>Reassign, disconnect, or retire child items to unlock deletion.</span>
              </div>
            </div>
          ) : (
            <div className="rounded-md bg-canvas/50 border border-hairline p-3 text-xs space-y-2">
              <DialogDescription className="text-2xs leading-relaxed text-secondary">
                {description || (
                  <>
                    Are you sure you want to permanently delete{' '}
                    <span className="font-semibold text-primary font-mono">{itemName}</span>?
                    This action is immediate and cannot be undone.
                  </>
                )}
              </DialogDescription>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-hairline">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="text-xs"
          >
            {isBlocked ? 'Dismiss' : 'Cancel'}
          </Button>

          {!isBlocked && (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={async () => {
                await onConfirm();
              }}
              disabled={isLoading}
              className="text-xs flex items-center gap-1.5"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {isLoading ? 'Deleting...' : confirmLabel}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface ConfirmActionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'primary';
  onConfirm: () => void | Promise<void>;
  isLoading?: boolean;
}

export function ConfirmActionDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  isLoading = false,
}: ConfirmActionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 bg-surface border border-hairline shadow-2xl">
        <DialogHeader className="space-y-1.5">
          <DialogTitle className="text-sm font-semibold text-primary flex items-center gap-2">
            <AlertOctagon
              className={`w-4 h-4 ${
                variant === 'danger'
                  ? 'text-tier0'
                  : variant === 'warning'
                  ? 'text-tier1'
                  : 'text-accent'
              }`}
            />
            {title}
          </DialogTitle>
          <DialogDescription className="text-2xs text-secondary leading-relaxed">
            {description}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-hairline">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="text-xs"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === 'primary' ? 'primary' : variant === 'danger' ? 'destructive' : 'secondary'}
            size="sm"
            onClick={async () => {
              await onConfirm();
            }}
            disabled={isLoading}
            className="text-xs"
          >
            {isLoading ? 'Processing...' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
