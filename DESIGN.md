---
name: ETCMS Design System
description: High-density, developer-first Operate Mode design system (light enterprise theme) for configuration management and cycle-safe dependency topology.
colors:
  bg-canvas: "#f6f7f9"
  bg-surface: "#ffffff"
  bg-surface-raised: "#ffffff"
  bg-surface-sunken: "#f1f3f6"
  bg-hover: "#eef0f4"
  bg-selected: "#e8effd"
  border-subtle: "#e5e8ed"
  border-hairline: "#d3d8e0"
  border-control: "#858e9e"
  text-primary: "#111827"
  text-secondary: "#4b5563"
  text-muted: "#5f6877"
  accent: "#1d4ed8"
  accent-hover: "#1e40af"
  accent-subtle: "#eff6ff"
  focus-ring: "#1d4ed8"
  tier0: "#b91c1c"
  tier0-bg: "#fef2f2"
  tier0-border: "#fecaca"
  tier1: "#92400e"
  tier1-bg: "#fffbeb"
  tier1-border: "#fde68a"
  tier2: "#1d4ed8"
  tier2-bg: "#eff6ff"
  tier2-border: "#bfdbfe"
  tier3: "#4b5563"
  tier3-bg: "#f3f4f6"
  tier3-border: "#e5e7eb"
  inservice: "#047857"
  planned: "#0369a1"
  deprecated: "#b45309"
  retired: "#5f6877"
typography:
  ui:
    fontFamily: "'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
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

# ETCMS Design System

## Overview
The ETCMS design system is tailored for high-stakes operational engineering tasks: incident triage, blast-radius queries, bi-weekly owner verification reviews, and decentralized service intake. It follows Impeccable **Operate Mode**, where scanability, high information density, and earned familiarity outrank decorative expression. The theme is **light only**: calm, precise, and trustworthy, closer to a professional ops console than a marketing site. Structure comes from 1px borders and tonal surface steps, not from shadows, gradients, or effects.

## Colors
A cool-neutral light palette with a single restrained accent. Hierarchy is built from surface steps (canvas, surface, sunken) and hairline borders.
- **Canvas (`#F6F7F9`):** App background. Never pure white, so white surfaces read as raised.
- **Surfaces (`#FFFFFF`):** Cards, table wrappers, drawers, popovers, and the sidebar. `bg-surface-sunken` (`#F1F3F6`) is for table headers, code blocks, and inset regions.
- **Interaction states:** `bg-hover` (`#EEF0F4`) for row and menu hover; `bg-selected` (`#E8EFFD`) for selected rows, paired with a 2px inset accent rule on the leading edge.
- **Borders:** `border-subtle` (`#E5E8ED`) for internal dividers and table rows; `border-hairline` (`#D3D8E0`) for card and panel edges; `border-control` (`#858E9E`) for inputs, checkboxes, and any boundary a user must perceive to operate a control (meets 3:1).
- **Text:** `text-primary` (`#111827`, 17.7:1 on white), `text-secondary` (`#4B5563`, 7.6:1), `text-muted` (`#5F6877`, 5.6:1). Muted is the floor; nothing lighter carries text. No pure black.
- **Accent (`#1D4ED8`):** Primary actions, active navigation, links, and the focus ring (2px, 2px offset). Hover is `#1E40AF`. Used sparingly. Note that `accent` and `tier2` share a hue, so tier chips always carry the `T2` label and are never used as buttons.
- **Criticality tokens** (each tier has ink, tint, and border; chips use ink on tint with a tint-border):
  - `tier_0`: Crimson (`#B91C1C` on `#FEF2F2`)
  - `tier_1`: Amber (`#92400E` on `#FFFBEB`)
  - `tier_2`: Cobalt (`#1D4ED8` on `#EFF6FF`)
  - `tier_3`: Slate (`#4B5563` on `#F3F4F6`)
- **Lifecycle indicators** (dot plus label; all at least 5:1 on white):
  - `in_service`: Emerald (`#047857`)
  - `planned`: Sky (`#0369A1`)
  - `deprecated`: Amber (`#B45309`)
  - `retired`: Muted Slate (`#5F6877`)
- **Color is never the only signal.** Criticality, lifecycle, and handshake state always pair color with an icon, abbreviation, or label.

## Typography
- **UI Font:** `IBM Plex Sans` across all headings, labels, button text, and body copy. Base size 13px, line height 1.4.
- **Data & Endpoint Font:** `JetBrains Mono` for IPs, CIDRs, FQDNs, UUIDs, timestamps, and criticality tiers. 12px, line height 1.3.
- **Scale:** Fixed rem scale with a 1.15 ratio, approximately 12 / 13 / 15 / 17 / 20 / 23px. Fluid scaling (`clamp()`) is forbidden in Operate Mode to preserve predictable table geometry.
- **Numerals:** Tabular figures (`font-variant-numeric: tabular-nums`) in tables, counts, and KPIs so columns align.
- **Weight:** 400 for body, 500 for labels and table headers, 600 for page titles. No heavier.

