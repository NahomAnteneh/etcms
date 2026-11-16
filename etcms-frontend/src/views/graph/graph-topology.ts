export interface TopologyNode {
  id: string;
  [key: string]: unknown;
}

export interface TopologyEdge {
  id?: string;
  source: string;
  target: string;
  [key: string]: unknown;
}

/**
 * Prunes any node and edge that does not belong to the connected component of rootTargetId.
 * Guarantees zero detached CIs and zero floating island subgraphs.
 * Also prunes self-loops (source === target) to prevent layout engine crashes.
 */
export function getConnectedTopology<N extends TopologyNode, E extends TopologyEdge>(
  rootTargetId: string,
  nodes: N[],
  edges: E[]
): { nodes: N[]; edges: E[] } {
  const nodeMap = new Map<string, N>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  // If root node is not in nodeMap, return empty
  if (!nodeMap.has(rootTargetId)) {
    return { nodes: [], edges: [] };
  }

  // Filter edges:
  // 1. Both source and target must exist in candidate nodes
  // 2. Disallow self-loops (source === target)
  const validEdges: E[] = edges.filter(
    (e) => e.source !== e.target && nodeMap.has(e.source) && nodeMap.has(e.target)
  );

  // Build undirected adjacency list for reachability
  const adj = new Map<string, string[]>();
  validEdges.forEach((e) => {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source)!.push(e.target);
    adj.get(e.target)!.push(e.source);
  });

  // Breadth-first search from rootTargetId
  const reachableNodeIds = new Set<string>();
  reachableNodeIds.add(rootTargetId);
  const queue: string[] = [rootTargetId];

  while (queue.length > 0) {
    const curr = queue.shift()!;
    const neighbors = adj.get(curr) || [];
    for (const neighbor of neighbors) {
      if (!reachableNodeIds.has(neighbor) && nodeMap.has(neighbor)) {
        reachableNodeIds.add(neighbor);
        queue.push(neighbor);
      }
    }
  }

  // Filter nodes: only reachable nodes remain
  const prunedNodes = nodes.filter((n) => reachableNodeIds.has(n.id));

  // Filter edges: only edges between reachable nodes remain
  const prunedEdges = validEdges.filter(
    (e) => reachableNodeIds.has(e.source) && reachableNodeIds.has(e.target)
  );

  return { nodes: prunedNodes, edges: prunedEdges };
}

export interface CycleDetectionResult {
  hasCycle: boolean;
  cycleNodeIds: Set<string>;
  cycleEdgeIds: Set<string>;
  cycles: string[][];
}

/**
 * Detects circular dependencies (cycles) in a directed topology graph.
 * Returns participating node IDs, participating edge IDs, and the exact cycle paths.
 * Safe against diamond lattices, multi-branching DAGs, and self-loops.
 */
export function detectTopologyCycles<N extends TopologyNode, E extends TopologyEdge>(
  nodes: N[],
  edges: E[]
): CycleDetectionResult {
  const nodeMap = new Map<string, N>();
  nodes.forEach((n) => nodeMap.set(n.id, n));

  const validEdges = edges.filter(
    (e) => nodeMap.has(e.source) && nodeMap.has(e.target)
  );

  const adj = new Map<string, { target: string; edgeId: string }[]>();
  nodes.forEach((n) => adj.set(n.id, []));

  validEdges.forEach((e) => {
    const edgeId = e.id || `${e.source}->${e.target}`;
    if (adj.has(e.source)) {
      adj.get(e.source)!.push({ target: e.target, edgeId });
    }
  });

  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const path: string[] = [];
  const edgePath: string[] = [];
  const cycleNodeIds = new Set<string>();
  const cycleEdgeIds = new Set<string>();
  const cycles: string[][] = [];

  function dfs(curr: string) {
    visited.add(curr);
    recursionStack.add(curr);
    path.push(curr);

    const neighbors = adj.get(curr) || [];
    for (const { target, edgeId } of neighbors) {
      edgePath.push(edgeId);

      if (!visited.has(target)) {
        dfs(target);
      } else if (recursionStack.has(target)) {
        // Cycle detected!
        const cycleStartIndex = path.indexOf(target);
        if (cycleStartIndex !== -1) {
          const cycleNodes = path.slice(cycleStartIndex);
          cycleNodes.forEach((id) => cycleNodeIds.add(id));
          cycleEdgeIds.add(edgeId);

          const cycleEdges = edgePath.slice(cycleStartIndex);
          cycleEdges.forEach((id) => cycleEdgeIds.add(id));

          cycles.push([...cycleNodes, target]);
        }
      }

      edgePath.pop();
    }

    path.pop();
    recursionStack.delete(curr);
  }

  nodes.forEach((n) => {
    if (!visited.has(n.id)) {
      dfs(n.id);
    }
  });

  return {
    hasCycle: cycleNodeIds.size > 0,
    cycleNodeIds,
    cycleEdgeIds,
    cycles,
  };
}

