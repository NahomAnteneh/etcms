import { useEffect, useState } from 'react';
import { Command } from 'cmdk';
import {
  Search,
  LayoutDashboard,
  Database,
  Network,
  CheckCircle,
  Inbox,
  Send,
  History,
  UserCheck,
} from 'lucide-react';
import { useAuth, DEV_USERS } from '../../store/auth-context';

interface CommandPaletteProps {
  onSelectView: (view: string) => void;
  onOpenCI?: (ciId: string) => void;
}

export function CommandPalette({ onSelectView }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const { switchDevUser, currentDevUserId } = useAuth();

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, []);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-[rgba(17,24,39,0.40)] p-4">
      <div className="fixed inset-0" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl bg-surface border border-hairline rounded-lg shadow-[0_4px_12px_rgba(16,24,40,0.10)] overflow-hidden z-10 animate-in fade-in-0 zoom-in-95 duration-150">
        <Command className="w-full">
          <div className="flex items-center px-3.5 border-b border-subtle bg-surface">
            <Search className="w-4 h-4 text-muted mr-2 shrink-0 stroke-[1.5]" />
            <Command.Input
              autoFocus
              placeholder="Type a command, search CIs, or switch views..."
              className="w-full h-11 bg-transparent text-sm text-primary placeholder:text-muted focus:outline-none font-sans"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-2xs font-mono font-medium text-secondary bg-surface-sunken px-1.5 py-0.5 rounded-sm border border-subtle">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2 space-y-1">
            <Command.Empty className="py-6 text-center text-xs text-muted">
              No matching commands or resources found.
            </Command.Empty>

            <Command.Group heading="Navigation" className="text-2xs font-semibold text-muted px-2 py-1 uppercase tracking-wider">
              <Command.Item
                onSelect={() => {
                  onSelectView('dashboard');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-hover rounded-sm cursor-pointer transition-colors"
              >
                <LayoutDashboard className="w-4 h-4 text-accent stroke-[1.5]" />
                <span>Dashboard & Governance Health</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('catalog');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-hover rounded-sm cursor-pointer transition-colors"
              >
                <Database className="w-4 h-4 text-inservice stroke-[1.5]" />
                <span>CI Catalog & Trigram Search</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('graph');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-hover rounded-sm cursor-pointer transition-colors"
              >
                <Network className="w-4 h-4 text-accent stroke-[1.5]" />
                <span>Graph Explorer & Blast Radius</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('digest');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-hover rounded-sm cursor-pointer transition-colors"
              >
                <CheckCircle className="w-4 h-4 text-deprecated stroke-[1.5]" />
                <span>My Owner Digest (Verification Queue)</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('handshakes');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-hover rounded-sm cursor-pointer transition-colors"
              >
                <Inbox className="w-4 h-4 text-accent stroke-[1.5]" />
                <span>Cross-Boundary Handshake Inbox</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('campaigns');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-hover rounded-sm cursor-pointer transition-colors"
              >
                <Send className="w-4 h-4 text-planned stroke-[1.5]" />
                <span>Decentralized Intake Campaigns</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('audit');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-hover rounded-sm cursor-pointer transition-colors"
              >
                <History className="w-4 h-4 text-muted stroke-[1.5]" />
                <span>Immutable Audit Trail</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Dev Auth Switcher" className="text-2xs font-semibold text-muted px-2 py-1 uppercase tracking-wider pt-2 border-t border-subtle">
              {DEV_USERS.map((user) => (
                <Command.Item
                  key={user.id}
                  onSelect={() => {
                    switchDevUser(user);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between px-3 py-2 text-xs text-secondary hover:text-primary hover:bg-hover rounded-sm cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-muted stroke-[1.5]" />
                    <span className="font-medium">{user.name}</span>
                    <span className="text-3xs text-muted font-mono uppercase bg-surface-sunken px-1.5 py-0.5 rounded-sm">
                      {user.role}
                    </span>
                  </div>
                  {currentDevUserId === user.id && (
                    <span className="text-accent font-mono text-xs">Active</span>
                  )}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>

          <div className="p-2 border-t border-subtle bg-surface-sunken flex items-center justify-between text-2xs text-muted font-mono">
            <span>Navigation: ↑↓ to navigate, ↵ to select</span>
            <span>ESC to close</span>
          </div>
        </Command>
      </div>
    </div>
  );
}
