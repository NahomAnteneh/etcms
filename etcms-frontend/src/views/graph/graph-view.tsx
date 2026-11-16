import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type EdgeProps,
  MarkerType,
  Handle,
  Position,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';
import {
  Database,
  Layers,
  Cpu,
  Server,
  Shield,
  Copy,
  Check,
  Activity,
  Power,
  Network,
  ArrowRight,
  ExternalLink,
  AlertTriangle,
  RefreshCw,
  Trash2,
  CheckCircle2,
  X,
  Search,
  ChevronDown,
  Boxes,
  Plus,
} from 'lucide-react';
import {
  useCICatalog,
  useUpwardImpact,
  useDownwardDependencies,
  useCISearch,
  useCIDetail,
  useRelationshipTypes,
  DEFAULT_RELATIONSHIP_TYPES,
  type RelationshipTypeDefinition,
  useConfirmEdge,
  useFlagMismatchEdge,
  useDeleteEdge,
} from '../../api/endpoints';
import {
  getConnectedTopology,
  detectTopologyCycles,
  simulateOutageCascade,
  getHighestCriticalityTier,
  type OutageSimulationResult,
} from './graph-topology';
import { Button } from '../../components/ui/button';
import { cn } from '../../lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '../../components/ui/dialog';

export interface CINodeData extends Record<string, unknown> {
  id: string;
  name: string;
  ci_class: string;
  criticality_tier?: string;
  environment?: string;
  isTarget: boolean;
  roleInTopology: 'target' | 'consumer' | 'provider' | 'sibling';
  depth?: number;
  isSharedDependency?: boolean;
  subgraphInDegree?: number;
  isCycle?: boolean;
  simulationStatus?: 'failed_source' | 'impacted' | 'healthy';
  simulationImpactDirection?: 'upstream' | 'downstream' | 'both';
  isSimulatingOutage?: boolean;
  onToggleSimulation?: (ciId: string) => void;
  onSelectNode?: (ciId: string) => void;
}

export interface DependencyEdgeData extends Record<string, unknown> {
  id?: string;
  source?: string;
  target?: string;
  consumerName: string;
  providerName: string;
  edgeType: string;
  edgeLabel?: string;
  edgeStroke?: string;
  edgeMarkerColor?: string;
  handshakeStatus: string;
  isImpacted?: boolean;
  isCycle?: boolean;
  onSelectEdge?: (edgeId: string) => void;
}

export const EDGE_CONFIGS: Record<
  string,
  {
    label: string;
    stroke: string;
    markerColor: string;
  }
> = {
  hosted_on: {
    label: 'hosted on',
    stroke: '#7c3aed',
    markerColor: '#7c3aed',
  },
  reads_from: {
    label: 'reads from',
    stroke: '#0d9488',
    markerColor: '#0d9488',
  },
  writes_to: {
    label: 'writes to',
    stroke: '#cf222e',
    markerColor: '#cf222e',
  },
  connects_to: {
    label: 'connects to',
    stroke: '#00845c',
    markerColor: '#00845c',
  },
  depends_on: {
    label: 'depends on',
    stroke: '#57606a',
    markerColor: '#57606a',
  },
};

export function getRelationshipColor(color?: string): string {
  switch (color) {
    case 'emerald':
    case 'cyan':
      return '#00845c';
    case 'violet':
    case 'purple':
      return '#7c3aed';
    case 'amber':
    case 'orange':
      return '#b05a00';
    case 'rose':
    case 'red':
      return '#cf222e';
    case 'slate':
    case 'neutral':
      return '#57606a';
    default:
      return '#57606a';
  }
}

interface GraphViewProps {
  initialCIId?: string | null;
  onNavigateToCatalogCI?: (ciId: string) => void;
}

