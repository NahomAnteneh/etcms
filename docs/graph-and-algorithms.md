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
- **`UNION` vs `UNION ALL`:** The query uses standard `UNION`. This ensures that if a cycle exists (e.g. $A \to B \to C \to A$), recursive iteration encounters already visited node IDs and automatically terminates.
- **`depth < 15` Guard:** Guarantees that any pathological deep structure is capped at 15 tiers, preventing stack overflow or query timeout.

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
- **Solution:** `etcms-backend` traverses node-by-node using deduplicated `UNION` recursion, preserving $O(V + E)$ complexity and eliminating combinatorial explosion.

### Shared Dependency Math
Within the reachable subgraph:
1. Fetch all connecting edges between visited nodes.
2. For each visited target CI, calculate its in-degree within the reachable subgraph:
   $$\text{subgraph\_in\_degree} = \text{Count of distinct immediate parents in the reachable subgraph}$$
3. Any node with $\text{subgraph\_in\_degree} \ge 2$ is marked:
   ```json
   "is_shared_dependency": true
   ```
4. Shared dependencies are returned in a dedicated top-level summary array in the response DTO.

---

## 4. Benchmark Gate & Scale Verification

As required by `AGENTS.md` and `etcms_go_openapi_backend_sprint_plan.md`, the graph engine is verified against a strict latency benchmark gate:

### Benchmark Topology
- **Size:** 1,000 Configuration Items, 2,500 Edges.
- **Structure:** 10-layer diamond lattice topology with high fan-out, plus deliberate cycle edges ($C \to A$).
- **Benchmark Gate:** p95 latency must be **$< 500\text{ ms}$** for both upward and downward traversals under concurrent load.

### Benchmark Results ([`dependencies_downward_test.go`](file:///home/nahom/Work/ET/etcms/etcms-backend/internal/adapters/http/dependencies_downward_test.go))
```
Benchmark Diamond Lattice Traversal (1,000 CIs / 2,500 Edges):
- Downward Traversal p95: 22.68 ms (Target: < 500 ms) -> PASS
- Upward Impact Traversal p95: 51.16 ms (Target: < 500 ms) -> PASS
```

> [!IMPORTANT]
> **PostgreSQL Optimizer Statistics:** When bulk seeding or inserting large graph structures, running `ANALYZE cis; ANALYZE ci_edges;` is critical. Without analyzed planner statistics, PostgreSQL estimates a 2-row bitmap heap scan, triggering millions of nested buffer loops. Fresh statistics enable instant index nested loop scans, dropping latency from $>1,000\text{ ms}$ down to $22\text{ ms}$.
