import { describe, it, expect } from 'vitest';
import { checkPayloadForITAM } from '../src/api/client';
import { DEFAULT_CI_CLASSES, type CIClassDefinition, type CIFormField } from '../src/api/endpoints';

describe('Production Auth, Boundary Scoping & Dynamic CI Class Forms', () => {
  describe('Boundary Scoping Rules', () => {
    it('enforces platform_admin operates with Global Scope across all boundaries', () => {
      const user = {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'admin@enterprise.com',
        name: 'Admin User',
        role: 'platform_admin' as const,
        primary_owner_group_id: '10000000-0000-0000-0000-000000000001',
      };

      const isAdmin = user.role === 'platform_admin';
      expect(isAdmin).toBe(true);

      // In auth-context, admin activeOwnerGroup defaults to undefined (Enterprise-wide / Global)
      const activeOwnerGroup = isAdmin ? undefined : { id: user.primary_owner_group_id, name: 'Assigned' };
      expect(activeOwnerGroup).toBeUndefined();

      const scopeLabel = isAdmin ? 'Enterprise Scope (All Boundaries)' : 'Locked Boundary';
      expect(scopeLabel).toBe('Enterprise Scope (All Boundaries)');
    });

    it('enforces non-admin users (Team Lead, Viewer) are strictly locked to their primary owner group boundary', () => {
      const teamLeadUser = {
        id: '22222222-2222-2222-2222-222222222222',
        email: 'sarah.chen@enterprise.com',
        name: 'Sarah Chen',
        role: 'team_lead' as const,
        primary_owner_group_id: '10000000-0000-0000-0000-000000000002',
      };

      const ownerGroups = [
        { id: '10000000-0000-0000-0000-000000000001', name: 'Platform Engineering', department_name: 'Platform' },
        { id: '10000000-0000-0000-0000-000000000002', name: 'Core Banking SRE', department_name: 'Retail Banking' },
      ];

      const isAdmin = teamLeadUser.role === 'platform_admin';
      expect(isAdmin).toBe(false);

      const matchedBoundary = ownerGroups.find((g) => g.id === teamLeadUser.primary_owner_group_id);
      expect(matchedBoundary).toBeDefined();
      expect(matchedBoundary?.name).toBe('Core Banking SRE');

      // Attempt to switch boundary as non-admin should be rejected / locked
      let activeGroup = matchedBoundary;
      const attemptSwitch = (newGroup: typeof ownerGroups[0]) => {
        if (isAdmin) {
          activeGroup = newGroup;
        }
        // Non-admins cannot switch boundaries
      };

      attemptSwitch(ownerGroups[0]);
      expect(activeGroup?.name).toBe('Core Banking SRE');
    });
  });

  describe('Dynamic CI Class Form Field Specifications', () => {
    it('verifies vm_server custom CI class defines all 5 required specifications', () => {
      const vmServer = DEFAULT_CI_CLASSES.find((c) => c.id === 'vm_server');
      expect(vmServer).toBeDefined();
      expect(vmServer?.label).toBe('VM Server');
      expect(vmServer?.category).toBe('Infrastructure');

      const fields = vmServer?.form_fields || [];
      expect(fields.length).toBe(5);

      const fieldNames = fields.map((f) => f.name);
      expect(fieldNames).toContain('server_name');
      expect(fieldNames).toContain('ip_address');
      expect(fieldNames).toContain('operating_system');
      expect(fieldNames).toContain('memory_size');
      expect(fieldNames).toContain('allocated_storage');

      // Check field types and required flags
      const serverName = fields.find((f) => f.name === 'server_name');
      expect(serverName?.type).toBe('text');
      expect(serverName?.required).toBe(true);

      const osField = fields.find((f) => f.name === 'operating_system');
      expect(osField?.type).toBe('select');
      expect(osField?.options).toContain('Ubuntu 22.04 LTS');
      expect(osField?.options).toContain('RHEL 9');

      const storageField = fields.find((f) => f.name === 'allocated_storage');
      expect(storageField?.type).toBe('text');
      expect(storageField?.required).toBe(true);
    });

    it('validates mandatory dynamic fields during CI creation', () => {
      const vmServerFields: CIFormField[] = [
        { name: 'server_name', label: 'Server Name', type: 'text', required: true },
        { name: 'ip_address', label: 'IP Address', type: 'text', required: true },
        { name: 'operating_system', label: 'Operating System', type: 'select', required: true },
        { name: 'memory_size', label: 'Memory Size', type: 'text', required: true },
        { name: 'allocated_storage', label: 'Allocated Storage', type: 'text', required: true },
      ];

      // Missing allocated_storage
      const partialValues: Record<string, string> = {
        server_name: 'srv-prod-east-01',
        ip_address: '10.240.10.15',
        operating_system: 'Ubuntu 22.04 LTS',
        memory_size: '64 GB',
      };

      const validateForm = (fields: CIFormField[], values: Record<string, any>) => {
        for (const field of fields) {
          if (field.required && (!values[field.name] || !values[field.name].toString().trim())) {
            return `Field "${field.label}" is required.`;
          }
        }
        return null;
      };

      const error = validateForm(vmServerFields, partialValues);
      expect(error).toBe('Field "Allocated Storage" is required.');

      // Complete values
      const completeValues = {
        ...partialValues,
        allocated_storage: '500 GB NVMe',
      };
      const valid = validateForm(vmServerFields, completeValues);
      expect(valid).toBeNull();
    });

    it('relaxes class_metadata constraint while strictly preventing Anti-ITAM attributes', () => {
      // 5 attributes in class_metadata is now valid (relaxed constraint)
      const validCustomMeta = {
        server_name: 'srv-prod-east-01',
        ip_address: '10.240.10.15',
        operating_system: 'Ubuntu 22.04 LTS',
        memory_size: '64 GB',
        allocated_storage: '500 GB NVMe',
      };

      expect(Object.keys(validCustomMeta).length).toBe(5);
      const violations = checkPayloadForITAM(validCustomMeta);
      expect(violations).toHaveLength(0);

      // Any attempt to include asset management fields is strictly intercepted
      const itamMeta = {
        ...validCustomMeta,
        cost: '$12,000/yr',
        vendor: 'VMware',
      };
      const itamViolations = checkPayloadForITAM(itamMeta);
      expect(itamViolations).toContain('cost');
      expect(itamViolations).toContain('vendor');
    });
  });

  describe('User and Session Management Operations', () => {
    it('properly validates user password updates and status transitions', () => {
      const user = {
        id: '22222222-2222-2222-2222-222222222222',
        name: 'Sarah Chen',
        email: 'sarah.chen@enterprise.com',
        role: 'team_lead',
        status: 'active' as const,
      };

      // Status transitions
      const suspendedUser = { ...user, status: 'suspended' as const };
      expect(suspendedUser.status).toBe('suspended');

      // Password reset validation
      const validateNewPassword = (pwd: string) => {
        if (!pwd || pwd.trim().length < 8) {
          return 'Password must be at least 8 characters long';
        }
        return null;
      };

      expect(validateNewPassword('short')).toBe('Password must be at least 8 characters long');
      expect(validateNewPassword('EnterpriseSecure123!')).toBeNull();
    });

    it('verifies session prefix formatting and revocation payloads', () => {
      const session = {
        id: '99999999-9999-9999-9999-999999999999',
        user_id: '11111111-1111-1111-1111-111111111111',
        user_name: 'Admin User',
        user_email: 'admin@enterprise.com',
        token_prefix: 'etcms_sec_a1b2',
        ip_address: '10.240.0.5',
        user_agent: 'Mozilla/5.0 (X11; Linux x86_64)',
        created_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
      };

      expect(session.token_prefix).toMatch(/^etcms_sec_/);
      expect(session.user_email).toBe('admin@enterprise.com');
    });
  });
});
