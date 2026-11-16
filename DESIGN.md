---
name: ETCMS Design System
description: High-density, developer-first Operate Mode design system for enterprise configuration management and cycle-safe dependency topology.
colors:
  bg-canvas: "#f4f5f7"
  bg-surface: "#ffffff"
  bg-surface-raised: "#ffffff"
  bg-hover: "#edf2f7"
  border-subtle: "#e2e8f0"
  border-hairline: "#d0d7de"
  text-primary: "#182230"
  text-secondary: "#516273"
  text-muted: "#57606a"
  accent: "#00845c"
  tier0: "#cf222e"
  tier1: "#b05a00"
  tier2: "#0969da"
  tier3: "#57606a"
  inservice: "#1a7f37"
  planned: "#0969da"
  deprecated: "#9a6700"
  retired: "#57606a"
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
---

# ETCMS Design System

## Overview
The ETCMS design system is tailored for high-stakes operational engineering tasks: incident triage, blast-radius queries, bi-weekly owner verification reviews, and decentralized service intake. It follows Impeccable **Operate Mode**—where scanability, high information density, and earned familiarity outrank decorative expression.

## Colors
The palette is built upon a light enterprise Polaris Operate Mode base designed for sustained readability during daylight operations, audits, and triage:
- **Canvas Base (`#F4F5F7`):** Neutral enterprise canvas providing high visual separation for elevated cards and tables.
- **Surface Containers (`#FFFFFF`):** Crisp white surface backgrounds for cards, table bodies, and slide-over inspector sidebars.
- **Borders & Dividers (`#D0D7DE`, `#E2E8F0`):** Precise 1px hairline borders delineating dense tabular cells and graph nodes without visual clutter.
- **Accent Brand Color (`#00845C`):** High-contrast ServiceNow green for primary actions, navigation active states, and focus rings.
- **Criticality Tokens (WCAG AA Compliant):**
  - `tier_0`: High-visibility Crimson (`#CF222E`)
  - `tier_1`: Warning Amber (`#B05A00`)
  - `tier_2`: Operational Cobalt (`#0969DA`)
  - `tier_3`: Subtle Slate (`#57606A`)
- **Lifecycle Indicators:**
  - `in_service`: Emerald (`#1A7F37`)
  - `planned`: Cobalt (`#0969DA`)
  - `deprecated`: Amber (`#9A6700`)
  - `retired`: Muted Slate (`#57606A`)

## Typography
- **UI Font:** `Source Sans 3` / `Inter` across all headings, labels, button text, and body copy.
- **Data & Endpoint Font:** `SF Mono` / `JetBrains Mono` for IPs, CIDRs, FQDNs, UUIDs, timestamps, and criticality tiers.
- **Scale:** Fixed rem scale with a 1.15 ratio. Fluid scaling (`clamp()`) is forbidden in Operate Mode to preserve predictable table geometry.

## Layout
- **Density:** Compact row spacing (32–36px table row height) maximizing visible items above the fold.
- **Structure:** Persistent top navigation bar (system status, global `⌘K` search trigger, dev auth switcher) + 5 unified workspaces (`dashboard`, `catalog`, `graph`, `audit`, `settings`).
- **Slide-Over Drawers:** CI details and audit histories open in slide-over drawers escaping the parent scroll container, preserving user scroll position.

## Elevation & Depth
- Elevation is established through crisp 1px borders (`#D0D7DE`) and subtle drop shadows (`0 1px 3px rgba(0,0,0,0.06)`) rather than heavy drop shadows.
- Modals, drawers, and command palettes use a semi-transparent scrim (`bg-black/40`) with hairline border highlights.

## Shapes
- Compact corner radius: `rounded-md` (4px) for cards, inputs, and buttons; `rounded-sm` (3px) for badges and chips.
- Pill badges and rounded-full containers are reserved exclusively for circular status indicator dots and progress bars.

## Components
- **CriticalityChip:** Displays tier-specific icon and short abbreviation (`T0`, `T1`, `T2`, `T3`) with full tooltip text.
- **LifecycleBadge:** Renders a color-coded status dot alongside state label.
- **HandshakeBadge:** Visualizes edge status (`confirmed`, `pending_confirmation`, `flagged_mismatch`, `rejected`).
- **RFC9457Alert:** Renders structured Problem Details (`type`, `title`, `status`, `detail`, and blocking `dependent_cis` list).
- **CommandPalette (`⌘K`):** Universal keyboard-first search and navigation bar.

## Do's and Don'ts

### Do:
- Display canonical directed edges as Consumer $\to$ Provider.
- Enforce search-first dependency selection before stub creation.
- Check and display active upstream dependents before CI retirement.
- Keep micro-interaction transitions strictly bounded between 150ms and 200ms.
- Use monospace fonts for IP addresses, FQDNs, and timestamps.

### Don't:
- Never allow unapproved ITAM fields (`cost`, `purchase_cost`, `license_count`, `warranty_end`, `vendor`) into form payloads.
- Never use archaic "custodian" terminology; exclusively use modern ownership (`owner_group`, `team_lead`).
- Never use generic AI-slop color combinations (purple gradients or neon cyan on dark).
- Never use fluid typography on dense data tables or dashboards.
- Never hard-delete configuration items; state transitions govern deprecation and retirement.
