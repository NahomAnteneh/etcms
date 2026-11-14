import {
  LayoutDashboard,
  Database,
  Network,
  CheckCircle,
  Inbox,
  Send,
  History,
  FileCode2,
  HelpCircle,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { usePendingEdges, useOwnerDigest, type DigestItem } from '../../api/endpoints';

interface SidebarProps {
  currentView: string;
  onSelectView: (view: string) => void;
}

export function Sidebar({ currentView, onSelectView }: SidebarProps) {
  const { data: pendingEdges } = usePendingEdges();
  const { data: digest } = useOwnerDigest();

  const pendingCount = pendingEdges?.length || 0;
  const digestItemsCount = digest?.items?.filter((item: DigestItem) => item.status === 'open').length || 0;

  const navItems = [
    {
      id: 'dashboard',
      label: 'Overview & Health',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'catalog',
      label: 'CI Catalog',
      icon: Database,
      badge: null,
    },
    {
      id: 'graph',
      label: 'Graph & Blast Radius',
      icon: Network,
      badge: null,
    },
    {
      id: 'digest',
      label: 'My Verification Queue',
      icon: CheckCircle,
      badge: digestItemsCount > 0 ? digestItemsCount : null,
      badgeColor: 'bg-tier1-bg text-tier1 border-tier1-border',
    },
    {
      id: 'handshakes',
      label: 'Handshake Inbox',
      icon: Inbox,
      badge: pendingCount > 0 ? pendingCount : null,
      badgeColor: 'bg-tier2-bg text-accent border-tier2-border',
    },
    {
      id: 'campaigns',
      label: 'Intake Campaigns',
      icon: Send,
      badge: null,
    },
    {
      id: 'audit',
      label: 'Audit Timeline',
      icon: History,
      badge: null,
    },
  ];

  return (
    <aside className="w-60 bg-surface border-r border-hairline flex flex-col justify-between select-none">
      <div className="p-3 space-y-1">
        <div className="px-3 py-2 text-3xs font-mono font-semibold uppercase tracking-wider text-muted">
          Core Workflows
        </div>
        <nav className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentView === item.id;
            return (
              <button
                key={item.id}
                onClick={() => onSelectView(item.id)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-colors duration-150 cursor-pointer',
                  isActive
                    ? 'bg-accent-subtle text-accent border border-accent font-semibold'
                    : 'text-secondary hover:text-primary hover:bg-hover border border-transparent'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={cn(
                      'w-4 h-4 stroke-[1.5]',
                      isActive ? 'text-accent' : 'text-muted'
                    )}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span
                    className={cn(
                      'text-3xs font-mono px-1.5 py-0.5 rounded-sm border font-semibold',
                      item.badgeColor
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="p-3 border-t border-subtle space-y-2">
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 rounded-sm text-2xs text-muted hover:text-primary hover:bg-hover transition-colors"
        >
          <FileCode2 className="w-3.5 h-3.5 text-muted stroke-[1.5]" />
          <span>OpenAPI Specification</span>
        </a>
        <div className="flex items-center justify-between px-3 py-1 text-3xs font-mono text-muted">
          <div className="flex items-center gap-1.5">
            <HelpCircle className="w-3 h-3 stroke-[1.5]" />
            <span>Press ⌘K for commands</span>
          </div>
          <span>v3.0</span>
        </div>
      </div>
    </aside>
  );
}
