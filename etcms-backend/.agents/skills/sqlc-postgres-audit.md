# Skill Playbook: PostgreSQL, Goose Migrations, sqlc & Immutable Audit

This playbook covers schema design, migrations, type-safe queries, and transactional audit logging in `etcms-backend`.

## Core Guidelines

1. **Goose Migrations:**
   * Migrations live in `migrations/` named `00001_init_schema.sql`, `00002_intake_campaigns.sql`, etc.
   * Every migration file MUST contain both `-- +goose Up` and `-- +goose Down` sections.
   * Down migrations must cleanly drop triggers, tables, constraints, functions, indexes, and custom enum types in reverse dependency order.

2. **Immutable Audit Log Pattern:**
   * The `audit_logs` table records every entity mutation.
   * Trigger functions raise PostgreSQL exceptions on any `UPDATE`, `DELETE`, or `TRUNCATE` operations:
     ```sql
     CREATE OR REPLACE FUNCTION trg_audit_logs_prevent_mutation() RETURNS trigger
     LANGUAGE plpgsql AS $$
     BEGIN
       RAISE EXCEPTION 'audit_logs is append-only: % is strictly prohibited', TG_OP;
     END;
     $$;
     ```
   * Triggers:
     - `BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION trg_audit_logs_prevent_mutation();`
     - `BEFORE TRUNCATE ON audit_logs EXECUTE FUNCTION trg_audit_logs_prevent_mutation();`

3. **Domain Constraints in DDL:**
   * Class metadata object count constraint:
     ```sql
     CREATE OR REPLACE FUNCTION fn_jsonb_key_count(j jsonb) RETURNS integer
     LANGUAGE sql IMMUTABLE STRICT AS $$
       SELECT count(*)::integer FROM jsonb_object_keys(j);
     $$;
     ```
     Table constraint: `CHECK (jsonb_typeof(class_metadata) = 'object' AND fn_jsonb_key_count(class_metadata) <= 2)`.
   * Active CI name uniqueness:
     `CREATE UNIQUE INDEX uq_cis_active_name ON cis (lower(name), ci_class, environment) WHERE lifecycle_state != 'retired';`
   * Graph self-loop prevention: `CHECK (source_ci_id != target_ci_id)`.

4. **sqlc Generation:**
   * SQL queries reside in `sql/queries/*.sql`.
   * Generated Go code resides in `internal/adapters/postgres/gen/`.
   * Configure `sqlc.yaml` with engine `postgresql`, schema `migrations/`, and queries `sql/queries/`.

5. **Transactional Audit Wrapper (`WithAuditTx`):**
   * All mutations must execute inside `Store.WithAuditTx(ctx, actor, fn)`.
   * Sets PostgreSQL session config: `set_config('etcms.actor_id', actor.ID.String(), true)`.
   * Records audit entries with `actor_id`, `entity_type`, `entity_id`, `affected_owner_group_ids`, `action`, and `diff`.
