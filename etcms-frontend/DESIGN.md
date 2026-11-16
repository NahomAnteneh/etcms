---
name: ServiceNow Polaris CMDB Workspace Design System
description: High-fidelity enterprise ITSM/CMDB UI cloned from the ServiceNow Next Experience (Polaris) framework with Unified Navigation, the 3 Cs of CMDB Health, BSM dependency topology, and high-density list grids.
colors:
  bg-canvas: "#f4f5f7"
  bg-surface: "#ffffff"
  bg-surface-raised: "#ffffff"
  bg-surface-sunken: "#ebeef2"
  bg-hover: "#edf2f7"
  bg-selected: "#e8f0fe"
  header-bg: "#16212d"
  header-surface: "#222f3e"
  border-subtle: "#e2e8f0"
  border-hairline: "#d0d7de"
  border-control: "#8c9ba5"
  text-primary: "#182230"
  text-secondary: "#516273"
  text-muted: "#57606a"
  accent: "#00845c"
  accent-hover: "#006b4a"
  accent-subtle: "#e6f4ea"
  focus-ring: "#00845c"
  tier0: "#cf222e"
  tier0-bg: "#ffebe9"
  tier0-border: "#ffc1c0"
  tier1: "#b05a00"
  tier1-bg: "#fff8c5"
  tier1-border: "#fae17d"
  tier2: "#0969da"
  tier2-bg: "#ddf4ff"
  tier2-border: "#b6e3ff"
  tier3: "#57606a"
  tier3-bg: "#f6f8fa"
  tier3-border: "#d0d7de"
  inservice: "#1a7f37"
  planned: "#0969da"
  deprecated: "#9a6700"
  retired: "#57606a"
  rel-hosted: "#7c3aed"
  rel-reads: "#0d9488"
  rel-writes: "#e11d48"
  rel-connects: "#0969da"
  rel-depends: "#57606a"
typography:
  ui:
    fontFamily: "'Source Sans 3', 'Source Sans Pro', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif"
    fontSize: "13px"
    lineHeight: 1.4
  mono:
    fontFamily: "'SF Mono', 'JetBrains Mono', Consolas, monospace"
    fontSize: "12px"
    lineHeight: 1.3
rounded:
  sm: "3px"
  md: "4px"
  lg: "6px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  button-secondary:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  button-destructive:
    backgroundColor: "{colors.tier0}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  input:
    backgroundColor: "{colors.bg-surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
---

# ServiceNow Polaris CMDB Workspace Design System

## Overview
This design system clones the visual identity and interaction architecture of the **ServiceNow Next Experience (Polaris)** framework and the official **ServiceNow CMDB Workspace / Service Operations Workspace**. It replaces generic design patterns with ServiceNow's battle-tested enterprise layout:
1. **The Polaris Unified Navigation Banner:** A persistent, high-contrast dark top bar (`#16212D`) housing global search, instance identity, and the four core navigation dropdowns: **All** (Application Navigator with module filter), **Favorites**, **History**, and **Workspaces**.
2. **CMDB Health 3 Cs Framework:** Direct operational telemetry tracking **Completeness** (mandatory attribute population), **Correctness** (orphan CIs and staleness rules), and **Compliance** (bi-weekly owner verification loops).
3. **High-Density Data Grids (List v3):** Compact tabular lists with column filtering, breadcrumb query builders (`All > Operational Status is In Service`), and batch actions.
4. **Service Mapping & BSM Dependency Views:** Cycle-safe upward and downward topology visualization with strict Consumer $\to$ Provider directional rules.

## Color Tokens & Palette
ServiceNow Next Experience balances a deep structural chrome with clean, high-density enterprise workspace surfaces.

### Chrome & Navigation (Unified Banner)
- **Header Background (`#16212D`):** Deep charcoal navy anchoring the top of the interface.
- **Header Surface Inset (`#222F3E`):** Inset search bar and menu triggers.
- **Header Text:** `#FFFFFF` (primary titles, active tabs) and `#CBD5E1` (secondary labels).
- **ServiceNow Brand Accent (`#00845C` / `#009E73`):** Iconic ServiceNow Emerald Green for primary actions, save buttons, and active tabs.

