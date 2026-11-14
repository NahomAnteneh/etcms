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
      badgeColor: 'bg-amber-500/20 text-amber-400 border-amber-600/40',
    },
    {
      id: 'handshakes',
      label: 'Handshake Inbox',
      icon: Inbox,
      badge: pendingCount > 0 ? pendingCount : null,
      badgeColor: 'bg-blue-500/20 text-blue-400 border-blue-600/40',
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
    <aside className="w-60 bg-obsidian-900 border-r border-obsidian-700/80 flex flex-col justify-between select-none">
      <div className="p-3 space-y-1">
        <div className="px-3 py-2 text-3xs font-mono font-semibold uppercase tracking-wider text-obsidian-400">
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
                  'w-full flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium transition-all duration-150',
                  isActive
                    ? 'bg-blue-600/20 text-white border border-blue-500/30 font-semibold'
                    : 'text-obsidian-300 hover:text-obsidian-100 hover:bg-obsidian-800/60 border border-transparent'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon
                    className={cn(
                      'w-4 h-4',
                      isActive ? 'text-blue-400' : 'text-obsidian-400 group-hover:text-obsidian-200'
                    )}
                  />
                  <span>{item.label}</span>
                </div>
                {item.badge !== null && (
                  <span
                    className={cn(
                      'text-3xs font-mono px-1.5 py-0.2 rounded border font-semibold',
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
      <div className="p-3 border-t border-obsidian-800/80 space-y-2">
        <a
          href="/docs"
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-2 px-3 py-1.5 rounded text-2xs text-obsidian-400 hover:text-obsidian-200 hover:bg-obsidian-800/40 transition-colors"
        >
          <FileCode2 className="w-3.5 h-3.5 text-obsidian-400" />
          <span>OpenAPI Specification</span>
        </a>
        <div className="flex items-center justify-between px-3 py-1 text-3xs font-mono text-obsidian-500">
          <div className="flex items-center gap-1.5">
            <HelpCircle className="w-3 h-3" />
            <span>Press ⌘K for commands</span>
          </div>
          <span>v3.0</span>
        </div>
      </div>
    </aside>
  );
}
