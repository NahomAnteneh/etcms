import { useState, useRef, useEffect, useMemo } from 'react';
import {
  Search,
  ChevronDown,
  LayoutGrid,
  Settings,
  Check,
  Building2,
  Database,
  Network,
  History,
  RefreshCw,
  X,
  ArrowRight,
  Server,
  UserCheck,
  Cpu,
  Layers,
  Globe,
  Sliders,
  LogOut,
} from 'lucide-react';
import { useAuth, DEV_USERS, type DevUserOption } from '../../store/auth-context';
import { cn } from '../../lib/utils';
import { useCISearch, useCICatalog, usePendingEdges } from '../../api/endpoints';

interface PolarisNavProps {
  currentView: string;
  onSelectView: (view: string) => void;
  onNavigateToGraph?: (ciId: string) => void;
  onNavigateToCatalogCI?: (ciId: string) => void;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function PolarisNav({
  currentView,
  onSelectView,
  onNavigateToGraph,
  onNavigateToCatalogCI,
  onRefresh,
  refreshing = false,
}: PolarisNavProps) {
  const {
    currentUser,
    activeOwnerGroup,
    ownerGroups,
    isAdmin,
    logout,
    switchDevUser,
    currentDevUserId,
  } = useAuth();

  const [activeMenu, setActiveMenu] = useState<'group' | 'persona' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Live backend search for fast trigram index matches
  const { data: searchApiResults = [] } = useCISearch(searchQuery);
  const { data: catalogFallback } = useCICatalog();
  const { data: pendingEdges } = usePendingEdges(activeOwnerGroup?.id);
  const pendingApprovalsCount = pendingEdges?.length || 0;

  // Streamlined 5-Workspace navigation tabs
  const workspaceTabs = useMemo(() => [
    { id: 'dashboard', label: 'Dashboard', fullLabel: 'Governance Health & 3 Cs', icon: LayoutGrid },
    { id: 'catalog', label: 'Catalog', fullLabel: 'Configuration Items Catalog', icon: Database },
    { id: 'graph', label: 'Graph', fullLabel: 'Dependency & Topology Graph', icon: Network },
    { id: 'audit', label: 'Audit', fullLabel: 'Audit Explorer & Event Logs', icon: History },
    { id: 'settings', label: 'Settings', fullLabel: 'Roles, Permissions & Settings', icon: Settings },
  ], []);

  // Platform-aware keyboard shortcut badge (Mac: ⌘K, Linux/Windows: Ctrl K)
  const isMac = useMemo(() => {
    return typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent || navigator.platform || '');
  }, []);
  const shortcutBadge = isMac ? '⌘K' : 'Ctrl K';

