# Graph Architecture & Traversal Algorithms

This document describes the canonical graph topology, cycle-safe recursive traversal algorithms, shared dependency math, and scale benchmarks implemented in `etcms-backend`.

---

## 1. Canonical Edge Direction & Semantics

In `etcms-backend`, dependency relationships are strictly directed and follow a standard consumer-to-provider semantic:

```
[ Dependent / Consumer ]  ----( edge_type )---->  [ Dependency / Provider ]
     source_ci_id                                      target_ci_id
 (e.g. Application)                                 (e.g. Database / Cluster)
```

### Invariant Rules:
1. **Source CI:** Always the consumer or caller that requires the target to operate.
2. **Target CI:** Always the provider or underlying resource supplying the service.
3. **Self-Edge Prevention:** An item cannot depend on itself (`CHECK (source_ci_id != target_ci_id)`).
4. **Supported Edge Types:**
   - `depends_on`: Generic structural dependency.
   - `connects_to`: Network/API connection.
   - `reads_from`: Data read / query dependency.
   - `writes_to`: Data mutation / ingestion dependency.
   - `hosted_on`: Compute / virtualization hosting dependency.

---

## 2. Cycle-Safe Upward Impact Traversal (`US-3.1`)

When an infrastructure CI fails, degrades, or undergoes maintenance (e.g., a database cluster), engineers need to understand which upstream applications, business services, and users are impacted.

### Traversal Direction
- Upward impact follows incoming edges backwards: **`target_ci_id = :start_id -> source_ci_id`**.

### SQL Recursive CTE Implementation (`sql/queries/graph_traversal.sql`)
```sql
WITH RECURSIVE upstream AS (
    -- Anchor member: immediate consumers depending on the target CI
    SELECT
        e.source_ci_id AS ci_id,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE e.target_ci_id = @start_ci_id::uuid
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state IN ('in_service', 'planned')
      )
    UNION
    -- Recursive member: traverse upwards node-by-node (deduplicated by UNION)
    SELECT
        e.source_ci_id AS ci_id,
        u.depth + 1 AS depth
    FROM ci_edges e
    JOIN upstream u ON e.target_ci_id = u.ci_id
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE u.depth < 15
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state IN ('in_service', 'planned')
      )
),
deduped_upstream AS (
    SELECT
        ci_id,
        min(depth)::integer AS depth
    FROM upstream
    GROUP BY ci_id
)
SELECT c.*, du.depth, og.*
FROM deduped_upstream du
JOIN cis c ON c.ci_id = du.ci_id
JOIN owner_groups og ON og.id = c.owner_group_id
ORDER BY du.depth ASC, c.name ASC;
```

### Cycle Termination & Combinatorial Protection
- **`UNION` Tuple Deduplication:** Standard `UNION` deduplicates the projected tuple `(ci_id, depth)`. Because `depth` increments with each recursive step (`u.depth + 1`), a cycle (e.g. $A \to B \to C \to A$) generates distinct tuples at differing depths—e.g., $(A, 1)$, $(B, 2)$, $(C, 3)$, $(A, 4)$. Consequently, `UNION` alone does not terminate cyclic paths.
- **`WHERE u.depth < 15` Guard:** The explicit depth boundary `WHERE u.depth < 15` in the recursive member is what terminates cycles and caps recursion at a maximum of 15 tiers, guaranteeing predictable execution time and preventing infinite loops.
- **Path Deduplication via `deduped_upstream`:** The subsequent CTE `deduped_upstream` executes `SELECT ci_id, min(depth)::integer AS depth FROM upstream GROUP BY ci_id`. This collapses multiple paths of different lengths (including loops and diamond lattices) to each visited node down to its single minimum topological distance from the target CI.
- **Edge `handshake_status` Behavior:** Upward impact traversal queries do **not** filter out edges based on `handshake_status`. They traverse all recorded relationships across active CIs (or retired CIs if `include_retired = true`). This behavior is shared by `GetActiveUpstreamDependents` (`sql/queries/cis.sql:354-371`), where unconfirmed and disputed edges also block unsafe CI retirement. This ensures incident responders see the entire potential blast radius—including unconfirmed (`pending_confirmation`), flagged (`flagged_mismatch`), or `rejected` edges. The API response returns `handshake_status` on each edge DTO for client visibility. (In contrast, governance metrics like Orphan CI Count in `sql/queries/health_metrics.sql:14-55` strictly require `e.handshake_status = 'confirmed'`).

