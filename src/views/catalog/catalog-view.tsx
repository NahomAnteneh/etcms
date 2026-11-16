import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import {
  Search,
  CheckCircle,
  Trash2,
  Eye,
  Server,
  Database,
  Layers,
  Cpu,
  Shield,
  Network,
  AlertTriangle,
  Flag,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Plus,
  Link as LinkIcon,
  AlertCircle,
  ChevronRight,
  Box,
  HardDrive,
  Radio,
  Workflow,
  Boxes,
  Cloud,
  CheckCheck,
  RefreshCw,
  Pencil,
  Upload,
  SlidersHorizontal,
  Download,
  ChevronLeft,
  X,
  MoreHorizontal,
  Copy,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '../../components/ui/dropdown-menu';
import {
  parseCSVText,
  validateCSVRows,
  SAMPLE_CSV_TEMPLATE,
  type ValidatedCSVRow,
} from '../../lib/csv-import';
import {
  useCICatalog,
  useVerifyCI,
  useRetireCI,
  useUpdateCI,
  useCreateCIFlag,
  useCreateCI,
  useCreateEdge,
  useCIClasses,
  DEFAULT_CI_CLASSES,
  useRelationshipTypes,
  DEFAULT_RELATIONSHIP_TYPES,
  type CIEnvelope,
} from '../../api/endpoints';
import { CriticalityChip } from '../../components/governance/criticality-chip';
import { LifecycleBadge } from '../../components/governance/lifecycle-badge';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../components/ui/dialog';
import { formatRelativeTime, cn } from '../../lib/utils';
import { ApiProblemError } from '../../api/client';
import { useAuth } from '../../store/auth-context';
import { useToast } from '../../components/ui/toast';

type SortField = 'name' | 'ci_class' | 'criticality_tier' | 'environment' | 'last_verified_at';

function getVerificationFreshness(lastVerifiedAt: string | null | undefined) {
  if (!lastVerifiedAt) {
    return {
      status: 'stale',
      label: 'Never verified',
      colorClass: 'text-tier0 font-medium',
      detail: 'Stale (>60 days)',
    };
  }
  const ageMs = Date.now() - new Date(lastVerifiedAt).getTime();
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  if (days <= 45) {
    return {
      status: 'ok',
      label: formatRelativeTime(lastVerifiedAt),
      colorClass: 'text-secondary',
      detail: 'Fresh (≤60 days)',
    };
  }
  if (days <= 60) {
    return {
      status: 'approaching',
      label: formatRelativeTime(lastVerifiedAt),
      colorClass: 'text-tier1 font-medium',
      detail: 'Approaching (>45 days)',
    };
  }
  return {
    status: 'stale',
    label: formatRelativeTime(lastVerifiedAt),
    colorClass: 'text-tier0 font-medium',
    detail: 'Stale (>60 days)',
  };
}

interface CatalogViewProps {
  onNavigateToGraph?: (ciId: string) => void;
  initialSelectedCIId?: string | null;
}

export function CatalogView({ onNavigateToGraph, initialSelectedCIId }: CatalogViewProps) {
  const { currentUser, activeRole, isAdmin, ownerGroups, activeOwnerGroup } = useAuth();
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClass, setSelectedClass] = useState<string>('');
  const [selectedEnv, setSelectedEnv] = useState<string>('');
  const [selectedTier, setSelectedTier] = useState<string>('');
  const [selectedState, setSelectedState] = useState<string>('');

  // Saved Views State
  const [savedView, setSavedView] = useState<'all' | 'critical' | 'production' | 'needs_update' | 'stale'>('all');

  // Column Chooser State
  const [visibleColumns, setVisibleColumns] = useState({
    tier: true,
    environment: true,
    status: true,
    owner: true,
    endpoint: true,
    verified: true,
  });
  const [isColumnChooserOpen, setIsColumnChooserOpen] = useState(false);

  // Pagination State
  const [pageSize, setPageSize] = useState<number>(25);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // CSV Import State
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [csvInputText, setCsvInputText] = useState('');
  const [parsedCsvRows, setParsedCsvRows] = useState<ValidatedCSVRow[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });

  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Side Drawer State (URL bound via ?ci=<id>)
  const [drawerCI, setDrawerCI] = useState<CIEnvelope | null>(null);

  const handleOpenDrawer = (ci: CIEnvelope) => {
    setDrawerCI(ci);
    if (ci.ci_id) {
      const url = new URL(window.location.href);
      url.searchParams.set('ci', ci.ci_id);
      window.history.pushState(null, '', url.pathname + (url.search ? url.search : ''));
    }
  };

  const handleCloseDrawer = () => {
    setDrawerCI(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('ci');
    window.history.pushState(null, '', url.pathname + (url.search ? url.search : ''));
  };

  const [retiringCI, setRetiringCI] = useState<CIEnvelope | null>(null);
  const [forceRetire, setForceRetire] = useState(false);
  const [retireProblem, setRetireProblem] = useState<ApiProblemError['problem'] | null>(null);
  const [flaggingCI, setFlaggingCI] = useState<CIEnvelope | null>(null);
  const [flagReason, setFlagReason] = useState('');

  // Multi-select bulk operations state
  const [selectedCIIds, setSelectedCIIds] = useState<Set<string>>(new Set());
  const [isBatchVerifying, setIsBatchVerifying] = useState(false);

  // Create CI modal state
  const [isCreateCIModalOpen, setIsCreateCIModalOpen] = useState(false);
  const [newCIName, setNewCIName] = useState('');
  const [newCIClass, setNewCIClass] = useState('application');
  const [newCIEnv, setNewCIEnv] = useState('prod');
  const [newCITier, setNewCITier] = useState('tier_1');
  const [newCIOwnerGroup, setNewCIOwnerGroup] = useState('');
  const [newCITechContact, setNewCITechContact] = useState('');
  const [newCIEndpoint, setNewCIEndpoint] = useState('');
  const [createCIError, setCreateCIError] = useState<string | null>(null);
  const [customFormValues, setCustomFormValues] = useState<Record<string, any>>({});

  // Edit CI modal state
  const [isEditCIModalOpen, setIsEditCIModalOpen] = useState(false);
  const [editingCI, setEditingCI] = useState<CIEnvelope | null>(null);
  const [editCIName, setEditCIName] = useState('');
  const [editCIClass, setEditCIClass] = useState('application');
  const [editCIEnv, setEditCIEnv] = useState<'prod' | 'dr' | 'staging'>('prod');
  const [editCITier, setEditCITier] = useState<'tier_0' | 'tier_1' | 'tier_2' | 'tier_3'>('tier_1');
  const [editCIState, setEditCIState] = useState<'in_service' | 'synced' | 'out_of_sync' | 'planned' | 'deprecated' | 'retired'>('in_service');
  const [editCIOwnerGroup, setEditCIOwnerGroup] = useState('');
  const [editCITechContact, setEditCITechContact] = useState('');
  const [editCIEndpoint, setEditCIEndpoint] = useState('');
  const [editCIError, setEditCIError] = useState<string | null>(null);
  const [editCustomFormValues, setEditCustomFormValues] = useState<Record<string, any>>({});

  // Attached dependencies for new CI
  interface AttachedDependency {
    target_ci_id: string;
    target_name: string;
    target_class: string;
    edge_type: string;
  }
  const [newCIDependencies, setNewCIDependencies] = useState<AttachedDependency[]>([]);
  const [selectedDepCIId, setSelectedDepCIId] = useState('');
  const [selectedDepType, setSelectedDepType] = useState<string>('depends_on');

  // Add Dependency modal state
  const [isAddEdgeModalOpen, setIsAddEdgeModalOpen] = useState(false);
  const [edgeSourceId, setEdgeSourceId] = useState('');
  const [edgeTargetId, setEdgeTargetId] = useState('');
  const [edgeType, setEdgeType] = useState<string>('depends_on');
  const [edgeError, setEdgeError] = useState<string | null>(null);

  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);

  const { data: ciClasses = DEFAULT_CI_CLASSES } = useCIClasses();
  const { data: relationshipTypes = DEFAULT_RELATIONSHIP_TYPES } = useRelationshipTypes();

  const activeCIClassDef = useMemo(() => {
    return ciClasses.find((c) => c.id === newCIClass);
  }, [ciClasses, newCIClass]);

  const activeEditClassDef = useMemo(() => {
    return ciClasses.find((c) => c.id === editCIClass);
  }, [ciClasses, editCIClass]);

  // When class changes, initialize default values for defined form fields
  useEffect(() => {
    if (activeCIClassDef?.form_fields && activeCIClassDef.form_fields.length > 0) {
      const initValues: Record<string, any> = {};
      activeCIClassDef.form_fields.forEach((f) => {
        if (f.default_value !== undefined) {
          initValues[f.name] = f.default_value;
        } else if (f.type === 'select' && f.options && f.options.length > 0) {
          initValues[f.name] = f.options[0];
        } else {
          initValues[f.name] = '';
        }
      });
      setCustomFormValues(initValues);
    } else {
      setCustomFormValues({});
    }
  }, [activeCIClassDef]);

  // Pre-fill owner group and contact with creator's details if not specified
  useEffect(() => {
    if (isCreateCIModalOpen) {
      if (!newCIOwnerGroup) {
        const creatorGroup = currentUser?.primary_owner_group_id || activeOwnerGroup?.id || ownerGroups[0]?.id || '';
        setNewCIOwnerGroup(creatorGroup);
      }
      if (!newCITechContact && currentUser?.email) {
        setNewCITechContact(currentUser.email);
      }
    }
  }, [isCreateCIModalOpen, currentUser, activeOwnerGroup, ownerGroups, newCIOwnerGroup, newCITechContact]);

  const { data: catalogData, isLoading, refetch } = useCICatalog({
    ci_class: selectedClass || undefined,
    environment: selectedEnv || undefined,
    criticality_tier: selectedTier || undefined,
    lifecycle_state: selectedState || undefined,
    owner_group_id: activeOwnerGroup?.id || undefined,
  });

  useEffect(() => {
    if (catalogData?.items) {
      const targetId = initialSelectedCIId || (typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('ci') : null);
      if (targetId) {
        const found = catalogData.items.find((item) => item.ci_id === targetId);
        if (found) {
          setDrawerCI(found);
        }
      }
    }
  }, [initialSelectedCIId, catalogData?.items]);

  useEffect(() => {
    const handlePop = () => {
      const params = new URLSearchParams(window.location.search);
      const ciId = params.get('ci');
      if (ciId && catalogData?.items) {
        const found = catalogData.items.find((i) => i.ci_id === ciId);
        setDrawerCI(found || null);
      } else {
        setDrawerCI(null);
      }
    };
    window.addEventListener('popstate', handlePop);
    return () => window.removeEventListener('popstate', handlePop);
  }, [catalogData?.items]);

  const verifyMutation = useVerifyCI();
  const retireMutation = useRetireCI();
  const updateCIMutation = useUpdateCI();
  const flagMutation = useCreateCIFlag();
  const createCIMutation = useCreateCI();
  const createEdgeMutation = useCreateEdge();

  const formatClassName = (ciClass: string) => {
    const matched = ciClasses.find((c) => c.id === ciClass);
    if (matched) return matched.label;
    switch (ciClass) {
      case 'business_service': return 'Service';
      case 'application': return 'Application';
      case 'database': return 'Database';
      case 'vm_cluster':
      case 'physical_host': return 'Infrastructure';
      case 'network_firewall': return 'Network';
      default: return ciClass;
    }
  };

  const handleAddDependencyToNewCI = () => {
    if (!selectedDepCIId) return;
    const target = catalogData?.items.find((item) => (item.ci_id || item.name) === selectedDepCIId);
    if (!target || !target.ci_id) return;
    if (newCIDependencies.some((d) => d.target_ci_id === target.ci_id)) return;
    setNewCIDependencies((prev) => [
      ...prev,
      {
        target_ci_id: target.ci_id!,
        target_name: target.name,
        target_class: target.ci_class,
        edge_type: selectedDepType,
      },
    ]);
    setSelectedDepCIId('');
  };

  const handleRemoveDependencyFromNewCI = (targetId: string) => {
    setNewCIDependencies((prev) => prev.filter((d) => d.target_ci_id !== targetId));
  };

  const handleCreateCI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCIName.trim()) {
      setCreateCIError('Name is required.');
      return;
    }
    // Default owner group to creator's owner group if not specified
    const creatorGroup = currentUser?.primary_owner_group_id || activeOwnerGroup?.id || ownerGroups[0]?.id;
    const groupId = (isAdmin && newCIOwnerGroup ? newCIOwnerGroup : undefined) ||
      newCIOwnerGroup ||
      creatorGroup;
    if (!groupId) {
      setCreateCIError('An owner group must be selected.');
      return;
    }

    // Default contact to creator's email if not specified
    const contact = newCITechContact.trim() || currentUser?.email || 'admin@enterprise.com';

    // Validate required dynamic form fields
    if (activeCIClassDef?.form_fields) {
      for (const field of activeCIClassDef.form_fields) {
        if (field.required && (!customFormValues[field.name] || !customFormValues[field.name]?.toString().trim())) {
          setCreateCIError(`Field "${field.label}" is required.`);
          return;
        }
      }
    }

    try {
      const createdCI = await createCIMutation.mutateAsync({
        name: newCIName.trim(),
        ci_class: newCIClass as any,
        environment: newCIEnv as any,
        criticality_tier: newCITier as any,
        owner_group_id: groupId,
        technical_contact: contact,
        primary_endpoint: newCIEndpoint.trim() || undefined,
        class_metadata: Object.keys(customFormValues).length > 0 ? customFormValues : undefined,
      });

      // Prepare all dependencies, including any selected in the dropdown that user didn't explicitly click "+ Add" for
      const allDeps = [...newCIDependencies];
      if (selectedDepCIId && !allDeps.some((d) => d.target_ci_id === selectedDepCIId)) {
        const target = catalogData?.items.find((item) => (item.ci_id || item.name) === selectedDepCIId);
        if (target && target.ci_id) {
          allDeps.push({
            target_ci_id: target.ci_id,
            target_name: target.name,
            target_class: target.ci_class,
            edge_type: selectedDepType,
          });
        }
      }

      // Link any attached dependencies
      if (createdCI?.ci_id && allDeps.length > 0) {
        for (const dep of allDeps) {
          try {
            await createEdgeMutation.mutateAsync({
              source_ci_id: createdCI.ci_id,
              target_ci_id: dep.target_ci_id,
              edge_type: dep.edge_type,
            });
          } catch (edgeErr) {
            console.error('Failed to attach dependency edge:', edgeErr);
          }
        }
      }

      setIsCreateCIModalOpen(false);
      setNewCIName('');
      setNewCITechContact('');
      setNewCIEndpoint('');
      setNewCIDependencies([]);
      setSelectedDepCIId('');
      setCreateCIError(null);
      toast.success(`Configuration item "${newCIName.trim()}" registered successfully`);
      refetch();
    } catch (err: any) {
      setCreateCIError(err?.message || 'Failed to create configuration item');
    }
  };

  const handleAddEdge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!edgeSourceId || !edgeTargetId) {
      setEdgeError('Both consumer and provider CIs must be selected.');
      return;
    }
    if (edgeSourceId === edgeTargetId) {
      setEdgeError('A configuration item cannot depend on itself.');
      return;
    }

    try {
      await createEdgeMutation.mutateAsync({
        source_ci_id: edgeSourceId,
        target_ci_id: edgeTargetId,
        edge_type: edgeType,
      });
      setIsAddEdgeModalOpen(false);
      setEdgeSourceId('');
      setEdgeTargetId('');
      setEdgeError(null);
      toast.success('Dependency connection established');
      refetch();
    } catch (err: any) {
      setEdgeError(err?.message || 'Failed to create dependency connection');
    }
  };

  const handleOpenEditCI = (ci: CIEnvelope) => {
    setEditingCI(ci);
    setEditCIName(ci.name);
    setEditCIClass(ci.ci_class);
    setEditCIEnv((ci.environment as any) || 'prod');
    setEditCITier((ci.criticality_tier as any) || 'tier_1');
    setEditCIState((ci.lifecycle_state as any) || 'in_service');
    setEditCIOwnerGroup(ci.owner_group_id || '');
    setEditCITechContact(ci.technical_contact || '');
    setEditCIEndpoint(ci.primary_endpoint || '');
    setEditCustomFormValues(ci.class_metadata ? { ...ci.class_metadata } : {});
    setEditCIError(null);
    setIsEditCIModalOpen(true);
  };

  const handleSaveEditCI = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCI || !editingCI.ci_id) return;
    if (!editCIName.trim() || !editCITechContact.trim()) {
      setEditCIError('Name and technical contact are required.');
      return;
    }
    const groupId = (isAdmin ? editCIOwnerGroup : editingCI.owner_group_id) || editingCI.owner_group_id || ownerGroups[0]?.id;
    if (!groupId) {
      setEditCIError('An owner group must be selected.');
      return;
    }

    if (activeEditClassDef?.form_fields) {
      for (const field of activeEditClassDef.form_fields) {
        if (field.required && (!editCustomFormValues[field.name] || !editCustomFormValues[field.name]?.toString().trim())) {
          setEditCIError(`Field "${field.label}" is required.`);
          return;
        }
      }
    }

    const cleanMetadata: Record<string, string> = {};
    for (const [k, v] of Object.entries(editCustomFormValues)) {
      if (v !== undefined && v !== null && v !== '') {
        cleanMetadata[k] = String(v);
      }
    }

    try {
      await updateCIMutation.mutateAsync({
        id: editingCI.ci_id,
        data: {
          name: editCIName.trim(),
          ci_class: editCIClass,
          environment: editCIEnv,
          criticality_tier: editCITier,
          lifecycle_state: editCIState,
          owner_group_id: groupId,
          technical_contact: editCITechContact.trim(),
          primary_endpoint: editCIEndpoint.trim() || undefined,
          class_metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : undefined,
        },
      });
      setIsEditCIModalOpen(false);
      setEditingCI(null);
      setEditCIError(null);
      toast.success(`CI "${editCIName.trim()}" updated successfully`);
      refetch();
    } catch (err: any) {
      setEditCIError(err?.message || 'Failed to update configuration item');
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const validateRawCsv = (text: string) => {
    if (!text.trim()) {
      setParsedCsvRows([]);
      return;
    }
    try {
      const parsed = parseCSVText(text);
      const defaultGroup = activeOwnerGroup?.id || ownerGroups[0]?.id || '';
      const defaultEmail = currentUser?.email || 'admin@enterprise.com';
      const validated = validateCSVRows(parsed, ciClasses, ownerGroups, defaultGroup, defaultEmail);
      setParsedCsvRows(validated);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to parse CSV format');
      setParsedCsvRows([]);
    }
  };

  const handleDownloadTemplate = () => {
    const blob = new Blob([SAMPLE_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'etcms-ci-import-template.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast.info('Sample CSV template downloaded');
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = String(event.target?.result || '');
      setCsvInputText(content);
      validateRawCsv(content);
    };
    reader.readAsText(file);
  };

  const validRowCount = parsedCsvRows.filter((r) => r.isValid).length;
  const invalidRowCount = parsedCsvRows.length - validRowCount;

  const handleExecuteImport = async () => {
    const validRows = parsedCsvRows.filter((r) => r.isValid);
    if (validRows.length === 0) return;

    setIsImporting(true);
    setImportProgress({ current: 0, total: validRows.length });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      try {
        await createCIMutation.mutateAsync({
          name: row.name,
          ci_class: row.ci_class as any,
          environment: row.environment,
          criticality_tier: row.criticality_tier,
          owner_group_id: row.owner_group_id,
          technical_contact: row.technical_contact,
          primary_endpoint: row.primary_endpoint,
        });
        successCount++;
      } catch {
        failCount++;
      }
      setImportProgress({ current: i + 1, total: validRows.length });
    }

    setIsImporting(false);
    setIsImportModalOpen(false);
    setCsvInputText('');
    setParsedCsvRows([]);
    refetch();

    if (successCount > 0) {
      toast.success(`Successfully imported ${successCount} configuration item(s)`);
    }
    if (failCount > 0) {
      toast.error(`${failCount} items failed to import`);
    }
  };

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const filteredItems = useMemo(() => {
    let items = catalogData?.items || [];

    // Apply Saved View presets
    if (savedView === 'critical') {
      items = items.filter((ci) => ci.criticality_tier === 'tier_0' || ci.criticality_tier === 'tier_1');
    } else if (savedView === 'production') {
      items = items.filter((ci) => ci.environment === 'prod');
    } else if (savedView === 'needs_update') {
      items = items.filter((ci) => ci.lifecycle_state === 'out_of_sync');
    } else if (savedView === 'stale') {
      const staleThreshold = 60 * 24 * 60 * 60 * 1000;
      items = items.filter((ci) => !ci.last_verified_at || (new Date().getTime() - new Date(ci.last_verified_at).getTime() > staleThreshold));
    }

    if (deferredSearchQuery.trim()) {
      const q = deferredSearchQuery.toLowerCase();
      items = items.filter(
        (ci) =>
          ci.name.toLowerCase().includes(q) ||
          (ci.technical_contact && ci.technical_contact.toLowerCase().includes(q)) ||
          (ci.primary_endpoint && ci.primary_endpoint.toLowerCase().includes(q)) ||
          (ci.ownership?.owner_group_name && ci.ownership.owner_group_name.toLowerCase().includes(q))
      );
    }
    return [...items].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      if (sortField === 'name') {
        valA = a.name.toLowerCase();
        valB = b.name.toLowerCase();
      } else if (sortField === 'ci_class') {
        valA = a.ci_class;
        valB = b.ci_class;
      } else if (sortField === 'criticality_tier') {
        const tierRank = { tier_0: 0, tier_1: 1, tier_2: 2, tier_3: 3 };
        valA = tierRank[a.criticality_tier as keyof typeof tierRank] ?? 99;
        valB = tierRank[b.criticality_tier as keyof typeof tierRank] ?? 99;
      } else if (sortField === 'environment') {
        valA = a.environment;
        valB = b.environment;
      } else if (sortField === 'last_verified_at') {
        valA = a.last_verified_at ? new Date(a.last_verified_at).getTime() : 0;
        valB = b.last_verified_at ? new Date(b.last_verified_at).getTime() : 0;
      }
      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [catalogData?.items, deferredSearchQuery, sortField, sortDirection, savedView]);

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredSearchQuery, selectedClass, selectedEnv, selectedTier, selectedState, savedView]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const currentPageClamped = Math.min(currentPage, totalPages);
  const paginatedItems = useMemo(() => {
    const start = (currentPageClamped - 1) * pageSize;
    return filteredItems.slice(start, start + pageSize);
  }, [filteredItems, currentPageClamped, pageSize]);

  const totalVisibleColSpan = useMemo(() => {
    let count = 3; // Checkbox, Name, Actions
    if (visibleColumns.tier) count++;
    if (visibleColumns.environment) count++;
    if (visibleColumns.status) count++;
    if (visibleColumns.owner) count++;
    if (visibleColumns.endpoint) count++;
    if (visibleColumns.verified) count++;
    return count;
  }, [visibleColumns]);

  const handleVerify = async (ci: CIEnvelope) => {
    if (!ci.ci_id) return;
    setActiveProblem(null);
    try {
      await verifyMutation.mutateAsync(ci.ci_id);
      toast.success(`CI "${ci.name}" verified successfully`);
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        toast.error(err.problem.detail || 'Verification failed');
      }
    }
  };

  const handleRetire = async () => {
    if (!retiringCI || !retiringCI.ci_id) return;
    setRetireProblem(null);
    try {
      await retireMutation.mutateAsync({ id: retiringCI.ci_id, force: forceRetire });
      toast.info(`CI "${retiringCI.name}" has been retired`);
      if (drawerCI?.ci_id === retiringCI.ci_id) handleCloseDrawer();
      setRetiringCI(null);
      setForceRetire(false);
      setRetireProblem(null);
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) {
        setRetireProblem(err.problem);
      }
    }
  };

  const handleFlagSubmit = async () => {
    if (!flaggingCI || !flaggingCI.ci_id || !flagReason.trim()) return;
    try {
      await flagMutation.mutateAsync({ ciId: flaggingCI.ci_id, reason: flagReason });
      toast.warning(`Dispute flag logged for "${flaggingCI.name}"`);
      setFlaggingCI(null);
      setFlagReason('');
      refetch();
    } catch (err) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        toast.error(err.problem.detail || 'Failed to submit flag');
      }
    }
  };

  const toggleSelectAll = () => {
    if (selectedCIIds.size === filteredItems.length && filteredItems.length > 0) {
      setSelectedCIIds(new Set());
    } else {
      const allIds = new Set<string>();
      filteredItems.forEach((ci) => {
        if (ci.ci_id) allIds.add(ci.ci_id);
      });
      setSelectedCIIds(allIds);
    }
  };

  const toggleSelectCI = (ciId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedCIIds((prev) => {
      const next = new Set(prev);
      if (next.has(ciId)) {
        next.delete(ciId);
      } else {
        next.add(ciId);
      }
      return next;
    });
  };

  const handleBatchVerify = async () => {
    if (selectedCIIds.size === 0) return;
    setIsBatchVerifying(true);
    const ids = Array.from(selectedCIIds);
    const results = await Promise.allSettled(
      ids.map(async (ciId) => {
        await verifyMutation.mutateAsync(ciId);
        return ciId;
      })
    );

    const succeededIds = new Set<string>();
    let failureCount = 0;

    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        succeededIds.add(ids[idx]);
      } else {
        failureCount++;
      }
    });

    setIsBatchVerifying(false);
    setSelectedCIIds((prev) => {
      const next = new Set<string>();
      prev.forEach((id) => {
        if (!succeededIds.has(id)) {
          next.add(id);
        }
      });
      return next;
    });

    if (succeededIds.size > 0) {
      toast.success(`Batch verified ${succeededIds.size} configuration item(s)`);
    }
    if (failureCount > 0) {
      toast.error(`${failureCount} item(s) failed verification and remain selected`);
    }
    refetch();
  };

  const handleBatchExport = () => {
    if (selectedCIIds.size === 0) return;
    const selectedItems = filteredItems.filter((ci) => ci.ci_id && selectedCIIds.has(ci.ci_id));
    const csvHeader = 'ci_id,name,ci_class,environment,criticality_tier,technical_contact,lifecycle_state\n';
    const csvRows = selectedItems
      .map(
        (ci) =>
          `"${ci.ci_id}","${ci.name}","${ci.ci_class}","${ci.environment}","${ci.criticality_tier}","${ci.technical_contact}","${ci.lifecycle_state}"`
      )
      .join('\n');
    const blob = new Blob([csvHeader + csvRows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `etcms-cis-export-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.info(`Exported ${selectedItems.length} records to CSV`);
  };

  const getClassIcon = (ciClass: string) => {
    const matched = ciClasses.find((c) => c.id === ciClass);
    if (matched?.icon) {
      switch (matched.icon) {
        case 'Database': return Database;
        case 'Cpu': return Cpu;
        case 'Server': return Server;
        case 'HardDrive': return HardDrive;
        case 'Network': return Network;
        case 'Radio': return Radio;
        case 'Workflow': return Workflow;
        case 'Boxes': return Boxes;
        case 'Cloud': return Cloud;
        case 'Shield': return Shield;
        default: return Layers;
      }
    }
    switch (ciClass) {
      case 'database':
        return Database;
      case 'application':
        return Layers;
      case 'vm_cluster':
        return Cpu;
      case 'physical_host':
        return Server;
      case 'network_firewall':
        return Network;
      default:
        return Box;
    }
  };

  return (
    <div className="space-y-6 w-full animate-in fade-in-50 duration-150">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-primary">Catalog</h1>
          <p className="text-xs text-secondary mt-0.5">
            Enterprise Configuration Management Database (CMDB) configuration items and lifecycle governance.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEdgeSourceId(catalogData?.items?.[0]?.ci_id || '');
              setEdgeTargetId(catalogData?.items?.[1]?.ci_id || '');
              setEdgeError(null);
              setIsAddEdgeModalOpen(true);
            }}
            className="gap-1.5 text-xs cursor-pointer"
          >
            <LinkIcon className="w-3.5 h-3.5 text-accent" />
            <span>Add Dependency</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setCsvInputText('');
              setParsedCsvRows([]);
              setIsImportModalOpen(true);
            }}
            className="gap-1.5 text-xs cursor-pointer"
            title="Import configuration items in bulk from a CSV file"
          >
            <Upload className="w-3.5 h-3.5 text-accent" />
            <span>Import CSV</span>
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setNewCIName('');
              setNewCITechContact('');
              setNewCIEndpoint('');
              setNewCIOwnerGroup(activeOwnerGroup?.id || ownerGroups[0]?.id || '');
              setCreateCIError(null);
              setIsCreateCIModalOpen(true);
            }}
            className="gap-1.5 bg-accent hover:bg-accent-hover text-white text-xs cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create CI</span>
          </Button>
        </div>
      </div>

      {/* RFC 9457 Problem Details Alert Banner */}
      {activeProblem && (
        <RFC9457Alert
          problem={activeProblem}
          onDismiss={() => setActiveProblem(null)}
          onNavigateToCI={(ciId) => {
            const found = catalogData?.items?.find((c) => c.ci_id === ciId);
            if (found) handleOpenDrawer(found);
          }}
        />
      )}

      {/* Saved Views Pill Selector */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
        <span className="text-2xs uppercase font-mono text-muted font-semibold mr-1 shrink-0">Views:</span>
        <button
          type="button"
          onClick={() => {
            setSavedView('all');
            setSelectedClass('');
            setSelectedEnv('');
            setSelectedTier('');
            setSelectedState('');
          }}
          className={cn(
            "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer shrink-0",
            savedView === 'all'
              ? "bg-header-bg text-white shadow-sm"
              : "bg-surface text-secondary hover:text-primary hover:bg-hover border border-control"
          )}
        >
          All Active
        </button>
        <button
          type="button"
          onClick={() => {
            setSavedView('critical');
            setSelectedClass('');
            setSelectedEnv('');
            setSelectedTier('');
            setSelectedState('');
          }}
          className={cn(
            "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer shrink-0",
            savedView === 'critical'
              ? "bg-tier0 text-white shadow-sm"
              : "bg-surface text-secondary hover:text-primary hover:bg-hover border border-control"
          )}
        >
          Critical (Tier 0/1)
        </button>
        <button
          type="button"
          onClick={() => {
            setSavedView('production');
            setSelectedClass('');
            setSelectedEnv('prod');
            setSelectedTier('');
            setSelectedState('');
          }}
          className={cn(
            "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer shrink-0",
            savedView === 'production'
              ? "bg-accent text-white shadow-sm"
              : "bg-surface text-secondary hover:text-primary hover:bg-hover border border-control"
          )}
        >
          Production
        </button>
        <button
          type="button"
          onClick={() => {
            setSavedView('needs_update');
            setSelectedClass('');
            setSelectedEnv('');
            setSelectedTier('');
            setSelectedState('out_of_sync');
          }}
          className={cn(
            "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer shrink-0",
            savedView === 'needs_update'
              ? "bg-outofsync text-white shadow-sm"
              : "bg-surface text-secondary hover:text-primary hover:bg-hover border border-control"
          )}
        >
          Needs Update
        </button>
        <button
          type="button"
          onClick={() => {
            setSavedView('stale');
            setSelectedClass('');
            setSelectedEnv('');
            setSelectedTier('');
            setSelectedState('');
          }}
          className={cn(
            "px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer shrink-0",
            savedView === 'stale'
              ? "bg-deprecated text-white shadow-sm"
              : "bg-surface text-secondary hover:text-primary hover:bg-hover border border-control"
          )}
        >
          Needs Verification (&gt;60d)
        </button>
      </div>

      {/* Filter, Search, and Column Chooser Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative flex-1 min-w-64">
          <Search className="w-4 h-4 text-muted absolute left-2.5 top-2 stroke-[1.5]" />
          <Input
            aria-label="Search configuration items"
            placeholder="Search CIs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Class Filter */}
        <select
          aria-label="Filter by CI class"
          value={selectedClass}
          onChange={(e) => {
            setSelectedClass(e.target.value);
            setSavedView('all');
          }}
          className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All Classes</option>
          {ciClasses.map((cls) => (
            <option key={cls.id} value={cls.id}>
              {cls.label}
            </option>
          ))}
        </select>

        {/* Environment Filter */}
        <select
          aria-label="Filter by environment"
          value={selectedEnv}
          onChange={(e) => {
            setSelectedEnv(e.target.value);
            setSavedView('all');
          }}
          className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All Environments</option>
          <option value="prod">Production</option>
          <option value="dr">Disaster Recovery</option>
          <option value="staging">Staging</option>
        </select>

        {/* Tier Filter */}
        <select
          aria-label="Filter by criticality tier"
          value={selectedTier}
          onChange={(e) => {
            setSelectedTier(e.target.value);
            setSavedView('all');
          }}
          className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All Criticalities</option>
          <option value="tier_0">Critical (Tier 0)</option>
          <option value="tier_1">High (Tier 1)</option>
          <option value="tier_2">Medium (Tier 2)</option>
          <option value="tier_3">Low (Tier 3)</option>
        </select>

        {/* Status Filter */}
        <select
          aria-label="Filter by status"
          value={selectedState}
          onChange={(e) => {
            setSelectedState(e.target.value);
            setSavedView('all');
          }}
          className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary focus:outline-none focus:ring-2 focus:ring-accent"
        >
          <option value="">All Statuses</option>
          <option value="out_of_sync">Out of Sync (Needs Update)</option>
          <option value="synced">Synced</option>
          <option value="in_service">In Service</option>
          <option value="planned">Planned</option>
          <option value="deprecated">Deprecated</option>
          <option value="retired">Show Retired CIs</option>
        </select>

        {/* Column Chooser Dropdown */}
        <div className="relative">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsColumnChooserOpen((prev) => !prev)}
            className="h-8 text-xs gap-1.5 cursor-pointer"
            title="Toggle visible columns in catalog table"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-muted" />
            <span>Columns</span>
          </Button>
          {isColumnChooserOpen && (
            <div className="absolute right-0 mt-1.5 w-48 bg-surface border border-hairline rounded-md shadow-lg p-2.5 z-40 space-y-1.5 text-xs animate-in fade-in-50">
              <div className="flex items-center justify-between pb-1.5 border-b border-subtle">
                <span className="text-3xs uppercase font-mono font-semibold text-muted">Visible Columns</span>
                <button
                  type="button"
                  onClick={() => setIsColumnChooserOpen(false)}
                  className="text-muted hover:text-primary cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
              {[
                { key: 'tier', label: 'Criticality Tier' },
                { key: 'environment', label: 'Environment' },
                { key: 'status', label: 'Lifecycle Status' },
                { key: 'owner', label: 'Owner & Contact' },
                { key: 'endpoint', label: 'Primary Endpoint' },
                { key: 'verified', label: 'Last Verified' },
              ].map((col) => (
                <label key={col.key} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-hover cursor-pointer text-secondary select-none">
                  <input
                    type="checkbox"
                    checked={visibleColumns[col.key as keyof typeof visibleColumns]}
                    onChange={(e) =>
                      setVisibleColumns((prev) => ({ ...prev, [col.key]: e.target.checked }))
                    }
                    className="rounded border-control text-accent focus:ring-accent"
                  />
                  <span>{col.label}</span>
                </label>
              ))}
            </div>
          )}
        </div>

        {(selectedClass || selectedEnv || selectedTier || selectedState || searchQuery || savedView !== 'all') && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSelectedClass('');
              setSelectedEnv('');
              setSelectedTier('');
              setSelectedState('');
              setSearchQuery('');
              setSavedView('all');
            }}
          >
            Clear Filters
          </Button>
        )}
      </div>

      {/* Bulk Actions Floating / Sticky Bar */}
      {selectedCIIds.size > 0 && (
        <div className="bg-header-bg text-white px-4 py-2.5 rounded-md flex items-center justify-between shadow-snow-dropdown animate-in fade-in-50 duration-150">
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-2xs font-semibold px-2 py-0.5 rounded bg-accent/20 text-accent border border-accent/30">
              {selectedCIIds.size} selected
            </span>
            <span className="text-xs text-slate-300">Catalog batch operations</span>
          </div>
          <div className="flex items-center gap-2">
            {selectedCIIds.size === 1 && onNavigateToGraph && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const singleId = Array.from(selectedCIIds)[0];
                  onNavigateToGraph(singleId);
                }}
                className="gap-1.5 h-7 text-2xs text-white border-slate-600 hover:bg-header-surface cursor-pointer"
                title="Inspect Blast Radius"
              >
                <Network className="w-3.5 h-3.5 text-accent" />
                <span>Inspect Blast Radius</span>
              </Button>
            )}
            {selectedCIIds.size === 1 && activeRole !== 'viewer' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const singleId = Array.from(selectedCIIds)[0];
                  const target = filteredItems.find((c) => c.ci_id === singleId);
                  if (target) handleOpenEditCI(target);
                }}
                className="gap-1.5 h-7 text-2xs text-white border-slate-600 hover:bg-header-surface cursor-pointer"
                title="Edit CI"
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit CI</span>
              </Button>
            )}
            {activeRole !== 'viewer' && (
              <Button
                size="sm"
                variant="primary"
                onClick={handleBatchVerify}
                isLoading={isBatchVerifying}
                className="gap-1.5 h-7 text-2xs cursor-pointer"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Batch Verify</span>
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={handleBatchExport}
              className="gap-1.5 h-7 text-2xs text-white border-slate-600 hover:bg-header-surface cursor-pointer"
            >
              <span>Export CSV</span>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedCIIds(new Set())}
              className="h-7 text-2xs text-slate-300 hover:text-white hover:bg-header-surface cursor-pointer"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* High-Density Data Table */}
      <div className="bg-surface border border-hairline rounded-md overflow-hidden flex flex-col">
        <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-270px)] min-h-[420px]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 bg-surface-sunken z-10 border-b border-subtle shadow-xs">
              <tr className="text-secondary font-mono text-2xs uppercase tracking-wider select-none h-9">
                <th className="py-1.5 px-3 w-8 text-center bg-surface-sunken">
                  <input
                    type="checkbox"
                    aria-label="Select all visible CIs"
                    checked={filteredItems.length > 0 && selectedCIIds.size === filteredItems.length}
                    onChange={toggleSelectAll}
                    className="rounded border-control text-accent focus:ring-accent cursor-pointer"
                  />
                </th>
                <th className="py-1.5 px-3 font-medium bg-surface-sunken">
                  <button
                    type="button"
                    onClick={() => toggleSort('name')}
                    className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
                  >
                    <span>CI Name & Class</span>
                    {sortField === 'name' ? (
                      sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-accent" /> : <ArrowDown className="w-3 h-3 text-accent" />
                    ) : (
                      <ArrowUpDown className="w-3 h-3 text-muted" />
                    )}
                  </button>
                </th>
                {visibleColumns.tier && (
                  <th className="py-1.5 px-3 font-medium bg-surface-sunken">
                    <button
                      type="button"
                      onClick={() => toggleSort('criticality_tier')}
                      className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
                    >
                      <span>Tier</span>
                      {sortField === 'criticality_tier' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-accent" /> : <ArrowDown className="w-3 h-3 text-accent" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-muted" />
                      )}
                    </button>
                  </th>
                )}
                {visibleColumns.environment && (
                  <th className="py-1.5 px-3 font-medium bg-surface-sunken">
                    <button
                      type="button"
                      onClick={() => toggleSort('environment')}
                      className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
                    >
                      <span>Environment</span>
                      {sortField === 'environment' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-accent" /> : <ArrowDown className="w-3 h-3 text-accent" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-muted" />
                      )}
                    </button>
                  </th>
                )}
                {visibleColumns.status && <th className="py-1.5 px-3 font-medium bg-surface-sunken">Status</th>}
                {visibleColumns.owner && <th className="py-1.5 px-3 font-medium bg-surface-sunken">Owner</th>}
                {visibleColumns.endpoint && <th className="py-1.5 px-3 font-medium bg-surface-sunken">Endpoint</th>}
                {visibleColumns.verified && (
                  <th className="py-1.5 px-3 font-medium bg-surface-sunken">
                    <button
                      type="button"
                      onClick={() => toggleSort('last_verified_at')}
                      className="flex items-center gap-1.5 hover:text-primary transition-colors cursor-pointer"
                    >
                      <span>Verified</span>
                      {sortField === 'last_verified_at' ? (
                        sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-accent" /> : <ArrowDown className="w-3 h-3 text-accent" />
                      ) : (
                        <ArrowUpDown className="w-3 h-3 text-muted" />
                      )}
                    </button>
                  </th>
                )}
                <th className="py-1.5 px-3 font-medium text-right bg-surface-sunken">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-subtle">
              {isLoading ? (
                <tr>
                  <td colSpan={totalVisibleColSpan} className="py-8 text-center text-muted text-xs">
                    Loading configuration catalog...
                  </td>
                </tr>
              ) : !catalogData?.items || catalogData.items.length === 0 ? (
                <tr>
                  <td colSpan={totalVisibleColSpan} className="py-14 text-center">
                    <div className="flex flex-col items-center justify-center max-w-md mx-auto space-y-3">
                      <div className="p-3 bg-surface-sunken rounded-full border border-subtle text-muted">
                        <Boxes className="w-8 h-8 text-accent stroke-[1.5]" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-primary">No CIs yet</h3>
                        <p className="text-xs text-secondary leading-relaxed">
                          Get started by creating your first configuration item or importing from CSV.
                        </p>
                      </div>
                      <div className="flex items-center gap-2 pt-2">
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() => {
                            setNewCIName('');
                            setNewCITechContact('');
                            setNewCIEndpoint('');
                            setNewCIOwnerGroup(activeOwnerGroup?.id || ownerGroups[0]?.id || '');
                            setCreateCIError(null);
                            setIsCreateCIModalOpen(true);
                          }}
                          className="text-xs gap-1.5 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Create CI</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setCsvInputText('');
                            setParsedCsvRows([]);
                            setIsImportModalOpen(true);
                          }}
                          className="text-xs gap-1.5 cursor-pointer"
                        >
                          <Upload className="w-3.5 h-3.5 text-accent" />
                          <span>Import CSV</span>
                        </Button>
                      </div>
                    </div>
                  </td>
                </tr>
              ) : filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={totalVisibleColSpan} className="py-12 text-center">
                    <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-2.5">
                      <div className="p-2.5 bg-surface-sunken rounded-full border border-subtle text-muted">
                        <Search className="w-6 h-6 text-muted stroke-[1.5]" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-semibold text-primary">No results for these filters</h3>
                        <p className="text-xs text-secondary">
                          No configuration items match your active search query or filter selections.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedClass('');
                          setSelectedEnv('');
                          setSelectedTier('');
                          setSelectedState('');
                          setSearchQuery('');
                          setSavedView('all');
                        }}
                        className="text-xs mt-1 cursor-pointer"
                      >
                        Clear filters
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedItems.map((ci) => {
                  const Icon = getClassIcon(ci.ci_class);
                  const isSelectedForDrawer = drawerCI?.ci_id === ci.ci_id;
                  const freshness = getVerificationFreshness(ci.last_verified_at);

                  return (
                    <tr
                      key={ci.ci_id || ci.name}
                      className={cn(
                        'hover:bg-hover transition-colors group cursor-pointer h-9 sm:h-10 select-none',
                        isSelectedForDrawer && 'bg-selected/40 border-l-2 border-l-accent'
                      )}
                      onClick={() => handleOpenDrawer(ci)}
                    >
                      {/* Checkbox Column */}
                      <td className="py-1.5 px-3 w-8 text-center" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${ci.name}`}
                          checked={!!(ci.ci_id && selectedCIIds.has(ci.ci_id))}
                          onChange={() => ci.ci_id && toggleSelectCI(ci.ci_id, { stopPropagation: () => {} } as any)}
                          className="rounded border-control text-accent focus:ring-accent cursor-pointer"
                        />
                      </td>

                      {/* Name & Class & Sys ID */}
                      <td className="py-1.5 px-3">
                        <div className="flex items-center gap-2">
                          <div className="p-1 rounded-sm bg-surface-sunken border border-subtle text-secondary shrink-0">
                            <Icon className="w-3.5 h-3.5 stroke-[1.5]" />
                          </div>
                          <div className="min-w-0">
                            <div className="font-semibold text-primary group-hover:text-accent transition-colors truncate text-[13px] leading-tight">
                              {ci.name}
                            </div>
                            <div className="flex items-center gap-1.5 text-2xs font-mono text-muted leading-tight mt-0.5">
                              <span className="uppercase">{formatClassName(ci.ci_class)}</span>
                              <span>•</span>
                              <span className="truncate max-w-[100px]" title={ci.ci_id || ''}>
                                {ci.ci_id ? `${ci.ci_id.slice(0, 8)}...` : '—'}
                              </span>
                              {ci.ci_id && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(ci.ci_id || '');
                                    toast.info('Copied Sys ID to clipboard');
                                  }}
                                  className="text-muted hover:text-primary transition-colors p-0.5 rounded cursor-pointer"
                                  title="Copy Sys ID"
                                  aria-label="Copy Sys ID"
                                >
                                  <Copy className="w-2.5 h-2.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Tier (Neutral Badge T0-T3) */}
                      {visibleColumns.tier && (
                        <td className="py-1.5 px-3">
                          <CriticalityChip tier={ci.criticality_tier} />
                        </td>
                      )}

                      {/* Env */}
                      {visibleColumns.environment && (
                        <td className="py-1.5 px-3 font-mono text-2xs uppercase text-secondary">
                          {ci.environment}
                        </td>
                      )}

                      {/* Status (Exception Only) */}
                      {visibleColumns.status && (
                        <td className="py-1.5 px-3">
                          {ci.lifecycle_state === 'in_service' ? (
                            <span className="text-muted/40 font-mono text-xs">—</span>
                          ) : (
                            <LifecycleBadge state={ci.lifecycle_state} />
                          )}
                        </td>
                      )}

                      {/* Owner & Contact */}
                      {visibleColumns.owner && (
                        <td className="py-1.5 px-3">
                          <div className="text-primary font-medium truncate max-w-40 text-xs leading-tight">
                            {ci.ownership?.owner_group_name || 'Unassigned'}
                          </div>
                          <div className="text-2xs text-muted truncate max-w-40 leading-tight mt-0.5">
                            {ci.technical_contact || '—'}
                          </div>
                        </td>
                      )}

                      {/* Endpoint */}
                      {visibleColumns.endpoint && (
                        <td className="py-1.5 px-3 font-mono text-2xs text-secondary truncate max-w-48">
                          {ci.primary_endpoint || <span className="text-muted/40">—</span>}
                        </td>
                      )}

                      {/* Verified (60-day rule color) */}
                      {visibleColumns.verified && (
                        <td className="py-1.5 px-3">
                          <span className={cn('text-xs leading-tight', freshness.colorClass)}>
                            {freshness.label}
                          </span>
                        </td>
                      )}

                      {/* Single "..." Menu */}
                      <td className="py-1.5 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-md text-muted hover:text-primary hover:bg-hover cursor-pointer"
                              aria-label={`Actions for ${ci.name}`}
                              title={`Actions for ${ci.name}`}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44">
                            <DropdownMenuItem onClick={() => handleOpenDrawer(ci)}>
                              <Eye className="w-3.5 h-3.5 text-muted mr-1.5" />
                              <span>View Details</span>
                            </DropdownMenuItem>
                            {activeRole !== 'viewer' && (
                              <DropdownMenuItem onClick={() => handleOpenEditCI(ci)}>
                                <Pencil className="w-3.5 h-3.5 text-muted mr-1.5" />
                                <span>Edit</span>
                              </DropdownMenuItem>
                            )}
                            {activeRole !== 'viewer' && (
                              <DropdownMenuItem onClick={() => handleVerify(ci)}>
                                <CheckCircle className="w-3.5 h-3.5 text-inservice mr-1.5" />
                                <span>Verify</span>
                              </DropdownMenuItem>
                            )}
                            {onNavigateToGraph && ci.ci_id && (
                              <DropdownMenuItem onClick={() => onNavigateToGraph(ci.ci_id!)}>
                                <Network className="w-3.5 h-3.5 text-accent mr-1.5" />
                                <span>View in Graph</span>
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setFlaggingCI(ci)}>
                              <Flag className="w-3.5 h-3.5 text-tier1 mr-1.5" />
                              <span>Flag Dispute</span>
                            </DropdownMenuItem>
                            {activeRole === 'platform_admin' && ci.ci_id && (
                              <DropdownMenuItem
                                onClick={() => {
                                  const nextState = ci.lifecycle_state === 'out_of_sync' ? 'synced' : 'out_of_sync';
                                  updateCIMutation.mutate({ id: ci.ci_id!, data: { lifecycle_state: nextState } });
                                }}
                              >
                                {ci.lifecycle_state === 'out_of_sync' ? (
                                  <>
                                    <CheckCheck className="w-3.5 h-3.5 text-synced mr-1.5" />
                                    <span>Mark Synced</span>
                                  </>
                                ) : (
                                  <>
                                    <RefreshCw className="w-3.5 h-3.5 text-outofsync mr-1.5" />
                                    <span>Mark Out of Sync</span>
                                  </>
                                )}
                              </DropdownMenuItem>
                            )}
                            {activeRole !== 'viewer' && ci.lifecycle_state !== 'retired' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  destructive
                                  onClick={() => setRetiringCI(ci)}
                                >
                                  <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                                  <span>Delete</span>
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination Bar */}
      {filteredItems.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-3.5 py-2.5 bg-surface border border-hairline rounded-md text-xs text-secondary shadow-sm">
          <div className="flex items-center gap-2">
            <span>
              Showing <span className="font-semibold text-primary">{filteredItems.length === 0 ? 0 : (currentPageClamped - 1) * pageSize + 1}</span>–
              <span className="font-semibold text-primary">{Math.min(currentPageClamped * pageSize, filteredItems.length)}</span> of{' '}
              <span className="font-semibold text-primary">{filteredItems.length}</span> configuration items
            </span>
            {selectedCIIds.size > 0 && (
              <span className="text-accent font-semibold ml-1.5">({selectedCIIds.size} selected)</span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-2xs text-muted">Rows per page:</span>
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setCurrentPage(1);
                }}
                className="h-7 rounded border border-control bg-surface px-1.5 text-xs text-primary focus:outline-none focus:ring-1 focus:ring-accent cursor-pointer"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>

            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPageClamped <= 1}
                className="h-7 w-7 p-0 cursor-pointer"
                title="Previous page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </Button>
              <span className="text-2xs font-mono px-2">
                Page {currentPageClamped} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPageClamped >= totalPages}
                className="h-7 w-7 p-0 cursor-pointer"
                title="Next page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* CI Details Side Drawer */}
      <Dialog
        open={!!drawerCI}
        onOpenChange={(open) => {
          if (!open) handleCloseDrawer();
        }}
      >
        <DialogContent
          variant="drawer"
          className="w-full sm:max-w-xl p-0 flex flex-col h-full bg-surface border-l border-hairline overflow-hidden space-y-0"
        >
          {drawerCI && (
            <>
              {/* Drawer Header */}
              <div className="p-4 border-b border-subtle bg-surface-sunken space-y-3">
                <div className="flex items-start justify-between gap-3 pr-6">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-3xs font-mono uppercase bg-surface text-secondary px-1.5 py-0.5 rounded border border-subtle">
                        {drawerCI.ci_class}
                      </span>
                      <CriticalityChip tier={drawerCI.criticality_tier} />
                      <LifecycleBadge state={drawerCI.lifecycle_state} />
                    </div>
                    <h2 className="text-base font-semibold text-primary truncate">
                      {drawerCI.name}
                    </h2>
                    <div className="flex items-center gap-2 text-2xs font-mono text-muted">
                      <span>Sys ID:</span>
                      <span className="text-secondary select-all">{drawerCI.ci_id}</span>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(drawerCI.ci_id || '');
                          toast.info('Copied Sys ID to clipboard');
                        }}
                        className="text-muted hover:text-primary p-0.5 rounded cursor-pointer"
                        title="Copy Sys ID"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quick Action Toolbar */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  {activeRole !== 'viewer' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleVerify(drawerCI)}
                      isLoading={verifyMutation.isPending}
                      className="text-xs gap-1.5 h-7 text-inservice hover:bg-accent-subtle cursor-pointer"
                    >
                      <CheckCircle className="w-3.5 h-3.5 stroke-[1.5]" />
                      <span>Verify</span>
                    </Button>
                  )}
                  {activeRole !== 'viewer' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        handleOpenEditCI(drawerCI);
                        handleCloseDrawer();
                      }}
                      className="text-xs gap-1.5 h-7 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5 stroke-[1.5]" />
                      <span>Edit</span>
                    </Button>
                  )}
                  {onNavigateToGraph && drawerCI.ci_id && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onNavigateToGraph(drawerCI.ci_id!);
                        handleCloseDrawer();
                      }}
                      className="text-xs gap-1.5 h-7 cursor-pointer"
                    >
                      <Network className="w-3.5 h-3.5 text-accent stroke-[1.5]" />
                      <span>View in Graph</span>
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFlaggingCI(drawerCI)}
                    className="text-xs gap-1.5 h-7 cursor-pointer"
                  >
                    <Flag className="w-3.5 h-3.5 text-tier1 stroke-[1.5]" />
                    <span>Flag</span>
                  </Button>
                  {activeRole !== 'viewer' && drawerCI.lifecycle_state !== 'retired' && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRetiringCI(drawerCI)}
                      className="text-xs gap-1.5 h-7 text-tier0 hover:bg-tier0-bg/30 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5 stroke-[1.5]" />
                      <span>Retire</span>
                    </Button>
                  )}
                </div>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                {/* 1. Ownership & Contacts */}
                <div className="p-3 bg-surface-sunken/60 border border-subtle rounded-md space-y-2">
                  <span className="text-3xs font-mono uppercase text-muted font-semibold block tracking-wider">
                    Ownership & Assignment
                  </span>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-2xs text-muted block">Owner Group</span>
                      <span className="font-semibold text-primary">
                        {drawerCI.ownership?.owner_group_name || 'Unassigned'}
                      </span>
                    </div>
                    <div>
                      <span className="text-2xs text-muted block">Department</span>
                      <span className="text-secondary font-medium">
                        {drawerCI.ownership?.department_name || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-2xs text-muted block">Technical Contact</span>
                      <span className="font-mono text-secondary text-2xs">
                        {drawerCI.technical_contact || '—'}
                      </span>
                    </div>
                    <div>
                      <span className="text-2xs text-muted block">Team Lead</span>
                      <span className="text-secondary font-medium">
                        {drawerCI.ownership?.team_lead_name || '—'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 2. Governance & Attestation */}
                <div className="p-3 bg-surface-sunken/60 border border-subtle rounded-md space-y-2">
                  <span className="text-3xs font-mono uppercase text-muted font-semibold block tracking-wider">
                    Governance & Freshness
                  </span>
                  {(() => {
                    const freshness = getVerificationFreshness(drawerCI.last_verified_at);
                    return (
                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-secondary">Last Verified:</span>
                          <span className={freshness.colorClass}>
                            {freshness.label}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-secondary">Freshness Rule:</span>
                          <span className={freshness.colorClass}>
                            {freshness.detail}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-secondary">Lifecycle State:</span>
                          <LifecycleBadge state={drawerCI.lifecycle_state} />
                        </div>
                      </div>
                    );
                  })()}

                  {activeRole === 'platform_admin' && (
                    <div className="pt-2 border-t border-subtle mt-2 space-y-1.5">
                      <span className="text-3xs font-mono uppercase text-muted font-semibold block">
                        Admin State Override
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant={drawerCI.lifecycle_state === 'synced' ? 'outline' : 'secondary'}
                          size="sm"
                          disabled={updateCIMutation.isPending || drawerCI.lifecycle_state === 'synced'}
                          onClick={() => {
                            if (!drawerCI.ci_id) return;
                            updateCIMutation.mutate({ id: drawerCI.ci_id, data: { lifecycle_state: 'synced' } });
                            setDrawerCI((prev) => prev ? { ...prev, lifecycle_state: 'synced' } : null);
                          }}
                          className="text-xs h-7 gap-1"
                        >
                          <CheckCheck className="w-3.5 h-3.5 text-synced" />
                          Mark Synced
                        </Button>
                        <Button
                          variant={drawerCI.lifecycle_state === 'out_of_sync' ? 'outline' : 'secondary'}
                          size="sm"
                          disabled={updateCIMutation.isPending || drawerCI.lifecycle_state === 'out_of_sync'}
                          onClick={() => {
                            if (!drawerCI.ci_id) return;
                            updateCIMutation.mutate({ id: drawerCI.ci_id, data: { lifecycle_state: 'out_of_sync' } });
                            setDrawerCI((prev) => prev ? { ...prev, lifecycle_state: 'out_of_sync' } : null);
                          }}
                          className="text-xs h-7 gap-1"
                        >
                          <RefreshCw className="w-3.5 h-3.5 text-outofsync" />
                          Mark Out of Sync
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 3. Network & Endpoints */}
                <div className="p-3 bg-surface-sunken/60 border border-subtle rounded-md space-y-2">
                  <span className="text-3xs font-mono uppercase text-muted font-semibold block tracking-wider">
                    Network & Endpoints
                  </span>
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="text-secondary">Primary Endpoint:</span>
                      <span className="font-mono text-2xs text-primary">
                        {drawerCI.primary_endpoint || 'None'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-secondary">Environment:</span>
                      <span className="font-mono text-2xs uppercase text-primary font-semibold">
                        {drawerCI.environment}
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. Class Metadata */}
                <div className="p-3 bg-surface-sunken/60 border border-subtle rounded-md space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-3xs font-mono uppercase text-muted font-semibold block tracking-wider">
                      Class Form Specifications
                    </span>
                    <span className="text-3xs font-mono text-accent">
                      {formatClassName(drawerCI.ci_class)}
                    </span>
                  </div>
                  {drawerCI.class_metadata && Object.keys(drawerCI.class_metadata).length > 0 ? (
                    <div className="space-y-1.5 font-mono text-2xs">
                      {Object.entries(drawerCI.class_metadata).map(([k, v]) => {
                        const classDef = ciClasses.find((c) => c.id === drawerCI.ci_class);
                        const fieldDef = classDef?.form_fields?.find((f) => f.name === k);
                        const displayLabel = fieldDef ? fieldDef.label : k;
                        return (
                          <div
                            key={k}
                            className="flex justify-between items-center text-secondary py-1 border-b border-subtle/40 last:border-0"
                          >
                            <span className="text-muted text-xs font-sans">{displayLabel}:</span>
                            <span className="text-primary font-medium font-mono bg-canvas px-1.5 py-0.5 rounded border border-hairline">
                              {String(v)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="text-muted text-2xs italic py-1">
                      No custom class metadata registered.
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Safe Retirement Modal with Active Dependent Check */}
      <Dialog
        open={!!retiringCI}
        onOpenChange={(open) => {
          if (!open) {
            setRetiringCI(null);
            setForceRetire(false);
            setRetireProblem(null);
          }
        }}
      >
        <DialogContent variant="modal" className="border-tier0-border">
          {retiringCI && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3 text-tier0">
                  <AlertTriangle className="w-6 h-6 shrink-0 stroke-[1.5]" />
                  <div>
                    <DialogTitle className="text-base font-semibold text-primary">
                      Retire Configuration Item
                    </DialogTitle>
                    <DialogDescription className="text-xs text-secondary mt-1">
                      Are you sure you want to retire <span className="font-semibold text-primary">{retiringCI.name}</span>?
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>

              {/* In-Dialog RFC 9457 Problem Alert */}
              {retireProblem && (
                <div className="p-3 bg-tier0-bg border border-tier0-border rounded-md text-xs space-y-1.5 animate-in fade-in-50">
                  <div className="font-semibold text-tier0 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 stroke-[1.5] shrink-0" />
                    <span>Retirement Blocked (HTTP {retireProblem.status}): {retireProblem.title}</span>
                  </div>
                  <p className="text-secondary leading-normal">{retireProblem.detail}</p>
                  {activeRole === 'platform_admin' && (
                    <p className="text-2xs text-muted pt-1 border-t border-tier0-border/40">
                      Platform Admins may enable Force Retire to override active dependent protections.
                    </p>
                  )}
                </div>
              )}

              <p className="text-xs text-secondary leading-relaxed bg-surface-sunken p-3 rounded-md border border-subtle">
                Retirement requires zero active dependent services. If active dependents exist, retirement fails with <code className="text-deprecated font-mono text-2xs">HTTP 409 Conflict</code>.
              </p>

              {/* Force checkbox for platform admin only */}
              {activeRole === 'platform_admin' && (
                <label className="flex items-center gap-2 text-xs text-tier0 cursor-pointer p-2.5 bg-surface-sunken rounded-md border border-tier0-border/30">
                  <input
                    type="checkbox"
                    checked={forceRetire}
                    onChange={(e) => setForceRetire(e.target.checked)}
                    className="rounded-sm border-control text-tier0 focus:ring-accent"
                  />
                  <div>
                    <span className="font-semibold block text-primary">Force Retire (Admin Override)</span>
                    <span className="text-3xs text-secondary block">Bypasses dependent check and severs incoming dependencies</span>
                  </div>
                </label>
              )}

              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => {
                  setRetiringCI(null);
                  setRetireProblem(null);
                }}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleRetire}
                  isLoading={retireMutation.isPending}
                >
                  {forceRetire ? 'Force Retire CI' : 'Confirm Retirement'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Report Dispute Flag Modal */}
      <Dialog
        open={!!flaggingCI}
        onOpenChange={(open) => {
          if (!open) {
            setFlaggingCI(null);
            setFlagReason('');
          }
        }}
      >
        <DialogContent variant="modal">
          {flaggingCI && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2.5 text-deprecated">
                  <Flag className="w-5 h-5 shrink-0 stroke-[1.5]" />
                  <DialogTitle className="text-base font-semibold text-primary">
                    Report Data-Quality Dispute
                  </DialogTitle>
                </div>
                <DialogDescription className="text-xs text-secondary mt-1">
                  Notifies <span className="font-semibold text-primary">{flaggingCI.ownership?.owner_group_name || 'owner group'}</span> to verify or update operational metadata.
                </DialogDescription>
              </DialogHeader>

              <div>
                <label htmlFor="catalog-flag-reason" className="block text-2xs font-mono uppercase text-muted mb-1">
                  Reason for Dispute / Correction
                </label>
                <textarea
                  id="catalog-flag-reason"
                  value={flagReason}
                  onChange={(e) => setFlagReason(e.target.value)}
                  rows={3}
                  placeholder="e.g. Primary endpoint decommissioned; relocated to eu-west-1..."
                  className="w-full rounded-md border border-control bg-surface p-2.5 text-xs text-primary placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent font-sans"
                />
              </div>

              <DialogFooter>
                <Button variant="ghost" size="sm" onClick={() => setFlaggingCI(null)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleFlagSubmit}
                  isLoading={flagMutation.isPending}
                  disabled={!flagReason.trim()}
                >
                  Submit Flag
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Create Configuration Item Modal */}
      <Dialog
        open={isCreateCIModalOpen}
        onOpenChange={(open) => {
          setIsCreateCIModalOpen(open);
          if (!open) {
            setNewCIDependencies([]);
            setSelectedDepCIId('');
            setCreateCIError(null);
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Plus className="w-4 h-4 text-accent" />
              Create CI
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateCI} className="space-y-3 pt-1">
            {createCIError && (
              <div className="p-2 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{createCIError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Name *
              </label>
              <Input
                value={newCIName}
                onChange={(e) => setNewCIName(e.target.value)}
                placeholder="e.g. checkout-api-service"
                required
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Class *
                </label>
                <select
                  value={newCIClass}
                  onChange={(e) => setNewCIClass(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  {ciClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Tier *
                </label>
                <select
                  value={newCITier}
                  onChange={(e) => setNewCITier(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="tier_0">Critical (Tier 0)</option>
                  <option value="tier_1">High (Tier 1)</option>
                  <option value="tier_2">Medium (Tier 2)</option>
                  <option value="tier_3">Low (Tier 3)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Environment *
                </label>
                <select
                  value={newCIEnv}
                  onChange={(e) => setNewCIEnv(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="prod">Production</option>
                  <option value="dr">Disaster Recovery</option>
                  <option value="staging">Staging</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center justify-between">
                  <span>Owner Group</span>
                  {!isAdmin ? (
                    <span className="text-2xs text-inservice font-sans font-medium">(Locked to boundary)</span>
                  ) : (
                    <span className="text-3xs text-secondary font-sans font-normal">(Defaults to creator)</span>
                  )}
                </label>
                <select
                  value={newCIOwnerGroup || currentUser?.primary_owner_group_id || activeOwnerGroup?.id || ''}
                  onChange={(e) => setNewCIOwnerGroup(e.target.value)}
                  disabled={!isAdmin}
                  className={cn(
                    "w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none",
                    !isAdmin && "opacity-75 cursor-not-allowed bg-surface-sunken"
                  )}
                >
                  {ownerGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center justify-between">
                <span>Technical Contact</span>
                <span className="text-3xs text-secondary font-sans font-normal">(Defaults to {currentUser?.email || 'your email'})</span>
              </label>
              <Input
                type="email"
                value={newCITechContact}
                onChange={(e) => setNewCITechContact(e.target.value)}
                placeholder={currentUser?.email || "e.g. checkout-sre@enterprise.com"}
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Endpoint
              </label>
              <Input
                value={newCIEndpoint}
                onChange={(e) => setNewCIEndpoint(e.target.value)}
                placeholder="e.g. https://checkout.internal:8080"
                className="h-8 text-xs font-mono"
              />
            </div>

            {/* Dynamic CI Class Form Fields (e.g. VM Server, Database, etc.) */}
            {activeCIClassDef?.form_fields && activeCIClassDef.form_fields.length > 0 && (
              <div className="pt-2 border-t border-hairline space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-2xs font-semibold uppercase tracking-wider text-accent font-mono flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    <span>{activeCIClassDef.label} Form Specifications</span>
                  </label>
                  <span className="text-3xs text-secondary font-mono">
                    {activeCIClassDef.form_fields.length} dynamic attributes
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-surface-sunken/40 border border-subtle p-2.5 rounded-md">
                  {activeCIClassDef.form_fields.map((field) => (
                    <div key={field.name} className="space-y-1">
                      <label className="text-2xs font-medium text-secondary flex items-center gap-1 font-mono">
                        <span>{field.label}</span>
                        {field.required && <span className="text-tier0 font-bold">*</span>}
                      </label>
                      {field.type === 'select' ? (
                        <select
                          value={customFormValues[field.name] || ''}
                          onChange={(e) =>
                            setCustomFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                        >
                          {field.options?.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'number' ? (
                        <Input
                          type="number"
                          value={customFormValues[field.name] || ''}
                          onChange={(e) =>
                            setCustomFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          placeholder={field.placeholder || '0'}
                          required={field.required}
                          className="h-8 text-xs font-mono"
                        />
                      ) : (
                        <Input
                          type="text"
                          value={customFormValues[field.name] || ''}
                          onChange={(e) =>
                            setCustomFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                          required={field.required}
                          className="h-8 text-xs font-mono"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attached Dependencies Section */}
            <div className="pt-2 border-t border-hairline space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center gap-1.5">
                  <LinkIcon className="w-3 h-3 text-accent" />
                  Dependencies (Optional)
                </label>
                <span className="text-3xs text-secondary font-mono">
                  {newCIDependencies.length} attached
                </span>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={selectedDepCIId}
                  onChange={(e) => setSelectedDepCIId(e.target.value)}
                  aria-label="Select dependency target CI"
                  className="flex-1 h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none truncate"
                >
                  <option value="">Select dependency (provider CI)...</option>
                  {catalogData?.items
                    ?.filter((c) => c.ci_id && !newCIDependencies.some((d) => d.target_ci_id === c.ci_id))
                    .map((c) => (
                      <option key={c.ci_id || c.name} value={c.ci_id}>
                        {c.name} ({formatClassName(c.ci_class)})
                      </option>
                    ))}
                </select>

                <select
                  value={selectedDepType}
                  onChange={(e) => setSelectedDepType(e.target.value)}
                  aria-label="Select dependency relationship type"
                  className="h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  {relationshipTypes.map((rel) => (
                    <option key={rel.id} value={rel.id}>
                      {rel.label}
                    </option>
                  ))}
                </select>

                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleAddDependencyToNewCI}
                  disabled={!selectedDepCIId}
                  className="h-8 px-2.5 text-xs gap-1 shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </Button>
              </div>

              {newCIDependencies.length > 0 && (
                <div className="space-y-1.5 max-h-32 overflow-y-auto border border-subtle rounded p-1.5 bg-canvas">
                  {newCIDependencies.map((dep) => (
                    <div
                      key={dep.target_ci_id}
                      className="flex items-center justify-between p-1.5 rounded bg-surface border border-hairline text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono font-medium text-primary truncate max-w-[160px]">
                          {dep.target_name}
                        </span>
                        <span className="text-3xs text-secondary px-1.5 py-0.5 rounded bg-canvas border border-hairline font-mono">
                          {formatClassName(dep.target_class)}
                        </span>
                        <span className="text-3xs font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
                          {dep.edge_type}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveDependencyFromNewCI(dep.target_ci_id)}
                        className="text-muted hover:text-tier0 hover:bg-tier0-bg p-1.5 rounded transition-colors cursor-pointer"
                        title="Remove dependency"
                        aria-label={`Remove dependency ${dep.target_name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsCreateCIModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createCIMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {createCIMutation.isPending ? 'Creating...' : 'Create CI'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Configuration Item Modal */}
      <Dialog
        open={isEditCIModalOpen}
        onOpenChange={(open) => {
          setIsEditCIModalOpen(open);
          if (!open) {
            setEditingCI(null);
            setEditCIError(null);
          }
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Pencil className="w-4 h-4 text-accent" />
              Edit CI: {editingCI?.name}
            </DialogTitle>
            <DialogDescription className="text-2xs text-secondary font-mono">
              Sys ID: <span className="select-all text-primary font-semibold">{editingCI?.ci_id}</span>
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveEditCI} className="space-y-3 pt-1">
            {editCIError && (
              <div className="p-2 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{editCIError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Name *
              </label>
              <Input
                value={editCIName}
                onChange={(e) => setEditCIName(e.target.value)}
                placeholder="e.g. checkout-api-service"
                required
                className="h-8 text-xs font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Class *
                </label>
                <select
                  value={editCIClass}
                  onChange={(e) => setEditCIClass(e.target.value)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  {ciClasses.map((cls) => (
                    <option key={cls.id} value={cls.id}>
                      {cls.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Criticality Tier *
                </label>
                <select
                  value={editCITier}
                  onChange={(e) => setEditCITier(e.target.value as any)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="tier_0">Critical (Tier 0)</option>
                  <option value="tier_1">High (Tier 1)</option>
                  <option value="tier_2">Standard (Tier 2)</option>
                  <option value="tier_3">Low (Tier 3)</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Environment *
                </label>
                <select
                  value={editCIEnv}
                  onChange={(e) => setEditCIEnv(e.target.value as any)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="prod">Production</option>
                  <option value="dr">Disaster Recovery</option>
                  <option value="staging">Staging</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Lifecycle State *
                </label>
                <select
                  value={editCIState}
                  onChange={(e) => setEditCIState(e.target.value as any)}
                  className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                >
                  <option value="in_service">In Service</option>
                  <option value="synced">Synced</option>
                  <option value="out_of_sync">Out of Sync</option>
                  <option value="planned">Planned</option>
                  <option value="deprecated">Deprecated</option>
                  <option value="retired">Retired</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center justify-between">
                  <span>Owner Group *</span>
                  {!isAdmin && <span className="text-2xs text-inservice font-sans font-medium">(Locked to boundary)</span>}
                </label>
                <select
                  value={editCIOwnerGroup}
                  onChange={(e) => setEditCIOwnerGroup(e.target.value)}
                  disabled={!isAdmin}
                  className={cn(
                    "w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none",
                    !isAdmin && "opacity-75 cursor-not-allowed bg-surface-sunken"
                  )}
                >
                  {ownerGroups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Technical Contact *
                </label>
                <Input
                  type="email"
                  value={editCITechContact}
                  onChange={(e) => setEditCITechContact(e.target.value)}
                  placeholder="e.g. checkout-sre@enterprise.com"
                  required
                  className="h-8 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Primary Endpoint
              </label>
              <Input
                value={editCIEndpoint}
                onChange={(e) => setEditCIEndpoint(e.target.value)}
                placeholder="e.g. https://checkout.internal:8080"
                className="h-8 text-xs font-mono"
              />
            </div>

            {/* Dynamic Class Form Fields */}
            {activeEditClassDef?.form_fields && activeEditClassDef.form_fields.length > 0 && (
              <div className="pt-2 border-t border-hairline space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-2xs font-semibold uppercase tracking-wider text-accent font-mono flex items-center gap-1.5">
                    <Layers className="w-3.5 h-3.5" />
                    <span>{activeEditClassDef.label} Form Specifications</span>
                  </label>
                  <span className="text-3xs text-secondary font-mono">
                    {activeEditClassDef.form_fields.length} dynamic attributes
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 bg-surface-sunken/40 border border-subtle p-2.5 rounded-md">
                  {activeEditClassDef.form_fields.map((field) => (
                    <div key={field.name} className="space-y-1">
                      <label className="text-2xs font-medium text-secondary flex items-center gap-1 font-mono">
                        <span>{field.label}</span>
                        {field.required && <span className="text-tier0 font-bold">*</span>}
                      </label>
                      {field.type === 'select' ? (
                        <select
                          value={editCustomFormValues[field.name] || ''}
                          onChange={(e) =>
                            setEditCustomFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
                        >
                          {field.options?.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : field.type === 'number' ? (
                        <Input
                          type="number"
                          value={editCustomFormValues[field.name] || ''}
                          onChange={(e) =>
                            setEditCustomFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          placeholder={field.placeholder || '0'}
                          required={field.required}
                          className="h-8 text-xs font-mono"
                        />
                      ) : (
                        <Input
                          type="text"
                          value={editCustomFormValues[field.name] || ''}
                          onChange={(e) =>
                            setEditCustomFormValues((prev) => ({ ...prev, [field.name]: e.target.value }))
                          }
                          placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}`}
                          required={field.required}
                          className="h-8 text-xs font-mono"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsEditCIModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={updateCIMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {updateCIMutation.isPending ? 'Updating...' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Direct Dependency Modal */}
      <Dialog open={isAddEdgeModalOpen} onOpenChange={setIsAddEdgeModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <LinkIcon className="w-4 h-4 text-accent" />
              Add Dependency
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleAddEdge} className="space-y-3 pt-1">
            {edgeError && (
              <div className="p-2 rounded bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{edgeError}</span>
              </div>
            )}

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center justify-between">
                <span>Consumer (Dependent CI) *</span>
                <span className="text-3xs text-secondary font-sans font-normal">(Service that relies on provider)</span>
              </label>
              <select
                value={edgeSourceId}
                onChange={(e) => setEdgeSourceId(e.target.value)}
                className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
              >
                <option value="">Select consumer service...</option>
                {catalogData?.items?.map((ci) => (
                  <option key={ci.ci_id} value={ci.ci_id}>
                    {ci.name} ({formatClassName(ci.ci_class)})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                Relationship *
              </label>
              <select
                value={edgeType}
                onChange={(e) => setEdgeType(e.target.value)}
                className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
              >
                {relationshipTypes.map((rel) => (
                  <option key={rel.id} value={rel.id}>
                    {rel.label} ({rel.id})
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-2xs font-semibold uppercase tracking-wider text-muted font-mono flex items-center justify-between">
                <span>Provider (Dependency CI) *</span>
                <span className="text-3xs text-secondary font-sans font-normal">(Underlying service or database)</span>
              </label>
              <select
                value={edgeTargetId}
                onChange={(e) => setEdgeTargetId(e.target.value)}
                className="w-full h-8 px-2 rounded bg-surface border border-hairline text-xs text-primary focus:border-accent focus:outline-none"
              >
                <option value="">Select provider dependency...</option>
                {catalogData?.items?.map((ci) => (
                  <option key={ci.ci_id} value={ci.ci_id}>
                    {ci.name} ({formatClassName(ci.ci_class)})
                  </option>
                ))}
              </select>
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsAddEdgeModalOpen(false)}
                className="text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={createEdgeMutation.isPending}
                className="bg-accent hover:bg-accent-hover text-white text-xs gap-1.5"
              >
                {createEdgeMutation.isPending ? 'Connecting...' : 'Add Dependency'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* CSV Import Modal */}
      <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              <Upload className="w-4 h-4 text-accent" />
              <span>Import Configuration Items from CSV</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-secondary">
              Bulk upload or paste CIs with automatic validation against your CI classes and owner groups.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 my-2 text-xs">
            {/* File Upload & Template Download Bar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-surface-sunken border border-subtle rounded-md">
              <div className="space-y-0.5">
                <span className="font-semibold text-primary block">Supported Columns</span>
                <span className="text-2xs text-muted font-mono block">
                  name, ci_class, environment, criticality_tier, technical_contact, primary_endpoint, owner_group
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="text-xs h-7 gap-1 shrink-0"
              >
                <Download className="w-3 h-3 text-accent" />
                <span>Download Template</span>
              </Button>
            </div>

            {/* CSV Input Area */}
            <div>
              <label className="text-xs font-semibold text-primary block mb-1">
                Upload File or Paste CSV:
              </label>
              <div className="flex items-center gap-2 mb-2">
                <input
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleFileSelect}
                  className="text-xs text-secondary file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-2xs file:font-semibold file:bg-surface-sunken file:text-primary hover:file:bg-hover cursor-pointer"
                />
              </div>
              <textarea
                rows={6}
                value={csvInputText}
                onChange={(e) => {
                  setCsvInputText(e.target.value);
                  validateRawCsv(e.target.value);
                }}
                placeholder={SAMPLE_CSV_TEMPLATE}
                className="w-full font-mono text-2xs p-2.5 bg-canvas border border-control rounded-md focus:outline-none focus:ring-1 focus:ring-accent leading-relaxed"
              />
            </div>

            {/* Parsed Preview Table */}
            {parsedCsvRows.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-primary text-xs">
                    Preview ({validRowCount} valid, {invalidRowCount} invalid of {parsedCsvRows.length})
                  </span>
                  {invalidRowCount > 0 && (
                    <span className="text-2xs text-tier0 font-medium">
                      Invalid rows will be skipped
                    </span>
                  )}
                </div>
                <div className="max-h-48 overflow-y-auto border border-subtle rounded-md">
                  <table className="w-full text-left text-2xs">
                    <thead className="bg-surface-sunken text-secondary border-b border-subtle sticky top-0">
                      <tr>
                        <th className="p-1.5">Status</th>
                        <th className="p-1.5">Name</th>
                        <th className="p-1.5">Class</th>
                        <th className="p-1.5">Env</th>
                        <th className="p-1.5">Tier</th>
                        <th className="p-1.5">Contact</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-subtle">
                      {parsedCsvRows.slice(0, 15).map((row, i) => (
                        <tr key={i} className={row.isValid ? 'bg-surface' : 'bg-tier0-bg/30'}>
                          <td className="p-1.5" title={!row.isValid ? row.errors.join('; ') : undefined}>
                            {row.isValid ? (
                              <CheckCircle className="w-3.5 h-3.5 text-inservice" />
                            ) : (
                              <AlertCircle className="w-3.5 h-3.5 text-tier0" />
                            )}
                          </td>
                          <td className="p-1.5 font-semibold text-primary truncate max-w-36">{row.name}</td>
                          <td className="p-1.5 font-mono text-secondary">{row.ci_class}</td>
                          <td className="p-1.5 uppercase font-mono text-secondary">{row.environment}</td>
                          <td className="p-1.5 font-mono text-secondary">{row.criticality_tier}</td>
                          <td className="p-1.5 text-muted truncate max-w-36">{row.technical_contact}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {parsedCsvRows.length > 15 && (
                    <div className="p-1.5 text-center text-3xs text-muted bg-surface-sunken border-t border-subtle">
                      Showing first 15 of {parsedCsvRows.length} rows
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Import Progress */}
            {isImporting && (
              <div className="space-y-1.5 p-3 bg-surface-sunken rounded-md border border-subtle">
                <div className="flex justify-between text-2xs font-semibold text-primary">
                  <span>Importing configuration items...</span>
                  <span>{importProgress.current} / {importProgress.total}</span>
                </div>
                <div className="w-full bg-canvas rounded-full h-2 border border-subtle overflow-hidden">
                  <div
                    className="bg-accent h-full transition-all duration-150"
                    style={{ width: `${(importProgress.current / Math.max(1, importProgress.total)) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsImportModalOpen(false)}
              disabled={isImporting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={handleExecuteImport}
              disabled={validRowCount === 0 || isImporting}
              isLoading={isImporting}
              className="gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Import {validRowCount} CI{validRowCount !== 1 ? 's' : ''}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
