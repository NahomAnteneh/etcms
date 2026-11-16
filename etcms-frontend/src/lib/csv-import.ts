export interface RawCSVRow {
  name: string;
  ci_class?: string;
  environment?: string;
  criticality_tier?: string;
  technical_contact?: string;
  primary_endpoint?: string;
  owner_group?: string;
}

export interface ValidatedCSVRow {
  name: string;
  ci_class: string;
  environment: 'prod' | 'dr' | 'staging';
  criticality_tier: 'tier_0' | 'tier_1' | 'tier_2' | 'tier_3';
  technical_contact: string;
  primary_endpoint?: string;
  owner_group_id: string;
  isValid: boolean;
  errors: string[];
}

/**
 * Basic RFC 4180 CSV parser that supports quotes and commas within quotes
 */
export function parseCSVText(csvText: string): string[][] {
  const lines: string[][] = [];
  const rows = csvText.split(/\r?\n/);

  for (const rawRow of rows) {
    if (!rawRow.trim()) continue;
    const row: string[] = [];
    let insideQuote = false;
    let entry = '';

    for (let i = 0; i < rawRow.length; i++) {
      const char = rawRow[i];
      if (char === '"') {
        if (insideQuote && rawRow[i + 1] === '"') {
          entry += '"';
          i++; // skip escaped quote
        } else {
          insideQuote = !insideQuote;
        }
      } else if (char === ',' && !insideQuote) {
        row.push(entry.trim());
        entry = '';
      } else {
        entry += char;
      }
    }
    row.push(entry.trim());
    lines.push(row);
  }

  return lines;
}

export function validateCSVRows(
  parsedRows: string[][],
  availableClasses: { id: string; label: string }[],
  availableGroups: { id: string; name: string }[],
  defaultGroupId: string,
  defaultContactEmail: string
): ValidatedCSVRow[] {
  if (parsedRows.length <= 1) return [];

  // Header row normalization
  const header = parsedRows[0].map((h) => h.toLowerCase().trim().replace(/[\s_-]+/g, '_'));
  const nameIdx = header.findIndex((h) => h === 'name' || h === 'ci_name');
  const classIdx = header.findIndex((h) => h === 'class' || h === 'ci_class');
  const envIdx = header.findIndex((h) => h === 'env' || h === 'environment');
  const tierIdx = header.findIndex((h) => h === 'tier' || h === 'criticality' || h === 'criticality_tier');
  const contactIdx = header.findIndex((h) => h === 'contact' || h === 'tech_contact' || h === 'technical_contact');
  const endpointIdx = header.findIndex((h) => h === 'endpoint' || h === 'primary_endpoint' || h === 'url');
  const ownerIdx = header.findIndex((h) => h === 'owner' || h === 'owner_group' || h === 'owner_group_id' || h === 'group');

  if (nameIdx === -1) {
    throw new Error('CSV is missing required header column: "name"');
  }

  const validEnvs = new Set(['prod', 'dr', 'staging']);
  const validTiers = new Set(['tier_0', 'tier_1', 'tier_2', 'tier_3']);
  const validClassIds = new Set(availableClasses.map((c) => c.id));

  const result: ValidatedCSVRow[] = [];

  for (let r = 1; r < parsedRows.length; r++) {
    const row = parsedRows[r];
    if (row.length === 0 || (row.length === 1 && !row[0])) continue;

    const errors: string[] = [];
    const rawName = row[nameIdx]?.trim() || '';

    if (!rawName) {
      errors.push('Name is required');
    }

    // CI Class
    let rawClass = (classIdx >= 0 && row[classIdx]?.trim()) || 'application';
    rawClass = rawClass.toLowerCase().replace(/[\s-]+/g, '_');
    if (!validClassIds.has(rawClass)) {
      const matchLabel = availableClasses.find((c) => c.label.toLowerCase() === rawClass.toLowerCase());
      if (matchLabel) {
        rawClass = matchLabel.id;
      } else {
        errors.push(`Invalid CI Class "${rawClass}". Allowed: ${Array.from(validClassIds).slice(0, 4).join(', ')}...`);
      }
    }

    // Environment
    let rawEnv = ((envIdx >= 0 && row[envIdx]?.trim().toLowerCase()) || 'prod') as any;
    if (rawEnv === 'production') rawEnv = 'prod';
    if (!validEnvs.has(rawEnv)) {
      errors.push(`Invalid Environment "${rawEnv}". Allowed: prod, dr, staging`);
      rawEnv = 'prod';
    }

    // Criticality Tier
    let rawTier = ((tierIdx >= 0 && row[tierIdx]?.trim().toLowerCase()) || 'tier_1') as any;
    if (rawTier === '0' || rawTier === 'critical') rawTier = 'tier_0';
    if (rawTier === '1' || rawTier === 'high') rawTier = 'tier_1';
    if (rawTier === '2' || rawTier === 'medium') rawTier = 'tier_2';
    if (rawTier === '3' || rawTier === 'low') rawTier = 'tier_3';
    if (!validTiers.has(rawTier)) {
      errors.push(`Invalid Criticality "${rawTier}". Allowed: tier_0, tier_1, tier_2, tier_3`);
      rawTier = 'tier_1';
    }

    // Technical Contact
    const rawContact = (contactIdx >= 0 && row[contactIdx]?.trim()) || defaultContactEmail || 'admin@enterprise.com';

    // Primary Endpoint
    const rawEndpoint = (endpointIdx >= 0 && row[endpointIdx]?.trim()) || undefined;

    // Owner Group
    let matchedGroupId = defaultGroupId;
    if (ownerIdx >= 0 && row[ownerIdx]?.trim()) {
      const val = row[ownerIdx].trim();
      const byId = availableGroups.find((g) => g.id === val);
      const byName = availableGroups.find((g) => g.name.toLowerCase() === val.toLowerCase());
      if (byId) {
        matchedGroupId = byId.id;
      } else if (byName) {
        matchedGroupId = byName.id;
      } else {
        errors.push(`Owner group "${val}" not found; defaulted to active group`);
      }
    }

    if (!matchedGroupId && availableGroups.length > 0) {
      matchedGroupId = availableGroups[0].id;
    }

    result.push({
      name: rawName,
      ci_class: rawClass,
      environment: rawEnv,
      criticality_tier: rawTier,
      technical_contact: rawContact,
      primary_endpoint: rawEndpoint,
      owner_group_id: matchedGroupId,
      isValid: errors.length === 0,
      errors,
    });
  }

  return result;
}

export const SAMPLE_CSV_TEMPLATE = `name,ci_class,environment,criticality_tier,technical_contact,primary_endpoint,owner_group
payment-gateway,business_service,prod,tier_0,billing-lead@enterprise.com,https://api.payments.corp,Platform Engineering
accounts-db,database,prod,tier_0,dba-team@enterprise.com,postgres-primary.corp:5432,Platform Engineering
order-processor,application,prod,tier_1,orders-dev@enterprise.com,https://orders.internal.corp,Platform Engineering
auth-cache,application,prod,tier_1,security-ops@enterprise.com,redis-cluster.corp:6379,Platform Engineering
k8s-cluster-west,vm_cluster,prod,tier_0,infra-ops@enterprise.com,k8s.west.corp:6443,Platform Engineering`;