/**
 * Resolves the highest criticality tier among an array of tiers (tier_0 > tier_1 > tier_2 > tier_3 > NONE).
 */
export function getHighestCriticalityTier(tiers: (string | undefined | null)[]): string {
  const rankMap: Record<string, number> = {
    tier_0: 0,
    tier_1: 1,
    tier_2: 2,
    tier_3: 3,
  };

  let bestRank = 99;
  let bestTier = 'NONE';

  for (const t of tiers) {
    if (!t) continue;
    const lower = t.toLowerCase().trim();
    const rank = rankMap[lower];
    if (rank !== undefined && rank < bestRank) {
      bestRank = rank;
      bestTier = lower.toUpperCase();
    }
  }

  return bestTier;
}

export interface OutageSimulationResult {
  failedNodeId: string;
  failedNodeIds: Set<string>;
  impactedNodeIds: Set<string>;
  upstreamImpactedNodeIds: Set<string>;
  downstreamImpactedNodeIds: Set<string>;
  impactedEdgeIds: Set<string>;
}

export interface CascadeEdge {
  id?: string;
  source?: string;
  target?: string;
  source_ci_id?: string;
  target_ci_id?: string;
  [key: string]: unknown;
}

/**
 * Calculates outage failure cascade in both UPWARD and DOWNWARD directions:
 * - UPWARD: Along incoming dependency edges (from provider/target to consumers/source).
 *   If a dependency is offline, any consumer relying on it is impacted.
 * - DOWNWARD: Along outgoing dependency edges (from consumer/source to dependencies/target).
 *   If a consumer/service is offline, its downstream dependency connections are impacted.
 * Safe against circular dependencies and disconnected subgraphs.
 */
export function simulateOutageCascade<E extends CascadeEdge>(
  failedNodeId: string,
  candidateEdges: E[],
  options?: {
    direction?: 'both' | 'downward' | 'upward';
  }
): OutageSimulationResult {
  const direction = options?.direction || 'both';
  const failedNodeIds = new Set<string>([failedNodeId]);
  const upstreamImpactedNodeIds = new Set<string>();
  const downstreamImpactedNodeIds = new Set<string>();
  const impactedEdgeIds = new Set<string>();

  // Normalize candidate edges
  const normalizedEdges = candidateEdges
    .map((e) => {
      const source = (e.source || e.source_ci_id || '') as string;
      const target = (e.target || e.target_ci_id || '') as string;
      const edgeId = (e.id || `${source}->${target}`) as string;
      return { id: edgeId, source, target };
    })
    .filter((e) => e.source && e.target);

  // A. Upward Propagation (Target to Source: Provider fails -> Consumers impacted)
  if (direction === 'both' || direction === 'upward') {
    const upwardQueue: string[] = [failedNodeId];
    const visitedUpward = new Set<string>([failedNodeId]);

    while (upwardQueue.length > 0) {
      const curr = upwardQueue.shift()!;
      for (const edge of normalizedEdges) {
        if (edge.target === curr) {
          impactedEdgeIds.add(edge.id);
          if (!visitedUpward.has(edge.source)) {
            visitedUpward.add(edge.source);
            failedNodeIds.add(edge.source);
            upstreamImpactedNodeIds.add(edge.source);
            upwardQueue.push(edge.source);
          }
        }
      }
    }
  }

  // B. Downward Propagation (Source to Target: Service fails -> Downstream dependencies impacted)
  if (direction === 'both' || direction === 'downward') {
    const downwardQueue: string[] = [failedNodeId];
    const visitedDownward = new Set<string>([failedNodeId]);

    while (downwardQueue.length > 0) {
      const curr = downwardQueue.shift()!;
      for (const edge of normalizedEdges) {
        if (edge.source === curr) {
          impactedEdgeIds.add(edge.id);
          if (!visitedDownward.has(edge.target)) {
            visitedDownward.add(edge.target);
            failedNodeIds.add(edge.target);
            downstreamImpactedNodeIds.add(edge.target);
            downwardQueue.push(edge.target);
          }
        }
      }
    }
  }

  const impactedNodeIds = new Set<string>([
    ...upstreamImpactedNodeIds,
    ...downstreamImpactedNodeIds,
  ]);

  return {
    failedNodeId,
    failedNodeIds,
    impactedNodeIds,
    upstreamImpactedNodeIds,
    downstreamImpactedNodeIds,
    impactedEdgeIds,
  };
}