  // Global Keyboard Shortcut: Cmd+K / Ctrl+K / '/'
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchFocused(true);
      } else if (
        e.key === '/' &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA' &&
        document.activeElement?.tagName !== 'SELECT'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchFocused(true);
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setIsSearchFocused(false);
      }
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        setActiveMenu(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Build unified search results list
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return { views: [], cis: [], totalCount: 0 };

    const matchingViews = workspaceTabs.filter(
      (tab) =>
        tab.label.toLowerCase().includes(q) ||
        tab.fullLabel.toLowerCase().includes(q) ||
        tab.id.toLowerCase().includes(q)
    );

    // Merge API search results with client fallback
    const ciMap = new Map<string, any>();
    if (searchApiResults && searchApiResults.length > 0) {
      searchApiResults.forEach((r) => {
        if (r.ci?.ci_id) ciMap.set(r.ci.ci_id, r.ci);
      });
    }
    if (ciMap.size === 0 && catalogFallback?.items) {
      catalogFallback.items.forEach((item) => {
        if (
          item.name.toLowerCase().includes(q) ||
          item.ci_class.toLowerCase().includes(q) ||
          item.environment.toLowerCase().includes(q) ||
          (item.technical_contact && item.technical_contact.toLowerCase().includes(q))
        ) {
          if (item.ci_id) ciMap.set(item.ci_id, item);
        }
      });
    }

    const matchingCIs = Array.from(ciMap.values()).slice(0, 8);
    const totalCount = matchingViews.length + matchingCIs.length;

    return { views: matchingViews, cis: matchingCIs, totalCount };
  }, [searchQuery, searchApiResults, catalogFallback, workspaceTabs]);

  // Reset highlight when search query changes
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [searchQuery]);

  const handleSelectView = (viewId: string) => {
    onSelectView(viewId);
    setSearchQuery('');
    setIsSearchFocused(false);
    setActiveMenu(null);
  };

  const handleSelectCIInCatalog = (ciId: string) => {
    if (onNavigateToCatalogCI) {
      onNavigateToCatalogCI(ciId);
    } else {
      onSelectView('catalog');
    }
    setSearchQuery('');
    setIsSearchFocused(false);
  };

  const handleSelectCIInGraph = (ciId: string) => {
    if (onNavigateToGraph) {
      onNavigateToGraph(ciId);
    } else {
      onSelectView('graph');
    }
    setSearchQuery('');
    setIsSearchFocused(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsSearchFocused(false);
      searchInputRef.current?.blur();
      return;
    }

    const total = searchResults.totalCount;
    if (total === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => (prev <= 0 ? total - 1 : prev - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const viewsCount = searchResults.views.length;
      if (highlightedIndex >= 0 && highlightedIndex < viewsCount) {
        handleSelectView(searchResults.views[highlightedIndex].id);
      } else if (highlightedIndex >= viewsCount) {
        const ci = searchResults.cis[highlightedIndex - viewsCount];
        if (ci?.ci_id) {
          if (e.shiftKey) {
            handleSelectCIInGraph(ci.ci_id);
          } else {
            handleSelectCIInCatalog(ci.ci_id);
          }
        }
      } else if (searchResults.views.length > 0) {
        handleSelectView(searchResults.views[0].id);
      } else if (searchResults.cis.length > 0) {
        const ci = searchResults.cis[0];
        if (ci?.ci_id) {
          if (e.shiftKey) {
            handleSelectCIInGraph(ci.ci_id);
          } else {
            handleSelectCIInCatalog(ci.ci_id);
          }
        }
      } else {
        handleSelectView('catalog');
      }
    }
  };

  const getClassIcon = (ciClass: string) => {
    switch (ciClass) {
      case 'database':
        return Database;
      case 'application':
        return Layers;
      case 'vm_cluster':
        return Cpu;
      case 'physical_host':
        return Server;
      default:
        return Server;
    }
  };

  return (
    <header className="h-11 bg-header-bg border-b border-header-surface px-3 flex items-center justify-between text-white select-none z-40 shrink-0 relative">
      {/* Left: Brand Glyph + Workspace Tabs (Protected against clipping) */}
      <div className="flex items-center gap-2 lg:gap-3 shrink-0">
        {/* Brand Label */}
        <button
          type="button"
          onClick={() => onSelectView('dashboard')}
          className="flex items-center gap-1.5 shrink-0 pr-1 cursor-pointer group focus:outline-none focus-visible:ring-1 focus-visible:ring-accent rounded text-left"
          title="ETCMS - CMDB Workspace"
          aria-label="ETCMS Home Dashboard"
        >
          <div className="w-5 h-5 rounded bg-accent/20 border border-accent/40 flex items-center justify-center text-accent group-hover:bg-accent group-hover:text-white transition-colors">
            <Database className="w-3 h-3 stroke-[2.2]" />
          </div>
          <span className="font-bold text-sm tracking-tight text-white font-mono">ETCMS</span>
          <span className="text-3xs font-mono font-semibold px-1 py-0.5 rounded bg-header-surface text-slate-300 border border-control/30 uppercase tracking-wider hidden sm:inline">
            CMDB
          </span>
        </button>

        {/* Primary Workspace Tabs Navigation */}
        <nav
          role="tablist"
          aria-label="Workspace Views"
          className="flex items-center gap-0.5 shrink-0 py-0.5"
        >
          {workspaceTabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentView === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => onSelectView(tab.id)}
                className={cn(
                  'flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent',
                  isActive
                    ? 'bg-header-surface text-white font-semibold ring-1 ring-accent/50 shadow-sm'
                    : 'text-slate-300 hover:text-white hover:bg-header-surface/50'
                )}
                title={tab.fullLabel}
                aria-label={tab.fullLabel}
              >
                <Icon className={cn('w-3.5 h-3.5 shrink-0', isActive ? 'text-accent' : 'text-slate-400')} />
                <span className="hidden sm:inline">{tab.label}</span>
                {tab.id === 'dashboard' && pendingApprovalsCount > 0 && (
                  <span className="px-1.5 py-0.2 rounded-full text-3xs font-mono font-semibold bg-accent text-white leading-tight">
                    {pendingApprovalsCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Center: Interactive Global Omnibar Search (Pre-AI 2023 Enterprise Standard) */}
      <div
        ref={searchContainerRef}
        className="relative flex-1 max-w-xs md:max-w-sm lg:max-w-md mx-2 md:mx-3 min-w-[140px]"
      >
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setIsSearchFocused(true)}
            onKeyDown={handleKeyDown}
            aria-label="Search configuration items, services, and views"
            placeholder={`Search CIs, views... (${shortcutBadge})`}
            className="w-full h-7.5 pl-8 pr-16 rounded bg-header-surface text-xs text-white placeholder:text-slate-400 border border-control/30 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent transition-colors font-sans"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            {searchQuery ? (
              <button
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear search query"
                className="text-slate-400 hover:text-white cursor-pointer p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            ) : (
              <span className="text-3xs font-mono text-slate-400 bg-header-bg border border-control/30 px-1 py-0.5 rounded select-none pointer-events-none">
                {shortcutBadge}
              </span>
            )}
          </div>
        </div>

        {/* Live Search Results Dropdown */}
        {isSearchFocused && searchQuery.trim() && (
          <div className="absolute left-0 mt-1.5 w-full sm:w-[460px] bg-surface border border-hairline rounded-md shadow-snow-dropdown z-50 text-primary p-2 max-h-[32rem] overflow-y-auto">
            {/* Matching Views Section */}
            {searchResults.views.length > 0 && (
              <div className="mb-2">
                <div className="px-2 py-1 text-3xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center justify-between">
                  <span>Workspace Views</span>
                  <span className="text-3xs text-secondary font-normal font-sans">Enter to navigate</span>
                </div>
                <div className="space-y-0.5 mt-0.5">
                  {searchResults.views.map((tab, idx) => {
                    const Icon = tab.icon;
                    const isHighlighted = highlightedIndex === idx;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => handleSelectView(tab.id)}
                        className={cn(
                          'w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between cursor-pointer transition-colors',
                          isHighlighted
                            ? 'bg-selected text-accent font-semibold'
                            : 'text-secondary hover:text-primary hover:bg-hover'
                        )}
                      >
                        <div className="flex items-center gap-2">
                          <Icon className="w-3.5 h-3.5 text-accent" />
                          <span className="font-medium text-primary">{tab.fullLabel}</span>
                        </div>
                        <ArrowRight className="w-3 h-3 text-muted" />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Matching Configuration Items Section */}
            {searchResults.cis.length > 0 && (
              <div>
                <div className="px-2 py-1 text-3xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center justify-between border-t border-subtle pt-1.5">
                  <span>Configuration Items ({searchResults.cis.length})</span>
                  <span className="text-3xs text-secondary font-normal font-sans">
                    Use ↑ ↓ &bull; Enter to inspect &bull; Shift+Enter for graph
                  </span>
                </div>
                <div className="space-y-1 mt-1">
                  {searchResults.cis.map((ci, idx) => {
                    const absoluteIndex = searchResults.views.length + idx;
                    const isHighlighted = highlightedIndex === absoluteIndex;
                    const Icon = getClassIcon(ci.ci_class);
                    return (
                      <div
                        key={ci.ci_id || ci.name}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleSelectCIInCatalog(ci.ci_id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (e.shiftKey) {
                              handleSelectCIInGraph(ci.ci_id);
                            } else {
                              handleSelectCIInCatalog(ci.ci_id);
                            }
                          }
                        }}
                        aria-label={`Select ${ci.name} (${ci.environment})`}
                        className={cn(
                          'w-full text-left px-2.5 py-2 rounded text-xs flex items-center justify-between cursor-pointer transition-colors border group focus:outline-none focus:ring-1 focus:ring-accent',
                          isHighlighted
                            ? 'bg-selected/50 border-accent/40 shadow-xs'
                            : 'border-transparent hover:bg-hover hover:border-subtle'
                        )}
                      >
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <div className="p-1 rounded bg-surface-sunken border border-subtle text-muted shrink-0">
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="truncate">
                            <div className="font-mono text-xs font-semibold text-primary truncate flex items-center gap-1.5">
                              <span>{ci.name}</span>
                              <span className="text-3xs font-sans font-normal px-1 py-0.5 rounded bg-surface-sunken border border-subtle text-secondary uppercase">
                                {ci.environment}
                              </span>
                            </div>
                            <div className="text-3xs text-muted truncate mt-0.5">
                              {ci.ci_class?.replace('_', ' ')} · {ownerGroups.find(g => g.id === ci.owner_group_id)?.name || ci.ownership?.owner_group_name || 'Platform Engineering'}
                              {ci.technical_contact ? ` · ${ci.technical_contact}` : ''}
                            </div>
                          </div>
                        </div>

                        {/* Quick Action Buttons on Hover / Focus */}
                        <div className="flex items-center gap-1 shrink-0 ml-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectCIInGraph(ci.ci_id);
                            }}
                            className="px-2 py-0.5 rounded text-3xs font-medium bg-surface hover:bg-accent hover:text-white border border-subtle text-secondary transition-colors cursor-pointer flex items-center gap-1"
                            title="Open in Topology Graph"
                          >
                            <Network className="w-3 h-3" />
                            <span>Graph</span>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectCIInCatalog(ci.ci_id);
                            }}
                            className="px-2 py-0.5 rounded text-3xs font-medium bg-accent text-white hover:bg-accent-hover transition-colors cursor-pointer flex items-center gap-1"
                            title="Inspect in Catalog"
                          >
                            <span>Inspect</span>
                            <ArrowRight className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {searchResults.views.length === 0 && searchResults.cis.length === 0 && (
              <div className="p-4 text-center text-xs text-muted">
                No matching configuration items or views found for &ldquo;{searchQuery}&rdquo;
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Actions, Owner Scope Filter & Multi-Persona Impersonator */}
      <div ref={menuRef} className="flex items-center gap-2 shrink-0">
        {/* Refresh Action */}
        {onRefresh && (
          <button
            onClick={onRefresh}
            aria-label="Refresh workspace data"
            className="p-1.5 rounded hover:bg-header-surface text-slate-300 hover:text-white transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            title="Refresh All CMDB Data"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin text-accent')} />
          </button>
        )}

        {/* Automatic Boundary / Scope Badge (Platform Admin is Global; other users belong to their boundary) */}
        {isAdmin ? (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-header-surface text-xs text-accent-subtle border border-accent/40 shadow-sm"
            title="Platform Admin operates globally across all owner group boundaries"
          >
            <Globe className="w-3.5 h-3.5 text-accent" />
            <span className="font-semibold text-xs">Enterprise Scope (Global)</span>
          </div>
        ) : (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-header-surface text-xs text-accent-subtle border border-accent/40 shadow-sm"
            title={`Assigned Boundary: ${activeOwnerGroup?.name || 'Assigned Boundary'}. Non-admin accounts are strictly locked to their primary owner group.`}
          >
            <Building2 className="w-3.5 h-3.5 text-accent" />
            <span className="font-medium text-xs max-w-44 truncate">
              Boundary: {activeOwnerGroup?.name || 'Assigned Boundary'}
            </span>
          </div>
        )}

        {/* Persona Impersonation Dropdown (Pre-AI Enterprise CMDB Standard) */}
        <div className="relative">
          <button
            onClick={() => setActiveMenu((prev) => (prev === 'persona' ? null : 'persona'))}
            aria-expanded={activeMenu === 'persona'}
            aria-haspopup="menu"
            aria-label="Switch User Persona"
            className="flex items-center gap-2 pl-1.5 pr-2 py-0.5 rounded bg-header-surface border border-control/30 hover:border-accent text-xs text-white transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
            title="Switch Developer Persona"
          >
            <div className="w-5 h-5 rounded-full bg-accent border border-white/20 flex items-center justify-center font-bold text-3xs text-white font-mono">
              {(currentUser?.name?.[0] || 'A').toUpperCase()}
            </div>
            <div className="text-left leading-tight hidden md:block">
              <span className="font-semibold text-2xs text-white block">
                {currentUser?.name || 'Admin User'}
              </span>
              <span className="text-3xs text-accent-subtle font-mono uppercase block">
                {currentUser?.role?.replace(/_/g, ' ') || 'Platform Admin'}
              </span>
            </div>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </button>

          {activeMenu === 'persona' && (
            <div className="absolute right-0 mt-1.5 w-72 bg-surface border border-hairline rounded-md shadow-snow-dropdown z-50 text-primary p-2 animate-in fade-in-50 duration-100">
              {/* Current Persona Header */}
              <div className="px-2.5 py-1.5 bg-surface-sunken border border-subtle rounded-md mb-2">
                <div className="text-3xs font-mono uppercase tracking-wider text-muted font-semibold">
                  Active Persona
                </div>
                <div className="font-semibold text-xs text-primary mt-0.5">
                  {currentUser?.name}
                </div>
                <div className="text-3xs font-mono text-secondary mt-0.5">
                  {currentUser?.email}
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-3xs font-mono px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30 uppercase font-semibold">
                    {currentUser?.role}
                  </span>
                  <span className="text-3xs text-muted">
                    &bull; {activeOwnerGroup?.name || 'Platform Engineering'}
                  </span>
                </div>
              </div>

              {/* Development Impersonation Section (Dev Mode Only) */}
              {import.meta.env.DEV && (
                <>
                  <div className="px-2.5 py-1 text-3xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center gap-1">
                    <UserCheck className="w-3 h-3 text-accent" />
                    <span>Switch Developer Persona</span>
                  </div>
                  <div className="space-y-1 mt-1">
                    {DEV_USERS.map((user: DevUserOption) => {
                      const isActive = currentDevUserId === user.id;
                      return (
                        <button
                          key={user.id}
                          onClick={() => {
                            switchDevUser(user);
                            setActiveMenu(null);
                          }}
                          className={cn(
                            'w-full text-left px-2.5 py-2 rounded text-xs flex items-center justify-between cursor-pointer transition-colors border',
                            isActive
                              ? 'bg-selected/70 border-accent/40 text-primary font-semibold'
                              : 'border-transparent text-secondary hover:text-primary hover:bg-hover'
                          )}
                        >
                          <div>
                            <div className="font-semibold text-xs text-primary flex items-center gap-1.5">
                              <span>{user.name}</span>
                              <span className="text-3xs font-mono px-1 py-0.5 rounded bg-surface-sunken border border-subtle uppercase font-normal text-secondary">
                                {user.role}
                              </span>
                            </div>
                            <div className="text-3xs text-muted mt-0.5">
                              {user.ownerGroupName}
                            </div>
                          </div>
                          {isActive && <Check className="w-3.5 h-3.5 text-accent stroke-[2.5]" />}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              {/* Quick Settings Link */}
              <div className="border-t border-subtle mt-2 pt-1.5">
                <button
                  onClick={() => handleSelectView('settings')}
                  className="w-full text-left px-2.5 py-1 rounded text-xs text-secondary hover:text-primary hover:bg-hover flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-1.5">
                    <Sliders className="w-3 h-3 text-muted" />
                    <span>System Settings & Roles</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-muted" />
                </button>
              </div>

              {/* Sign Out Action */}
              <div className="border-t border-subtle mt-1.5 pt-1.5">
                <button
                  onClick={async () => {
                    setActiveMenu(null);
                    await logout();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs text-tier0 hover:bg-tier0-bg border border-transparent hover:border-tier0-border flex items-center justify-between cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-1.5">
                    <LogOut className="w-3.5 h-3.5" />
                    <span className="font-medium">Sign Out</span>
                  </div>
                  <span className="text-3xs font-mono text-muted">Revoke Session</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
