# Skill Playbook: OpenAPI Contract-First Pipeline

This playbook describes the rules and workflows for defining, validating, and generating code from OpenAPI 3.0.3 contracts in `etcms-backend`.

## Core Guidelines

1. **Single Source of Truth:**
   * All API routes, request bodies, query parameters, headers, and response models MUST be defined in `api/openapi.yaml`.
   * Never write Go HTTP handlers or data structs manually without defining them in `api/openapi.yaml` first.

2. **OpenAPI 3.0.3 Syntax:**
   * Use OpenAPI 3.0.3 specifications.
   * Represent nullable fields using `nullable: true` (e.g. `type: string`, `nullable: true`).
   * Do not use OpenAPI 3.1 syntax (such as `type: [string, "null"]` or `$schema`).

3. **Flattened Schemas:**
   * Never combine `allOf` with `additionalProperties: false`.
   * For composite DTOs (e.g. `CIEnvelope` containing `OwnershipHeader`), define flattened schemas with `additionalProperties: false` at the top level or embed nested object properties explicitly.

4. **Strict Anti-ITAM Schema Guard:**
   * Prohibit ITAM fields (`cost`, `purchase_cost`, `license_count`, `warranty_end`, `vendor`).
   * With `additionalProperties: false`, any unexpected ITAM fields sent in requests trigger a schema validation error returning HTTP `422 Unprocessable Entity`.

5. **Code Generation Workflow:**
   * Run `make generate` to invoke `oapi-codegen` via `oapi-codegen.yaml`.
   * Generated Go interfaces and types reside in `internal/adapters/http/gen/openapi.gen.go`.
   * Handlers implement `gen.StrictServerInterface`.

6. **Error Standard (RFC 9457):**
   * Use `ProblemDetails` schema for error payloads:
     - `title`: Short human-readable summary.
     - `status`: HTTP status code integer.
     - `detail`: Detailed explanation.
     - `instance`: URI or path of the request.
     - `invalid_params` / `node_errors`: Optional structured field-level or node-level validation errors.