## Layout
- **Density:** Compact row spacing (32-36px table row height) maximizing visible items above the fold. Spacing follows the 4/8/12/16/24 scale.
- **Structure:** Persistent top navigation bar (system status, global `⌘K` search trigger, dev auth switcher) + left collapsible workflow sidebar + flex canvas workspace. The top bar and sidebar are white with a 1px `border-hairline` edge; the workspace sits on `bg-canvas`.
- **Page header:** Breadcrumbs, a 20px title, and one primary action. No hero areas, banners, or welcome copy.
- **Tables:** Sticky `bg-surface-sunken` header with 500-weight 12px `text-secondary` labels, `border-subtle` row dividers, no zebra striping. Hover uses `bg-hover`; selection uses `bg-selected` with the accent edge rule.
- **Slide-Over Drawers:** CI details and audit histories open in slide-over drawers escaping the parent scroll container, preserving user scroll position.
- **Graph canvas:** `bg-canvas` background with an optional 1px dot grid at `border-subtle`. Nodes are white with a `border-hairline` edge and a 3px leading rule in the tier color; edges are 1.5px `text-muted`, with arrowheads pointing Consumer to Provider. The selected node uses the accent ring.

## Elevation & Depth
- Elevation is established primarily through border contrast (`border-hairline`) and surface steps rather than shadows. No backdrop blur or translucency anywhere.
- Cards and tables: no shadow, 1px border only.
- Popovers, menus, and the command palette: `0 4px 12px rgba(16,24,40,0.10)` plus a 1px `border-hairline`.
- Drawers: `-8px 0 24px rgba(16,24,40,0.08)` plus a 1px leading border.
- Modals, drawers, and the command palette sit on a flat scrim of `rgba(17,24,39,0.40)`.

## Shapes
- Compact corner radius: `rounded-md` (6px) for cards, inputs, and buttons; `rounded-sm` (4px) for badges and chips; `rounded-lg` (8px) only for modals and the command palette.
- Pill badges and rounded-full containers are reserved exclusively for circular status indicator dots and progress bars.

## Components
- **Buttons:** Primary is accent fill with white text. Secondary is white with a `border-control` edge and `bg-hover` on hover. Destructive is `tier0` fill with white text. Ghost is text-only for toolbar actions. All have visible `focus-visible` rings and distinct disabled and loading states.
- **Inputs & Selects:** White fill, `border-control` edge, labels above the field, helper text in `text-muted`, inline validation in `tier0` with an icon. Focus replaces the border with the accent ring.
- **CriticalityChip:** Displays tier-specific icon and short abbreviation (`T0`, `T1`, `T2`, `T3`) in ink-on-tint with a tint border, and full tooltip text.
- **LifecycleBadge:** Renders a color-coded status dot alongside state label on a transparent background.
- **HandshakeBadge:** Visualizes edge status (`confirmed`, `pending_confirmation`, `flagged_mismatch`, `rejected`), mapped to `inservice`, `deprecated`, `tier0`, and `retired` respectively, each with an icon and label.
- **RFC9457Alert:** Renders structured Problem Details (`type`, `title`, `status`, `detail`, and blocking `dependent_cis` list) on `tier0-bg` with a `tier0-border` edge, an icon, and the dependents as dense rows with monospace identifiers.
- **CommandPalette (`⌘K`):** Universal keyboard-first search and navigation bar on a raised white surface over the flat scrim.
- **Icons:** One line icon set (Lucide) at a single 1.5px stroke weight. No emoji.
- **State coverage:** Every interactive component defines default, hover, focus-visible, active, disabled, loading, and error states.

## Do's and Don'ts

### Do:
- Display canonical directed edges as Consumer $\to$ Provider.
- Enforce search-first dependency selection before stub creation.
- Check and display active upstream dependents before CI retirement.
- Keep micro-interaction transitions strictly bounded between 150ms and 200ms, ease-out, functional only.
- Use monospace fonts for IP addresses, FQDNs, and timestamps.
- Pair every semantic color with an icon or text label.
- Use `border-control` for any boundary a user must see to operate a control.

### Don't:
- Never allow unapproved ITAM fields (`cost`, `purchase_cost`, `license_count`, `warranty_end`, `vendor`) into form payloads.
- Never use archaic "custodian" terminology; exclusively use modern ownership (`owner_group`, `team_lead`).
- Never use generic AI-slop styling: purple or pink gradients, glow effects, glassmorphism or backdrop blur, blurred background blobs.
- Never use hero sections, marketing copy, or welcome messages inside the app.
- Never nest cards or default to a card grid for list data; use tables.
- Never use fluid typography on dense data tables or dashboards.
- Never hardcode hex values in components; reference the tokens above.
- Never hard-delete configuration items; state transitions govern deprecation and retirement.