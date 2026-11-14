import { useState } from 'react';
import { Search, ChevronDown, Layers, Building2, User } from 'lucide-react';
import { useAuth, DEV_USERS } from '../../store/auth-context';

interface TopNavProps {
  onOpenCommandPalette: () => void;
}

export function TopNav({ onOpenCommandPalette }: TopNavProps) {
  const { currentUser, activeRole, switchDevUser, currentDevUserId, activeOwnerGroup, ownerGroups, setActiveOwnerGroup } = useAuth();
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);

  return (
    <header className="h-13 bg-surface border-b border-hairline px-4 flex items-center justify-between sticky top-0 z-30 select-none">
      {/* Left: Brand & Search Trigger */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
            <Layers className="w-4 h-4 text-white stroke-[1.5]" />
          </div>
          <div>
            <span className="font-semibold text-sm tracking-tight text-primary flex items-center gap-1.5">
              ETCMS
              <span className="text-3xs font-mono font-medium uppercase px-1.5 py-0.5 bg-tier2-bg text-accent border border-tier2-border rounded-sm">
                v3.0
              </span>
            </span>
          </div>
        </div>

        {/* Global Search Button */}
        <button
          onClick={onOpenCommandPalette}
          className="hidden md:flex items-center gap-2.5 bg-surface hover:bg-hover border border-control px-3 py-1.5 rounded-md text-xs text-muted hover:text-primary transition-colors w-72 justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Search className="w-3.5 h-3.5 stroke-[1.5]" />
            <span>Search CIs, blast radius, owners...</span>
          </div>
          <kbd className="text-2xs font-mono bg-surface-sunken px-1.5 py-0.5 rounded-sm border border-subtle text-secondary">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right: Operational Status, Owner Group & Dev Auth */}
      <div className="flex items-center gap-3">
        {/* Active System Status / Window */}
        <div className="hidden lg:flex items-center gap-2 px-2.5 py-1 bg-surface-sunken border border-subtle rounded-sm text-2xs font-mono text-secondary">
          <span className="w-1.5 h-1.5 rounded-full bg-inservice" />
          <span>Liveness: OK</span>
          <span className="text-muted">|</span>
          <span className="text-primary font-medium">Cycle: Nov 01–15 UTC</span>
        </div>

        {/* Active Owner Group Selector */}
        {ownerGroups.length > 0 && (
          <div className="relative">
            <button
              onClick={() => {
                setShowGroupDropdown(!showGroupDropdown);
                setShowRoleDropdown(false);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface hover:bg-hover border border-hairline text-xs text-primary transition-colors cursor-pointer"
            >
              <Building2 className="w-3.5 h-3.5 text-accent stroke-[1.5]" />
              <span className="font-medium max-w-32 truncate">
                {activeOwnerGroup?.name || 'Select Group'}
              </span>
              <ChevronDown className="w-3 h-3 text-muted stroke-[1.5]" />
            </button>

            {showGroupDropdown && (
              <div className="absolute right-0 mt-1.5 w-60 bg-surface border border-hairline rounded-md shadow-[0_4px_12px_rgba(16,24,40,0.10)] p-1 z-40">
                <div className="px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-muted">
                  Switch Active Owner Group
                </div>
                {ownerGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => {
                      setActiveOwnerGroup(group);
                      setShowGroupDropdown(false);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-sm text-xs text-secondary hover:text-primary hover:bg-hover flex items-center justify-between cursor-pointer"
                  >
                    <span className="truncate">{group.name}</span>
                    {activeOwnerGroup?.id === group.id && (
                      <span className="text-accent font-mono text-xs">✓</span>
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
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface hover:bg-hover border border-hairline text-xs text-primary transition-colors cursor-pointer"
          >
            <div className="w-5 h-5 rounded-sm bg-surface-sunken flex items-center justify-center">
              <User className="w-3 h-3 text-secondary stroke-[1.5]" />
            </div>
            <div className="text-left leading-tight hidden sm:block">
              <div className="font-medium text-xs text-primary">{currentUser?.name || 'Dev User'}</div>
              <div className="text-3xs font-mono text-muted uppercase">{activeRole}</div>
            </div>
            <ChevronDown className="w-3 h-3 text-muted stroke-[1.5]" />
          </button>

          {showRoleDropdown && (
            <div className="absolute right-0 mt-1.5 w-64 bg-surface border border-hairline rounded-md shadow-[0_4px_12px_rgba(16,24,40,0.10)] p-1 z-40">
              <div className="px-2.5 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted border-b border-subtle">
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
                    className="w-full text-left px-2.5 py-2 rounded-sm text-xs text-secondary hover:text-primary hover:bg-hover flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <div className="font-medium">{user.name}</div>
                      <div className="text-3xs text-muted">{user.ownerGroupName}</div>
                    </div>
                    <span className="text-2xs font-mono uppercase bg-surface-sunken px-1 py-0.5 rounded-sm border border-subtle">
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
