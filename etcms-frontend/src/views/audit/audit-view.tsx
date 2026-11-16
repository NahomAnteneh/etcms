import { useState, useEffect, useMemo, useCallback, Fragment } from 'react';
import {
  FileSpreadsheet,
  RefreshCw,
  Search,
  Eye,
  CheckCircle,
  Trash2,
  Edit3,
  PlusCircle,
  Flag,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  ArrowRight,
  Code,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';
import { useAuth } from '../../store/auth-context';
import { formatDateTime, formatRelativeTime } from '../../lib/utils';
import { useRevertAuditLog } from '../../api/endpoints';
import { useToast } from '../../components/ui/toast';
import { ConfirmActionDialog } from '../../components/ui/confirm-dialog';

export interface AuditLogEntry {
  id: string;
  action: string;
  actor_id: string;
  actor_name: string;
  actor_email: string;
  entity_type: string;
  entity_id: string;
  created_at: string;
  diff: Record<string, any>;
  affected_owner_group_ids?: string[];
}

export function AuditView() {
  const { activeRole, activeOwnerGroup, currentDevUserId } = useAuth();
  const toast = useToast();
  const [isExporting, setIsExporting] = useState(false);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [dateRangeFilter, setDateRangeFilter] = useState<'all' | '24h' | '7d' | '30d'>('all');
  const [actorFilter, setActorFilter] = useState('');
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [showRawJsonMap, setShowRawJsonMap] = useState<Record<string, boolean>>({});
  const [inspectingLog, setInspectingLog] = useState<AuditLogEntry | null>(null);
  const [revertingId, setRevertingId] = useState<string | null>(null);
  const [revertTarget, setRevertTarget] = useState<AuditLogEntry | null>(null);
  const revertMutation = useRevertAuditLog();

  const distinctActors = useMemo(() => {
    const map = new Map<string, string>();
    logs.forEach((l) => {
      const name = l.actor_name || l.actor_email;
      if (name) map.set(name, name);
    });
    return Array.from(map.values()).sort();
  }, [logs]);

  const distinctEntityTypes = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      if (l.entity_type) set.add(l.entity_type);
    });
    return Array.from(set).sort();
  }, [logs]);

  const fetchAuditLogs = useCallback(async () => {
    setIsLoading(true);
    try {
      const url = `/api/v1/audit-logs/export?format=ndjson${
        activeRole !== 'platform_admin' && activeOwnerGroup
          ? `&owner_group_id=${activeOwnerGroup.id}`
          : ''
      }`;
      const response = await fetch(url, {
        headers: {
          'X-Dev-User-ID': currentDevUserId || '11111111-1111-1111-1111-111111111111',
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      const parsed: AuditLogEntry[] = [];
      const lines = text.trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          parsed.push(JSON.parse(line));
        } catch {
          // ignore corrupted line if any
        }
      }
      // Sort newest first
      parsed.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setLogs(parsed);
    } catch (e) {
      console.error('Failed to load audit logs', e);
    } finally {
      setIsLoading(false);
    }
  }, [activeRole, activeOwnerGroup, currentDevUserId]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const url = `/api/v1/audit-logs/export${
        activeRole !== 'platform_admin' && activeOwnerGroup
          ? `?owner_group_id=${activeOwnerGroup.id}`
          : ''
      }`;
      const response = await fetch(url, {
        headers: {
          'X-Dev-User-ID': currentDevUserId || '11111111-1111-1111-1111-111111111111',
        },
      });
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `etcms-audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
      toast.info('Exported audit logs to CSV');
    } catch (e) {
      console.error('Export failed', e);
      toast.error('Failed to export audit logs');
    } finally {
      setIsExporting(false);
    }
  };

  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      if (actionFilter && log.action !== actionFilter) return false;
      if (entityTypeFilter && log.entity_type !== entityTypeFilter) return false;
      if (actorFilter && log.actor_name !== actorFilter && log.actor_email !== actorFilter) return false;

      if (dateRangeFilter === '24h') {
        const cutoff = Date.now() - 24 * 60 * 60 * 1000;
        if (new Date(log.created_at).getTime() < cutoff) return false;
      } else if (dateRangeFilter === '7d') {
        const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
        if (new Date(log.created_at).getTime() < cutoff) return false;
      } else if (dateRangeFilter === '30d') {
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        if (new Date(log.created_at).getTime() < cutoff) return false;
      }

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        log.actor_name?.toLowerCase().includes(q) ||
        log.actor_email?.toLowerCase().includes(q) ||
        log.entity_id?.toLowerCase().includes(q) ||
        log.entity_type?.toLowerCase().includes(q) ||
        JSON.stringify(log.diff).toLowerCase().includes(q)
      );
    });
  }, [logs, actionFilter, entityTypeFilter, actorFilter, dateRangeFilter, searchQuery]);

  const renderDiffRows = (diff: Record<string, any>) => {
    if (!diff || Object.keys(diff).length === 0) {
      return (
        <div className="text-muted text-xs italic py-2">
          Initial creation or state transition without property-level mutation diffs.
        </div>
      );
    }

    if (diff.old && diff.new && typeof diff.old === 'object' && typeof diff.new === 'object') {
      const allKeys = Array.from(new Set([...Object.keys(diff.old), ...Object.keys(diff.new)]));
      return (
        <table className="w-full text-left text-2xs border-collapse">
          <thead>
            <tr className="border-b border-subtle text-secondary font-mono uppercase bg-surface-sunken">
              <th className="py-1.5 px-2.5">Field / Property</th>
              <th className="py-1.5 px-2.5">Previous Value (Before)</th>
              <th className="py-1.5 px-2 w-6 text-center"></th>
              <th className="py-1.5 px-2.5">Committed Value (After)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-subtle/50 font-mono">
            {allKeys.map((k) => (
              <tr key={k} className="hover:bg-hover/50">
                <td className="py-1.5 px-2.5 font-semibold text-primary">{k}</td>
                <td className="py-1.5 px-2.5 text-tier0 bg-tier0-bg/30 rounded">
                  {diff.old[k] !== undefined ? String(diff.old[k]) : <span className="text-muted">—</span>}
                </td>
                <td className="py-1.5 px-2 text-center text-muted">
                  <ArrowRight className="w-3 h-3 inline text-accent" />
                </td>
                <td className="py-1.5 px-2.5 text-inservice bg-accent/10 rounded font-medium">
                  {diff.new[k] !== undefined ? String(diff.new[k]) : <span className="text-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    const entries = Object.entries(diff);
    return (
      <table className="w-full text-left text-2xs border-collapse">
        <thead>
          <tr className="border-b border-subtle text-secondary font-mono uppercase bg-surface-sunken">
            <th className="py-1.5 px-2.5">Field / Property</th>
            <th className="py-1.5 px-2.5">Previous Value</th>
            <th className="py-1.5 px-2 w-6 text-center"></th>
            <th className="py-1.5 px-2.5">Committed Mutation</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-subtle/50 font-mono">
          {entries.map(([k, v]) => {
            const isObj = v && typeof v === 'object' && ('old' in v || 'new' in v || 'before' in v || 'after' in v);
            const oldVal = isObj ? (v.old ?? v.before ?? '—') : '—';
            const newVal = isObj ? (v.new ?? v.after ?? JSON.stringify(v)) : (typeof v === 'object' ? JSON.stringify(v) : String(v));

            return (
              <tr key={k} className="hover:bg-hover/50">
                <td className="py-1.5 px-2.5 font-semibold text-primary">{k}</td>
                <td className="py-1.5 px-2.5 text-secondary">
                  {String(oldVal)}
                </td>
                <td className="py-1.5 px-2 text-center text-muted">
                  <ArrowRight className="w-3 h-3 inline text-accent" />
                </td>
                <td className="py-1.5 px-2.5 text-inservice bg-accent/10 rounded font-medium">
                  {String(newVal)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    );
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'create':
        return (
          <span className="inline-flex items-center gap-1 text-3xs font-mono uppercase bg-tier2-bg text-tier2 border border-tier2-border px-1.5 py-0.5 rounded-sm font-semibold">
            <PlusCircle className="w-2.5 h-2.5 stroke-[1.5]" /> Create
          </span>
        );
      case 'verify':
        return (
          <span className="inline-flex items-center gap-1 text-3xs font-mono uppercase bg-accent-subtle text-inservice border border-inservice/30 px-1.5 py-0.5 rounded-sm font-semibold">
            <CheckCircle className="w-2.5 h-2.5 stroke-[1.5]" /> Verify
          </span>
        );
      case 'update':
        return (
          <span className="inline-flex items-center gap-1 text-3xs font-mono uppercase bg-surface-sunken text-primary border border-subtle px-1.5 py-0.5 rounded-sm font-semibold">
            <Edit3 className="w-2.5 h-2.5 stroke-[1.5]" /> Update
          </span>
        );
      case 'retire':
        return (
          <span className="inline-flex items-center gap-1 text-3xs font-mono uppercase bg-tier0-bg text-tier0 border border-tier0-border px-1.5 py-0.5 rounded-sm font-semibold">
            <Trash2 className="w-2.5 h-2.5 stroke-[1.5]" /> Retire
          </span>
        );
      case 'flag':
        return (
          <span className="inline-flex items-center gap-1 text-3xs font-mono uppercase bg-tier1-bg text-tier1 border border-tier1-border px-1.5 py-0.5 rounded-sm font-semibold">
            <Flag className="w-2.5 h-2.5 stroke-[1.5]" /> Flag
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-3xs font-mono uppercase bg-surface-sunken text-secondary border border-subtle px-1.5 py-0.5 rounded-sm">
            {action}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6 w-full animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-subtle">
        <h1 className="text-lg font-semibold tracking-tight text-primary">Audit Log</h1>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAuditLogs}
            isLoading={isLoading}
            className="text-xs h-8"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
            Refresh
          </Button>
          <Button variant="primary" size="sm" onClick={handleExportCSV} isLoading={isExporting} className="text-xs h-8">
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-64">
          <Search className="w-4 h-4 text-muted absolute left-2.5 top-2 stroke-[1.5]" />
          <Input
            aria-label="Search audit logs"
            placeholder="Search audit logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Date Range Filter */}
        <select
          aria-label="Filter by date range"
          value={dateRangeFilter}
          onChange={(e) => setDateRangeFilter(e.target.value as any)}
          className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer"
        >
          <option value="all">All Time</option>
          <option value="24h">Past 24 Hours</option>
          <option value="7d">Past 7 Days</option>
          <option value="30d">Past 30 Days</option>
        </select>

        {/* Action Filter */}
        <select
          aria-label="Filter by action"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer"
        >
          <option value="">All Actions</option>
          <option value="create">Create</option>
          <option value="verify">Verify</option>
          <option value="update">Update</option>
          <option value="retire">Retire</option>
          <option value="flag">Flag</option>
        </select>

        {/* Entity Type Filter */}
        <select
          aria-label="Filter by entity type"
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent cursor-pointer"
        >
          <option value="">All Entity Types</option>
          {distinctEntityTypes.map((t) => (
            <option key={t} value={t}>
              {t.toUpperCase()}
            </option>
          ))}
        </select>

        {/* Actor Filter */}
        <select
          aria-label="Filter by actor"
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent max-w-44 truncate cursor-pointer"
        >
          <option value="">All Actors</option>
          {distinctActors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>

        {(actionFilter || entityTypeFilter || actorFilter || dateRangeFilter !== 'all' || searchQuery) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setActionFilter('');
              setEntityTypeFilter('');
              setActorFilter('');
              setDateRangeFilter('all');
              setSearchQuery('');
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Interactive Audit Log Stream Table */}
      <div className="bg-surface border border-hairline rounded-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-surface-sunken border-b border-subtle text-secondary font-mono text-2xs uppercase tracking-wider select-none">
                <th className="py-2.5 px-4 font-medium">Timestamp</th>
                <th className="py-2.5 px-3 font-medium">Action</th>
                <th className="py-2.5 px-3 font-medium">Actor</th>
                <th className="py-2.5 px-3 font-medium">Entity Type</th>
                <th className="py-2.5 px-3 font-medium">Entity ID</th>
                <th className="py-2.5 px-3 font-medium">Mutation Summary</th>
                <th className="py-2.5 px-4 font-medium text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-muted text-xs">
                    Loading immutable audit trail...
                  </td>
                </tr>
              ) : logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-2.5">
                      <div className="p-2.5 bg-surface-sunken rounded-full border border-subtle text-muted">
                        <FileSpreadsheet className="w-6 h-6 text-accent stroke-[1.5]" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-primary">No Audit Trail Records Yet</h3>
                        <p className="text-xs text-secondary">
                          Audit events are automatically recorded in an immutable append-only ledger when configuration items, dependencies, or owner groups are modified.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={fetchAuditLogs}
                        className="text-xs mt-1 cursor-pointer gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-accent" />
                        <span>Refresh Records</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-2.5">
                      <div className="p-2.5 bg-surface-sunken rounded-full border border-subtle text-muted">
                        <Search className="w-6 h-6 text-muted stroke-[1.5]" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-primary">No audit log records match your filter criteria</h3>
                        <p className="text-xs text-secondary">
                          Try expanding the date range or clearing your active filters to view all audit records.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setActionFilter('');
                          setEntityTypeFilter('');
                          setActorFilter('');
                          setDateRangeFilter('all');
                          setSearchQuery('');
                        }}
                        className="text-xs mt-1 cursor-pointer"
                      >
                        Clear All Filters
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((entry) => {
                  const isExpanded = expandedLogId === entry.id;
                  const toggleExpand = () => setExpandedLogId((prev) => (prev === entry.id ? null : entry.id));
                  const diffKeys = Object.keys(entry.diff || {});
                  const diffPreview =
                    diffKeys.length > 0
                      ? diffKeys
                          .slice(0, 3)
                          .map((k) => `${k}: ${typeof entry.diff[k] === 'object' ? JSON.stringify(entry.diff[k]) : entry.diff[k]}`)
                          .join(', ')
                      : 'Initial creation';

                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className={`hover:bg-hover transition-colors cursor-pointer group ${
                          isExpanded ? 'bg-selected/40 border-l border-l-accent' : ''
                        }`}
                        onClick={toggleExpand}
                      >
                        <td className="py-2.5 px-4 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand();
                              }}
                              className="p-0.5 rounded text-muted hover:text-primary hover:bg-hover transition-colors shrink-0 cursor-pointer"
                              aria-label={isExpanded ? 'Collapse audit details' : 'Expand audit details'}
                            >
                              {isExpanded ? (
                                <ChevronDown className="w-3.5 h-3.5 text-accent stroke-[2]" />
                              ) : (
                                <ChevronRight className="w-3.5 h-3.5 text-muted hover:text-primary stroke-[2]" />
                              )}
                            </button>
                            <div>
                              <span className="text-primary font-mono text-2xs font-medium block">
                                {formatRelativeTime(entry.created_at)}
                              </span>
                              <span className="block text-3xs text-muted font-mono" title={entry.created_at}>
                                {formatDateTime(entry.created_at)}
                              </span>
                            </div>
                          </div>
                        </td>

                        <td className="py-2.5 px-3">{getActionBadge(entry.action)}</td>

                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-primary truncate max-w-40">{entry.actor_name}</div>
                          <div className="text-3xs text-muted font-mono truncate max-w-40">{entry.actor_email}</div>
                        </td>

                        <td className="py-2.5 px-3 font-mono text-2xs uppercase text-secondary">
                          {entry.entity_type}
                        </td>

                        <td className="py-2.5 px-3 font-mono text-2xs text-muted truncate max-w-36">
                          {entry.entity_id}
                        </td>

                        <td className="py-2.5 px-3 text-secondary font-mono text-2xs truncate max-w-64" title={diffPreview}>
                          {diffPreview}
                        </td>

                        <td className="py-2.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              title="Revert / Undo Mutation"
                              disabled={revertingId === entry.id}
                              onClick={(e) => {
                                e.stopPropagation();
                                setRevertTarget(entry);
                              }}
                              className="h-6 px-1.5 text-3xs gap-1 text-tier1 hover:text-tier1 hover:bg-tier1-bg border border-tier1-border/60 rounded-sm cursor-pointer"
                            >
                              <RotateCcw className={`w-3 h-3 ${revertingId === entry.id ? 'animate-spin' : ''}`} />
                              <span>Undo</span>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              title={isExpanded ? 'Collapse Diff' : 'Expand Diff Details'}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleExpand();
                              }}
                              className="h-6 w-6"
                            >
                              <Eye className={`w-3.5 h-3.5 stroke-[1.5] ${isExpanded ? 'text-accent' : 'text-muted hover:text-primary'}`} />
                            </Button>
                          </div>
                        </td>
                      </tr>

                      {/* In-Line Expanded Diff Panel */}
                      {isExpanded && (
                        <tr key={`${entry.id}-expanded`} className="bg-surface-sunken/40 border-b border-subtle animate-in fade-in-50">
                          <td colSpan={7} className="p-3 sm:p-4">
                            <div className="bg-surface border border-hairline rounded-md p-3.5 shadow-sm space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-subtle pb-2.5">
                                <div className="flex items-center gap-2 flex-wrap text-xs">
                                  {getActionBadge(entry.action)}
                                  <span className="font-semibold text-primary uppercase font-mono">
                                    {entry.entity_type}
                                  </span>
                                  <span className="text-3xs text-muted font-mono">•</span>
                                  <span className="text-2xs text-secondary font-mono">
                                    Target ID: <span className="text-primary font-semibold select-all">{entry.entity_id}</span>
                                  </span>
                                  <span className="text-3xs text-muted font-mono">•</span>
                                  <span className="text-2xs text-secondary font-mono">
                                    Actor: <span className="text-primary font-semibold">{entry.actor_name}</span> ({entry.actor_email})
                                  </span>
                                  <span className="text-3xs text-muted font-mono">•</span>
                                  <span className="text-2xs text-secondary font-mono">
                                    Timestamp: <span className="text-primary font-semibold">{formatDateTime(entry.created_at)}</span>
                                  </span>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setShowRawJsonMap((prev) => ({ ...prev, [entry.id]: !prev[entry.id] }));
                                    }}
                                    className="h-6 text-3xs px-2 gap-1 cursor-pointer"
                                  >
                                    <Code className="w-3 h-3 text-accent" />
                                    <span>{showRawJsonMap[entry.id] ? 'Formatted Diff' : 'Raw JSON'}</span>
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={revertingId === entry.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRevertTarget(entry);
                                    }}
                                    className="h-6 px-2 text-3xs gap-1 text-tier1 hover:bg-tier1-bg border border-tier1-border/60 rounded-sm cursor-pointer"
                                  >
                                    <RotateCcw className={`w-3 h-3 ${revertingId === entry.id ? 'animate-spin' : ''}`} />
                                    <span>Revert Mutation</span>
                                  </Button>
                                </div>
                              </div>

                              <div>
                                {showRawJsonMap[entry.id] ? (
                                  <pre className="p-3 bg-canvas text-primary font-mono text-2xs rounded-md border border-subtle overflow-x-auto max-h-56 leading-relaxed">
                                    {JSON.stringify(entry.diff, null, 2)}
                                  </pre>
                                ) : (
                                  renderDiffRows(entry.diff)
                                )}
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Log Diff Inspection Dialog */}
      <Dialog open={!!inspectingLog} onOpenChange={(open) => { if (!open) setInspectingLog(null); }}>
        <DialogContent variant="modal">
          {inspectingLog && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2.5">
                  {getActionBadge(inspectingLog.action)}
                  <DialogTitle className="text-base font-semibold text-primary">
                    Audit Log Entry: {inspectingLog.action.toUpperCase()} {inspectingLog.entity_type.toUpperCase()}
                  </DialogTitle>
                </div>
                <DialogDescription className="text-2xs font-mono text-muted">
                  Log ID: {inspectingLog.id} &bull; Recorded at {formatDateTime(inspectingLog.created_at)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-2 bg-surface-sunken p-2.5 rounded-md border border-subtle">
                  <div>
                    <span className="text-3xs font-mono uppercase text-muted block">Actor</span>
                    <span className="font-semibold text-primary">{inspectingLog.actor_name}</span>
                    <span className="text-3xs font-mono text-secondary block">{inspectingLog.actor_email}</span>
                  </div>
                  <div>
                    <span className="text-3xs font-mono uppercase text-muted block">Target Entity</span>
                    <span className="font-semibold text-primary uppercase font-mono">{inspectingLog.entity_type}</span>
                    <span className="text-3xs font-mono text-secondary truncate block">{inspectingLog.entity_id}</span>
                  </div>
                </div>

                <div>
                  <span className="text-3xs font-mono uppercase text-muted block mb-1">
                    Recorded State Diff Payload (JSON)
                  </span>
                  <pre className="p-3 bg-canvas text-primary font-mono text-2xs rounded-md border border-subtle overflow-x-auto max-h-64 leading-relaxed">
                    {JSON.stringify(inspectingLog.diff, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Custom Revert Confirmation Dialog */}
      <ConfirmActionDialog
        open={!!revertTarget}
        onOpenChange={(open) => {
          if (!open) setRevertTarget(null);
        }}
        title="Confirm Mutation Revert"
        description={
          revertTarget ? (
            <span>
              Are you sure you want to revert mutation recorded in audit log entry{' '}
              <span className="font-mono text-accent font-semibold">
                #{revertTarget.id.slice(0, 8)}
              </span>
              ? This will restore the target entity to its previous state.
            </span>
          ) : (
            ''
          )
        }
        confirmLabel="Revert Mutation"
        cancelLabel="Keep Current State"
        variant="warning"
        isLoading={!!revertingId}
        onConfirm={async () => {
          if (!revertTarget) return;
          setRevertingId(revertTarget.id);
          try {
            const res = await revertMutation.mutateAsync(revertTarget.id);
            toast.success(res.message || 'Mutation successfully reverted');
            await fetchAuditLogs();
            setRevertTarget(null);
          } catch (err: any) {
            toast.error(err?.message || 'Failed to revert mutation');
          } finally {
            setRevertingId(null);
          }
        }}
      />
    </div>
  );
}
