# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

React 19 + TypeScript + Vite + Tailwind CSS v4 + Radix UI + TanStack Query + React Flow (@xyflow/react)

## Users

- **Department Team Leads:** Engineering leads and service owners who register services, applications, and dependencies via tokenized magic links without prior account provisioning; responsible for bi-weekly verification of owned CIs and cross-boundary dependency handshakes.
- **Platform Administrators & Enterprise Architects:** Oversee CMDB health, launch decentralized intake campaigns, inspect enterprise-wide graph topologies, and execute emergency governance actions.
- **Incident Responders & SREs (Viewers):** Triage production incidents by querying sub-500ms blast radius (upward impact) to identify affected tier-0/tier-1 business services, and file data-quality dispute flags.

## Product Purpose

ETCMS replaces bureaucratic, workshop-heavy CMDB data entry with a high-performance, decentralized Configuration Management System. Success means zero duplicate infrastructure CIs, 100% cycle-safe graph traversals, active owner verification within a 60-day calendar cycle, and an immutable audit trail.

## Positioning

Unlike bloated legacy ITAM/ITSM suites that demand synchronous workshops and manual asset tracking, ETCMS is a lean, developer-first CMDB anchored on decentralized tokenized intake campaigns, strict Anti-ITAM guardrails (zero cost/licensing clutter), sub-500ms recursive blast-radius graph traversal, and automated owner verification digests.

## Operating Context

- **Decentralized Intake Campaigns:** Periodic onboarding campaigns where team leads receive cryptographic magic links (`/intake/:token`) to register their services with a search-first dependency picker.
- **Bi-Weekly Owner Verification Digests:** Fixed-window calendar review (1st and 15th UTC) where owners perform one-click verification (`last_verified_at = now()`) and safe leaf-only retirement.
- **Incident Response & Blast Radius Traversal:** High-stakes on-call situations where responders look up an affected database or host to immediately see all upstream applications and business services at risk.

## Capabilities and Constraints

- **Contract-First Source of Truth:** `api/openapi.yaml` defines all endpoints, flattened schemas, and RFC 9457 Problem Details.
- **Modern Ownership Terminology:** Exclusively modern team terminology (`owner_group`, `team_lead`, `owner_group_id`, `department_name`). Archaic "custodian" terminology is strictly prohibited.
- **Strict Anti-ITAM Schema Enforcement:** Any payload containing unapproved ITAM fields (`cost`, `purchase_cost`, `license_count`, `warranty_end`, `vendor`) is rejected.
- **Canonical Edge Direction:** `source_ci_id` = Consumer / Dependent, `target_ci_id` = Provider / Dependency. Self-dependencies are forbidden (`source_ci_id != target_ci_id`).
- **Cycle-Safe Recursion:** Graph queries bounded at 15 tiers with node-by-node UNION recursion.
- **Safe Leaf-Only Retirement:** Attempting to retire a CI with active dependents returns `HTTP 409 Conflict` listing blocking applications, unless forced by `platform_admin`.

## Brand Commitments

- **Tone & Persona:** Precise, authoritative, high-density, developer-first engineering tool.
- **Visual Mode:** Operate Mode (Impeccable). Light enterprise theme: cool-neutral off-white canvas, white surfaces, hairline borders, one restrained cobalt accent, earned familiarity, no product slop, restrained slate/crimson/emerald/amber semantic palette, 150-200ms transitions.
- **Theme:** Light only. No dark-mode variant is in scope; set `color-scheme: light`.
- **Anti-references:** Purple/pink gradients, glassmorphism and backdrop blur, glow effects, hero sections or marketing copy inside the app, emoji icons, card-grid-for-everything layouts, nested cards, heavy drop shadows, decorative animation.

## Evidence on Hand

- Backend API: Fully implemented Go 1.27 backend with OpenAPI 3.0.3 specification at [`../etcms-backend/api/openapi.yaml`](../etcms-backend/api/openapi.yaml).
- Database Schema: PostgreSQL 16 migrations (`migrations/00001_init_schema.sql` through `00003_digests.sql`) with append-only audit triggers and trigram indexes.
- Technical Documentation: Exhaustive architecture, database, graph, digest, and testing docs in [`../etcms-backend/docs/`](../etcms-backend/docs/).

## Product Principles

1. **Search First, Never Duplicate:** Enforce catalog search before creating dependencies so shared databases, clusters, and hosts are never duplicated.
2. **The Tool Disappears into the Task:** High density, keyboard-accessible (`Cmd+K`), zero decorative distraction, and sub-200ms transitions.
3. **Protect Upstream Dependents:** Never allow silent breaking changes or premature retirement of shared infrastructure.
4. **Decentralize Intake, Centralize Governance:** Remove account provisioning hurdles with magic links while maintaining strict immutable audit logging.

## Accessibility & Inclusion

WCAG 2.1 AA compliant across all views. Full keyboard navigation for graph navigation, command palette, and table inspectors. High-contrast semantic tokens for all criticality tiers, validated at AA or better on both the white surface and the off-white canvas. Criticality, lifecycle, and handshake status are never conveyed by color alone; each pairs color with an icon or text label.