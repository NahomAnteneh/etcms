import { describe, it, expect } from 'vitest';
import { parseCSVText, validateCSVRows, SAMPLE_CSV_TEMPLATE } from './csv-import';

describe('CSV Import Engine', () => {
  it('parses basic CSV and handles commas within quotes', () => {
    const csv = `name,ci_class,environment
"service-a, main",business_service,prod
service-b,database,staging`;
    const parsed = parseCSVText(csv);
    expect(parsed).toHaveLength(3);
    expect(parsed[1][0]).toBe('service-a, main');
    expect(parsed[1][1]).toBe('business_service');
    expect(parsed[2][0]).toBe('service-b');
  });

  it('validates rows against classes and owner groups', () => {
    const parsed = parseCSVText(SAMPLE_CSV_TEMPLATE);
    const classes = [
      { id: 'business_service', label: 'Business Service' },
      { id: 'database', label: 'Database' },
      { id: 'application', label: 'Application' },
      { id: 'vm_cluster', label: 'VM Cluster' },
    ];
    const groups = [
      { id: 'grp-1', name: 'Platform Engineering' },
    ];
    const validated = validateCSVRows(parsed, classes, groups, 'grp-1', 'admin@enterprise.com');
    expect(validated.length).toBe(5);
    expect(validated.every((v) => v.isValid)).toBe(true);
    expect(validated[0].owner_group_id).toBe('grp-1');
    expect(validated[0].criticality_tier).toBe('tier_0');
  });

  it('flags errors on missing name or invalid tier', () => {
    const csv = `name,tier
,invalid_tier`;
    const parsed = parseCSVText(csv);
    const validated = validateCSVRows(parsed, [{ id: 'application', label: 'App' }], [{ id: 'grp-1', name: 'Platform' }], 'grp-1', 'test@test.com');
    expect(validated.length).toBe(1);
    expect(validated[0].isValid).toBe(false);
    expect(validated[0].errors).toContain('Name is required');
  });
});
