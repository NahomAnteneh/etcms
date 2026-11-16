# API Reference & Contract Specification

This document provides a complete reference for all REST API endpoints defined in [`api/openapi.yaml`](../api/openapi.yaml) and implemented in the `etcms-backend` service.

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

### `POST /api/v1/admin/intake/campaigns`
- **Summary:** Launches an intake campaign and generates tokenized magic links for all team leads.
- **Auth:** Restricted to `platform_admin` (`HTTP 403 Forbidden` for non-admins).
- **Request Body:**
  ```json
  {
    "title": "Q4 2026 Service Mapping Campaign",
    "deadline": "2026-12-15T00:00:00Z",
    "owner_group_ids": ["7fa85f64-5717-4562-b3fc-2c963f66afa6"]
  }
  ```
- **Past Deadline Guard:** If `deadline <= now()`, rejected with `HTTP 422 Unprocessable Entity` (`"campaign deadline must be in the future"`).
- **Empty Owner Groups Guard:** If `owner_group_ids` is empty, rejected with `HTTP 422 Unprocessable Entity` (`"at least one owner group must be specified"`).
- **Response 201 Created:** `CampaignResponse` with nested `invitations[]` containing magic link URLs (`/intake/<rawToken>`).

### `GET /api/v1/admin/intake/campaigns/{id}/progress`
- **Summary:** Aggregates department-level and group-level completion progress for a campaign.
- **Auth:** `BearerAuth` / `DevAuth`.
- **Response 200 OK:** `CampaignProgressResponse` with departmental breakdowns (`sent_count`, `opened_count`, `submitted_count`, `overdue_count`).

### `GET /api/v1/intake/{token}`
- **Summary:** Resolves tokenized magic link, updates status to `'opened'`, and returns team context, existing CIs, and active draft.
- **Auth:** Token hash authentication (`intake_invitations.token_hash`).
- **Errors:**
  - `HTTP 401 Unauthorized`: If the magic link token is expired (`expires_at <= now()`) or in `'expired'` status.
  - `HTTP 404 Not Found`: If the magic link token does not exist in `intake_invitations`.
- **Response 200 OK:** `IntakeContextResponse`.

### `PATCH /api/v1/intake/{token}`
- **Summary:** Auto-saves draft services, applications, and dependency selections.
- **Auth:** Token hash authentication (`intake_invitations.token_hash`).
- **Headers:** `If-Match: "<lock_version>"` (required).
- **Payload Limit:** Enforces 2MB maximum payload size limit in middleware.
- **Errors:**
  - `HTTP 401 Unauthorized`: If the magic link token is expired or invalid.
  - `HTTP 404 Not Found`: If the magic link token does not exist.
  - `HTTP 409 Conflict`: If the submission has already been submitted/approved (`"intake submission is not in draft status"`).
  - `HTTP 412 Precondition Failed`: If `If-Match` does not match active `lock_version` (`"lock version mismatch"`).
  - `HTTP 422 Unprocessable Entity`: If prohibited Anti-ITAM fields are present.
- **Response 200 OK:** Updated draft payload with incremented `lock_version`.

