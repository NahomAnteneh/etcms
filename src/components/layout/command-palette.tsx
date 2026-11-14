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
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/70 backdrop-blur-xs p-4">
      <div className="fixed inset-0" onClick={() => setOpen(false)} />
      <div className="relative w-full max-w-xl bg-obsidian-850 border border-obsidian-600 rounded-xl shadow-2xl overflow-hidden z-10 animate-in fade-in-0 zoom-in-95 duration-150">
        <Command className="w-full">
          <div className="flex items-center px-3.5 border-b border-obsidian-700 bg-obsidian-900/60">
            <Search className="w-4 h-4 text-obsidian-400 mr-2 shrink-0" />
            <Command.Input
              autoFocus
              placeholder="Type a command, search CIs, or switch views..."
              className="w-full h-11 bg-transparent text-sm text-obsidian-100 placeholder:text-obsidian-500 focus:outline-none font-sans"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-2xs font-mono font-medium text-obsidian-400 bg-obsidian-800 px-1.5 py-0.5 rounded border border-obsidian-700">
              ESC
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2 space-y-1">
            <Command.Empty className="py-6 text-center text-xs text-obsidian-400">
              No matching commands or resources found.
            </Command.Empty>

            <Command.Group heading="Navigation" className="text-2xs font-semibold text-obsidian-400 px-2 py-1 uppercase tracking-wider">
              <Command.Item
                onSelect={() => {
                  onSelectView('dashboard');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-obsidian-200 hover:text-white hover:bg-blue-600/20 rounded cursor-pointer transition-colors"
              >
                <LayoutDashboard className="w-4 h-4 text-blue-400" />
                <span>Dashboard & Governance Health</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('catalog');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-obsidian-200 hover:text-white hover:bg-blue-600/20 rounded cursor-pointer transition-colors"
              >
                <Database className="w-4 h-4 text-emerald-400" />
                <span>CI Catalog & Trigram Search</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('graph');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-obsidian-200 hover:text-white hover:bg-blue-600/20 rounded cursor-pointer transition-colors"
              >
                <Network className="w-4 h-4 text-blue-400" />
                <span>Graph Explorer & Blast Radius</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('digest');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-obsidian-200 hover:text-white hover:bg-blue-600/20 rounded cursor-pointer transition-colors"
              >
                <CheckCircle className="w-4 h-4 text-amber-400" />
                <span>My Owner Digest (Verification Queue)</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('handshakes');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-obsidian-200 hover:text-white hover:bg-blue-600/20 rounded cursor-pointer transition-colors"
              >
                <Inbox className="w-4 h-4 text-indigo-400" />
                <span>Cross-Boundary Handshake Inbox</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('campaigns');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-obsidian-200 hover:text-white hover:bg-blue-600/20 rounded cursor-pointer transition-colors"
              >
                <Send className="w-4 h-4 text-rose-400" />
                <span>Intake Campaigns Management</span>
              </Command.Item>
              <Command.Item
                onSelect={() => {
                  onSelectView('audit');
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 text-xs text-obsidian-200 hover:text-white hover:bg-blue-600/20 rounded cursor-pointer transition-colors"
              >
                <History className="w-4 h-4 text-indigo-400" />
                <span>Immutable Audit Trail & Export</span>
              </Command.Item>
            </Command.Group>

            <Command.Group heading="Dev Auth Role Switcher" className="text-2xs font-semibold text-obsidian-400 px-2 py-1 uppercase tracking-wider mt-2 border-t border-obsidian-700/60 pt-2">
              {DEV_USERS.map((user) => (
                <Command.Item
                  key={user.id}
                  onSelect={() => {
                    switchDevUser(user);
                    setOpen(false);
                  }}
                  className="flex items-center justify-between px-3 py-2 text-xs text-obsidian-200 hover:text-white hover:bg-blue-600/20 rounded cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <UserCheck className="w-4 h-4 text-blue-400" />
                    <span>{user.name} ({user.ownerGroupName})</span>
                  </div>
                  <span className="text-2xs font-mono uppercase bg-obsidian-800 text-obsidian-400 px-1.5 py-0.5 rounded border border-obsidian-700">
                    {user.role} {currentDevUserId === user.id ? '✓' : ''}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
