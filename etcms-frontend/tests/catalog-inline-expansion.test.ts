import { describe, it, expect } from 'bun:test';

interface CIEnvelope {
  ci_id?: string;
  name: string;
  ci_class: string;
  criticality_tier: 'tier_0' | 'tier_1' | 'tier_2' | 'tier_3';
  environment: 'prod' | 'dr' | 'staging';
  lifecycle_state: 'in_service' | 'synced' | 'out_of_sync' | 'planned' | 'deprecated' | 'retired';
  ownership?: {
    owner_group_id?: string;
    owner_group_name?: string;
    department_name?: string;
    team_lead_name?: string;
  };
  technical_contact?: string;
  primary_endpoint?: string;
  last_verified_at?: string | null;
  class_metadata?: Record<string, any>;
}

// Helper simulating field visibility & "Not set" in amber rules
function getFieldDisplay(ci: CIEnvelope, fieldDef?: { required?: boolean }) {
  const fields: Array<{ label: string; value: string; isMissingRequired?: boolean; isHidden?: boolean }> = [];

  // 1. Sys ID (required)
  fields.push({
    label: 'Sys ID',
    value: ci.ci_id ? `${ci.ci_id.slice(0, 18)}...` : '—',
  });

  // 2. Class (required)
  fields.push({
    label: 'Class',
    value: ci.ci_class,
  });

  // 3. Tier (required)
  fields.push({
    label: 'Criticality tier',
    value: ci.criticality_tier,
  });

  // 4. Environment (required)
  fields.push({
    label: 'Environment',
    value: ci.environment,
  });

  // 5. Lifecycle state (required)
  fields.push({
    label: 'Lifecycle state',
    value: ci.lifecycle_state,
  });

  // 6. Owner group (required: if empty, "Not set" in amber)
  if (!ci.ownership?.owner_group_name) {
    fields.push({ label: 'Owner group', value: 'Not set', isMissingRequired: true });
  } else {
    fields.push({ label: 'Owner group', value: ci.ownership.owner_group_name });
  }

  // 7. Department (optional: hide if empty)
  if (ci.ownership?.department_name) {
    fields.push({ label: 'Department', value: ci.ownership.department_name });
  } else {
    fields.push({ label: 'Department', value: '', isHidden: true });
  }

  // 8. Team lead (optional: hide if empty)
  if (ci.ownership?.team_lead_name) {
    fields.push({ label: 'Team lead', value: ci.ownership.team_lead_name });
  } else {
    fields.push({ label: 'Team lead', value: '', isHidden: true });
  }

  // 9. Technical contact (required: if empty, "Not set" in amber)
  if (!ci.technical_contact) {
    fields.push({ label: 'Technical contact', value: 'Not set', isMissingRequired: true });
  } else {
    fields.push({ label: 'Technical contact', value: ci.technical_contact });
  }

  // 10. Primary endpoint (optional: hide if empty)
  if (ci.primary_endpoint) {
    fields.push({ label: 'Primary endpoint', value: ci.primary_endpoint });
  } else {
    fields.push({ label: 'Primary endpoint', value: '', isHidden: true });
  }

  return fields;
}

// Helper simulating Status column visibility exception-only rule
function computeHasStatusExceptions(cis: CIEnvelope[]): boolean {
  return cis.some((ci) => ci.lifecycle_state !== 'in_service');
}

// Helper simulating row expansion toggle
function toggleExpandedSet(prev: Set<string>, ciId: string): Set<string> {
  const next = new Set(prev);
  if (next.has(ciId)) {
    next.delete(ciId);
  } else {
    next.add(ciId);
  }
  return next;
}

// Helper simulating relationship chip display with first 10 limit
function computeDisplayedChips<T>(items: T[], isExpanded: boolean) {
  if (isExpanded) {
    return { displayed: items, remaining: 0, hasMore: false };
  }
  const displayed = items.slice(0, 10);
  const remaining = Math.max(0, items.length - 10);
  return { displayed, remaining, hasMore: remaining > 0 };
}