### `POST /api/v1/intake/{token}/submit`
- **Summary:** Atomically validates the 10-field envelope, rejects unapproved ITAM fields (`422`), acquires row lock (`FOR UPDATE`), and publishes CIs and dependencies into an approved baseline.
- **Auth:** Token hash authentication (`intake_invitations.token_hash`).
- **Headers:** `Idempotency-Key: "<uuid>"` (optional).
- **10-Field Envelope Validation (`validateIntakePayload`):** Every declared service or application item is strictly validated against the 10-field envelope:
  1. `name` (required, string, 1-160 chars)
  2. `ci_class` (required, enum: `business_service`, `application`, `database`, `vm_cluster`, `physical_host`, `network_firewall`)
  3. `environment` (required, enum: `prod`, `dr`, `staging`)
  4. `criticality_tier` (required, enum: `tier_0`, `tier_1`, `tier_2`, `tier_3`)
  5. `technical_contact` (required, string, 1-160 chars)
  6. `owner_group_id` (implicitly bound to the invitation's owner group during publication)
  7. `primary_endpoint` (optional, string, nullable, max 255 chars)
  8. `itam_external_ref` (optional, string, nullable, max 512 chars)
  9. `class_metadata` (optional, JSON object, max 2 keys)
  10. `last_verified_at` (timestamp, automatically initialized to `now()` on baseline publication)
- **Dependency Linking Validation:**
  - `source_ci_name`: Must match a declared service in the submission.
  - `target_ci_id`: Must exist in active CI catalog (returns `422` with node error if not found).
  - `edge_type`: Valid enum (`depends_on`, `hosted_on`, `connects_to`, `reads_from`).
  - Self-dependencies are forbidden: `targetCI.Name == dep.SourceCIName` rejected with `422`.
- **Anti-ITAM Enforcement:** Rejects unapproved ITAM fields (`cost`, `purchase_cost`, `license_count`, `warranty_end`, `vendor`) with `HTTP 422 Unprocessable Entity`.
- **Responses:**
  - **`HTTP 200 OK` (Idempotent Replay):** Returned when resubmitting a token whose submission is already in `'submitted'` or `'approved'` status, returning the existing baseline snapshot.
  - **`HTTP 201 Created`:** Returned on initial successful publication of the baseline.
  - **`HTTP 401 Unauthorized`:** If token is expired.
  - **`HTTP 404 Not Found`:** If token does not exist.
  - **`HTTP 409 Conflict`:** If submission is marked submitted/approved but the existing baseline record cannot be found.
  - **`HTTP 422 Unprocessable Entity`:** If pre-flight validation fails (`node_errors` detailed map) or Anti-ITAM prohibited fields are detected.

---

## 5. Cross-Boundary Edge Handshake (`US-2.4`)

### `GET /api/v1/owner-groups/pending-edges`
- **Summary:** Lists pending cross-boundary dependencies where target CI belongs to caller's groups.
- **Auth:** `BearerAuth` / `DevAuth`.
- **Query Params:** `owner_group_id` (optional).
- **Response 200 OK:** Array of `PendingEdgeItem` objects.

### `POST /api/v1/edges/{id}/confirm`
- **Summary:** Confirms an edge dependency. Restricted to target CI team lead (`actor.BelongsToOwnerGroup(edge.TargetOwnerGroupID)`) or `platform_admin`. Users with `role = viewer` are rejected with `HTTP 403 Forbidden`.
- **Auth:** `BearerAuth` / `DevAuth`.
- **Response 200 OK:** `GraphEdge` with `handshake_status = 'confirmed'`.

### `POST /api/v1/edges/{id}/flag-mismatch`
- **Summary:** Flags dependency discrepancy.
- **Auth:** Restricted to target CI team lead (`actor.BelongsToOwnerGroup(edge.TargetOwnerGroupID)`) or `platform_admin`. Users with `role = viewer` are rejected with `HTTP 403 Forbidden`.
- **State Machine:** If the edge is already `rejected`, returns `HTTP 409 Conflict`.
- **Reason Storage:** The `reason` string is persisted in `audit_logs.diff` JSONB (`{"action": "flag_edge_mismatch", "previous_status": "...", "new_status": "flagged_mismatch", "reason": "..."}`). `ci_edges` has no `reason` column; only `handshake_status` is updated.
- **Request Body:** `{"reason": "Service actually connects via Read Replica, not Primary"}`.
- **Response 200 OK:** `GraphEdge` with `handshake_status = 'flagged_mismatch'`.

### `POST /api/v1/edges/{id}/reject`
- **Summary:** Rejects and disconnects unapproved cross-boundary dependency.
- **Auth:** Restricted to target CI team lead (`actor.BelongsToOwnerGroup(edge.TargetOwnerGroupID)`) or `platform_admin`. Users with `role = viewer` are rejected with `HTTP 403 Forbidden`.
- **State Machine:** If the edge is already `rejected`, returns `HTTP 409 Conflict`.
- **Response 200 OK:** `GraphEdge` with `handshake_status = 'rejected'`.

---

## 6. Post-Baseline Single-CI & Edge Lifecycle (`US-2.5`, `US-3.3`)

### `POST /api/v1/cis`
- **Summary:** Directly creates a single in-service CI post-baseline.
- **Auth:** Restricted to CI owner group member (`actor.BelongsToOwnerGroup(req.OwnerGroupId)`) or `platform_admin`. Users with `role = viewer` are explicitly rejected with `HTTP 403 Forbidden`.
- **10-Field Envelope Validation:**
  1. `name` (required, string, trimmed, 1-160 chars)
  2. `ci_class` (required, enum: `business_service`, `application`, `database`, `vm_cluster`, `physical_host`, `network_firewall`)
  3. `environment` (required, enum: `prod`, `dr`, `staging`)
  4. `criticality_tier` (required, enum: `tier_0`, `tier_1`, `tier_2`, `tier_3`)
  5. `owner_group_id` (required, UUID; caller must belong to this group unless `platform_admin`)
  6. `technical_contact` (required, string, trimmed, 1-160 chars)
  7. `primary_endpoint` (optional, string, nullable, max 255 chars)
  8. `last_verified_at` (automatically stamped to `now()` upon creation)
  9. `itam_external_ref` (optional, string, nullable, max 512 chars)
  10. `class_metadata` (optional, JSON object, max 2 keys; $>2$ keys rejected with `422`)
- **Anti-ITAM Enforcement:** Rejects unapproved ITAM fields (`cost`, `purchase_cost`, `license_count`, `warranty_end`, `vendor`) with `HTTP 422 Unprocessable Entity`.
- **Response 201 Created:** `CIEnvelope` with `last_verified_at = now()`.

### `POST /api/v1/edges`
- **Summary:** Connects two CIs post-baseline.
- **Auth:** Restricted to team leads belonging to the source OR target CI owner group, or `platform_admin`. Rejects `role = viewer` with `HTTP 403 Forbidden`.
- **Self-Loop Check:** Rejects `source_ci_id == target_ci_id` with `HTTP 422 Unprocessable Entity`.
- **Response 201 Created:** `GraphEdge` (`confirmed` if internal, `pending_confirmation` if cross-boundary).

### `DELETE /api/v1/edges/{id}`
- **Summary:** Disconnects an edge and records `disconnect` audit log.
- **Auth:** Viewers cannot delete edges (`role = viewer` returns `HTTP 403 Forbidden`). Caller must belong to either the source CI owner group or target CI owner group (`actor.BelongsToOwnerGroup(...)`), or be `platform_admin`.
- **Response 204 No Content.**

### `PATCH /api/v1/cis/{id}`
- **Summary:** Domain-restricted edits with volatile-only verification stamping and diff auditing.
- **Auth:** Restricted to CI owner group member (`actor.BelongsToOwnerGroup(...)`) or `platform_admin`. Users with `role = viewer` or non-members of the CI's owner group are rejected with `HTTP 403 Forbidden`.
- **Field Mutability & Stamping Rules (`internal/service/cis.go:452-573`):**
  - **Volatile Operational Fields:** Modifying `primary_endpoint`, `technical_contact`, `owner_group_id`, or `criticality_tier` updates `last_verified_at = now()` AND `updated_at = now()`.
  - **Cosmetic / Metadata Fields:** Modifying `name`, `ci_class`, `environment`, `itam_external_ref`, or `class_metadata` ($\le 2$ keys) updates `updated_at = now()` ONLY, leaving `last_verified_at` untouched.
  - **Class Metadata Validation:** If provided, `class_metadata` must be a JSON object with at most 2 keys. Providing $>2$ keys is rejected with `HTTP 422 Unprocessable Entity`.
  - **Lifecycle State:** Can be updated between `planned`, `in_service`, and `deprecated`. Attempting to set `lifecycle_state = 'retired'` via PATCH is explicitly rejected with `HTTP 422 Unprocessable Entity` (retirements must use `POST /api/v1/cis/{id}/retire`).
- **Response 200 OK:** Updated `CIEnvelope`.

### `POST /api/v1/cis/{id}/flags`
- **Summary:** Reports data-quality flag on a CI. Open to all authenticated users (`viewer`, `team_lead`, `platform_admin`).
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
- **Auth:** Restricted to CI owner group member (`actor.BelongsToOwnerGroup(ci.OwnerGroupID)`) or `platform_admin`.
- **Side Effects:**
  - Updates `last_verified_at = now()`.
  - Resolves any open flags on the CI (`status = 'resolved'`).
  - Marks active digest items in open cycles as `status = 'actioned'`, `action_type = 'verify'`.
  - Records `verify` event in `audit_logs`.
- **Response 200 OK:** Updated `CIEnvelope`.

### `POST /api/v1/cis/{id}/retire`
- **Summary:** Retires CI with upstream dependency check.
- **Auth:** Restricted to CI owner group member (`actor.BelongsToOwnerGroup(ci.OwnerGroupID)`) or `platform_admin`.
- **Query Params:** `force` (boolean, default false).
- **Dependent Check:** Inspects all incoming edges in `ci_edges` with in-service source CIs (`GetActiveUpstreamDependents`). Edge `handshake_status` is not filtered (unconfirmed and flagged edges also block retirement). If active dependents exist (`lifecycle_state = 'in_service'`) and `force != true`, returns `HTTP 409 Conflict` with `dependent_cis` array.
- **Force Bypass:** `force=true` is strictly restricted to `platform_admin` (`HTTP 403 Forbidden` for non-admins).
- **Response 200 OK:** Updated `CIEnvelope` with `lifecycle_state = 'retired'`.

### `POST /api/v1/admin/digests/trigger`
- **Summary:** Manually triggers an immediate digest evaluation pass for all owner groups.
- **Auth:** Restricted to `platform_admin` (`HTTP 403 Forbidden` for non-admins).
- **Response 200 OK:** `DigestTriggerResponse`.

---

## 10. Audit History, Streaming Export & Governance Metrics (`US-4.2`, `US-4.3`)

### `GET /api/v1/cis/{id}/audit-logs`
- **Summary:** Cursor-paginated timeline of audit logs for a CI (`created_at DESC, id DESC`).
- **Auth:** Requires authentication (`HTTP 401 Unauthorized` if unauthenticated). Accessible to all authenticated roles (`viewer`, `team_lead`, `platform_admin`).
- **Query Params:**
  - `cursor`: Base64-encoded keyset cursor token containing `(created_at, id)` for deterministic timeline pagination.
  - `limit`: Integer page limit (default 20, max 100).
- **Errors:** Returns `HTTP 404 Not Found` if CI does not exist.
- **Response 200 OK:** `CIAuditLogsResponse` containing `items[]` array, `total_count`, and `next_cursor` (null when end of timeline is reached).

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

---

## 11. System Administration & Custom Governance

### `POST /api/v1/owner-groups`
- **Summary:** Creates a new owner group with automatic slug generation.
- **Auth:** Restricted to `platform_admin` (`HTTP 403 Forbidden` for non-admins).
- **Request Body:** `CreateOwnerGroupRequest` (`name`, `department_name`, `team_lead_name`, `team_lead_email`, optional `slug`).
- **Response 201 Created:** `OwnerGroup`.

### `PUT /api/v1/owner-groups/{id}`
- **Summary:** Updates metadata for an existing owner group.
- **Auth:** Restricted to `platform_admin`.
- **Response 200 OK:** Updated `OwnerGroup`.

### `DELETE /api/v1/owner-groups/{id}`
- **Summary:** Deletes an owner group. Fails if CIs or users are currently associated.
- **Auth:** Restricted to `platform_admin`.
- **Response 204 No Content.**

### `GET /api/v1/admin/ci-classes`
- **Summary:** Lists all system and custom CI class definitions.
- **Auth:** Requires authentication.
- **Response 200 OK:** Array of `CIClassDefinition` objects.

### `POST /api/v1/admin/ci-classes`
- **Summary:** Registers a custom CI class definition.
- **Auth:** Restricted to `platform_admin`.
- **Request Body:** `CreateCIClassRequest` (`id`, `label`, `category`, `description`, `icon`, `attributes`).
- **Response 201 Created:** `CIClassDefinition`.

### `PUT /api/v1/admin/ci-classes/{id}`
- **Summary:** Updates a custom CI class definition (system classes are protected).
- **Auth:** Restricted to `platform_admin`.
- **Response 200 OK:** Updated `CIClassDefinition`.

### `DELETE /api/v1/admin/ci-classes/{id}`
- **Summary:** Deletes a custom CI class definition.
- **Auth:** Restricted to `platform_admin`.
- **Response 204 No Content.**

### `GET /api/v1/admin/roles`
- **Summary:** Lists all custom RBAC roles and permissions.
- **Auth:** Requires authentication.
- **Response 200 OK:** Array of `CustomRole` objects.

### `POST /api/v1/admin/roles`
- **Summary:** Creates a custom RBAC role with granular capability assignments.
- **Auth:** Restricted to `platform_admin`.
- **Response 201 Created:** `CustomRole`.

### `DELETE /api/v1/admin/roles/{id}`
- **Summary:** Deletes a custom role (system roles are protected).
- **Auth:** Restricted to `platform_admin`.
- **Response 204 No Content.**

### `GET /api/v1/admin/users`
- **Summary:** Lists user accounts with their assigned custom role and primary owner group.
- **Auth:** Restricted to `platform_admin`.
- **Response 200 OK:** Array of `AdminUserResponse`.

### `POST /api/v1/admin/users`
- **Summary:** Creates a user account with assigned role and owner group.
- **Auth:** Restricted to `platform_admin`.
- **Response 201 Created:** `AdminUserResponse`.

### `POST /api/v1/audit-logs/{id}/revert`
- **Summary:** Reverts an audit mutation with compensating transaction.
- **Auth:** Restricted to `platform_admin`.
- **Response 200 OK:** `RevertAuditLogResponse`.
