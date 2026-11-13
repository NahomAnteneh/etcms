# AGENTS.md — AI Agent Guardrails & Non-Negotiable Rules

This document establishes the invariant operational and architectural guardrails for `etcms-backend`. Every agent and engineer working on this repository MUST strictly adhere to these rules.

---

## 1. Operating Protocol & Contract-First Pipeline

1. **One Story at a Time:** Deliver features sequentially. Never begin the next prompt/story until the current story's verification gate passes with zero warnings and zero test failures (`make lint && make test -race`).
2. **Contract-First Pipeline:** The single source of truth is `api/openapi.yaml`.
   * **Sequence:** `Spec (api/openapi.yaml) -> Codegen (make generate) -> SQL (sql/queries/*.sql) -> Store -> Service -> Handler`.
   * Never hand-write, patch, or edit generated Go files in `internal/adapters/http/gen/` or `internal/adapters/postgres/gen/`.
   * Never write Go HTTP handlers before defining schemas, parameters, and routes in `api/openapi.yaml` and running `make generate`.
3. **No Drift:** Adhere strictly to the modular `.agents/skills/` playbooks.
4. **Ownership Terminology:** Exclusively use modern ownership terminology (`owner_group`, `team_lead`, `owner_group_id`, `department_name`). Archaic "custodian" terminology is strictly prohibited across code, schemas, DB migrations, and comments.

---

## 2. API Design & OpenAPI 3.0.3 Constraints

1. **OpenAPI 3.0.3 Standard:** Author contracts using OpenAPI 3.0.3 with native `nullable: true` (avoid OpenAPI 3.1 syntax like `type: [string, "null"]` due to generator toolchain limitations).
2. **Flattened Schemas:** All composite request and response DTOs (e.g., `CIEnvelope` containing `OwnershipHeader`) MUST be defined as **flattened schemas** with top-level `additionalProperties: false`. Never combine `allOf` with `additionalProperties: false` as it causes `kin-openapi` and `oapi-codegen` schema collision errors.
3. **Strict Anti-ITAM Schema Enforcement:** Any payload containing unapproved ITAM fields (such as `cost`, `purchase_cost`, `license_count`, `warranty_end`, or `vendor`) MUST be rejected with HTTP `422 Unprocessable Entity`.
4. **Generated Server Interfaces:** All handlers MUST implement the generated `StrictServerInterface` in `internal/adapters/http/gen/openapi.gen.go`.
5. **RFC 9457 Problem Details:** All errors MUST return standard RFC 9457 Problem Details:
   * `400 Bad Request`: Unparseable syntax (malformed JSON, invalid UUID format, illegal query parameters).
   * `401 Unauthorized`: Missing or expired tokens / intake magic link tokens.
   * `403 Forbidden`: Domain RBAC violations (e.g. non-owner modifying CI).
   * `404 Not Found`: Resource or token does not exist.
   * `409 Conflict`: State-machine or dependency conflicts (e.g. retiring CI with active dependents).
   * `412 Precondition Failed`: Optimistic concurrency conflict on draft auto-saves (`If-Match` version mismatch).
   * `422 Unprocessable Entity`: Syntactically valid JSON violating schema constraints or business rules.

---

## 3. Database, Graph & Audit Rules

1. **Append-Only Audit Logs:** The `audit_logs` table is strictly append-only. Triggers `audit_logs_no_update_delete` and `audit_logs_no_truncate` prevent any `UPDATE`, `DELETE`, or `TRUNCATE` operations at the database level.
2. **Class Metadata Limits:** The `cis.class_metadata` field is constrained to a JSON object with at most 2 keys:
   `CHECK (jsonb_typeof(class_metadata) = 'object' AND fn_jsonb_key_count(class_metadata) <= 2)`.
3. **Canonical Edge Direction:**
   * `source_ci_id` = Dependent / Consumer (e.g. Application).
   * `target_ci_id` = Dependency / Provider (e.g. Database).
   * Self-dependencies are forbidden: `CHECK (source_ci_id != target_ci_id)`.
4. **Cycle-Safe Traversal:** Graph traversal queries MUST be cycle-safe and avoid combinatorial path explosion by traversing node-by-node using bounded `UNION` recursion (`max_depth = 15`).
5. **Transactional Audit Wrapper:** All mutating domain actions MUST execute within `postgres.Store.WithAuditTx(ctx, actor, fn)`, which configures `set_config('etcms.actor_id', actor.ID.String(), true)` and writes audit log entries.
6. **Refined Verification Stamping:** `last_verified_at = now()` is updated ONLY upon:
   * Initial publication into `in_service`.
   * Explicit verification via `POST /api/v1/cis/{id}/verify`.
   * Mutation of volatile operational fields (`primary_endpoint`, `technical_contact`, `owner_group_id`, `criticality_tier`).
   Cosmetic changes (e.g., `class_metadata`) update `updated_at` only.

---

## 4. Security & Environment Guards

1. **Development Auth Guard:**
   * If `APP_ENV != "development"` and `APP_ENV != "test"`, incoming `X-Dev-User-ID` headers are ignored.
   * If `ALLOW_DEV_AUTH_HEADER=true` when `APP_ENV` is production/staging, the server MUST refuse to boot with a fatal error.
2. **Formula Injection Sanitization:** CSV exports MUST sanitize every text cell starting with `=`, `+`, `-`, `@`, `\t`, or `\r` by prefixing with `'`.