### Workspace Canvas & Cards
- **Canvas (`#F4F5F7`):** Neutral enterprise light-gray background.
- **Surfaces (`#FFFFFF`):** Pure white container cards, data table wrappers, and drawer panels.
- **Surface Sunken (`#EBEEF2`):** Table column headers, filter bars, and code panels.
- **Row Hover (`#EDF2F7`):** Row and dropdown hover state.
- **Row Selected (`#E8F0FE`):** Selected table rows and active list items with a 2px left accent border.

### Borders & Dividers
- **Borders (`#D0D7DE` / `#E2E8F0`):** 1px structural hairline borders defining table cells and widget frames.
- **Form Controls (`#8C9BA5`):** High-contrast border meeting WCAG 3:1 requirements for operable controls.

### Semantic Status Tokens
- **Critical / Outage (`tier_0`):** Crimson `#CF222E` on `#FFEBE9` (border `#FFC1C0`).
- **High / Degraded (`tier_1`):** Amber `#B05A00` on `#FFF8C5` (border `#FAE17D`).
- **Standard / Planned (`tier_2`):** Cobalt `#0969DA` on `#DDF4FF` (border `#B6E3FF`).
- **Low / Retired (`tier_3`):** Slate `#57606A` on `#F6F8FA` (border `#D0D7DE`).
- **In Service (`in_service`):** Emerald Green `#1A7F37`.

## Typography
ServiceNow emphasizes legibility, high tabular density, and clean information hierarchy.
- **UI Font Stack:** `'Source Sans 3', 'Source Sans Pro', 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif`.
- **Monospace Stack:** `'SF Mono', 'JetBrains Mono', Consolas, monospace` for CIs, sys_ids, IP addresses, FQDNs, and timestamps.
- **Scale:** High density 11px (3xs), 12px (2xs), 13px (body), 14px (card titles), 16px (page headings), 20px (instance header).
- **Numerals:** Tabular numbers (`tabular-nums`) ensuring strict decimal and metric alignment.

## Navigation & Layout Architecture
- **Polaris Unified Banner (Top):**
  - Left: ServiceNow Logo glyph, Instance name (`ETCMS - CMDB Workspace`), and persistent dropdowns:
    - **All:** Application navigator drawer with module search ("Filter navigator...").
    - **Favorites:** Bookmarked CIs and queries.
    - **History:** Chronological trail of visited CIs and actions.
    - **Workspaces:** Dropdown listing CMDB Workspace, Service Operations Workspace, and Dependency BSM View.
  - Center: Global Omnibar search with `⌘K` command integration.
  - Right: Quick Create (+), Notification Bell, Settings gear, and Dev Auth Impersonation avatar (`System Administrator`, `Core Banking SRE Lead`, `Auditor`).
- **Workspace Tab Navigation (5 Streamlined Workspaces):**
  - **CMDB Health (`dashboard`):** Real-time 3 Cs overview (Completeness, Compliance, Correctness) with integrated high-density governance sub-tabs:
    - `3 Cs Overview`: CMDB health metrics, attention queue, and lifecycle distribution.
    - `Verification Digest`: Bi-weekly CI owner attestation, single verify, and bulk verify.
    - `Handshake Inbox`: Upstream/downstream dependency attestation with confirmation, rejection dialogs, and mismatch flagging.
    - `Intake Campaigns`: Campaign tracking, progress bars, and campaign creation.
  - **CI Catalog (`catalog`):** Unified grid (`cmdb_ci`) with multi-select bulk operations, batch verification, CSV export, lifecycle state transitions, and slide-over CI inspection drawer.
  - **Dependency Views (`graph`):** Canvas-based directed dependency graphs (Consumer $\to$ Provider), cycle detection warnings, upstream/downstream blast radius queries, and service search filter.
  - **Audit Timeline (`audit`):** Immutable chronological record (`sys_audit`) with diff inspector, filter by actor/action/target, rollback capability, and non-blocking toast notifications.
  - **System Settings (`settings`):** Administrative governance console for custom roles (RBAC), owner groups, CI class registry, and anti-ITAM schema boundary enforcement.
- **Breadcrumb Filter Bar:** Standard ServiceNow filter trail (`All > Operational Status = In Service > Class = Service`).

## Corner Radii & Elevation
- **Compact Radii:** `rounded-sm` (3px) and `rounded-md` (4px). ServiceNow avoids large bubbly radiuses to maintain clean enterprise density.
- **Hairline Elevation:** Crisp 1px borders (`#D0D7DE`). Subtle drop shadow (`0 1px 3px rgba(0,0,0,0.06)`) for cards and elevated dropdowns.
