# API Reference & Contract Specification

This document provides a complete reference for all REST API endpoints defined in [`api/openapi.yaml`](file:///home/nahom/Work/ET/etcms/etcms-backend/api/openapi.yaml) and implemented in the `etcms-backend` service.

---

## 1. RFC 9457 Problem Details Error Standard

All error responses across all endpoints adhere strictly to the **RFC 9457 Problem Details** standard with `Content-Type: application/problem+json`.

### Problem Details Schema

```json
{
  "type": "https://api.etcms.internal/errors/conflict",
  "title": "Conflict",
  "status": 409,
  "detail": "cannot retire CI audit-db (72f3e82b-...): 1 active dependent CIs exist",
  "instance": "/api/v1/cis/72f3e82b-.../retire",
  "dependent_cis": [
    {
      "ci_id": "993b1234-...",
      "name": "gateway-api",
      "ci_class": "application",
      "environment": "prod"
    }
  ],
  "node_errors": {
    "srv-1": ["Class metadata must contain at most 2 keys", "Unapproved ITAM field 'cost' rejected"]
  },
  "invalid_params": [
    {
      "name": "cursor",
      "reason": "invalid cursor encoding"
    }
  ]
}
```

### Standard HTTP Status Codes

| Code | Status | Usage |
| :--- | :--- | :--- |
| **`400`** | `Bad Request` | Malformed JSON, unparseable UUID, illegal parameter syntax. |
| **`401`** | `Unauthorized` | Missing or expired token / magic link token. |
| **`403`** | `Forbidden` | Insufficient domain RBAC permissions (e.g. non-owner modifying CI). |
| **`404`** | `Not Found` | Target resource does not exist. |
| **`409`** | `Conflict` | State machine conflict or active upstream dependencies blocking retirement. |
| **`412`** | `Precondition Failed` | Optimistic concurrency mismatch on draft auto-saves (`If-Match` mismatch). |
| **`422`** | `Unprocessable Entity` | Schema or semantic validation failure (Anti-ITAM rejection, self-edges, metadata $>2$ keys). |

---

## 2. Diagnostics & Health Endpoints

### `GET /api/v1/healthz`
- **Summary:** Liveness probe.
- **Auth:** None.
- **Response 200 OK:**
  ```json
  {
    "status": "ok",
    "version": "3.0.0",
    "timestamp": "2026-11-13T21:00:00Z"
  }
  ```

### `GET /api/v1/readyz`
- **Summary:** Readiness probe (verifies live PostgreSQL connectivity via connection pool ping).
- **Auth:** None.
- **Response 200 OK:**
  ```json
  {
    "status": "ready",
    "database": "connected",
    "timestamp": "2026-11-13T21:00:00Z"
  }
  ```
- **Response 503 Service Unavailable:** If database ping fails.

---

## 3. Identity & Owner Groups

### `GET /api/v1/users/me`
- **Summary:** Profile of the currently authenticated principal.
- **Auth:** `BearerAuth` / `DevAuth`.
- **Response 200 OK:**
  ```json
  {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "email": "teamlead@example.com",
    "name": "Team Lead Name",
    "role": "team_lead",
    "primary_owner_group_id": "7fa85f64-5717-4562-b3fc-2c963f66afa6",
    "owner_group_ids": ["7fa85f64-5717-4562-b3fc-2c963f66afa6"],
    "created_at": "2026-11-13T18:00:00Z"
  }
  ```

### `GET /api/v1/owner-groups`
- **Summary:** Lists all registered owner groups ordered alphabetically by name.
- **Auth:** `BearerAuth` / `DevAuth`.
- **Response 200 OK:** Array of `OwnerGroup` objects.

---

## 4. Decentralized Service Intake (`US-2.1`, `US-2.2`, `US-2.3`, `US-1.1`, `US-1.2`)

### `POST /api/v1/intake-campaigns`
- **Summary:** Launches an intake campaign and generates tokenized magic links for all team leads.
- **Auth:** Restricted to `platform_admin`.
- **Request Body:**
  ```json
  {
    "name": "Q4 2026 Service Mapping Campaign",
    "deadline": "2026-12-15T00:00:00Z"
  }
  ```
- **Response 201 Created:** `IntakeCampaign` with nested `magic_links[]`.

### `GET /api/v1/intake-campaigns/{id}/progress`
- **Summary:** Aggregates department-level and group-level completion progress for a campaign.
- **Auth:** `BearerAuth` / `DevAuth`.
- **Response 200 OK:** `CampaignProgressResponse` with completion percentages.

### `GET /api/v1/intake/{token}`
- **Summary:** Resolves tokenized magic link, updates status to `'opened'`, and returns team context, existing CIs, and active draft.
- **Auth:** None (token hash authentication).
- **Response 200 OK:** `IntakeTokenContextResponse`.

### `PATCH /api/v1/intake/{token}`
- **Summary:** Auto-saves draft services, applications, and dependency selections.
- **Headers:** `If-Match: "<lock_version>"` (required).
- **Payload Limit:** Enforces 2MB maximum payload size limit in middleware.
- **Response 200 OK:** Updated draft payload with incremented `lock_version`.
- **Response 412 Precondition Failed:** If `If-Match` does not match active `lock_version`.

### `POST /api/v1/intake/{token}/submit`
- **Summary:** Atomically validates 10-field envelope, rejects unapproved ITAM fields (`422`), acquires row lock (`FOR UPDATE`), and publishes CIs and dependencies.
- **Headers:** `Idempotency-Key: "<uuid>"` (optional).
- **Response 201 Created:** `SubmitIntakeResponse` with baseline publication details (`Baseline v1.0`).
- **Response 409 Conflict:** If already submitted or approved.
- **Response 422 Unprocessable Entity:** If pre-flight validation fails (`node_errors` detailed map).

---

## 5. Cross-Boundary Edge Handshake (`US-2.4`)

### `GET /api/v1/owner-groups/pending-edges`
- **Summary:** Lists pending cross-boundary dependencies where target CI belongs to caller's groups.
- **Auth:** `BearerAuth` / `DevAuth`.
- **Query Params:** `owner_group_id` (optional).
- **Response 200 OK:** Array of `PendingEdgeItem` objects.

### `POST /api/v1/edges/{id}/confirm`
- **Summary:** Confirms an edge dependency. Restricted to target CI team lead or `platform_admin`.
- **Auth:** `BearerAuth` / `DevAuth`.
- **Response 200 OK:** `GraphEdge` with `handshake_status = 'confirmed'`.

### `POST /api/v1/edges/{id}/flag-mismatch`
- **Summary:** Flags dependency discrepancy.
- **Request Body:** `{"reason": "Service actually connects via Read Replica, not Primary"}`.
- **Response 200 OK:** `GraphEdge` with `handshake_status = 'flagged_mismatch'`.

### `POST /api/v1/edges/{id}/reject`
- **Summary:** Rejects and disconnects unapproved cross-boundary dependency.
- **Response 200 OK:** `GraphEdge` with `handshake_status = 'rejected'`.

---

## 6. Post-Baseline Single-CI & Edge Lifecycle (`US-2.5`, `US-3.3`)

### `POST /api/v1/cis`
- **Summary:** Directly creates a single in-service CI post-baseline.
- **Auth:** Restricted to CI owner group member or `platform_admin`.
- **Validation:** 10-field envelope, Anti-ITAM rejection, `class_metadata <= 2` keys.
- **Response 201 Created:** `CIEnvelope` with `last_verified_at = now()`.

### `POST /api/v1/edges`
- **Summary:** Connects two CIs post-baseline.
- **Self-Loop Check:** Rejects `source_ci_id == target_ci_id` with `HTTP 422`.
- **Response 201 Created:** `GraphEdge` (`confirmed` if internal, `pending_confirmation` if cross-boundary).

### `DELETE /api/v1/edges/{id}`
- **Summary:** Disconnects an edge and records `disconnect` audit log.
- **Response 204 No Content.**

### `PATCH /api/v1/cis/{id}`
- **Summary:** Domain-restricted edits with volatile-only verification stamping and diff auditing.
- **Auth:** Restricted to CI owner group member or `platform_admin`.
- **Volatile Stamping:** Updates `last_verified_at = now()` ONLY when modifying `primary_endpoint`, `technical_contact`, `owner_group_id`, or `criticality_tier`. Cosmetic edits (e.g. `class_metadata`) leave verification timestamp untouched.
- **Retirement Block:** Explicitly rejects retirement via PATCH with `422` (must use `/retire`).
- **Response 200 OK:** Updated `CIEnvelope`.

### `POST /api/v1/cis/{id}/flags`
- **Summary:** Reports data-quality flag on a CI. Open to all authenticated users.
- **Request Body:** `{"reason": "Host offline since last night", "flag_type": "connectivity"}` (reason min 5 chars).
- **Response 201 Created:** `CIFlagResponse`.

---

## 7. Hybrid Search & Detail Aggregation (`US-3.3`)

### `GET /api/v1/cis/search`
- **Summary:** Hybrid prefix/trigram search with deterministic keyset pagination.
- **Query Params:**
  - `q`: Search string. If $<3$ chars, prefix matching; if $\ge 3$ chars, trigram `similarity()` ranking.
  - `ci_class`, `environment`, `owner_group_id`: Optional filters.
  - `limit`: Default 20.
  - `cursor`: Keyset pagination cursor `(score, name, ci_id)`.
- **Response 200 OK:** `CISearchResponse` containing pinned `ownership` objects and `<100ms` latency.

### `GET /api/v1/cis/{id}`
- **Summary:** Aggregates CI envelope, pinned ownership, upward impact summary, downward dependency summary, and verification status (`last_verified_at`, `is_stale`, `open_flag_count`, `pending_edge_count`).
- **Response 200 OK:** `CIDetailResponse`.

---

## 8. Cycle-Safe Graph Traversals (`US-3.1`, `US-3.2`)

### `GET /api/v1/cis/{id}/impact-upward`
- **Summary:** Traverses incoming dependencies (`target_ci_id -> source_ci_id`) with cycle safety and `max_depth = 15`.
- **Query Params:** `include_retired` (boolean, default false).
- **Response 200 OK:** `UpwardImpactResponse`:
  - `highest_criticality_tier`: Highest tier across all reachable upstream nodes (`tier_0` to `tier_3`).
  - `impacted_business_services[]`, `impacted_applications[]`.
  - `shared_sibling_dependencies[]`: Sibling infrastructure supporting the same applications.

### `GET /api/v1/cis/{id}/dependencies-downward`
- **Summary:** Traverses outgoing dependencies (`source_ci_id -> target_ci_id`) with cycle safety and `max_depth = 15`.
- **Shared Dependency Calculation:** Marks any node with `subgraph_in_degree >= 2` as `is_shared_dependency: true`.
- **Response 200 OK:** `DownwardDependenciesResponse`.

---

## 9. Owner Audit Loop & One-Click Actions (`US-4.1`)

### `GET /api/v1/owner-groups/me/digest`
- **Summary:** Returns active open digest cycle and queued review items for caller's owner group.
- **Response 200 OK:** `ActiveDigestResponse`.

### `POST /api/v1/cis/{id}/verify`
- **Summary:** Explicitly verifies operational accuracy of a CI.
- **Auth:** Restricted to CI owner group member or `platform_admin`.
- **Side Effects:**
  - Updates `last_verified_at = now()`.
  - Resolves any open flags on the CI (`status = 'resolved'`).
  - Marks active digest items in open cycles as `status = 'actioned'`, `action_type = 'verify'`.
  - Records `verify` event in `audit_logs`.
- **Response 200 OK:** Updated `CIEnvelope`.

### `POST /api/v1/cis/{id}/retire`
- **Summary:** Retires CI with upstream dependency check.
- **Query Params:** `force` (boolean, default false).
- **Dependent Check:** If active dependents exist (`lifecycle_state = 'in_service'`) and `force != true`, returns `HTTP 409 Conflict` with `dependent_cis` array.
- **Force Bypass:** `force=true` is strictly restricted to `platform_admin` (`403` for non-admins).
- **Response 200 OK:** Updated `CIEnvelope` with `lifecycle_state = 'retired'`.

### `POST /api/v1/admin/digests/trigger`
- **Summary:** Manually triggers an immediate digest evaluation pass for all owner groups.
- **Auth:** Restricted to `platform_admin`.
- **Response 200 OK:** `DigestTriggerResponse`.

---

## 10. Audit History, Streaming Export & Governance Metrics (`US-4.2`, `US-4.3`)

### `GET /api/v1/cis/{id}/audit-logs`
- **Summary:** Cursor-paginated timeline of audit logs for a CI (`created_at DESC, id DESC`).
- **Response 200 OK:** `CIAuditLogsResponse`.

### `GET /api/v1/audit-logs/export`
- **Summary:** Streams immutable audit logs under `REPEATABLE READ` snapshot isolation.
- **Query Params:** `owner_group_id`, `format` (`csv` or `ndjson`), `from`, `to`.
- **Auth:** Non-admins restricted to own group; global export requires `platform_admin`.
- **Formula Sanitization:** Escapes cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with `'` in CSV format.
- **Response 200 OK:** `text/csv` or `application/x-ndjson` stream.

### `GET /api/v1/health/metrics`
- **Summary:** CMDB governance health metrics API.
- **Query Params:** `owner_group_id` (optional).
- **Response 200 OK:** `HealthMetricsResponse`:
  - `freshness_rate`: % of in-service CIs verified within 60 days.
  - `orphan_ci_count`: Count of technical CIs with 0 confirmed paths to applications/business services.
  - `pending_edges_count` & `oldest_pending_age_days`.
  - `digest_completion_rate`: % of actioned items computed strictly over closed cycles.
  - `groups[]`: Per-group breakdowns.
