# Enterprise Configuration Management System (ETCMS) Backend

Welcome to the comprehensive technical documentation for the `etcms-backend` service. This system is a high-performance, decentralized Configuration Management Database (CMDB) designed specifically for enterprise environments running modern service topologies, cross-boundary ownership handshakes, cycle-safe dependency graphs, automated governance digests, and immutable audit exports.

---

## 1. System Vision & Non-Negotiable Invariants

The `etcms-backend` system was designed and implemented under strict architectural guardrails:

1. **Contract-First Pipeline:** The single source of truth is the OpenAPI 3.0.3 specification at [`api/openapi.yaml`](api/openapi.yaml). Handlers strictly implement the generated `StrictServerInterface` in [`internal/adapters/http/gen/openapi.gen.go`](internal/adapters/http/gen/openapi.gen.go).
2. **Modern Ownership Terminology:** Archaic "custodian" terminology is strictly prohibited across code, schemas, and documentation. Modern team terminology (`owner_group`, `team_lead`, `owner_group_id`, `department_name`) is used exclusively.
3. **Strict Anti-ITAM Schema Enforcement:** Any payload containing unapproved ITAM fields (such as `cost`, `purchase_cost`, `license_count`, `warranty_end`, or `vendor`) is rejected with `HTTP 422 Unprocessable Entity`.
4. **Append-Only Auditing:** The `audit_logs` table is strictly append-only. Database triggers (`audit_logs_no_update_delete` and `audit_logs_no_truncate`) prohibit any `UPDATE`, `DELETE`, or `TRUNCATE` operations at the database engine level.
5. **Cycle-Safe Graph Algorithms:** Graph traversal queries (`impact-upward` and `dependencies-downward`) are cycle-safe and avoid combinatorial path explosion by traversing node-by-node using bounded `UNION` recursion (`depth < 15`).
6. **Canonical Edge Direction:** 
   - `source_ci_id` = Dependent / Consumer (e.g. Application).
   - `target_ci_id` = Dependency / Provider (e.g. Database).
   - Self-dependencies are forbidden at the database constraint level: `CHECK (source_ci_id != target_ci_id)`.
7. **Formula Injection Sanitization:** CSV exports sanitize every text cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r` by prefixing with `'` to prevent spreadsheet code execution.

---

## 2. Technology Stack & Toolchain

| Layer | Component | Version / Library |
| :--- | :--- | :--- |
| **Language Runtime** | Go | `1.27` |
| **API Contract** | OpenAPI | `3.0.3` (flattened schemas, RFC 9457 Problem Details) |
| **API Codegen** | `oapi-codegen` | `v2.4.1` with `chi` strict server interface & request validation |
| **Database Engine** | PostgreSQL | `16-alpine` (`pg_trgm`, `pgcrypto` extensions) |
| **DB Driver & Pool** | `pgx/v5` | `v5.7.2` (high-performance connection pooling) |
| **Type-Safe SQL** | `sqlc` | `v1.28.0` (zero runtime reflection, compile-time verified queries) |
| **Schema Migrations**| `goose` | SQL migrations (`migrations/*.sql`) |
| **Testing Harness** | `testcontainers-go` | `v0.45.0` (isolated PostgreSQL 16 containers with race detector) |
| **Spec Drift Check** | `oasdiff` | `v1.10.27` (automated breaking change detection) |

---

## 3. Documentation Index

The `docs/` folder provides comprehensive, deep-dive specifications across all subsystems:

- [architecture.md](docs/architecture.md) — Architectural design, layered hexagonal structure, security model, and transaction handling.
- [api-reference.md](docs/api-reference.md) — Complete endpoint reference, request/response models, and RFC 9457 Problem Details.
- [database-schema.md](docs/database-schema.md) — PostgreSQL 16 schema, DDL migrations, tables, constraints, triggers, and indexing strategies.
- [graph-and-algorithms.md](docs/graph-and-algorithms.md) — Upward impact analysis, downward dependency traversal, shared dependency math, and scale benchmarks.
- [audit-and-digests.md](docs/audit-and-digests.md) — Bi-weekly calendar-anchored digest worker, one-click verification/retire actions, streaming export, and CMDB health metrics.
- [testing-and-verification.md](docs/testing-and-verification.md) — Testing strategy, test suites, coverage gates, and verification commands.

---

## 4. Repository Layout

```
.
├── AGENTS.md                          # Non-negotiable AI agent rules and operational protocols
├── Makefile                           # Development, codegen, lint, and test targets
├── api/
│   └── openapi.yaml                   # OpenAPI 3.0.3 source of truth contract
├── cmd/
│   └── etcms-api/
│       └── main.go                    # Application bootstrap & entrypoint
├── docs/                              # Detailed technical documentation
├── internal/
│   ├── adapters/
│   │   ├── http/                      # Routing, handlers, middleware, and integration tests
│   │   │   ├── gen/                   # Generated OpenAPI strict server code (DO NOT EDIT)
│   │   │   ├── handler/               # Handler implementation of StrictServerInterface
│   │   │   └── middleware/            # Auth, Anti-ITAM, max body, and error mapping middleware
│   │   └── postgres/                  # Database store, connection pooling, and WithAuditTx
│   │       └── gen/                   # Generated sqlc type-safe database queries (DO NOT EDIT)
│   ├── domain/                        # Domain entities, RBAC roles, ITAM validation, errors
│   ├── service/                       # Business logic services (intake, edges, cis, digests, audit, health)
│   └── worker/                        # Bi-weekly owner digest scheduler (orchestrated via external cron / admin endpoint)
├── migrations/                        # Goose SQL database migrations (00001 - 00003)
├── sql/
│   └── queries/                       # sqlc source SQL queries
├── oapi-codegen.yaml                  # oapi-codegen generator configuration
└── sqlc.yaml                          # sqlc compiler configuration
```

---

## 5. Development Quickstart

### Prerequisites
- Docker / Podman (running)
- Go `1.27` or higher
- `golangci-lint`

### Essential Makefile Commands

```bash
# Generate OpenAPI handlers and sqlc queries from api/openapi.yaml & sql/queries/
make generate

# Run breaking contract check against git base
make diff-spec

# Run linter across all packages
make lint

# Run full test suite with race detector using testcontainers-go
make test

# Run database migrations against local postgres
make migrate-up
```