// Clean, Uncluttered Service Node with Outage Simulation & Cycle Warning State
function CINodeComponent({ data }: { data: CINodeData }) {
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
      case 'network_firewall':
        return Shield;
      default:
        return Server;
    }
  };

  const Icon = getClassIcon(data.ci_class);
  const isTarget = data.isTarget;
  const simStatus = data.simulationStatus;
  const isSimulating = Boolean(data.isSimulatingOutage);

  const isFailedSource = simStatus === 'failed_source';
  const isImpacted = simStatus === 'impacted';
  const isDimmed = isSimulating && simStatus === 'healthy';
  const isCycle = Boolean(data.isCycle);
  const isShared = Boolean(data.isSharedDependency);

  return (
    <div
      tabIndex={0}
      role="button"
      aria-label={`${data.name}, class: ${data.ci_class}, role: ${data.roleInTopology}${
        isShared ? `, shared single point of failure with ${data.subgraphInDegree || 2} dependents` : ''
      }${isCycle ? ', circular dependency risk' : ''}${
        isFailedSource ? ', offline simulated failure' : isImpacted ? ', impacted service' : ''
      }`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          data.onSelectNode?.(data.id);
        }
      }}
      onClick={(e) => {
        e.stopPropagation();
        data.onSelectNode?.(data.id);
      }}
      className={`px-3 py-2.5 rounded-md border select-none transition-all shadow-sm w-[230px] cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent ${
        isFailedSource
          ? 'border-tier0 ring-4 ring-tier0/40 bg-tier0-bg shadow-md'
          : isImpacted
          ? 'border-tier0 ring-2 ring-tier0/20 bg-tier0-bg/70 shadow'
          : isDimmed
          ? 'border-subtle bg-surface opacity-45 hover:opacity-100'
          : isTarget
          ? 'border-accent ring-2 ring-accent/30 shadow-md bg-selected/40'
          : isCycle
          ? 'border-tier1 ring-2 ring-tier1/30 bg-tier1-bg/30 hover:border-tier1'
          : isShared
          ? 'border-tier1/70 bg-surface hover:border-tier1 hover:shadow'
          : 'border-subtle bg-surface hover:border-control hover:shadow'
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-2 !h-2 !opacity-0 !pointer-events-none"
      />

      {/* Class Icon & Type */}
      <div className="flex items-center justify-between text-2xs mb-1">
        <div className="flex items-center gap-1.5 text-secondary">
          <Icon className={`w-3.5 h-3.5 stroke-[1.5] ${isFailedSource || isImpacted ? 'text-tier0' : isCycle ? 'text-tier1' : ''}`} />
          <span
            className={`font-mono text-2xs uppercase tracking-wider font-medium ${
              isFailedSource || isImpacted ? 'text-tier0 font-bold' : isCycle ? 'text-tier1 font-semibold' : 'text-muted'
            }`}
          >
            {data.ci_class?.replace('_', ' ') || 'Service'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {isFailedSource ? (
            <span className="font-mono font-bold text-3xs uppercase tracking-wider text-white bg-tier0 px-1.5 py-0.5 rounded">
              Offline
            </span>
          ) : isImpacted ? (
            <span className="font-mono font-bold text-3xs uppercase tracking-wider text-tier0 bg-white border border-tier0-border px-1.5 py-0.5 rounded">
              Impacted
            </span>
          ) : isTarget ? (
            <span className="font-mono font-bold text-3xs uppercase tracking-wider text-accent bg-accent/10 px-1.5 py-0.5 rounded border border-accent/20">
              Target
            </span>
          ) : isCycle ? (
            <span
              className="font-mono font-bold text-3xs uppercase tracking-wider text-tier1 bg-tier1-bg border border-tier1-border px-1.5 py-0.5 rounded flex items-center gap-0.5"
              title="Participates in a circular dependency loop"
            >
              <RefreshCw className="w-2.5 h-2.5 animate-spin duration-3000" />
              <span>Cycle</span>
            </span>
          ) : isShared ? (
            <span
              className="font-mono font-semibold text-3xs text-tier1 bg-tier1-bg px-1.5 py-0.5 rounded border border-tier1-border/50"
              title={`Single Point of Failure: ${data.subgraphInDegree || 2} distinct consumers depend on this infrastructure`}
            >
              SPOF ({data.subgraphInDegree || 2})
            </span>
          ) : null}

          {/* Quick Outage Power Toggle Button with Explanatory Tooltip */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              data.onToggleSimulation?.(data.id);
            }}
            className={`p-1 rounded cursor-pointer transition-colors ${
              isFailedSource
                ? 'bg-tier0 text-white hover:bg-tier0/90'
                : 'text-muted hover:text-tier0 hover:bg-tier0-bg'
            }`}
            title={
              isFailedSource
                ? 'Restore this service (turn back on to exit simulation)'
                : 'Simulate outage: test cascade impact if this service goes offline'
            }
            aria-label={
              isFailedSource
                ? `Restore ${data.name}`
                : `Simulate outage for ${data.name}`
            }
          >
            <Power className="w-3.5 h-3.5 stroke-[2]" />
          </button>
        </div>
      </div>

      {/* Primary Service Name (Larger Text) */}
      <div
        className={`font-semibold text-sm truncate leading-snug ${
          isFailedSource || isImpacted ? 'text-tier0' : 'text-primary'
        }`}
        title={data.name}
      >
        {data.name}
      </div>

      {/* Subtle Criticality and Environment */}
      <div className="flex items-center justify-between text-2xs text-muted mt-1 font-mono">
        <span>{data.environment?.toUpperCase() || 'PROD'}</span>
        {data.criticality_tier && (
          <span className="capitalize">{data.criticality_tier.replace('_', ' ')}</span>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-2 !h-2 !opacity-0 !pointer-events-none"
      />
    </div>
  );
}

// Clear Connection Line with Plain-English Relation Type ("connects to ➔", "depends on ➔")
function DependencyEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const edgeData = data as DependencyEdgeData | undefined;
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetPosition,
    targetX,
    targetY,
    borderRadius: 14,
  });

  const isPending = edgeData?.handshakeStatus === 'pending_confirmation';
  const isImpacted = Boolean(edgeData?.isImpacted);
  const isCycle = Boolean(edgeData?.isCycle);
  const [isHovered, setIsHovered] = useState(false);

  const fallbackConfig = EDGE_CONFIGS[edgeData?.edgeType || 'depends_on'] || {
    label: (edgeData?.edgeType || 'depends on').replace(/_/g, ' '),
    stroke: '#57606a',
    markerColor: '#57606a',
  };
  const effectiveLabel = edgeData?.edgeLabel || fallbackConfig.label;
  const effectiveStroke = edgeData?.edgeStroke || fallbackConfig.stroke;

  const isDominantDependsOn = (edgeData?.edgeType || 'depends_on') === 'depends_on';
  const shouldShowLabel = !isDominantDependsOn || isCycle || isImpacted || selected || isHovered;

  const baseStroke = isImpacted
    ? '#cf222e'
    : isCycle
    ? '#b05a00'
    : isPending
    ? '#b05a00'
    : selected
    ? '#00845c'
    : effectiveStroke;

  const handleSelect = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    edgeData?.onSelectEdge?.(id);
  };

  return (
    <>
      {/* Invisible wider hit area for easy clicking & hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={28}
        className="cursor-pointer"
        onClick={handleSelect}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      />

      {/* Visible Dependency Edge Line */}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: baseStroke,
          strokeWidth: isImpacted ? 2.5 : isCycle ? 2.5 : selected ? 2.5 : 1.75,
          strokeDasharray: isCycle ? '4,4' : isPending ? '5,5' : undefined,
          transition: 'stroke 0.15s',
        }}
      />

      {/* Relation Type Badge on Edge (shown on hover or when differing from dominant depends_on) */}
      {shouldShowLabel && (
        <EdgeLabelRenderer>
          <div
            role="button"
            tabIndex={0}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            aria-label={`Dependency: ${edgeData?.consumerName || 'Service'} ${effectiveLabel} ${edgeData?.providerName || 'Service'}${isCycle ? ' (Circular Dependency)' : ''}`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            onClick={handleSelect}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSelect(e);
              }
            }}
            className={`nodrag nopan select-none transition-all cursor-pointer shadow-sm flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs font-sans font-medium focus:outline-none focus:ring-2 focus:ring-accent ${
              isImpacted
                ? 'bg-tier0-bg border-tier0-border text-tier0 font-bold shadow-md z-30'
                : selected
                ? 'ring-2 ring-accent border-accent bg-selected text-accent font-semibold shadow-md z-30'
                : isCycle
                ? 'bg-tier1-bg border-tier1-border text-tier1 font-semibold shadow-md z-30'
                : 'bg-surface border-subtle text-primary hover:border-control z-20'
            }`}
            title={`${edgeData?.consumerName || 'Service'} ${effectiveLabel} ${edgeData?.providerName || 'Service'}${
              isCycle ? ' (Circular Dependency Loop)' : ''
            }`}
          >
            <span className={`font-semibold ${isImpacted ? 'text-tier0' : isCycle ? 'text-tier1' : 'text-primary'}`}>
              {effectiveLabel}
            </span>
            {isImpacted ? (
              <span className="text-3xs font-bold uppercase tracking-wider text-white bg-tier0 px-1 py-0.5 rounded ml-0.5">
                Impacted
              </span>
            ) : isCycle ? (
              <span className="text-3xs font-bold uppercase tracking-wider text-tier1 bg-white border border-tier1-border px-1 py-0.5 rounded ml-0.5">
                Cycle ↺
              </span>
            ) : isPending ? (
              <span className="text-3xs font-bold uppercase text-tier1 bg-tier1-bg px-1 py-0.5 rounded ml-0.5">
                Pending
              </span>
            ) : null}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

const nodeTypes = {
  ciNode: CINodeComponent,
};

const edgeTypes = {
  dependencyEdge: DependencyEdgeComponent,
};

// Dagre Layout Algorithm: Clean Hierarchical Top-to-Bottom
function getLayoutedElements(nodes: Node[], edges: Edge[], direction = 'TB') {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 220, height: 70 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const width = 220;
    const height = 70;
    return {
      ...node,
      position: {
        x: (nodeWithPosition?.x || 0) - width / 2,
        y: (nodeWithPosition?.y || 0) - height / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

function GraphAutoFitter({ triggerKey }: { triggerKey: string }) {
  const { fitView } = useReactFlow();
  const fitViewRef = useRef(fitView);
  fitViewRef.current = fitView;

  useEffect(() => {
    fitViewRef.current({ padding: 0.2, duration: 200 });
    const timer = setTimeout(() => {
      fitViewRef.current({ padding: 0.2, duration: 200 });
    }, 100);
    return () => clearTimeout(timer);
  }, [triggerKey]);

  return null;
}

export function GraphView({ initialCIId, onNavigateToCatalogCI }: GraphViewProps) {
  const { data: catalog } = useCICatalog();
  const [selectedCIId, setSelectedCIId] = useState<string | null>(initialCIId || null);
  const { data: selectedCIDetail } = useCIDetail(selectedCIId);
  const { data: relationshipTypes = DEFAULT_RELATIONSHIP_TYPES } = useRelationshipTypes();
  const [serviceFilter, setServiceFilter] = useState('');
  const { data: searchResults } = useCISearch(serviceFilter);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [isSiblingDrawerOpen, setIsSiblingDrawerOpen] = useState(false);
  const [isComboboxOpen, setIsComboboxOpen] = useState(false);
  const comboboxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as any)) {
        setIsComboboxOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Edge Mutations
  const confirmEdgeMutation = useConfirmEdge();
  const flagMismatchEdgeMutation = useFlagMismatchEdge();
  const deleteEdgeMutation = useDeleteEdge();

  const handleSelectNode = useCallback((ciId: string) => {
    setSelectedNodeId(ciId);
    setSelectedEdgeId(null);
  }, []);

  const handleSelectEdge = useCallback((edgeId: string) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeId(null);
  }, []);

  useEffect(() => {
    if (initialCIId) {
      setSelectedCIId(initialCIId);
    }
  }, [initialCIId]);

  const filteredServices = useMemo(() => {
    if (serviceFilter.trim() && searchResults && searchResults.length > 0) {
      return searchResults.map((s) => ({
        ci_id: s.ci.ci_id,
        name: s.ci.name,
        ci_class: s.ci.ci_class,
        environment: s.ci.environment,
        criticality_tier: s.ci.criticality_tier,
      }));
    }
    const items = catalog?.items || [];
    if (!serviceFilter.trim()) return items;
    const q = serviceFilter.toLowerCase();
    const matches = items.filter(
      (ci) =>
        ci.name.toLowerCase().includes(q) ||
        ci.ci_class.toLowerCase().includes(q)
    );

    // If currently selected CI is not in matches, ensure it remains in dropdown list
    if (selectedCIId && !matches.some((m) => m.ci_id === selectedCIId)) {
      const current = items.find((i) => i.ci_id === selectedCIId);
      if (current) {
        return [current, ...matches];
      }
    }
    return matches;
  }, [catalog?.items, serviceFilter, searchResults, selectedCIId]);

  // 3 Clear Modes: 'connected' | 'upward' | 'downward'
  const [traversalMode, setTraversalMode] = useState<'connected' | 'upward' | 'downward'>('connected');
  const [depthLimit, setDepthLimit] = useState<number>(5);
  const [includeRetired, setIncludeRetired] = useState<boolean>(false);
  const [copiedIncident, setCopiedIncident] = useState(false);

  // Outage Simulation: The ID of the service that has been "turned off"
  const [simulatedFailedId, setSimulatedFailedId] = useState<string | null>(null);

  const toggleSimulation = useCallback((ciId: string) => {
    setSimulatedFailedId((prev) => (prev === ciId ? null : ciId));
  }, []);

  // Default to connected hub service (Checkmk Server or core-account-service) if none selected
  useEffect(() => {
    if (!selectedCIId && catalog?.items && catalog.items.length > 0) {
      const preferred =
        catalog.items.find((i) => i.name === 'Checkmk Server') ||
        catalog.items.find((i) => i.name === 'core-account-service') ||
        catalog.items.find((i) => i.ci_class === 'application') ||
        catalog.items.find((i) => i.ci_class === 'vm_server') ||
        catalog.items[0];
      setSelectedCIId(preferred.ci_id || null);
    }
  }, [catalog?.items, selectedCIId]);

  // Fetch both Upward Impact and Downward Dependencies so blast radius telemetry is always complete
  const { data: upwardData, isLoading: upwardLoading } = useUpwardImpact(
    selectedCIId,
    includeRetired
  );

  const { data: downwardData, isLoading: downwardLoading } = useDownwardDependencies(
    selectedCIId,
    includeRetired
  );

  // Determine what to render based on user's active tab
  const shouldRenderUpward = traversalMode === 'connected' || traversalMode === 'upward';
  const shouldRenderDownward = traversalMode === 'connected' || traversalMode === 'downward';

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const selectedNode = useMemo(() => {
    if (!selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, nodes]);

  const selectedEdge = useMemo(() => {
    if (!selectedEdgeId) return null;
    return edges.find((e) => e.id === selectedEdgeId) || null;
  }, [selectedEdgeId, edges]);

  const cycleResult = useMemo(() => {
    return detectTopologyCycles(nodes, edges);
  }, [nodes, edges]);

  // Synchronize Graph Nodes and Directed Edges
  const buildGraph = useCallback(() => {
    if (!selectedCIId) return;

    const rootCI = catalog?.items?.find((i) => i.ci_id === selectedCIId) || selectedCIDetail;
    if (!rootCI || !rootCI.ci_id) return;

    const nodeMap = new Map<string, Node>();
    const edgeMap = new Map<string, Edge>();

    // 1. Root Target Node
    nodeMap.set(rootCI.ci_id!, {
      id: rootCI.ci_id!,
      type: 'ciNode',
      data: {
        id: rootCI.ci_id!,
        name: rootCI.name,
        ci_class: rootCI.ci_class,
        criticality_tier: rootCI.criticality_tier,
        environment: rootCI.environment,
        isTarget: true,
        roleInTopology: 'target',
        depth: 0,
        onToggleSimulation: toggleSimulation,
        onSelectNode: handleSelectNode,
      },
      position: { x: 0, y: 0 },
    });

    // 2. Compute BFS depths for Upward Nodes from edges
    const upwardDepthMap = new Map<string, number>();
    upwardDepthMap.set(selectedCIId, 0);

    if (upwardData?.edges) {
      const queue: string[] = [selectedCIId];
      while (queue.length > 0) {
        const currId = queue.shift()!;
        const currDepth = upwardDepthMap.get(currId) || 0;
        for (const edge of upwardData.edges) {
          if (edge.target_ci_id === currId && !upwardDepthMap.has(edge.source_ci_id)) {
            upwardDepthMap.set(edge.source_ci_id, currDepth + 1);
            queue.push(edge.source_ci_id);
          }
        }
      }
    }

    // 3. Add Upstream Consumers (if mode includes upward)
    if (shouldRenderUpward && upwardData?.nodes) {
      upwardData.nodes.forEach((n) => {
        if (!n.ci_id || n.ci_id === selectedCIId) return;
        const nodeDepth = upwardDepthMap.get(n.ci_id);
        // Strict consistency: skip if not reached from selectedCIId in upward graph
        if (nodeDepth === undefined || nodeDepth > depthLimit) return;

        if (!nodeMap.has(n.ci_id)) {
          nodeMap.set(n.ci_id, {
            id: n.ci_id,
            type: 'ciNode',
            data: {
              id: n.ci_id,
              name: n.name,
              ci_class: n.ci_class,
              criticality_tier: n.criticality_tier,
              environment: n.environment,
              isTarget: false,
              roleInTopology: 'consumer',
              depth: nodeDepth,
              onToggleSimulation: toggleSimulation,
              onSelectNode: handleSelectNode,
            },
            position: { x: 0, y: 0 },
          });
        }
      });
    }

    // 4. Add Downstream Dependencies (if mode includes downward)
    if (shouldRenderDownward && downwardData?.nodes) {
      downwardData.nodes.forEach((item) => {
        const ci = item.ci;
        if (!ci.ci_id || ci.ci_id === selectedCIId) return;
        if (item.depth > depthLimit) return;

        if (!nodeMap.has(ci.ci_id)) {
          nodeMap.set(ci.ci_id, {
            id: ci.ci_id,
            type: 'ciNode',
            data: {
              id: ci.ci_id,
              name: ci.name,
              ci_class: ci.ci_class,
              criticality_tier: ci.criticality_tier,
              environment: ci.environment,
              isTarget: false,
              roleInTopology: 'provider',
              depth: item.depth,
              isSharedDependency: item.is_shared_dependency,
              subgraphInDegree: item.subgraph_in_degree,
              onToggleSimulation: toggleSimulation,
              onSelectNode: handleSelectNode,
            },
            position: { x: 0, y: 0 },
          });
        } else {
          // If already added, enrich with shared dependency info
          const existing = nodeMap.get(ci.ci_id)!;
          const data = existing.data as CINodeData;
          data.isSharedDependency = item.is_shared_dependency;
          data.subgraphInDegree = item.subgraph_in_degree;
        }
      });
    }

    // 5. Collect Candidate Edges
    const candidateEdges = [
      ...(shouldRenderUpward && upwardData?.edges ? upwardData.edges : []),
      ...(shouldRenderDownward && downwardData?.edges ? downwardData.edges : []),
    ];

    // 6. Calculate Outage Cascade Simulation:
    // When simulatedFailedId is set, failure propagates DOWNWARD along outgoing dependency edges:
    // (from consumer/source to dependencies/target). When a downward dependency is offline,
    // it does NOT impact upward consumers per operational policy.
    let simulationResult: OutageSimulationResult | null = null;
    if (simulatedFailedId) {
      simulationResult = simulateOutageCascade(
        simulatedFailedId,
        candidateEdges,
        { direction: 'both' }
      );
    }

    const relMap = new Map<string, RelationshipTypeDefinition>();
    if (relationshipTypes) {
      relationshipTypes.forEach((rt) => relMap.set(rt.id, rt));
    }

    // 7. Connect Edges with Plain-English Relation Types & Outage Highlighting
    candidateEdges.forEach((edge) => {
      if (edgeMap.has(edge.id)) return;
      if (!nodeMap.has(edge.source_ci_id) || !nodeMap.has(edge.target_ci_id)) return;

      const sourceNode = nodeMap.get(edge.source_ci_id);
      const targetNode = nodeMap.get(edge.target_ci_id);
      const sourceData = sourceNode?.data as CINodeData | undefined;
      const targetData = targetNode?.data as CINodeData | undefined;

      const isPending = edge.handshake_status === 'pending_confirmation';
      const isImpacted = simulationResult ? simulationResult.impactedEdgeIds.has(edge.id) : false;
      const relDef = relMap.get(edge.edge_type);
      const edgeLabel = relDef ? relDef.label.toLowerCase() : (EDGE_CONFIGS[edge.edge_type]?.label || edge.edge_type.replace(/_/g, ' '));
      const strokeColor = relDef ? getRelationshipColor(relDef.color) : (EDGE_CONFIGS[edge.edge_type]?.stroke || '#57606a');
      const edgeColor = isImpacted ? '#cf222e' : isPending ? '#b05a00' : strokeColor;

      edgeMap.set(edge.id, {
        id: edge.id,
        source: edge.source_ci_id,
        target: edge.target_ci_id,
        type: 'dependencyEdge',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: edgeColor,
          width: 14,
          height: 14,
        },
        data: {
          id: edge.id,
          source: edge.source_ci_id,
          target: edge.target_ci_id,
          consumerName: sourceData?.name || 'Consumer',
          providerName: targetData?.name || 'Provider',
          edgeType: edge.edge_type,
          edgeLabel,
          edgeStroke: strokeColor,
          edgeMarkerColor: strokeColor,
          handshakeStatus: edge.handshake_status,
          isImpacted,
          onSelectEdge: handleSelectEdge,
        },
      });
    });

    // 8. Strict Graph Consistency Verification: Eliminate Detached CIs & Island Subgraphs
    const rawNodes = Array.from(nodeMap.values());
    const rawEdges = Array.from(edgeMap.values());
    const { nodes: connectedNodes, edges: connectedEdges } = getConnectedTopology(
      selectedCIId,
      rawNodes,
      rawEdges
    );

    // 9. Cycle Detection on Connected Graph (Circular Dependency Guard)
    const cycleDetection = detectTopologyCycles(connectedNodes, connectedEdges);

    // 10. Apply Simulation & Cycle Status to Valid Nodes & Edges
    connectedNodes.forEach((node) => {
      const data = node.data as CINodeData;
      const isFailedSource = node.id === simulatedFailedId;
      const isImpacted = simulationResult ? simulationResult.impactedNodeIds.has(node.id) : false;
      const isCycle = cycleDetection.cycleNodeIds.has(node.id);

      let impactDirection: 'upstream' | 'downstream' | 'both' | undefined = undefined;
      if (simulationResult && isImpacted) {
        const isUp = simulationResult.upstreamImpactedNodeIds.has(node.id);
        const isDown = simulationResult.downstreamImpactedNodeIds.has(node.id);
        if (isUp && isDown) impactDirection = 'both';
        else if (isUp) impactDirection = 'upstream';
        else if (isDown) impactDirection = 'downstream';
      }

      data.simulationStatus = isFailedSource
        ? 'failed_source'
        : isImpacted
        ? 'impacted'
        : 'healthy';
      data.simulationImpactDirection = impactDirection;
      data.isSimulatingOutage = Boolean(simulatedFailedId);
      data.isCycle = isCycle;
      data.onSelectNode = handleSelectNode;
    });

    connectedEdges.forEach((edge) => {
      const data = edge.data as DependencyEdgeData;
      const isCycle = cycleDetection.cycleEdgeIds.has(edge.id);
      data.isCycle = isCycle;
      data.onSelectEdge = handleSelectEdge;
      if (isCycle && !data.isImpacted) {
        edge.markerEnd = {
          type: MarkerType.ArrowClosed,
          color: '#b05a00',
          width: 14,
          height: 14,
        };
      }
    });

    // Clean top-to-bottom layout
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      connectedNodes,
      connectedEdges,
      'TB'
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [
    selectedCIId,
    traversalMode,
    depthLimit,
    simulatedFailedId,
    toggleSimulation,
    shouldRenderUpward,
    shouldRenderDownward,
    upwardData,
    downwardData,
    catalog?.items,
    selectedCIDetail,
    relationshipTypes,
    handleSelectNode,
    handleSelectEdge,
    setNodes,
    setEdges,
  ]);

  useEffect(() => {
    buildGraph();
  }, [buildGraph]);

  // Copy on-call incident responder impact summary
  const copyIncidentSummary = () => {
    if (!selectedCIId) return;
    const startCI = catalog?.items.find((i) => i.ci_id === selectedCIId) || selectedCIDetail;
    const isSimulating = Boolean(simulatedFailedId);

    // 1. Gather all tiers from both upstream consumers and downstream dependencies
    const allImpactedTiers: (string | undefined | null)[] = [];

    // Include upward tiers
    if (upwardData?.highest_criticality_tier) {
      allImpactedTiers.push(upwardData.highest_criticality_tier);
    }
    if (upwardData?.nodes) {
      upwardData.nodes.forEach((n) => allImpactedTiers.push(n.criticality_tier));
    }

    // Include downward tiers (crucial: downstream dependencies are impacted!)
    if (downwardData?.nodes) {
      downwardData.nodes.forEach((d) => allImpactedTiers.push(d.ci.criticality_tier));
    }

    // If simulating, also consider any visible nodes marked impacted
    if (isSimulating) {
      nodes.forEach((n) => {
        const d = n.data as CINodeData;
        if (d && (d.simulationStatus === 'impacted' || d.simulationStatus === 'failed_source')) {
          allImpactedTiers.push(d.criticality_tier);
        }
      });
    }

    const highestTier = getHighestCriticalityTier(allImpactedTiers);

    // 2. Upstream consumers
    const upstreamNodes = upwardData?.nodes || [];
    const totalUpstreamImpacted = upstreamNodes.length;

    // 3. Downstream dependencies (they are impacted!)
    const downstreamNodes = downwardData?.nodes || [];
    const totalDownstreamImpacted = downstreamNodes.length;

    // 4. Partition business services & applications across both directions
    const upstreamBizServices = upwardData?.impacted_business_services || [];
    const downstreamBizServices = downstreamNodes
      .filter((d) => d.ci.ci_class === 'business_service')
      .map((d) => d.ci);
    const totalBizServices = upstreamBizServices.length + downstreamBizServices.length;

    const upstreamApps = upwardData?.impacted_applications || [];
    const downstreamApps = downstreamNodes
      .filter((d) => d.ci.ci_class === 'application')
      .map((d) => d.ci);
    const totalApps = upstreamApps.length + downstreamApps.length;

    // 5. Construct Incident Blast Radius Summary
    const summary: string[] = [
      `=== INCIDENT BLAST RADIUS: ${startCI?.name} (${startCI?.ci_class}) ===`,
      `Highest Impacted Tier: ${highestTier}`,
      `Total Upstream Consumers Impacted: ${totalUpstreamImpacted}`,
      `Impacted Business Services (${totalBizServices}):`,
      ...upstreamBizServices.map((s) => ` - [Upstream] ${s.name} (Owner: ${s.ownership?.owner_group_name || 'Unassigned'})`),
      ...downstreamBizServices.map((s) => ` - [Downstream] ${s.name} (Owner: ${s.ownership?.owner_group_name || 'Unassigned'})`),
      `Impacted Applications (${totalApps}):`,
      ...upstreamApps.map((a) => ` - [Upstream] ${a.name} (Contact: ${a.technical_contact || 'None'})`),
      ...downstreamApps.map((a) => ` - [Downstream] ${a.name} (Contact: ${a.technical_contact || 'None'})`),
      `Total Downstream Dependencies Impacted: ${totalDownstreamImpacted}`,
    ];

    if (totalDownstreamImpacted > 0) {
      summary.push(
        `Impacted Downstream Dependencies (${totalDownstreamImpacted}):`,
        ...downstreamNodes.map((d) => {
          const contact = d.ci.technical_contact ? `, Contact: ${d.ci.technical_contact}` : '';
          const owner = d.ci.ownership?.owner_group_name ? `, Owner: ${d.ci.ownership.owner_group_name}` : '';
          return ` - ${d.ci.name} (${d.ci.ci_class}, Tier: ${d.ci.criticality_tier || 'unassigned'}${owner}${contact})`;
        })
      );
    } else {
      summary.push('Downstream Dependencies:', ' (None)');
    }

    navigator.clipboard.writeText(summary.join('\n'));
    setCopiedIncident(true);
    setTimeout(() => setCopiedIncident(false), 2000);
  };

  const selectedCIName = catalog?.items.find((i) => i.ci_id === selectedCIId)?.name || selectedCIDetail?.name || 'Select Service';
  const simulatedFailedName = catalog?.items.find((i) => i.ci_id === simulatedFailedId)?.name || 'Selected Service';

  // Calculate impacted node count during outage simulation
  const totalImpactedServices = useMemo(() => {
    if (!simulatedFailedId) return 0;
    return nodes.filter((n) => (n.data as CINodeData)?.simulationStatus === 'impacted').length;
  }, [simulatedFailedId, nodes]);

  // Group impacted services by criticality tier (T0, T1, T2, T3)
  const impactedByTier = useMemo(() => {
    const groups: { T0: CINodeData[]; T1: CINodeData[]; T2: CINodeData[]; T3: CINodeData[] } = {
      T0: [],
      T1: [],
      T2: [],
      T3: [],
    };
    if (!simulatedFailedId) return groups;

    const impactedNodes = nodes
      .filter((n) => (n.data as CINodeData)?.simulationStatus === 'impacted')
      .map((n) => n.data as CINodeData);

    impactedNodes.forEach((node) => {
      const tier = String(node.criticality_tier || '').toLowerCase();
      if (tier.includes('0')) groups.T0.push(node);
      else if (tier.includes('1')) groups.T1.push(node);
      else if (tier.includes('2')) groups.T2.push(node);
      else groups.T3.push(node);
    });

    return groups;
  }, [simulatedFailedId, nodes]);

  // Count shared single points of failure
  const totalSharedDependencies = useMemo(() => {
    return nodes.filter((n) => (n.data as CINodeData)?.isSharedDependency).length;
  }, [nodes]);

  const totalConnectedNodes = nodes.length;
  const totalConnectedEdges = edges.length;

  return (
    <div className="flex-1 flex flex-col h-full space-y-2.5 animate-in fade-in-50 duration-150">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-2 border-b border-subtle">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-primary">Dependency Topology</h1>
          <p className="text-xs text-secondary mt-0.5">
            Service dependency mapping, circular loop detection, and headline blast radius outage simulation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onNavigateToCatalogCI && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigateToCatalogCI(selectedCIId || '')}
              className="gap-1.5 text-xs cursor-pointer"
            >
              <ExternalLink className="w-3.5 h-3.5 text-muted" />
              <span>Catalog View</span>
            </Button>
          )}
        </div>
      </div>

      {/* Top Controls Bar */}
      <div className="bg-surface border border-hairline p-2.5 rounded-md flex flex-wrap items-center justify-between gap-3 shadow-sm">
        {/* Left: Service Selector & 3 Primary Traversal Modes */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Unified Searchable Combobox */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-primary">Target:</span>
            <div className="relative" ref={comboboxRef}>
              <div
                role="button"
                tabIndex={0}
                onClick={() => setIsComboboxOpen((prev) => !prev)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setIsComboboxOpen((prev) => !prev);
                  }
                }}
                className="h-8 px-2.5 rounded-md border border-control bg-surface hover:bg-hover flex items-center justify-between gap-2 text-xs cursor-pointer min-w-52 max-w-72 shadow-sm focus:outline-none focus:ring-2 focus:ring-accent"
              >
                <div className="flex items-center gap-1.5 truncate">
                  <Search className="w-3.5 h-3.5 text-muted shrink-0" />
                  <span className="font-semibold text-primary truncate">
                    {selectedCIName}
                  </span>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-muted shrink-0" />
              </div>

              {isComboboxOpen && (
                <div className="absolute left-0 mt-1 w-80 bg-surface border border-hairline rounded-md shadow-lg p-2 z-40 space-y-1.5 text-xs animate-in fade-in-50">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-muted absolute left-2 top-2" />
                    <input
                      type="text"
                      autoFocus
                      placeholder="Search services or classes..."
                      value={serviceFilter}
                      onChange={(e) => setServiceFilter(e.target.value)}
                      className="w-full h-7 pl-7 pr-6 rounded border border-control bg-canvas text-xs text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    {serviceFilter && (
                      <button
                        type="button"
                        onClick={() => setServiceFilter('')}
                        className="absolute right-2 top-1.5 text-muted hover:text-primary cursor-pointer text-xs"
                      >
                        ×
                      </button>
                    )}
                  </div>

                  <div className="max-h-60 overflow-y-auto divide-y divide-subtle/50">
                    {filteredServices.length === 0 ? (
                      <div className="p-3 text-center text-muted text-xs">No matching services found</div>
                    ) : (
                      filteredServices.map((ci) => (
                        <button
                          key={ci.ci_id}
                          type="button"
                          onClick={() => {
                            setSelectedCIId(ci.ci_id || null);
                            setIsComboboxOpen(false);
                            setServiceFilter('');
                          }}
                          className={cn(
                            "w-full text-left px-2 py-1.5 rounded flex items-center justify-between gap-2 hover:bg-hover transition-colors cursor-pointer",
                            ci.ci_id === selectedCIId ? "bg-accent/10 text-accent font-semibold" : "text-primary"
                          )}
                        >
                          <div className="min-w-0 truncate">
                            <span className="font-semibold block truncate">{ci.name}</span>
                            <span className="text-3xs text-muted block truncate font-mono">
                              {ci.environment ? ci.environment.toUpperCase() : ''} {ci.criticality_tier ? `• ${ci.criticality_tier}` : ''}
                            </span>
                          </div>
                          <span className="text-3xs uppercase font-mono px-1.5 py-0.5 rounded bg-surface-sunken border border-subtle text-secondary shrink-0">
                            {ci.ci_class}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* The 3 Core Modes: Connected, Upward Impact, Downward */}
          <div className="flex items-center p-0.5 bg-surface-sunken rounded-md border border-subtle">
            <button
              type="button"
              onClick={() => setTraversalMode('connected')}
              className={`px-3 py-1 rounded-sm text-xs font-semibold transition-all cursor-pointer ${
                traversalMode === 'connected'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-secondary hover:text-primary'
              }`}
              title="Full bidirectional dependency topology (both consumers and providers)"
            >
              Full Topology
            </button>
            <button
              type="button"
              onClick={() => setTraversalMode('upward')}
              className={`px-3 py-1 rounded-sm text-xs font-semibold transition-all cursor-pointer ${
                traversalMode === 'upward'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-secondary hover:text-primary'
              }`}
              title="Inspect upstream consumers that depend on this service (blast radius)"
            >
              Upward Impact
            </button>
            <button
              type="button"
              onClick={() => setTraversalMode('downward')}
              className={`px-3 py-1 rounded-sm text-xs font-semibold transition-all cursor-pointer ${
                traversalMode === 'downward'
                  ? 'bg-accent text-white shadow-sm'
                  : 'text-secondary hover:text-primary'
              }`}
              title="Inspect downstream infrastructure and databases supporting this service"
            >
              Downward Dependencies
            </button>
          </div>

          {/* Headline Feature: Outage Simulation Trigger Button */}
          <button
            type="button"
            onClick={() => {
              if (simulatedFailedId) {
                setSimulatedFailedId(null);
              } else if (selectedCIId) {
                setSimulatedFailedId(selectedCIId);
              }
            }}
            className={cn(
              "px-3.5 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border shadow-sm",
              simulatedFailedId
                ? "bg-tier0 text-white border-tier0 ring-2 ring-tier0/40 animate-pulse font-bold"
                : "bg-tier0-bg/60 border-tier0-border text-tier0 hover:bg-tier0 hover:text-white"
            )}
            title="Headline Feature: Turn off this service to simulate an outage and view which services are impacted"
          >
            <Power className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>{simulatedFailedId ? 'Restore Service' : 'Simulate Outage'}</span>
          </button>
        </div>

        {/* Right: Depth, Counts & Incident Copy */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono uppercase text-muted">Depth:</span>
            <input
              type="range"
              aria-label="Topology Traversal Depth"
              min="1"
              max="15"
              value={depthLimit}
              onChange={(e) => setDepthLimit(Number(e.target.value))}
              className="w-16 accent-accent cursor-pointer"
            />
            <span className="text-2xs font-mono text-secondary w-3">{depthLimit}</span>
          </div>

          <label className="flex items-center gap-1.5 text-2xs text-secondary cursor-pointer" title="Include retired configuration items in topology graph">
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={(e) => setIncludeRetired(e.target.checked)}
              className="rounded-sm border-control text-accent focus:ring-accent"
            />
            <span>Show retired</span>
          </label>

          <Button variant="secondary" size="sm" onClick={copyIncidentSummary}>
            {copiedIncident ? (
              <>
                <Check className="w-3.5 h-3.5 mr-1 text-inservice stroke-[1.5]" />
                Copied!
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
                Copy Summary
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Banner 1: Circular Dependency Warning (If any cycle detected) */}
      {cycleResult.hasCycle && (
        <div className="px-3.5 py-2 bg-tier1-bg border border-tier1-border rounded-md flex items-center justify-between text-xs text-tier1 shadow-sm animate-in fade-in-50">
          <div className="flex items-center gap-2 flex-wrap">
            <AlertTriangle className="w-4 h-4 text-tier1 shrink-0" />
            <span className="font-bold uppercase tracking-wider">Circular Dependency Risk:</span>
            <span>
              A cycle was detected in this topology involving{' '}
              <strong>{cycleResult.cycleNodeIds.size} components</strong>:{' '}
              <span className="font-mono text-2xs bg-white/70 px-1.5 py-0.5 rounded border border-tier1-border/40">
                {cycleResult.cycles.map((c) => c.join(' to ')).join(' | ')}
              </span>
            </span>
            <span className="text-muted hidden sm:inline">
              (Circular dependencies risk cascading failures and deployment deadlocks)
            </span>
          </div>
        </div>
      )}

      {/* Banner 2: Live Outage Simulation Alert OR Mode Description */}
      {simulatedFailedId ? (
        <div className="px-3.5 py-2.5 bg-tier0-bg border border-tier0-border rounded-md text-xs text-tier0 shadow-sm animate-in fade-in-50 space-y-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-tier0 animate-ping" />
              <span className="font-bold uppercase tracking-wider">Outage Simulation Active:</span>
              <span>
                <strong>{simulatedFailedName}</strong> is simulated offline.
              </span>
              <span>
                {totalImpactedServices > 0 ? (
                  <span>
                    <strong>
                      {totalImpactedServices} {totalImpactedServices === 1 ? 'service' : 'services'}
                    </strong>{' '}
                    impacted in blast radius.
                  </span>
                ) : (
                  <span>No dependent or downstream components are impacted.</span>
                )}
              </span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              className="h-6 text-xs bg-surface text-tier0 border border-tier0-border hover:bg-tier0-bg cursor-pointer font-semibold"
              onClick={() => setSimulatedFailedId(null)}
            >
              Restore All Services
            </Button>
          </div>

          {/* Criticality tier breakdown */}
          {totalImpactedServices > 0 && (
            <div className="flex items-center gap-3 pt-1 border-t border-tier0-border/40 text-2xs flex-wrap">
              <span className="font-semibold uppercase tracking-wider text-primary">Impact by Tier:</span>
              {(['T0', 'T1', 'T2', 'T3'] as const).map((tierKey) => {
                const list = impactedByTier[tierKey];
                if (!list || list.length === 0) return null;
                return (
                  <div key={tierKey} className="flex items-center gap-1.5 bg-surface/90 px-2 py-0.5 rounded border border-tier0-border/30">
                    <span className="font-bold text-tier0">{tierKey}: {list.length}</span>
                    <span className="text-secondary truncate max-w-[220px]">
                      ({list.map((n) => n.name).join(', ')})
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="px-3 py-1.5 bg-surface-sunken border border-subtle rounded-md flex items-center justify-between text-xs text-secondary">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-primary">{selectedCIName}</span>
            <span className="text-muted">•</span>
            <span>
              {traversalMode === 'connected'
                ? 'Full dependency chain (consumers and providers)'
                : traversalMode === 'upward'
                ? 'Upstream dependents (blast radius if service fails)'
                : 'Downstream dependencies (required providers and databases)'}
            </span>
            {totalSharedDependencies > 0 && (
              <span
                className="px-1.5 py-0.5 rounded bg-tier1-bg border border-tier1-border/40 text-tier1 font-semibold text-3xs flex items-center gap-1"
                title={`${totalSharedDependencies} components in this graph are single points of failure shared by multiple services`}
              >
                <AlertTriangle className="w-3 h-3 text-tier1" />
                <span>{totalSharedDependencies} Shared SPOF{totalSharedDependencies > 1 ? 's' : ''}</span>
              </span>
            )}
            {upwardData?.shared_sibling_dependencies && upwardData.shared_sibling_dependencies.length > 0 && (
              <button
                type="button"
                onClick={() => setIsSiblingDrawerOpen(true)}
                className="flex items-center gap-1 px-2 py-0.5 rounded bg-surface border border-control text-3xs font-medium text-secondary hover:text-accent hover:border-accent transition-colors cursor-pointer ml-1"
                title="Components shared with other services that support the same upstream applications"
                aria-label="View components shared with other services"
              >
                <Server className="w-3 h-3 text-accent" />
                <span>Shared with other services ({upwardData.shared_sibling_dependencies.length})</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {selectedCIId && (
              <button
                type="button"
                onClick={() => toggleSimulation(selectedCIId)}
                className="flex items-center gap-1 text-2xs font-semibold text-accent hover:text-accent-hover cursor-pointer"
                title="Simulate failure of the target service to calculate bidirectional blast radius"
              >
                <Power className="w-3 h-3" />
                <span>Simulate Outage</span>
              </button>
            )}
            <div className="text-3xs font-mono text-muted hidden sm:inline">
              <span className="font-semibold text-primary">{totalConnectedNodes}</span> Services &bull;{' '}
              <span className="font-semibold text-primary">{totalConnectedEdges}</span> Relations
            </div>
          </div>
        </div>
      )}

      {/* Main Graph Canvas Area */}
      <div className="flex-1 min-h-[520px] bg-canvas border border-hairline rounded-md relative overflow-hidden">
        {upwardLoading || downwardLoading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-canvas/80 text-xs text-secondary">
            <Activity className="w-4 h-4 mr-2 animate-spin text-accent" />
            Loading topology...
          </div>
        ) : null}

        {/* Selected Edge Inspector Toolbar */}
        {selectedEdge ? (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 px-4 py-2 bg-surface border border-subtle rounded-md shadow-lg flex items-center gap-3 text-xs animate-in fade-in-50 max-w-2xl flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-primary font-mono">{String(selectedEdge.data?.consumerName || '')}</span>
              <span className="px-2 py-0.5 rounded-full bg-accent/10 border border-accent/20 text-accent font-semibold text-2xs">
                {String(selectedEdge.data?.edgeLabel || (selectedEdge.data?.edgeType as string || 'depends_on').replace(/_/g, ' '))}
              </span>
              <span className="font-bold text-primary font-mono">{String(selectedEdge.data?.providerName || '')}</span>
            </div>

            <div className="flex items-center gap-1.5 border-l border-subtle pl-2">
              {selectedEdge.data?.handshakeStatus === 'confirmed' ? (
                <span className="text-3xs font-semibold uppercase tracking-wider text-inservice bg-accent/10 px-1.5 py-0.5 rounded border border-inservice/20">
                  Confirmed
                </span>
              ) : selectedEdge.data?.handshakeStatus === 'pending_confirmation' ? (
                <span className="text-3xs font-semibold uppercase tracking-wider text-tier1 bg-tier1-bg px-1.5 py-0.5 rounded border border-tier1-border">
                  Pending Confirmation
                </span>
              ) : selectedEdge.data?.handshakeStatus === 'flagged_mismatch' ? (
                <span className="text-3xs font-semibold uppercase tracking-wider text-tier0 bg-tier0-bg px-1.5 py-0.5 rounded border border-tier0-border">
                  Flagged Mismatch
                </span>
              ) : (
                <span className="text-3xs font-semibold uppercase tracking-wider text-muted bg-surface-sunken px-1.5 py-0.5 rounded">
                  {String(selectedEdge.data?.handshakeStatus || 'Unknown')}
                </span>
              )}

              {/* Edge Handshake Quick Confirm */}
              {selectedEdge.data?.handshakeStatus === 'pending_confirmation' && (
                <>
                  <Button
                    size="sm"
                    variant="primary"
                    className="h-6 text-2xs px-2 cursor-pointer gap-1"
                    onClick={() => {
                      confirmEdgeMutation.mutate(selectedEdge.id, {
                        onSuccess: () => setSelectedEdgeId(null),
                      });
                    }}
                    title="Confirm cross-boundary dependency handshake"
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Confirm</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-2xs px-2 cursor-pointer gap-1 text-tier1 hover:border-tier1 hover:bg-tier1-bg"
                    onClick={() => {
                      const reason = window.prompt('Reason for flagging dependency mismatch:');
                      if (reason && reason.trim()) {
                        flagMismatchEdgeMutation.mutate(
                          { edgeId: selectedEdge.id, reason: reason.trim() },
                          { onSuccess: () => setSelectedEdgeId(null) }
                        );
                      }
                    }}
                    title="Flag cross-boundary dependency mismatch"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    <span>Flag Mismatch</span>
                  </Button>
                </>
              )}

              {/* Soft Disconnect Edge */}
              <Button
                size="sm"
                variant="outline"
                className="h-6 text-2xs px-2 cursor-pointer gap-1 text-muted hover:text-tier0 hover:border-tier0 hover:bg-tier0-bg"
                onClick={() => {
                  if (window.confirm(`Disconnect relationship "${selectedEdge.data?.consumerName} to ${selectedEdge.data?.providerName}"?`)) {
                    deleteEdgeMutation.mutate(selectedEdge.id, {
                      onSuccess: () => setSelectedEdgeId(null),
                    });
                  }
                }}
                title="Soft-disconnect this dependency edge with an audit trail"
              >
                <Trash2 className="w-3 h-3" />
                <span>Disconnect</span>
              </Button>
            </div>

            <button
              type="button"
              onClick={() => setSelectedEdgeId(null)}
              aria-label="Close relationship details"
              className="text-muted hover:text-primary ml-1 cursor-pointer p-0.5"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null}

        {/* Selected Node Right Side Panel */}
        {selectedNode && (
          <div className="absolute right-0 top-0 bottom-0 w-80 bg-surface border-l border-hairline shadow-xl z-30 flex flex-col p-4 animate-in slide-in-from-right duration-150">
            <div className="flex items-start justify-between pb-3 border-b border-subtle">
              <div className="min-w-0 pr-2">
                <span className="text-3xs font-semibold uppercase tracking-wider text-muted">Component Details</span>
                <h3 className="text-sm font-semibold text-primary font-mono mt-0.5 truncate" title={String(selectedNode.data?.name || '')}>
                  {String(selectedNode.data?.name || '')}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedNodeId(null)}
                aria-label="Close component details"
                className="text-muted hover:text-primary cursor-pointer p-1 rounded hover:bg-hover shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-3 space-y-4 text-xs">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-secondary text-2xs">Class</span>
                  <span className="font-mono text-primary font-semibold text-2xs uppercase">
                    {String(selectedNode.data?.ci_class || 'CI').replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-secondary text-2xs">Tier</span>
                  <span className="text-2xs font-semibold px-1.5 py-0.5 rounded bg-surface-sunken border border-subtle text-primary">
                    {String(selectedNode.data?.criticality_tier || 'T2').toUpperCase().replace('TIER_', 'T')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-secondary text-2xs">Environment</span>
                  <span className="text-2xs font-mono text-muted uppercase">
                    {String(selectedNode.data?.environment || 'prod')}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-secondary text-2xs">Topology Role</span>
                  <span className="text-2xs font-semibold uppercase px-1.5 py-0.5 rounded bg-surface-sunken text-secondary">
                    {String(selectedNode.data?.roleInTopology || 'CI')}
                  </span>
                </div>
              </div>

              {/* Status and Topology Flags */}
              <div className="space-y-1.5 pt-2 border-t border-subtle">
                <span className="text-3xs font-semibold uppercase tracking-wider text-muted">Analysis</span>
                {Boolean(selectedNode.data?.isSharedDependency) && (
                  <div className="p-2 rounded bg-tier1-bg border border-tier1-border text-tier1 text-2xs flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Single point of failure (shared across multiple services).</span>
                  </div>
                )}
                {Boolean(selectedNode.data?.isCycle) && (
                  <div className="p-2 rounded bg-tier1-bg border border-tier1-border text-tier1 text-2xs flex items-start gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Involved in a circular dependency loop.</span>
                  </div>
                )}
                {selectedNode.data?.simulationStatus === 'failed_source' ? (
                  <div className="p-2 rounded bg-tier0-bg border border-tier0-border text-tier0 text-2xs font-semibold flex items-center gap-1.5">
                    <Power className="w-3.5 h-3.5 shrink-0" />
                    <span>Simulated Outage Origin</span>
                  </div>
                ) : selectedNode.data?.simulationStatus === 'impacted' ? (
                  <div className="p-2 rounded bg-tier0-bg border border-tier0-border text-tier0 text-2xs flex items-start gap-1.5">
                    <Activity className="w-3.5 h-3.5 shrink-0 mt-0.5 text-tier0" />
                    <span>Impacted by simulated outage cascade.</span>
                  </div>
                ) : (
                  <div className="p-2 rounded bg-surface-sunken border border-subtle text-muted text-2xs">
                    Normal operational state in active topology.
                  </div>
                )}
              </div>
            </div>

            {/* Panel Actions */}
            <div className="pt-3 border-t border-subtle space-y-2">
              {selectedNode.id !== selectedCIId && (
                <Button
                  variant="primary"
                  size="sm"
                  className="w-full text-xs justify-center cursor-pointer gap-1.5"
                  onClick={() => {
                    setSelectedCIId(selectedNode.id);
                    setSelectedNodeId(null);
                  }}
                  title="Pivot graph topology around this configuration item"
                >
                  <Network className="w-3.5 h-3.5" />
                  <span>Set as Target</span>
                </Button>
              )}
              {onNavigateToCatalogCI && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs justify-center cursor-pointer gap-1.5"
                  onClick={() => {
                    onNavigateToCatalogCI(selectedNode.id);
                    setSelectedNodeId(null);
                  }}
                  title="Inspect configuration item details in catalog"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-muted" />
                  <span>Open in Catalog</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className={`w-full text-xs justify-center cursor-pointer gap-1.5 ${
                  simulatedFailedId === selectedNode.id
                    ? 'bg-tier0 text-white border-tier0 hover:bg-tier0/90'
                    : 'text-secondary hover:text-tier0 hover:border-tier0'
                }`}
                onClick={() => {
                  toggleSimulation(selectedNode.id);
                }}
                title="Toggle outage simulation for this service"
              >
                <Power className="w-3.5 h-3.5" />
                <span>{simulatedFailedId === selectedNode.id ? 'Restore Service' : 'Simulate Outage'}</span>
              </Button>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => {
            setSelectedNodeId(node.id);
            setSelectedEdgeId(null);
          }}
          onEdgeClick={(_, edge) => {
            setSelectedEdgeId(edge.id);
            setSelectedNodeId(null);
          }}
          onNodeDoubleClick={(_, node) => {
            setSelectedCIId(node.id);
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          onPaneClick={() => {
            setSelectedNodeId(null);
            setSelectedEdgeId(null);
          }}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          className="bg-canvas"
        >
          {/* Fit view only on target, mode, or topology size changes — not on outage simulation toggles */}
          <GraphAutoFitter triggerKey={`${selectedCIId}-${traversalMode}-${nodes.length}`} />
          <Background color="#cbd5e1" gap={20} size={1} />
          <Controls
            position="top-left"
            className="bg-surface border border-subtle shadow-sm"
            aria-label="Viewport zoom, fit-view, and interactive lock controls"
          />
          {nodes.length > 0 && (
            <MiniMap
              className="bg-surface border border-hairline rounded-md overflow-hidden shadow-sm"
              nodeColor={(n) => (n.id === selectedCIId ? '#00845c' : '#94a3b8')}
              maskColor="rgba(241, 245, 249, 0.7)"
            />
          )}
        </ReactFlow>

        {/* Canvas Legend */}
        {nodes.length > 0 && (
          <div className="absolute bottom-4 left-4 z-10 bg-surface/90 backdrop-blur-xs border border-subtle rounded-md p-2.5 text-2xs space-y-1.5 shadow-sm max-w-[210px] pointer-events-none select-none">
            <div className="font-semibold text-primary uppercase tracking-wider text-3xs">Legend</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-4 h-0.5 bg-neutral-500 inline-block" />
                <span className="text-secondary text-3xs">Confirmed relation</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 border-b border-dashed border-neutral-500 inline-block" />
                <span className="text-secondary text-3xs">Pending approval</span>
              </div>
            </div>
            <div className="pt-1 border-t border-subtle space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: '#7c3aed' }} />
                <span className="text-secondary text-3xs">hosted on</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: '#0d9488' }} />
                <span className="text-secondary text-3xs">reads from</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: '#cf222e' }} />
                <span className="text-secondary text-3xs">writes to</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: '#00845c' }} />
                <span className="text-secondary text-3xs">connects to</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ backgroundColor: '#57606a' }} />
                <span className="text-secondary text-3xs">depends on</span>
              </div>
            </div>
          </div>
        )}

        {/* Empty States on Graph Canvas */}
        {!upwardLoading && !downwardLoading && nodes.length === 0 && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center p-6 text-center bg-canvas/90 backdrop-blur-[1px]">
            {!catalog?.items || catalog.items.length === 0 ? (
              <div className="max-w-md mx-auto space-y-3">
                <div className="w-12 h-12 mx-auto rounded-full bg-surface-sunken border border-subtle flex items-center justify-center text-muted">
                  <Boxes className="w-6 h-6 text-accent stroke-[1.5]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-primary">No Configuration Items Registered</h3>
                  <p className="text-xs text-secondary mt-1">
                    The topology graph requires registered configuration items and dependency relationships to visualize blast radius trees.
                  </p>
                </div>
                {onNavigateToCatalogCI && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => onNavigateToCatalogCI('')}
                    className="gap-1.5 text-xs cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Create or Import CIs</span>
                  </Button>
                )}
              </div>
            ) : (
              <div className="max-w-md mx-auto space-y-3">
                <div className="w-12 h-12 mx-auto rounded-full bg-surface-sunken border border-subtle flex items-center justify-center text-muted">
                  <Network className="w-6 h-6 text-accent stroke-[1.5]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-primary">Select a Service to Inspect Dependencies</h3>
                  <p className="text-xs text-secondary mt-1">
                    Choose a service from the Target dropdown above to explore upstream consumers, downstream infrastructure, and simulate outage blast radiuses.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                  {catalog.items.slice(0, 4).map((ci) => (
                    <Button
                      key={ci.ci_id}
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedCIId(ci.ci_id || null)}
                      className="text-xs gap-1.5 cursor-pointer bg-surface hover:bg-hover"
                    >
                      <span className="font-semibold text-primary">{ci.name}</span>
                      <span className="text-3xs font-mono text-muted uppercase">({ci.ci_class})</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Modal: Sibling Infrastructure Dialog */}
      <Dialog open={isSiblingDrawerOpen} onOpenChange={setIsSiblingDrawerOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold flex items-center gap-2">
              <Server className="w-4 h-4 text-accent" />
              <span>Sibling Infrastructure Components</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-secondary">
              Shared infrastructure components supporting the same upstream applications.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 max-h-80 overflow-y-auto mt-2">
            {(upwardData?.shared_sibling_dependencies || []).map((sib) => (
              <div
                key={sib.ci_id || sib.name}
                className="p-3 rounded-md border border-subtle bg-surface-sunken flex items-center justify-between gap-3 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="font-mono font-semibold text-primary truncate flex items-center gap-2">
                    <span>{sib.name}</span>
                    <span className="text-3xs uppercase font-sans px-1 py-0.5 rounded bg-surface border border-subtle text-secondary">
                      {sib.ci_class?.replace('_', ' ')}
                    </span>
                  </div>
                  <div className="text-3xs text-muted truncate mt-0.5">
                    {sib.environment?.toUpperCase()} &bull; Tier: {sib.criticality_tier} &bull; Owner: {sib.ownership?.owner_group_name || 'Platform Engineering'}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2.5 cursor-pointer gap-1"
                    onClick={() => {
                      if (sib.ci_id) {
                        setSelectedCIId(sib.ci_id);
                        setIsSiblingDrawerOpen(false);
                      }
                    }}
                    title="Center graph topology on this sibling"
                  >
                    <Network className="w-3 h-3" />
                    <span>View Graph</span>
                  </Button>
                  {onNavigateToCatalogCI && (
                    <Button
                      size="sm"
                      variant="primary"
                      className="h-7 text-xs px-2.5 cursor-pointer gap-1"
                      onClick={() => {
                        if (sib.ci_id) {
                          onNavigateToCatalogCI(sib.ci_id);
                          setIsSiblingDrawerOpen(false);
                        }
                      }}
                      title="Inspect full details in catalog"
                    >
                      <span>Inspect</span>
                      <ArrowRight className="w-3 h-3" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
