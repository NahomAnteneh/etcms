# Skill Playbook: Recursive Graph Traversal & Shared-Dependency Analysis

This playbook defines algorithms and query patterns for cycle-safe graph traversals in `etcms-backend`.

## Core Guidelines

1. **Directional Semantics:**
   * `source_ci_id` = Consumer / Dependent (Application, VM).
   * `target_ci_id` = Provider / Dependency (Database, Host, Service).

2. **Upward Impact Traversal:**
   * Answers: *"If this database/host fails, what applications and business services are impacted?"*
   * Traversal moves from provider to consumer: `target_ci_id -> source_ci_id`.
   * Edge filter default: `lifecycle_state IN ('in_service', 'planned')` unless `include_retired=true`.

3. **Downward Dependency Traversal:**
   * Answers: *"What infrastructure components does this application depend on?"*
   * Traversal moves from consumer to provider: `source_ci_id -> target_ci_id`.

4. **Cycle Safety & Combinatorial Explosion Prevention:**
   * Never enumerate all paths between nodes in a diamond lattice (which causes $O(2^n)$ path explosion).
   * Traverse at the **node level** using `UNION` (deduplicating visited nodes) with a bounded depth: `max_depth = 15`.
   * Track visited paths or node arrays to terminate cycles gracefully.

5. **Shared Dependency Detection:**
   * Extract reachable subgraph nodes and edges.
   * A dependency node is marked `is_shared_dependency = true` when its in-degree within the reachable subgraph is $\ge 2$ (converged upon by two or more distinct immediate parents in the traversal).
