# Audit Loop, Governance Digests & Metrics

This document details the bi-weekly owner audit digest worker, one-click verification and retirement actions, immutable audit timeline, streaming export with formula injection sanitization, and CMDB governance health metrics.

---

## 1. Bi-Weekly Fixed-Window Digest Scheduler (`US-4.1`)

In enterprise organizations, configuration data decays rapidly if not continuously verified by the engineering teams that own the services. The `etcms-backend` system implements an automated, calendar-anchored audit loop.

### Calendar Window Anchoring
Digest cycles are strictly anchored to fixed calendar windows:
- **First Half:** 1st of the month at 00:00:00 UTC $\to$ 15th of the month at 00:00:00 UTC.
- **Second Half:** 15th of the month at 00:00:00 UTC $\to$ 1st of the next month at 00:00:00 UTC.

```go
func CalculateCurrentWindow(t time.Time) (windowStart, windowEnd, prevWindowStart time.Time)
```

### Distributed Safety & Idempotency
Multiple instances of the backend or scheduler worker can run concurrently or restart at any time without duplicating cycles:
```sql
INSERT INTO digest_cycles (id, owner_group_id, window_start, window_end, status, created_at)
VALUES (@id, @owner_group_id, @window_start, @window_end, 'open', @created_at)
ON CONFLICT (owner_group_id, window_start) DO NOTHING;
```
Each item in a cycle is deduplicated via `CONSTRAINT uq_digest_items_cycle_ci UNIQUE (cycle_id, ci_id)`.

### Trigger Reasons & Evaluation Prioritization
For each active owner group, the scheduler selects CIs matching at least one trigger condition. When a CI matches multiple triggers, the reason is prioritized in order of operational urgency:

```
[ Priority 1: open_flag ]
  --> Active data-quality report filed by another team or user.
  
[ Priority 2: pending_edge ]
  --> Incoming cross-boundary dependency waiting for team lead confirmation.
  
[ Priority 3: stale_verification ]
  --> Operational CI in 'in_service' state not verified in > 60 days.
  
[ Priority 4: recent_change ]
  --> Created or updated since the start of the previous review window.
```

### Cycle Transition & Expiration
When a new review window begins:
1. All previous open cycles for that owner group are transitioned to `'closed'` with `closed_at = now()`.
2. Any un-actioned review items in those closed cycles are transitioned to `'expired'`.

### Webhook Notification
If `DIGEST_WEBHOOK_URL` is set in the environment, the worker posts a structured JSON notification payload containing team lead details, cycle window, and summary counts by trigger reason.

---

## 2. One-Click Digest Actions (`US-4.1`)

### Explicit Verification (`POST /api/v1/cis/{id}/verify`)
1. **Authorization & RBAC:** Users with `role = viewer` are strictly read-only and rejected with `HTTP 403 Forbidden`. Team leads must belong to the CI's owner group (`actor.BelongsToOwnerGroup(ci.OwnerGroupID)`). Users with `role = platform_admin` have global bypass privileges.
2. **Atomic Side Effects (inside `WithAuditTx`):**
   - Sets `last_verified_at = now()`.
   - Resolves all open flags on that CI in `ci_flags` (`status = 'resolved'`, `resolved_by = actor.ID`, `resolved_at = now()`).
   - Marks active review items in open cycles as `status = 'actioned'`, `action_type = 'verify'`, `actioned_at = now()`.
   - Writes structured audit log with action `"verify"`.

### Safe CI Retirement (`POST /api/v1/cis/{id}/retire`)
Retiring a database or shared API prematurely can trigger cascading outages for dependent services.
1. **Authorization & RBAC:** Users with `role = viewer` are strictly read-only and rejected with `HTTP 403 Forbidden`. Team leads must belong to the CI's owner group (`actor.BelongsToOwnerGroup(ci.OwnerGroupID)`). Users with `role = platform_admin` have global bypass privileges.
2. **Upstream Active Dependent Check (`sql/queries/cis.sql` - `GetActiveUpstreamDependents`):**
   - Queries `ci_edges` for active dependents:
     ```sql
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
         og.name AS owner_group_name
     FROM ci_edges e
     JOIN cis c ON c.ci_id = e.source_ci_id
     JOIN owner_groups og ON og.id = c.owner_group_id
     WHERE e.target_ci_id = @target_ci_id
       AND c.lifecycle_state = 'in_service'
     ORDER BY c.name ASC;
     ```
   - **`handshake_status` Filtering Behavior:** Notice that `GetActiveUpstreamDependents` does **not** filter out edges by `handshake_status`. Any incoming edge from an active `in_service` CI (even if `pending_confirmation` or `flagged_mismatch`) blocks standard retirement to prevent accidental disruption.
   - If active dependents exist and `force != true`:
     - Aborts with **`HTTP 409 Conflict`**.
     - Returns RFC 9457 Problem Details containing the array of blocking `dependent_cis`.
3. **Force Retirement Bypass (`force=true`):**
   - Strictly restricted to `platform_admin` role (`HTTP 403 Forbidden` if called by regular team lead or non-admin user).
   - Records `"force": true` in the audit log diff.
4. **Successful Retirement:**
   - Transitions `lifecycle_state = 'retired'`.
   - Marks active digest items as `status = 'actioned'`, `action_type = 'retire'`.
   - Writes structured audit log with action `"retire"`.

---

## 3. Immutable CI Change Audit Trail & Hardened Export (`US-4.2`)

### Append-Only Invariant
Auditing is non-negotiable. Database-level triggers prevent any `UPDATE`, `DELETE`, or `TRUNCATE` operations on `audit_logs`.

