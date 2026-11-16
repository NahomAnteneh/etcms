# Testing Strategy & Verification Gates

This document outlines the testing architecture, integration test suites, verification gates, and scale benchmarking methodologies implemented in `etcms-backend`.

---

## 1. Testing Philosophy & Invariants

1. **Zero Mocks for Database:** Testing uses real PostgreSQL 16 instances spun up dynamically in ephemeral Docker containers using [`testcontainers-go`](https://github.com/testcontainers/testcontainers-go). Tests exercise real PostgreSQL extensions (`pg_trgm`, `pgcrypto`), real PL/pgSQL triggers, real JSONB functions, and real transaction isolation.
2. **Race Detector Mandatory:** All tests execute with `-race` enabled (`go test -v -race ./...`) to guarantee thread safety and prevent data races across concurrent requests.
3. **Contract-First Verification:** Contract compliance is verified using `oasdiff` (`make diff-spec`). Any backward-incompatible changes to schemas, parameters, or routes are automatically flagged.
4. **Zero Warnings Policy:** The repository enforces a zero-warning gate via `golangci-lint` (`make lint`).

---

## 2. Test Suite Matrix

All integration tests reside in [`internal/adapters/http/`](../internal/adapters/http) and [`internal/worker/`](../internal/worker):

| Test Suite | File | Focus Areas & User Stories Covered |
| :--- | :--- | :--- |
| **`TestIntakeCampaignsFlow`** | [`campaign_test.go`](../internal/adapters/http/campaign_test.go) | `US-2.1`: Campaign creation by admin, 403 for non-admins, past deadline rejection (`422`), token generation, token expiration (`401`), department progress aggregation. |
| **`TestIntakeWizardDraftAutoSave`** | [`intake_wizard_test.go`](../internal/adapters/http/intake_wizard_test.go) | `US-2.2`: Token resolution, status update to `'opened'`, draft auto-save, 2MB payload guard, `If-Match` lock version check, `HTTP 412 Precondition Failed` on version mismatch. |
| **`TestAtomicBaselineValidationAndPublisher`** | [`submit_test.go`](../internal/adapters/http/submit_test.go) | `US-1.1`, `US-1.2`, `US-2.3`: Pre-flight 10-field envelope validation, strict Anti-ITAM rejection (`422`), metadata $\le 2$ keys limit, atomic publication into `Baseline v1.0` (`HTTP 201 Created`), idempotent replay returning existing baseline (`HTTP 200 OK`), row lock (`FOR UPDATE`), 409 when baseline missing on completed submission. |
| **`TestEdgeHandshakeFlow`** | [`edges_test.go`](../internal/adapters/http/edges_test.go) | `US-2.4`: Cross-boundary edge listing for target owner group, confirmation by target team lead, discrepancy flagging, rejection, non-target lead 403 rejection. |
| **`TestPostBaselineLifecycle`** | [`lifecycle_test.go`](../internal/adapters/http/lifecycle_test.go) | `US-2.5`: Single CI creation post-baseline, owner RBAC, edge creation, self-dependency rejection (`CHECK source_ci_id != target_ci_id` with `422`), edge deletion. |
| **`TestSearchAndDetailAggregation`** | [`search_detail_test.go`](../internal/adapters/http/search_detail_test.go) | `US-3.3`: Hybrid prefix ($<3$ chars) and trigram similarity ($\ge 3$ chars) search, pinned `ownership` DTO, deterministic keyset cursor pagination, CI detail aggregation. |
| **`TestUpwardImpactTraversal`** | [`impact_upward_test.go`](../internal/adapters/http/impact_upward_test.go) | `US-3.1`: Multi-tier incoming dependency traversal, cycle termination ($A \to B \to C \to A$), highest criticality tier calculation, impacted applications & business services, sibling dependencies. |
| **`TestDownwardDependenciesAndSharedMath`** | [`dependencies_downward_test.go`](../internal/adapters/http/dependencies_downward_test.go) | `US-3.2`: Outgoing dependency traversal, cycle safety, subgraph in-degree calculation, shared dependency detection (`subgraph_in_degree >= 2`). |
| **`TestDiamondLatticeScaleAndLatency`** | [`dependencies_downward_test.go`](../internal/adapters/http/dependencies_downward_test.go) | Scale benchmark: 1,000 CIs / 2,500 edges in 10-layer diamond lattice. Asserts p95 latency is $<500\text{ ms}$ (achieved $22.68\text{ ms}$ downward, $51.16\text{ ms}$ upward). |
| **`TestCIEditsVolatileStampingAndFlags`** | [`ci_edits_flags_test.go`](../internal/adapters/http/ci_edits_flags_test.go) | `US-3.3`: Domain-restricted edits, volatile-only verification stamping, cosmetic edit timestamp retention, retirement disallowed via PATCH (`422`), data-quality flagging. |
| **`TestDigestSchedulerExecutionAndTriggers`** | [`digest_scheduler_test.go`](../internal/worker/digest_scheduler_test.go) | `US-4.1`: Calendar window math (1st and 15th UTC) across month and year boundaries, trigger reason prioritization, distributed idempotency, cycle transition & item expiration, webhook dispatch. |
| **`TestDigestActionsAndRetirement`** | [`digest_actions_test.go`](../internal/adapters/http/digest_actions_test.go) | `US-4.1`: Active digest review query, one-click verify (timestamp update, flag resolution, item actioning), safe retirement (409 conflict on active dependents), admin force retirement bypass, leaf CI clean retirement. |
| **`TestAuditExportAndHealthMetrics`** | [`audit_export_health_test.go`](../internal/adapters/http/audit_export_health_test.go) | `US-4.2`, `US-4.3`: Keyset cursor audit timeline, streaming CSV/NDJSON export under `REPEATABLE READ`, formula injection sanitization (`=`, `+`, `-`, `@`, `\t`, `\r` prefixed with `'`), CMDB governance health metrics (Freshness, Orphans, Pending Edges, Digest Completion). |

---

## 3. Running Verification Gates

### Run All Tests with Race Detector
```bash
make test
```
*Spins up ephemeral PostgreSQL 16 containers via `testcontainers-go`, runs all schema migrations, and executes all unit, integration, and benchmark tests with `-race`.*

### Run Static Analysis & Linter
```bash
make lint
```
*Executes `golangci-lint` configured in [`.golangci.yml`](../.golangci.yml) ensuring zero unhandled errors, proper variable declarations, and adherence to Go idioms.*

### Run OpenAPI Contract Breaking-Change Check
```bash
make diff-spec
```
*Uses `oasdiff` to verify that modifications to [`api/openapi.yaml`](../api/openapi.yaml) have not introduced breaking changes against the repository base.*