### Go Aggregation Logic
The service layer computes:
- **`highest_criticality_tier`:** Scans all reachable upstream nodes and identifies the most critical tier (`tier_0` > `tier_1` > `tier_2` > `tier_3`).
- **`impacted_business_services[]`:** Filters visited nodes where `ci_class = 'business_service'`.
- **`impacted_applications[]`:** Filters visited nodes where `ci_class = 'application'`.
- **`shared_sibling_dependencies[]`:** Discovers other infrastructure CIs that support the same impacted applications.

---

## 3. Cycle-Safe Downward Dependency Traversal & Shared Dependency Math (`US-3.2`)

When evaluating an application before deployment, engineers need to inspect the full transitive tree of dependencies and identify single points of failure (shared dependencies).

### Traversal Direction
- Downward dependencies follow outgoing edges: **`source_ci_id = :start_id -> target_ci_id`**.

### SQL Recursive CTE Implementation (`sql/queries/graph_traversal.sql`)

```sql
-- Downward Nodes Traversal (GetDownwardDependencyNodes)
WITH RECURSIVE downstream AS (
    -- Anchor: immediate dependencies required by the starting source CI
    SELECT
        e.target_ci_id AS ci_id,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.target_ci_id
    WHERE e.source_ci_id = @start_ci_id::uuid
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state IN ('in_service', 'planned')
      )
    UNION
    -- Recursive member: traverse downstream node-by-node
    SELECT
        e.target_ci_id AS ci_id,
        d.depth + 1 AS depth
    FROM ci_edges e
    JOIN downstream d ON e.source_ci_id = d.ci_id
    JOIN cis c ON c.ci_id = e.target_ci_id
    WHERE d.depth < 15
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state IN ('in_service', 'planned')
      )
),
deduped_downstream AS (
    SELECT
        ci_id,
        min(depth)::integer AS depth
    FROM downstream
    GROUP BY ci_id
)
SELECT
    c.ci_id,
    c.name,
    c.ci_class,
    c.environment,
    c.lifecycle_state,
    c.criticality_tier,
    c.owner_group_id,
    c.technical_contact,
    c.primary_endpoint,
    c.last_verified_at,
    c.itam_external_ref,
    c.class_metadata,
    c.created_at,
    c.updated_at,
    og.name AS owner_group_name,
    og.department_name,
    og.team_lead_name,
    og.team_lead_email,
    dd.depth
FROM deduped_downstream dd
JOIN cis c ON c.ci_id = dd.ci_id
JOIN owner_groups og ON og.id = c.owner_group_id
ORDER BY dd.depth ASC, c.name ASC;

-- Subgraph Connecting Edges (GetDownwardDependencyEdges)
WITH RECURSIVE downstream AS (
    SELECT
        e.target_ci_id AS ci_id,
        1 AS depth
    FROM ci_edges e
    JOIN cis c ON c.ci_id = e.target_ci_id
    WHERE e.source_ci_id = @start_ci_id::uuid
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state IN ('in_service', 'planned')
      )
    UNION
    SELECT
        e.target_ci_id AS ci_id,
        d.depth + 1 AS depth
    FROM ci_edges e
    JOIN downstream d ON e.source_ci_id = d.ci_id
    JOIN cis c ON c.ci_id = e.target_ci_id
    WHERE d.depth < 15
      AND (
          @include_retired::boolean = true
          OR c.lifecycle_state IN ('in_service', 'planned')
      )
),
all_nodes AS (
    SELECT @start_ci_id::uuid AS ci_id
    UNION
    SELECT ci_id FROM downstream
)
SELECT DISTINCT
    e.id,
    e.source_ci_id,
    e.target_ci_id,
    e.edge_type,
    e.handshake_status
FROM ci_edges e
JOIN all_nodes s ON e.source_ci_id = s.ci_id
JOIN all_nodes t ON e.target_ci_id = t.ci_id
ORDER BY e.edge_type, e.source_ci_id;
```

