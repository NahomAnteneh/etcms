import { useState } from 'react';
import { Search, ChevronDown, Sparkles, Building2, User } from 'lucide-react';
import { useAuth, DEV_USERS } from '../../store/auth-context';

interface TopNavProps {
  onOpenCommandPalette: () => void;
}

export function TopNav({ onOpenCommandPalette }: TopNavProps) {
  const { currentUser, activeRole, switchDevUser, currentDevUserId, activeOwnerGroup, ownerGroups, setActiveOwnerGroup } = useAuth();
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);

  return (
    <header className="h-13 bg-obsidian-900 border-b border-obsidian-700/80 px-4 flex items-center justify-between sticky top-0 z-30 select-none backdrop-blur-md">
      {/* Left: Brand & Search Trigger */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-md shadow-blue-900/30">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="font-semibold text-sm tracking-tight text-white flex items-center gap-1.5">
              ETCMS
              <span className="text-3xs font-mono font-medium uppercase px-1.5 py-0.2 bg-blue-950/80 text-blue-400 border border-blue-800/60 rounded">
                v3.0
              </span>
            </span>
          </div>
        </div>

        {/* Global Search Button */}
        <button
          onClick={onOpenCommandPalette}
          className="hidden md:flex items-center gap-2.5 bg-obsidian-950/70 hover:bg-obsidian-800 border border-obsidian-700 hover:border-obsidian-600 px-3 py-1.5 rounded-md text-xs text-obsidian-400 hover:text-obsidian-200 transition-colors w-72 justify-between"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5" />
            <span>Search CIs, blast radius, owners...</span>
          </div>
          <kbd className="text-2xs font-mono bg-obsidian-850 px-1.5 py-0.5 rounded border border-obsidian-700 text-obsidian-400">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Operational Status, Owner Group & Dev Auth */}
      <div className="flex items-center gap-3">
        {/* Active System Status / Window */}
        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 bg-obsidian-950/60 border border-obsidian-800 rounded text-2xs font-mono text-obsidian-400">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Liveness: OK</span>
          <span className="text-obsidian-600">|</span>
          <span className="text-obsidian-300">Cycle: Nov 01–15 UTC</span>
        </div>

        {/* Active Owner Group Selector */}
        {ownerGroups.length > 0 && (
          <div className="relative">
            <button
              onClick={() => {
                setShowGroupDropdown(!showGroupDropdown);
                setShowRoleDropdown(false);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-obsidian-850 hover:bg-obsidian-800 border border-obsidian-700 text-xs text-obsidian-200 transition-colors"
            >
              <Building2 className="w-3.5 h-3.5 text-blue-400" />
              <span className="font-medium max-w-32 truncate">
                {activeOwnerGroup?.name || 'Select Group'}
              </span>
              <ChevronDown className="w-3 h-3 text-obsidian-400" />
            </button>

            {showGroupDropdown && (
              <div className="absolute right-0 mt-1.5 w-60 bg-obsidian-850 border border-obsidian-600 rounded-lg shadow-xl p-1 z-40">
                <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-obsidian-400">
                  Switch Active Owner Group
                </div>
                {ownerGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => {
                      setActiveOwnerGroup(group);
                      setShowGroupDropdown(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded text-xs text-obsidian-200 hover:text-white hover:bg-obsidian-750 flex items-center justify-between"
                  >
                    <span className="truncate">{group.name}</span>
                    {activeOwnerGroup?.id === group.id && (
                      <span className="text-blue-400 font-mono text-xs">✓</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dev Auth Switcher */}
        <div className="relative">
          <button
            onClick={() => {
              setShowRoleDropdown(!showRoleDropdown);
              setShowGroupDropdown(false);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-obsidian-850 hover:bg-obsidian-800 border border-obsidian-700 text-xs text-obsidian-200 transition-colors"
          >
            <div className="w-5 h-5 rounded bg-obsidian-700 flex items-center justify-center">
              <User className="w-3 h-3 text-obsidian-300" />
            </div>
            <div className="text-left leading-tight hidden sm:block">
              <div className="font-medium text-xs text-obsidian-100">{currentUser?.name || 'Dev User'}</div>
              <div className="text-3xs font-mono text-obsidian-400 uppercase">{activeRole}</div>
            </div>
            <ChevronDown className="w-3 h-3 text-obsidian-400" />
          </button>

          {showRoleDropdown && (
            <div className="absolute right-0 mt-1.5 w-64 bg-obsidian-850 border border-obsidian-600 rounded-lg shadow-xl p-1 z-40">
              <div className="px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wider text-obsidian-400 border-b border-obsidian-750">
                Switch Dev Auth Role
              </div>
              <div className="py-1">
                {DEV_USERS.map((user) => (
                  <button
                    key={user.id}
                    onClick={() => {
                      switchDevUser(user);
                      setShowRoleDropdown(false);
                    }}
                    className="w-full text-left px-2.5 py-2 rounded text-xs text-obsidian-200 hover:text-white hover:bg-obsidian-750 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-medium">{user.name}</div>
                      <div className="text-3xs text-obsidian-400">{user.ownerGroupName}</div>
                    </div>
                    <span className="text-2xs font-mono uppercase bg-obsidian-900 px-1 py-0.5 rounded border border-obsidian-750">
                      {user.role} {currentDevUserId === user.id ? '✓' : ''}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
