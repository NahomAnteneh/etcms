import { useState, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  MarkerType,
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
} from 'lucide-react';
import { useCICatalog, useUpwardImpact, useDownwardDependencies } from '../../api/endpoints';
import { CriticalityChip } from '../../components/governance/criticality-chip';
import { Button } from '../../components/ui/button';

interface GraphViewProps {
  initialCIId?: string | null;
}

// Custom Node Component per DESIGN.md:
// "Nodes are white with a border-hairline edge and a 3px leading rule in the tier color;
// The selected node uses the accent ring."
function CINodeComponent({ data }: { data: any }) {
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

  const tierBorderClasses = {
    tier_0: 'border-l-[3px] border-l-tier0',
    tier_1: 'border-l-[3px] border-l-tier1',
    tier_2: 'border-l-[3px] border-l-tier2',
    tier_3: 'border-l-[3px] border-l-tier3',
  };

  const tierClass = tierBorderClasses[data.criticality_tier as keyof typeof tierBorderClasses] || tierBorderClasses.tier_2;

  return (
    <div
      className={`px-3.5 py-2.5 rounded-md border bg-surface min-w-52 select-none transition-colors ${tierClass} ${
        isTarget
          ? 'border-accent ring-2 ring-accent'
          : 'border-hairline hover:border-control'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="p-1 rounded-sm bg-surface-sunken border border-subtle text-secondary">
            <Icon className="w-3 h-3 stroke-[1.5]" />
          </div>
          <span className="text-3xs font-mono uppercase text-muted">
            {data.ci_class?.replace('_', ' ') || 'CI'}
          </span>
        </div>
        <CriticalityChip tier={data.criticality_tier || 'tier_2'} showLabel={false} />
      </div>

      <div className="font-semibold text-xs text-primary truncate max-w-44 mb-1">
        {data.name}
      </div>

      <div className="flex items-center justify-between text-3xs font-mono text-muted pt-1 border-t border-subtle">
        <span className="truncate max-w-28">{data.owner_group_name || 'System'}</span>
        <span className="uppercase text-secondary">{data.environment || 'PROD'}</span>
      </div>
    </div>
  );
}

const nodeTypes = {
  ciNode: CINodeComponent,
};

// Dagre Layout Algorithm
function getLayoutedElements(nodes: Node[], edges: Edge[], direction = 'TB') {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ rankdir: direction, nodesep: 60, ranksep: 80 });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: 220, height: 80 });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 110,
        y: nodeWithPosition.y - 40,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}

export function GraphView({ initialCIId }: GraphViewProps) {
  const { data: catalog } = useCICatalog();
  const [selectedCIId, setSelectedCIId] = useState<string | null>(initialCIId || null);
  const [traversalMode, setTraversalMode] = useState<'upward' | 'downward'>('upward');
  const [depthLimit, setDepthLimit] = useState<number>(5);
  const [includeRetired, setIncludeRetired] = useState<boolean>(false);
  const [copiedIncident, setCopiedIncident] = useState(false);

  // Default to first database or app if no initial ID
  useEffect(() => {
    if (!selectedCIId && catalog?.items && catalog.items.length > 0) {
      const preferred = catalog.items.find((i) => i.ci_class === 'database') || catalog.items[0];
      setSelectedCIId(preferred.ci_id || null);
    }
  }, [catalog?.items, selectedCIId]);

  const { data: upwardData, isLoading: upwardLoading } = useUpwardImpact(
    traversalMode === 'upward' ? selectedCIId : null
  );

  const { data: downwardData, isLoading: downwardLoading } = useDownwardDependencies(
    traversalMode === 'downward' ? selectedCIId : null
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Synchronize Graph Nodes and Directed Edges (Consumer -> Provider)
  const buildGraph = useCallback(() => {
    if (!selectedCIId || !catalog?.items) return;

    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    const rootCI = catalog.items.find((i) => i.ci_id === selectedCIId);
    if (!rootCI) return;

    // Add Root Target Node
    rawNodes.push({
      id: rootCI.ci_id!,
      type: 'ciNode',
      data: {
        name: rootCI.name,
        ci_class: rootCI.ci_class,
        criticality_tier: rootCI.criticality_tier,
        environment: rootCI.environment,
        owner_group_name: rootCI.ownership?.owner_group_name || 'System',
        isTarget: true,
      },
      position: { x: 0, y: 0 },
    });

    if (traversalMode === 'upward' && upwardData) {
      (upwardData.nodes || [])
        .filter((node) => node.ci_id && node.ci_id !== selectedCIId)
        .forEach((node) => {
          rawNodes.push({
            id: node.ci_id!,
            type: 'ciNode',
            data: {
              name: node.name,
              ci_class: node.ci_class,
              criticality_tier: node.criticality_tier,
              environment: node.environment,
              owner_group_name: node.ownership?.owner_group_name || 'System',
              isTarget: false,
            },
            position: { x: 0, y: 0 },
          });
        });

      upwardData.edges.forEach((edge) => {
        rawEdges.push({
          id: edge.id,
          source: edge.source_ci_id, // Consumer
          target: edge.target_ci_id, // Provider
          label: edge.edge_type.replace('_', ' '),
          animated: edge.handshake_status === 'pending_confirmation',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#5f6877' },
          style: { stroke: '#5f6877', strokeWidth: 1.5 },
          labelStyle: { fill: '#4b5563', fontSize: 10, fontFamily: 'monospace' },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
        });
      });
    } else if (traversalMode === 'downward' && downwardData) {
      downwardData.nodes
        .filter((node) => node.depth <= depthLimit && node.ci.ci_id !== selectedCIId && node.ci.ci_id)
        .forEach((node) => {
          rawNodes.push({
            id: node.ci.ci_id!,
            type: 'ciNode',
            data: {
              name: node.ci.name,
              ci_class: node.ci.ci_class,
              criticality_tier: node.ci.criticality_tier,
              environment: node.ci.environment,
              owner_group_name: node.ci.ownership?.owner_group_name || 'System',
              isTarget: false,
            },
            position: { x: 0, y: 0 },
          });
        });

      downwardData.edges.forEach((edge) => {
        rawEdges.push({
          id: edge.id,
          source: edge.source_ci_id,
          target: edge.target_ci_id,
          label: edge.edge_type.replace('_', ' '),
          animated: edge.handshake_status === 'pending_confirmation',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#5f6877' },
          style: { stroke: '#5f6877', strokeWidth: 1.5 },
          labelStyle: { fill: '#4b5563', fontSize: 10, fontFamily: 'monospace' },
          labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
        });
      });
    }

    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      rawNodes,
      rawEdges,
      traversalMode === 'upward' ? 'BT' : 'TB'
    );

    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [selectedCIId, traversalMode, depthLimit, upwardData, downwardData, catalog?.items, setNodes, setEdges]);

  useEffect(() => {
    buildGraph();
  }, [buildGraph]);

  // Copy on-call incident responder impact summary
  const copyIncidentSummary = () => {
    if (!upwardData || !selectedCIId) return;
    const startCI = catalog?.items.find((i) => i.ci_id === selectedCIId);
    const summary = [
      `=== INCIDENT BLAST RADIUS: ${startCI?.name} (${startCI?.ci_class}) ===`,
      `Highest Impacted Tier: ${(upwardData.highest_criticality_tier || 'NONE').toUpperCase()}`,
      `Total Upstream Consumers Impacted: ${upwardData.nodes?.length || 0}`,
      `Impacted Business Services (${upwardData.impacted_business_services.length}):`,
      ...upwardData.impacted_business_services.map((s) => ` - ${s.name} (Owner: ${s.ownership?.owner_group_name})`),
      `Impacted Applications (${upwardData.impacted_applications.length}):`,
      ...upwardData.impacted_applications.map((a) => ` - ${a.name} (Contact: ${a.technical_contact})`),
    ].join('\n');

    navigator.clipboard.writeText(summary);
    setCopiedIncident(true);
    setTimeout(() => setCopiedIncident(false), 2000);
  };

  const selectedCIName = catalog?.items.find((i) => i.ci_id === selectedCIId)?.name || 'Select CI';

  return (
    <div className="flex-1 flex flex-col h-full space-y-3 animate-in fade-in-50 duration-150">
      {/* Top Controls Bar */}
      <div className="bg-surface border border-hairline p-3 rounded-md flex flex-wrap items-center justify-between gap-3">
        {/* Left: CI Selector & Mode Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono uppercase text-muted">Target CI:</span>
            <select
              value={selectedCIId || ''}
              onChange={(e) => setSelectedCIId(e.target.value)}
              className="h-8 rounded-md border border-control bg-surface px-2.5 text-xs text-primary font-medium focus:outline-none focus:ring-2 focus:ring-accent max-w-64 truncate"
            >
              {catalog?.items.map((ci) => (
                <option key={ci.ci_id} value={ci.ci_id}>
                  {ci.name} ({ci.ci_class})
                </option>
              ))}
            </select>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center p-0.5 bg-surface-sunken rounded-md border border-subtle text-xs">
            <button
              onClick={() => setTraversalMode('upward')}
              className={`px-3 py-1 rounded-sm text-2xs font-medium transition-colors cursor-pointer ${
                traversalMode === 'upward'
                  ? 'bg-accent text-white font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              Upward Impact (Blast Radius)
            </button>
            <button
              onClick={() => setTraversalMode('downward')}
              className={`px-3 py-1 rounded-sm text-2xs font-medium transition-colors cursor-pointer ${
                traversalMode === 'downward'
                  ? 'bg-accent text-white font-semibold'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              Downward Dependencies
            </button>
          </div>
        </div>

        {/* Right: Depth Tier Slider & Incident Copy */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono uppercase text-muted">Max Depth:</span>
            <input
              type="range"
              min="1"
              max="15"
              value={depthLimit}
              onChange={(e) => setDepthLimit(Number(e.target.value))}
              className="w-24 accent-accent cursor-pointer"
            />
            <span className="text-2xs font-mono text-secondary w-4">{depthLimit}</span>
          </div>

          <label className="flex items-center gap-1.5 text-2xs text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={(e) => setIncludeRetired(e.target.checked)}
              className="rounded-sm border-control text-accent"
            />
            <span>Include Retired</span>
          </label>

          {traversalMode === 'upward' && (
            <Button variant="secondary" size="sm" onClick={copyIncidentSummary}>
              {copiedIncident ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1 text-inservice stroke-[1.5]" />
                  Copied Blast Radius!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
                  Copy Incident Summary
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Main Visualizer Canvas Area */}
      <div className="flex-1 min-h-[500px] bg-canvas border border-hairline rounded-md relative overflow-hidden">
        {upwardLoading || downwardLoading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-canvas/80 text-xs text-secondary">
            Calculating cycle-safe graph traversal...
          </div>
        ) : null}

        {/* Blast Radius Summary Banner (Upward Mode) */}
        {traversalMode === 'upward' && upwardData && (
          <div className="absolute top-3 left-3 z-10 p-3 bg-surface border border-hairline rounded-md shadow-[0_4px_12px_rgba(16,24,40,0.10)] max-w-sm space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-mono uppercase text-muted font-semibold">
                Blast Radius Telemetry
              </span>
              <CriticalityChip tier={upwardData.highest_criticality_tier || 'tier_2'} />
            </div>
            <div className="text-xs text-secondary">
              Target: <span className="font-semibold text-primary">{selectedCIName}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-2xs pt-1 border-t border-subtle">
              <div>
                <span className="text-muted">Impacted Biz Services:</span>
                <span className="font-semibold text-primary ml-1">
                  {upwardData.impacted_business_services.length}
                </span>
              </div>
              <div>
                <span className="text-muted">Impacted Apps:</span>
                <span className="font-semibold text-primary ml-1">
                  {upwardData.impacted_applications.length}
                </span>
              </div>
            </div>
          </div>
        )}

        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          fitView
          className="bg-canvas"
        >
          <Background color="#d3d8e0" gap={18} size={1} />
          <Controls className="bg-surface border border-subtle" />
          <MiniMap
            className="bg-surface border border-hairline rounded-md overflow-hidden"
            nodeColor="#ffffff"
            maskColor="rgba(246, 247, 249, 0.7)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
