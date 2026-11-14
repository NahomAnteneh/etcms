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

// Custom Node Component
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

  return (
    <div
      className={`px-3.5 py-2.5 rounded-lg border shadow-lg transition-all min-w-52 backdrop-blur-md select-none ${
        isTarget
          ? 'bg-blue-950/90 border-blue-500 shadow-blue-900/40 ring-2 ring-blue-500/50'
          : 'bg-obsidian-850/90 border-obsidian-700 hover:border-obsidian-500 shadow-obsidian-950/80'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <div className="p-1 rounded bg-obsidian-900 border border-obsidian-750 text-obsidian-300">
            <Icon className="w-3 h-3" />
          </div>
          <span className="text-3xs font-mono uppercase text-obsidian-400">
            {data.ci_class?.replace('_', ' ') || 'CI'}
          </span>
        </div>
        <CriticalityChip tier={data.criticality_tier || 'tier_2'} showLabel={false} />
      </div>

      <div className="font-semibold text-xs text-white truncate max-w-44 mb-1">
        {data.name}
      </div>

      <div className="flex items-center justify-between text-3xs font-mono text-obsidian-400 pt-1 border-t border-obsidian-800">
        <span className="truncate max-w-28">{data.owner_group_name || 'System'}</span>
        <span className="uppercase text-obsidian-300">{data.environment || 'PROD'}</span>
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
  const [selectedCIId, setSelectedCIId] = useState<string | null>(initialCIId || null);
  const [traversalMode, setTraversalMode] = useState<'upward' | 'downward'>('upward');
  const [depthLimit, setDepthLimit] = useState<number>(15);
  const [includeRetired, setIncludeRetired] = useState<boolean>(false);
  const [copiedIncident, setCopiedIncident] = useState(false);

  const { data: catalog } = useCICatalog();
  const { data: upwardData, isLoading: upwardLoading } = useUpwardImpact(
    traversalMode === 'upward' ? selectedCIId : null,
    includeRetired
  );
  const { data: downwardData, isLoading: downwardLoading } = useDownwardDependencies(
    traversalMode === 'downward' ? selectedCIId : null,
    includeRetired
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Default to first CI if none selected
  useEffect(() => {
    if (!selectedCIId && catalog?.items && catalog.items.length > 0 && catalog.items[0].ci_id) {
      setSelectedCIId(catalog.items[0].ci_id);
    }
  }, [catalog?.items, selectedCIId]);

  // Construct and Layout Graph Elements
  const buildGraph = useCallback(() => {
    if (!selectedCIId) return;

    const rawNodes: Node[] = [];
    const rawEdges: Edge[] = [];

    const startCI = catalog?.items.find((item) => item.ci_id === selectedCIId);
    if (startCI && startCI.ci_id) {
      rawNodes.push({
        id: startCI.ci_id,
        type: 'ciNode',
        data: {
          name: startCI.name,
          ci_class: startCI.ci_class,
          criticality_tier: startCI.criticality_tier,
          environment: startCI.environment,
          owner_group_name: startCI.ownership?.owner_group_name || 'System',
          isTarget: true,
        },
        position: { x: 0, y: 0 },
      });
    }

    if (traversalMode === 'upward' && upwardData) {
      const upNodes = upwardData.nodes || [];
      upNodes
        .filter((node) => node.ci_id !== selectedCIId && node.ci_id)
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
          markerEnd: { type: MarkerType.ArrowClosed, color: '#3b82f6' },
          style: { stroke: '#3b82f6', strokeWidth: 1.5 },
          labelStyle: { fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' },
          labelBgStyle: { fill: '#090d16', fillOpacity: 0.8 },
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
          markerEnd: { type: MarkerType.ArrowClosed, color: '#10b981' },
          style: { stroke: '#10b981', strokeWidth: 1.5 },
          labelStyle: { fill: '#9ca3af', fontSize: 10, fontFamily: 'monospace' },
          labelBgStyle: { fill: '#090d16', fillOpacity: 0.8 },
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
      <div className="bg-obsidian-850/80 border border-obsidian-750 p-3 rounded-lg flex flex-wrap items-center justify-between gap-3 shadow-sm">
        {/* Left: CI Selector & Mode Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono uppercase text-obsidian-400">Target CI:</span>
            <select
              value={selectedCIId || ''}
              onChange={(e) => setSelectedCIId(e.target.value)}
              className="h-8 rounded border border-obsidian-700 bg-obsidian-950 px-2.5 text-xs text-white font-medium focus:outline-none focus:ring-1 focus:ring-blue-500 max-w-64 truncate"
            >
              {catalog?.items.map((ci) => (
                <option key={ci.ci_id} value={ci.ci_id}>
                  {ci.name} ({ci.ci_class})
                </option>
              ))}
            </select>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center p-0.5 bg-obsidian-950 rounded border border-obsidian-750 text-xs">
            <button
              onClick={() => setTraversalMode('upward')}
              className={`px-3 py-1 rounded text-2xs font-medium transition-colors ${
                traversalMode === 'upward'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-obsidian-400 hover:text-white'
              }`}
            >
              Upward Impact (Blast Radius)
            </button>
            <button
              onClick={() => setTraversalMode('downward')}
              className={`px-3 py-1 rounded text-2xs font-medium transition-colors ${
                traversalMode === 'downward'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-obsidian-400 hover:text-white'
              }`}
            >
              Downward Dependencies
            </button>
          </div>
        </div>

        {/* Right: Depth Tier Slider & Incident Copy */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-2xs font-mono uppercase text-obsidian-400">Max Depth:</span>
            <input
              type="range"
              min="1"
              max="15"
              value={depthLimit}
              onChange={(e) => setDepthLimit(Number(e.target.value))}
              className="w-24 accent-blue-500 cursor-pointer"
            />
            <span className="text-2xs font-mono text-obsidian-200 w-4">{depthLimit}</span>
          </div>

          <label className="flex items-center gap-1.5 text-2xs text-obsidian-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeRetired}
              onChange={(e) => setIncludeRetired(e.target.checked)}
              className="rounded border-obsidian-700 bg-obsidian-950 text-blue-500"
            />
            <span>Include Retired</span>
          </label>

          {traversalMode === 'upward' && (
            <Button variant="secondary" size="sm" onClick={copyIncidentSummary}>
              {copiedIncident ? (
                <>
                  <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" />
                  Copied Blast Radius!
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 mr-1" />
                  Copy Incident Summary
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Main Visualizer Canvas Area */}
      <div className="flex-1 min-h-[500px] bg-obsidian-950/80 border border-obsidian-750 rounded-lg relative overflow-hidden shadow-inner">
        {upwardLoading || downwardLoading ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-obsidian-950/60 backdrop-blur-2xs text-xs text-obsidian-300">
            Calculating cycle-safe graph traversal...
          </div>
        ) : null}

        {/* Blast Radius Summary Banner (Upward Mode) */}
        {traversalMode === 'upward' && upwardData && (
          <div className="absolute top-3 left-3 z-10 p-3 bg-obsidian-900/90 border border-obsidian-700 rounded-lg shadow-xl backdrop-blur-md max-w-sm space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-2xs font-mono uppercase text-obsidian-400 font-semibold">
                Blast Radius Telemetry
              </span>
              <CriticalityChip tier={upwardData.highest_criticality_tier || 'tier_2'} />
            </div>
            <div className="text-xs text-obsidian-200">
              Target: <span className="font-semibold text-white">{selectedCIName}</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-2xs pt-1 border-t border-obsidian-800">
              <div>
                <span className="text-obsidian-400">Impacted Biz Services:</span>
                <span className="font-bold text-white ml-1">
                  {upwardData.impacted_business_services.length}
                </span>
              </div>
              <div>
                <span className="text-obsidian-400">Impacted Apps:</span>
                <span className="font-bold text-white ml-1">
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
          className="bg-obsidian-950"
        >
          <Background color="#1f2937" gap={18} size={1} />
          <Controls className="bg-obsidian-850 border border-obsidian-700 fill-obsidian-200 text-obsidian-200" />
          <MiniMap
            className="bg-obsidian-900/90 border border-obsidian-700 rounded overflow-hidden"
            nodeColor="#374151"
            maskColor="rgba(9, 13, 22, 0.7)"
          />
        </ReactFlow>
      </div>
    </div>
  );
}
