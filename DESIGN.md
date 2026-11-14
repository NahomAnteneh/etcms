---
name: ETCMS Design System
description: High-density, developer-first Operate Mode design system for enterprise configuration management and cycle-safe dependency topology.
colors:
  bg-canvas: "#090d16"
  bg-surface: "#111827"
  bg-surface-raised: "#172033"
  bg-hover: "#1f2937"
  border-subtle: "#1f2937"
  border-hairline: "#374151"
  text-primary: "#f3f4f6"
  text-secondary: "#9ca3af"
  text-muted: "#6b7280"
  tier0: "#ef4444"
  tier1: "#f59e0b"
  tier2: "#3b82f6"
  tier3: "#9ca3af"
  inservice: "#10b981"
  planned: "#38bdf8"
  deprecated: "#f59e0b"
  retired: "#6b7280"
typography:
  ui:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    fontSize: "13px"
    lineHeight: 1.4
  mono:
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace"
    fontSize: "12px"
    lineHeight: 1.3
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.tier2}"
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
The palette is built upon a dark Obsidian base designed for long working hours in NOCs, SRE desks, and browser tabs:
- **Canvas Base (`#090D16`):** Deep charcoal/slate background providing maximum contrast for data visualization.
- **Surface Containers (`#111827`, `#172033`):** Raised card backgrounds, table wrappers, and slide-over inspector sidebars.
- **Borders & Dividers (`#1F2937`, `#374151`):** Precise 1px borders delineating dense tabular cells and graph nodes without visual clutter.
- **Criticality Tokens:**
  - `tier_0`: High-visibility Crimson (`#EF4444`)
  - `tier_1`: Warning Amber (`#F59E0B`)
  - `tier_2`: Operational Cobalt (`#3B82F6`)
  - `tier_3`: Subtle Slate (`#9CA3AF`)
- **Lifecycle Indicators:**
  - `in_service`: Emerald (`#10B981`)
  - `planned`: Sky (`#38BDF8`)
  - `deprecated`: Amber (`#F59E0B`)
  - `retired`: Muted Slate (`#6B7280`)

## Typography
- **UI Font:** `Inter` across all headings, labels, button text, and body copy.
- **Data & Endpoint Font:** `JetBrains Mono` for IPs, CIDRs, FQDNs, UUIDs, timestamps, and criticality tiers.
- **Scale:** Fixed rem scale with a 1.15 ratio. Fluid scaling (`clamp()`) is forbidden in Operate Mode to preserve predictable table geometry.

## Layout
- **Density:** Compact row spacing (32–36px table row height) maximizing visible items above the fold.
- **Structure:** Persistent top navigation bar (system status, global `⌘K` search trigger, dev auth switcher) + left collapsible workflow sidebar + flex canvas workspace.
- **Slide-Over Drawers:** CI details and audit histories open in slide-over drawers escaping the parent scroll container, preserving user scroll position.

## Elevation & Depth
- Elevation is established through border contrasts (`border-obsidian-700`) and subtle backdrop blur (`backdrop-blur-md`) rather than heavy drop shadows.
- Modals, drawers, and command palettes use a dark scrim (`bg-black/70`) with subtle border highlights.

## Shapes
- Compact corner radius: `rounded-md` (6px) for cards, inputs, and buttons; `rounded` (4px) for badges and chips.
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
