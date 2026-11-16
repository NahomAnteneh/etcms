# Enterprise Configuration Management System (ETCMS)

Decentralized, contract-first Configuration Management Database (CMDB) designed for modern enterprise topologies, cross-boundary ownership handshakes, cycle-safe dependency graphs, automated governance digests, and immutable audit trails.

---

## 1. System Overview

ETCMS consists of two cleanly integrated sub-projects:

- **`etcms-backend`**: High-performance Go service built with Chi, `pgx/v5`, `sqlc`, and `oapi-codegen` over PostgreSQL 16.
- **`etcms-frontend`**: React 19 + TypeScript + Tailwind CSS enterprise operator interface featuring BSM topology graphs (`@xyflow/react` + `dagre`), cross-boundary handshake inbox, owner attestation digests, and RFC 9457 Problem Details recovery.

---

## 2. Quickstart

### Prerequisites
- **PostgreSQL 16** (running locally on port 5432 or via `docker compose up -d` in `etcms-backend`)
- **Go 1.24+**
- **Bun** or **Node.js 20+**

### One-Command Setup

```bash
# 1. Run migrations, apply realistic enterprise seed fixtures, and install frontend dependencies
make setup

# 2. Start both backend (:8080) and frontend (:5173) concurrently
make dev
```

The frontend will be available at **`http://localhost:5173`** and reverse-proxies `/api/v1` calls directly to the Go backend on **`http://localhost:8080`**.

Alternatively, you can run them in separate terminals:
```bash
# Terminal 1: Backend
make dev-backend

# Terminal 2: Frontend
make dev-frontend
```

---

## 3. Pre-Seeded Developer Personas

The system comes pre-seeded with realistic enterprise actors for testing RBAC context:

| Persona | Role | Default Owner Group | Header Credential (`X-Dev-User-ID`) |
| :--- | :--- | :--- | :--- |
| **Admin User** | `platform_admin` | Platform Engineering | `11111111-1111-1111-1111-111111111111` |
| **Team Lead User** | `team_lead` | Core Banking SRE | `22222222-2222-2222-2222-222222222222` |
| **Viewer User** | `viewer` | Audit & Compliance | `33333333-3333-3333-3333-333333333333` |

You can switch personas dynamically inside the frontend via the top navigation user menu or **Settings > Persona & Access**.

---

## 4. Key Capabilities & Verification Paths

1. **CMDB Health Workspace (`/`)**: Real-time completeness, correctness, and compliance metrics computed directly from live CI and edge data.
2. **CI Catalog (`catalog`)**: Search, filter, inspect, one-click verify, or retire configuration items.
3. **BSM Dependency Graph (`graph`)**: Interactive upward impact analysis and downward dependency traversal powered by bounded cycle-safe graph recursion.
4. **Attestation Digest (`digest`)**: Bi-weekly verification cycle items prioritized by stale age (>60d), open dispute flags, or pending handshakes.
5. **Cross-Boundary Handshakes (`handshakes`)**: Confirm, dispute, or reject incoming dependency relationships.
6. **Decentralized Intake Campaigns (`campaigns`)**: Launch campaigns and distribute cryptographic magic link invitations (`/intake/:token`).
7. **Immutable Audit Trail (`audit`)**: PostgreSQL trigger-enforced append-only logs with streaming CSV / NDJSON export and spreadsheet formula injection sanitization.

---

## 5. Development & Testing Commands

```bash
# Re-apply seed fixtures
make seed

# Run full backend (with race detector) and frontend unit test suites
make test

# Compile production binaries and bundles
make build

# Lint both codebases
make lint
```
