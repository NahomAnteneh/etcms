import { describe, it, expect } from 'vitest';
import { checkPayloadForITAM, ApiProblemError } from '../src/api/client';
import { formatRelativeTime } from '../src/lib/utils';

describe('ETCMS Governance & Heuristics Unit Tests', () => {
  describe('Heuristic #5: Error Prevention & Strict Anti-ITAM Schema Enforcement', () => {
    it('detects top-level ITAM fields', () => {
      const payload = {
        name: 'payments-db',
        ci_class: 'database',
        cost: 15000,
      };
      const violations = checkPayloadForITAM(payload);
      expect(violations).toContain('cost');
    });

    it('detects nested and case-insensitive ITAM fields', () => {
      const payload = {
        name: 'auth-service',
        metadata: {
          VENDOR: 'Oracle',
          subsystem: {
            warranty_end: '2028-01-01',
            license_count: 50,
          },
        },
      };
      const violations = checkPayloadForITAM(payload);
      expect(violations).toContain('metadata.VENDOR');
      expect(violations).toContain('metadata.subsystem.warranty_end');
      expect(violations).toContain('metadata.subsystem.license_count');
    });

    it('passes operational CMDB payloads with zero ITAM fields', () => {
      const payload = {
        name: 'core-payment-api',
        ci_class: 'application',
        environment: 'prod',
        criticality_tier: 'tier_0',
        owner_group_id: '11111111-1111-1111-1111-111111111111',
        technical_contact: 'sre-lead@bank.internal',
        primary_endpoint: '10.200.4.15',
        class_metadata: {
          tier: 'core',
          zone: 'internal',
        },
      };
      const violations = checkPayloadForITAM(payload);
      expect(violations).toHaveLength(0);
    });
  });

  describe('Heuristic #9: Help Users Recognize, Diagnose, and Recover from Errors (RFC 9457)', () => {
    it('properly preserves RFC 9457 problem details and blocking dependent CIs', () => {
      const problem = {
        type: 'https://tools.ietf.org/html/rfc9457',
        title: 'Conflict',
        status: 409,
        detail: 'Cannot retire CI: active dependents exist',
        dependent_cis: [
          {
            ci_id: 'app-uuid-1',
            name: 'payments-web',
            ci_class: 'application' as const,
            environment: 'prod' as const,
          },
        ],
      };

      const err = new ApiProblemError(problem);
      expect(err.status).toBe(409);
      expect(err.problem.title).toBe('Conflict');
      expect(err.problem.dependent_cis).toHaveLength(1);
      expect(err.problem.dependent_cis?.[0].name).toBe('payments-web');
    });
  });

  describe('Time Formatting Helpers', () => {
    it('correctly computes relative time strings', () => {
      const now = new Date();
      expect(formatRelativeTime(now.toISOString())).toBe('just now');

      const oneHourAgo = new Date(now.getTime() - 65 * 60 * 1000);
      expect(formatRelativeTime(oneHourAgo.toISOString())).toBe('1h ago');

      const twoDaysAgo = new Date(now.getTime() - 49 * 60 * 60 * 1000);
      expect(formatRelativeTime(twoDaysAgo.toISOString())).toBe('2d ago');

      expect(formatRelativeTime(null)).toBe('Never');
    });
  });
});