### Edge `handshake_status` Behavior
Like upward impact analysis, downward dependency traversal does **not** filter out edges by `handshake_status`. All recorded dependencies are traversed (subject to `lifecycle_state` filtering). The resulting `handshake_status` is returned on each edge DTO so clients can distinguish confirmed production connections from pending or disputed dependencies.

### Node-Level vs Path-Level Traversal (Diamond Lattice Defense)
In complex enterprise topologies, multiple microservices often depend on the same shared databases or caches, forming diamond lattices:

```
        Application (Root)
         /             \
    Service A       Service B
         \             /
          Database 1
```

If a traversal enumerates raw paths, path count grows exponentially: $O(2^d)$. In a 10-layer diamond lattice, this produces over $1,000$ paths for a graph with only 20 nodes!
- **Solution:** `etcms-backend` traverses node-by-node using deduplicated `UNION` recursion with depth bounded at `depth < 15`, preserving $O(V + E)$ complexity and eliminating combinatorial explosion.

### Shared Dependency Math & In-Degree Calculation
Within the reachable subgraph:
1. `GetDownwardDependencyNodes` retrieves all reachable downstream CIs and their minimum topological depths.
2. `GetDownwardDependencyEdges` fetches all connecting edges between the root CI and visited downstream nodes.
3. In the service layer (`internal/service/cis.go`), the in-degree of each target CI is calculated by accumulating distinct immediate parents (`source_ci_id`) strictly within the reachable subgraph:
   $$\text{subgraph\_in\_degree} = \text{Count of distinct immediate parents in the reachable subgraph}$$
4. Any node with $\text{subgraph\_in\_degree} \ge 2$ represents a single point of failure (shared dependency) and is flagged:
   ```json
   "is_shared_dependency": true,
   "subgraph_in_degree": 2
   ```
5. All shared dependencies are returned in a dedicated top-level `shared_dependencies[]` array in the `DownwardDependenciesResponse` DTO for immediate operational triage.

---

## 4. Benchmark Gate & Scale Verification

As required by `AGENTS.md`, the graph engine is verified against a strict latency benchmark gate:

### Benchmark Topology
- **Size:** 1,000 Configuration Items, 2,500 Edges.
- **Structure:** 10-layer diamond lattice topology with high fan-out, plus deliberate cycle edges ($C \to A$).
- **Benchmark Gate:** p95 latency must be **$< 500\text{ ms}$** for both upward and downward traversals under concurrent load.

### Benchmark Results ([`dependencies_downward_test.go`](../internal/adapters/http/dependencies_downward_test.go))
```
Benchmark Diamond Lattice Traversal (1,000 CIs / 2,500 Edges):
- Downward Traversal p95: 22.68 ms (Target: < 500 ms) -> PASS
- Upward Impact Traversal p95: 51.16 ms (Target: < 500 ms) -> PASS
```

> [!IMPORTANT]
> **PostgreSQL Optimizer Statistics:** When bulk seeding or inserting large graph structures, running `ANALYZE cis; ANALYZE ci_edges;` is critical. Without analyzed planner statistics, PostgreSQL estimates a 2-row bitmap heap scan, triggering millions of nested buffer loops. Fresh statistics enable instant index nested loop scans, dropping latency from $>1,000\text{ ms}$ down to $22\text{ ms}$.