### Cursor-Paginated Timeline (`GET /api/v1/cis/{id}/audit-logs`)
- Provides deterministic keyset pagination on `(created_at DESC, id DESC)`.
- Returns actor details (`actor_name`, `actor_email`), timestamp, action, and JSON field-level diffs.

### Streaming Audit Export (`GET /api/v1/audit-logs/export`)
- **Snapshot Isolation:** Executes inside a PostgreSQL `REPEATABLE READ` read-only transaction snapshot to ensure point-in-time consistency across large exports.
- **Multi-Tenant RBAC Guard:**
  - Team leads may only export logs where `affected_owner_group_ids` contains their group.
  - Global exports (omitting `owner_group_id`) are strictly restricted to `platform_admin`.
- **Streaming Pipeline:** Uses `io.Pipe()` with a background writer goroutine, enabling $O(1)$ memory buffering even when streaming millions of audit entries.
- **Formula Injection Sanitization (AGENTS.md Rule 4.2):**
  Spreadsheet software (Microsoft Excel, LibreOffice Calc, Google Sheets) interprets cells starting with formula characters as executable expressions.
  - In CSV exports, every text cell is inspected:
    ```go
    func SanitizeCSVCell(val string) string {
        if len(val) > 0 {
            first := val[0]
            if first == '=' || first == '+' || first == '-' || first == '@' || first == '\t' || first == '\r' {
                return "'" + val
            }
        }
        return val
    }
    ```
  - Prefixing with a single quote `'` forces spreadsheet parsers to treat the content as literal text.

---

## 4. CMDB Governance Health Metrics API (`US-4.3`)

The endpoint `GET /api/v1/health/metrics` computes quantitative governance metrics globally and across individual owner groups.

### 1. Freshness Rate
The percentage of active operational CIs verified within the last 60 days:
$$\text{Freshness Rate} = \frac{\text{Count}(\text{in\_service CIs with } \text{last\_verified\_at} \ge \text{now()} - 60\text{d})}{\text{Count}(\text{Total in\_service CIs})} \times 100$$
*(If total in-service CIs is 0, freshness rate defaults to 100.0%)*

### 2. Orphan CI Count
Technical infrastructure items (`database`, `vm_cluster`, `physical_host`, `network_firewall`) that have zero confirmed upward dependency paths reaching a `business_service` or `application`. Identified via recursive CTE (`sql/queries/health_metrics.sql`):
```sql
WITH RECURSIVE upstream AS (
    SELECT
        e.target_ci_id AS technical_ci_id,
        e.source_ci_id AS ancestor_id,
        c.ci_class AS ancestor_class,
        1 AS depth
    FROM ci_edges e
    JOIN cis tc ON tc.ci_id = e.target_ci_id
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE tc.lifecycle_state = 'in_service'
      AND tc.ci_class IN ('database', 'vm_cluster', 'physical_host', 'network_firewall')
      AND c.lifecycle_state = 'in_service'
      AND e.handshake_status = 'confirmed'
    UNION
    SELECT
        u.technical_ci_id,
        e.source_ci_id AS ancestor_id,
        c.ci_class AS ancestor_class,
        u.depth + 1 AS depth
    FROM ci_edges e
    JOIN upstream u ON e.target_ci_id = u.ancestor_id
    JOIN cis c ON c.ci_id = e.source_ci_id
    WHERE u.depth < 15
      AND c.lifecycle_state = 'in_service'
      AND e.handshake_status = 'confirmed'
)
SELECT count(*)::integer AS orphan_count
FROM cis c
WHERE c.lifecycle_state = 'in_service'
  AND c.ci_class IN ('database', 'vm_cluster', 'physical_host', 'network_firewall')
  AND (
      @owner_group_id::uuid IS NULL
      OR @owner_group_id::uuid = '00000000-0000-0000-0000-000000000000'::uuid
      OR c.owner_group_id = @owner_group_id
  )
  AND NOT EXISTS (
      SELECT 1
      FROM upstream u
      WHERE u.technical_ci_id = c.ci_id
        AND u.ancestor_class IN ('business_service', 'application')
  );
```

#### Anchor Optimization & `handshake_status` Invariants:
- **Anchor Filtering Optimization:** The recursive anchor explicitly filters `target_ci_id` on `tc.lifecycle_state = 'in_service'` and technical classes (`database`, `vm_cluster`, `physical_host`, `network_firewall`). This avoids initializing CTE recursion for irrelevant edges between application nodes or non-technical targets.
- **Strict `handshake_status = 'confirmed'` Requirement:** Unlike impact and dependency traversals (which evaluate all edges regardless of handshake status for full visibility), the orphan calculation **strictly requires** `e.handshake_status = 'confirmed'`. Unconfirmed (`pending_confirmation`), flagged (`flagged_mismatch`), or rejected edges do not constitute a verified operational link. An infrastructure item linked only by pending or disputed edges is legitimately counted as an orphan until the dependency is confirmed.

### 3. Pending Edge Confirmations & Oldest Age
- Count of `ci_edges` with `handshake_status = 'pending_confirmation'`.
- `oldest_pending_age_days`: $\frac{\text{now()} - \min(\text{created\_at})}{86400}$.

### 4. Digest Completion Rate
A critical measure of owner responsiveness. Computed **strictly over closed/expired cycles** (excluding active open cycles where time remains):
$$\text{Digest Completion Rate} = \frac{\text{Count}(\text{Digest Items actioned in closed cycles})}{\text{Count}(\text{Total Digest Items in closed cycles})} \times 100$$
*(If total items in closed cycles is 0, completion rate defaults to 100.0%)*
