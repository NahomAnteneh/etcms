# Skill Playbook: Backend TDD & Testcontainers Testing

This playbook establishes testing standards and practices for `etcms-backend`.

## Core Guidelines

1. **Table-Driven Tests:**
   * Write comprehensive, table-driven unit and integration tests covering happy paths, edge cases, constraint violations, and RBAC rejections.

2. **Integration Testing with Testcontainers-Go:**
   * Spin up real `postgres:16-alpine` containers using `github.com/testcontainers/testcontainers-go` and `modules/postgres`.
   * Apply goose migrations to the test database prior to test execution.
   * Verify schema constraints directly against the real PostgreSQL engine (e.g. `fn_jsonb_key_count`, partial unique indexes, immutability triggers).

3. **Concurrency & Race Testing:**
   * All test suites must pass `go test -v -race ./...` with zero race conditions.
   * Test optimistic concurrency (`If-Match` version matching) and row locking (`FOR UPDATE`).

4. **Zero Flakiness:**
   * Clean up database state or utilize isolated transactions / ephemeral containers for test execution.
   * Assert specific database error codes (e.g. PostgreSQL `23514` for check constraint violation, `P0001` for trigger exceptions) rather than generic string assertions when possible.