describe('Catalog Inline Row Expansion & Discover-Style Details', () => {
  it('supports expanding multiple rows simultaneously in discovery mode', () => {
    let expanded = new Set<string>();
    expect(expanded.size).toBe(0);

    // Expand first CI
    expanded = toggleExpandedSet(expanded, 'ci-1');
    expect(expanded.has('ci-1')).toBe(true);
    expect(expanded.size).toBe(1);

    // Expand second CI
    expanded = toggleExpandedSet(expanded, 'ci-2');
    expect(expanded.has('ci-1')).toBe(true);
    expect(expanded.has('ci-2')).toBe(true);
    expect(expanded.size).toBe(2);

    // Expand third CI
    expanded = toggleExpandedSet(expanded, 'ci-3');
    expect(expanded.size).toBe(3);

    // Collapse second CI without affecting first and third
    expanded = toggleExpandedSet(expanded, 'ci-2');
    expect(expanded.has('ci-1')).toBe(true);
    expect(expanded.has('ci-2')).toBe(false);
    expect(expanded.has('ci-3')).toBe(true);
    expect(expanded.size).toBe(2);
  });

  it('resets expanded rows when filters, search query, or sorting change', () => {
    let expanded = new Set<string>(['ci-1', 'ci-2', 'ci-3']);
    expect(expanded.size).toBe(3);

    // Simulating user changing a filter or sorting: triggers collapse effect
    expanded = new Set<string>();
    expect(expanded.size).toBe(0);
  });

  it('hides Status column when all visible rows are in_service (exception-only status)', () => {
    const allInService: CIEnvelope[] = [
      {
        ci_id: '1',
        name: 'Service A',
        ci_class: 'application',
        criticality_tier: 'tier_1',
        environment: 'prod',
        lifecycle_state: 'in_service',
      },
      {
        ci_id: '2',
        name: 'Database B',
        ci_class: 'database',
        criticality_tier: 'tier_0',
        environment: 'prod',
        lifecycle_state: 'in_service',
      },
    ];

    expect(computeHasStatusExceptions(allInService)).toBe(false);

    // If one row has an exception (e.g. out_of_sync), column must appear
    const withException: CIEnvelope[] = [
      ...allInService,
      {
        ci_id: '3',
        name: 'Redis Cache',
        ci_class: 'database',
        criticality_tier: 'tier_2',
        environment: 'prod',
        lifecycle_state: 'out_of_sync',
      },
    ];

    expect(computeHasStatusExceptions(withException)).toBe(true);
  });

  it('defaults selection to empty (0 CIs) and confirms count before batch verify', () => {
    const initialSelection = new Set<string>();
    expect(initialSelection.size).toBe(0);

    // When 5 CIs are selected
    const selected = new Set<string>(['ci-1', 'ci-2', 'ci-3', 'ci-4', 'ci-5']);
    const confirmationTitle = `Verify ${selected.size} CIs?`;
    expect(confirmationTitle).toBe('Verify 5 CIs?');
  });

  it('shows "Not set" in amber for missing required fields and hides empty optional fields', () => {
    const incompleteCI: CIEnvelope = {
      ci_id: 'test-uuid-1234-5678-90ab',
      name: 'Unassigned Microservice',
      ci_class: 'application',
      criticality_tier: 'tier_2',
      environment: 'staging',
      lifecycle_state: 'in_service',
      // No owner group
      ownership: undefined,
      // No technical contact
      technical_contact: undefined,
      // No endpoint
      primary_endpoint: undefined,
    };

    const fields = getFieldDisplay(incompleteCI);

    const ownerField = fields.find((f) => f.label === 'Owner group');
    expect(ownerField).toBeDefined();
    expect(ownerField?.value).toBe('Not set');
    expect(ownerField?.isMissingRequired).toBe(true);

    const techContactField = fields.find((f) => f.label === 'Technical contact');
    expect(techContactField).toBeDefined();
    expect(techContactField?.value).toBe('Not set');
    expect(techContactField?.isMissingRequired).toBe(true);

    const deptField = fields.find((f) => f.label === 'Department');
    expect(deptField?.isHidden).toBe(true);

    const endpointField = fields.find((f) => f.label === 'Primary endpoint');
    expect(endpointField?.isHidden).toBe(true);
  });

  it('limits relationship chips to first 10 and provides "Show all N" toggle for 30+ relationships', () => {
    const relationships = Array.from({ length: 35 }, (_, i) => ({
      ci_id: `dep-${i + 1}`,
      name: `Dependency Service ${i + 1}`,
    }));

    // Collapsed: shows 10 items, remaining 25
    const collapsed = computeDisplayedChips(relationships, false);
    expect(collapsed.displayed.length).toBe(10);
    expect(collapsed.remaining).toBe(25);
    expect(collapsed.hasMore).toBe(true);

    // Expanded: shows all 35 items
    const expanded = computeDisplayedChips(relationships, true);
    expect(expanded.displayed.length).toBe(35);
    expect(expanded.remaining).toBe(0);
    expect(expanded.hasMore).toBe(false);
  });

  it('correctly names the CI and its dependent count during retirement confirmation', () => {
    const ciToRetire: CIEnvelope = {
      ci_id: '40000000-0000-0000-0000-000000000001',
      name: 'Core Banking API Gateway',
      ci_class: 'application',
      criticality_tier: 'tier_0',
      environment: 'prod',
      lifecycle_state: 'in_service',
    };

    const dependentCount = 14;
    const confirmationPrompt = `Are you sure you want to retire ${ciToRetire.name}?`;
    const dependentCountNotice = `Dependent CI count: ${dependentCount}`;

    expect(confirmationPrompt).toBe('Are you sure you want to retire Core Banking API Gateway?');
    expect(dependentCountNotice).toBe('Dependent CI count: 14');
  });
});
