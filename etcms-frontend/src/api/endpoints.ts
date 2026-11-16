import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, getBearerToken, getDevUserId } from './client';
import type { components } from './schema';

export type User = components['schemas']['User'];
export type OwnerGroup = components['schemas']['OwnerGroup'];
export type CIEnvelope = components['schemas']['CIEnvelope'];
export type CISearchResult = components['schemas']['CISearchResult'];
export type CISearchResponse = components['schemas']['CISearchResponse'];
export type PendingEdge = components['schemas']['PendingEdge'];
export type PendingEdgesResponse = components['schemas']['PendingEdgesResponse'];
export type UpwardImpactResponse = components['schemas']['UpwardImpactResponse'];
export type DownwardDependenciesResponse = components['schemas']['DownwardDependenciesResponse'];
export type ActiveDigestResponse = components['schemas']['ActiveDigestResponse'];
export type DigestItem = components['schemas']['DigestItem'];
export type HealthMetricsResponse = components['schemas']['HealthMetricsResponse'];
export type CIFlagResponse = components['schemas']['CIFlagResponse'];
export type AuditLogEntry = components['schemas']['AuditLogEntry'];
export type CampaignResponse = components['schemas']['CampaignResponse'];
export type CampaignProgressResponse = components['schemas']['CampaignProgressResponse'];
export type CustomRole = components['schemas']['CustomRole'];
export type CreateCustomRoleRequest = components['schemas']['CreateCustomRoleRequest'];
export type AdminUserResponse = components['schemas']['AdminUserResponse'];
export type CreateAdminUserRequest = components['schemas']['CreateAdminUserRequest'];
export type UpdateAdminUserRequest = components['schemas']['UpdateAdminUserRequest'];
export type ResetPasswordRequest = components['schemas']['ResetPasswordRequest'];
export type LoginRequest = components['schemas']['LoginRequest'];
export type LoginResponse = components['schemas']['LoginResponse'];
export type UserSessionResponse = components['schemas']['UserSessionResponse'];
export type RevertAuditLogResponse = components['schemas']['RevertAuditLogResponse'];
export type CreateCIRequest = components['schemas']['CreateCIRequest'];
export type CategoryDefinition = components['schemas']['CategoryDefinition'];
export type CreateCategoryRequest = components['schemas']['CreateCategoryRequest'];
export type UpdateCategoryRequest = components['schemas']['UpdateCategoryRequest'];
export type RelationshipTypeDefinition = components['schemas']['RelationshipTypeDefinition'];
export type CreateRelationshipTypeRequest = components['schemas']['CreateRelationshipTypeRequest'];
export type UpdateRelationshipTypeRequest = components['schemas']['UpdateRelationshipTypeRequest'];

// 1. Current User & Owner Groups
export function useCurrentUser() {
  const hasAuth = typeof window !== 'undefined' && !!(getBearerToken() || getDevUserId());
  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api.get('users/me').json<User>(),
    enabled: hasAuth,
    retry: false,
  });
}

export function useOwnerGroups() {
  return useQuery({
    queryKey: ['owner-groups'],
    queryFn: async () => {
      let apiGroups: OwnerGroup[] = [];
      try {
        apiGroups = await api.get('owner-groups').json<OwnerGroup[]>();
      } catch {
        apiGroups = [];
      }
      let customGroups: OwnerGroup[] = [];
      try {
        customGroups = JSON.parse(localStorage.getItem('etcms_custom_owner_groups') || '[]');
      } catch {
        customGroups = [];
      }
      const map = new Map<string, OwnerGroup>();
      apiGroups.forEach((g) => map.set(g.id, g));
      customGroups.forEach((g) => map.set(g.id, g));
      return Array.from(map.values());
    },
  });
}

// 2. Health & Governance Metrics
export function useCMDBHealthMetrics(ownerGroupId?: string) {
  const searchParams = ownerGroupId ? { owner_group_id: ownerGroupId } : undefined;
  return useQuery({
    queryKey: ['health', 'metrics', ownerGroupId],
    queryFn: () => api.get('health/metrics', { searchParams }).json<HealthMetricsResponse>(),
    refetchInterval: 30000,
  });
}

// 3. CI Catalog & Search
export function useCICatalog(params?: {
  q?: string;
  ci_class?: string;
  environment?: string;
  lifecycle_state?: string;
  criticality_tier?: string;
  owner_group_id?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['cis', 'search', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params) {
        if (params.q) searchParams.set('q', params.q);
        if (params.ci_class) searchParams.set('ci_class', params.ci_class);
        if (params.environment) searchParams.set('environment', params.environment);
        if (params.lifecycle_state) searchParams.set('lifecycle_state', params.lifecycle_state);
        if (params.owner_group_id) searchParams.set('owner_group_id', params.owner_group_id);
        if (params.limit) searchParams.set('limit', String(params.limit));
        else searchParams.set('limit', '100');
      } else {
        searchParams.set('limit', '100');
      }
      const res = await api.get('cis/search', { searchParams }).json<CISearchResponse>();
      let items: CIEnvelope[] = (res.items || []).map((r) => ({
        ...r.ci,
        ownership: r.ownership || r.ci.ownership,
      }));
      if (params?.lifecycle_state) {
        items = items.filter((ci) => ci.lifecycle_state === params.lifecycle_state);
      }
      if (params?.criticality_tier) {
        items = items.filter((ci) => ci.criticality_tier === params.criticality_tier);
      }
      return { items, total: res.total || items.length };
    },
  });
}

export function useCISearch(query: string) {
  return useQuery({
    queryKey: ['cis', 'search', query],
    queryFn: async () => {
      if (!query || query.trim().length === 0) return [];
      const res = await api.get('cis/search', { searchParams: { q: query.trim() } }).json<CISearchResponse>();
      return res.items || [];
    },
    enabled: query.trim().length > 0,
    staleTime: 5000,
  });
}

export function useCIDetail(id: string | null) {
  return useQuery({
    queryKey: ['cis', id],
    queryFn: () => api.get(`cis/${id}`).json<CIEnvelope>(),
    enabled: !!id,
  });
}

// 4. CI Mutations: Verify, Retire, Create, Flag
export function useVerifyCI() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post(`cis/${id}/verify`).json<CIEnvelope>(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cis'] });
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'me', 'digest'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'metrics'] });
      if (data.ci_id) {
        queryClient.setQueryData(['cis', data.ci_id], data);
      }
    },
  });
}

export function useRetireCI() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) => {
      const searchParams = force ? { force: 'true' } : undefined;
      return api.post(`cis/${id}/retire`, { searchParams }).json<CIEnvelope>();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cis'] });
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'me', 'digest'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'metrics'] });
      if (data.ci_id) {
        queryClient.setQueryData(['cis', data.ci_id], data);
      }
    },
  });
}

export function useCreateCIFlag() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ciId, reason }: { ciId: string; reason: string }) =>
      api.post(`cis/${ciId}/flags`, { json: { reason } }).json<CIFlagResponse>(),
    onSuccess: (_, { ciId }) => {
      queryClient.invalidateQueries({ queryKey: ['cis', ciId] });
      queryClient.invalidateQueries({ queryKey: ['cis', ciId, 'flags'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'metrics'] });
    },
  });
}

export function useUpdateCI() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: components['schemas']['UpdateCIRequest'] }) =>
      api.patch(`cis/${id}`, { json: data }).json<CIEnvelope>(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cis'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'metrics'] });
      if (data.ci_id) {
        queryClient.setQueryData(['cis', data.ci_id], data);
      }
    },
  });
}

// 5. Graph Traversal: Upward Impact & Downward Dependencies
export function useUpwardImpact(ciId: string | null, includeRetired = false) {
  return useQuery({
    queryKey: ['cis', ciId, 'impact-upward', includeRetired],
    queryFn: () =>
      api.get(`cis/${ciId}/impact-upward`, {
        searchParams: { include_retired: String(includeRetired) },
      }).json<UpwardImpactResponse>(),
    enabled: !!ciId,
  });
}

export function useDownwardDependencies(ciId: string | null, includeRetired = false) {
  return useQuery({
    queryKey: ['cis', ciId, 'dependencies-downward', includeRetired],
    queryFn: () =>
      api.get(`cis/${ciId}/dependencies-downward`, {
        searchParams: { include_retired: String(includeRetired) },
      }).json<DownwardDependenciesResponse>(),
    enabled: !!ciId,
  });
}

// 6. Cross-Boundary Handshakes
export function usePendingEdges(ownerGroupId?: string) {
  return useQuery({
    queryKey: ['owner-groups', 'pending-edges', ownerGroupId],
    queryFn: async () => {
      const searchParams = ownerGroupId ? { owner_group_id: ownerGroupId } : undefined;
      const res = await api.get('owner-groups/pending-edges', { searchParams }).json<PendingEdgesResponse>();
      return res.items || [];
    },
  });
}

export function useConfirmEdge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (edgeId: string) => api.post(`edges/${edgeId}/confirm`).json<any>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'pending-edges'] });
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'me', 'digest'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'metrics'] });
    },
  });
}

export function useFlagMismatchEdge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ edgeId, reason }: { edgeId: string; reason: string }) =>
      api.post(`edges/${edgeId}/flag-mismatch`, { json: { reason } }).json<any>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'pending-edges'] });
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'me', 'digest'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'metrics'] });
    },
  });
}

export function useRejectEdge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (param: string | { edgeId: string; reason?: string }) => {
      const edgeId = typeof param === 'string' ? param : param.edgeId;
      const reason = typeof param === 'object' ? param.reason : undefined;
      return api.post(`edges/${edgeId}/reject`, {
        json: reason ? { reason } : undefined,
      }).json<any>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'pending-edges'] });
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'me', 'digest'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'metrics'] });
    },
  });
}

// 7. Owner Group Verification Digest
export function useOwnerDigest(ownerGroupId?: string) {
  return useQuery({
    queryKey: ['owner-groups', 'me', 'digest', ownerGroupId],
    queryFn: () => {
      const searchParams = ownerGroupId ? { owner_group_id: ownerGroupId } : undefined;
      return api.get('owner-groups/me/digest', { searchParams }).json<ActiveDigestResponse>();
    },
  });
}

// 8. Intake Campaign Management & Progress
export function useCampaigns(enabled = true) {
  return useQuery({
    queryKey: ['admin', 'intake', 'campaigns'],
    queryFn: () => api.get('admin/intake/campaigns').json<CampaignResponse[]>(),
    enabled,
  });
}

export function useCampaignProgress(campaignId: string | null, enabled: boolean = true) {
  return useQuery({
    queryKey: ['admin', 'intake', 'campaigns', campaignId, 'progress'],
    queryFn: () => api.get(`admin/intake/campaigns/${campaignId}/progress`).json<CampaignProgressResponse>(),
    enabled: !!campaignId && enabled,
  });
}

export function useUpdateCampaignStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'closed' | 'archived' }) =>
      api.patch(`admin/intake/campaigns/${id}`, { json: { status } }).json<CampaignResponse>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'intake', 'campaigns'] });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`admin/intake/campaigns/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'intake', 'campaigns'] });
    },
  });
}

// 9. Custom Roles & Permissions Management
export function useCustomRoles() {
  return useQuery({
    queryKey: ['admin', 'roles'],
    queryFn: () => api.get('admin/roles').json<CustomRole[]>(),
  });
}

export function useCreateCustomRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCustomRoleRequest) =>
      api.post('admin/roles', { json: data }).json<CustomRole>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
}

export function useDeleteCustomRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`admin/roles/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'roles'] });
    },
  });
}

// 10. Admin Users Management
export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.get('admin/users').json<AdminUserResponse[]>(),
  });
}

export function useCreateAdminUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateAdminUserRequest) =>
      api.post('admin/users', { json: data }).json<AdminUserResponse>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateAdminUserRequest }) =>
      api.put(`admin/users/${id}`, { json: data }).json<AdminUserResponse>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['users', 'me'] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`admin/users/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: ({ id, newPassword }: { id: string; newPassword: string }) =>
      api.post(`admin/users/${id}/reset-password`, { json: { new_password: newPassword } }).json<{ message?: string }>(),
  });
}

// 10b. Authentication & Session Management
export function useLogin() {
  return useMutation({
    mutationFn: (data: LoginRequest) => api.post('auth/login', { json: data }).json<LoginResponse>(),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('auth/logout').json<{ message?: string }>(),
    onSuccess: () => {
      queryClient.clear();
    },
  });
}

export function useUserSessions() {
  return useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: () => api.get('auth/sessions').json<UserSessionResponse[]>(),
    retry: false,
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`auth/sessions/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] });
    },
  });
}

// 11. Audit Undo / Revert
export function useRevertAuditLog() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post(`audit-logs/${id}/revert`).json<RevertAuditLogResponse>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
      queryClient.invalidateQueries({ queryKey: ['cis'] });
      queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });
}

// 12. Direct CI Creation & Dependency Edge Creation
export function useCreateCI() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCIRequest) =>
      api.post('cis', { json: data }).json<CIEnvelope>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cis'] });
      queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });
}

export function useCreateEdge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      source_ci_id: string;
      target_ci_id: string;
      edge_type: string;
    }) => api.post('edges', { json: data }).json<any>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cis'] });
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.invalidateQueries({ queryKey: ['health'] });
    },
  });
}

export function useDeleteEdge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (edgeId: string) => api.delete(`edges/${edgeId}`).json<any>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['cis'] });
      queryClient.invalidateQueries({ queryKey: ['graph'] });
      queryClient.invalidateQueries({ queryKey: ['health'] });
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'pending-edges'] });
    },
  });
}

// 13. Owner Group Management
export interface CreateOwnerGroupRequest {
  name: string;
  slug?: string;
  department_name: string;
  team_lead_name: string;
  team_lead_email: string;
}

export interface UpdateOwnerGroupRequest {
  name: string;
  slug?: string;
  department_name: string;
  team_lead_name: string;
  team_lead_email: string;
}

export function useCreateOwnerGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateOwnerGroupRequest) => {
      return await api.post('owner-groups', { json: data }).json<OwnerGroup>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-groups'] });
    },
  });
}

export function useUpdateOwnerGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateOwnerGroupRequest }) => {
      return await api.put(`owner-groups/${id}`, { json: data }).json<OwnerGroup>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-groups'] });
    },
  });
}

export function useDeleteOwnerGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return await api.delete(`owner-groups/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-groups'] });
    },
  });
}

// 14. CI Class Administration & Dynamic Form Fields
export interface CIFormField {
  name: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'boolean';
  required?: boolean;
  placeholder?: string;
  options?: string[];
  default_value?: string;
}

export interface CIClassDefinition {
  id: string;
  label: string;
  category: string;
  description?: string;
  icon?: string;
  is_system?: boolean;
  attributes?: string[];
  form_fields?: CIFormField[];
  created_at?: string;
  updated_at?: string;
}

export interface CreateCIClassRequest {
  id: string;
  label: string;
  category: string;
  description?: string;
  icon?: string;
  attributes?: string[];
  form_fields?: CIFormField[];
}

export interface UpdateCIClassRequest {
  label: string;
  category: string;
  description?: string;
  icon?: string;
  attributes?: string[];
  form_fields?: CIFormField[];
}

export const DEFAULT_CI_CLASSES: CIClassDefinition[] = [
  {
    id: 'business_service',
    label: 'Business Service',
    category: 'Service',
    description: 'High-level business service consumed by external or internal users',
    icon: 'Layers',
    is_system: false,
    attributes: ['sla', 'business_unit', 'rto_minutes', 'rpo_minutes'],
    form_fields: [
      { name: 'sla', label: 'Service Level Agreement (SLA)', type: 'select', required: true, options: ['99.999%', '99.99%', '99.9%', '99.5%'], default_value: '99.99%' },
      { name: 'business_unit', label: 'Business Unit', type: 'text', required: false, placeholder: 'e.g. Retail Banking & Wealth' },
      { name: 'rto_minutes', label: 'Recovery Time Objective (RTO in mins)', type: 'number', required: false, placeholder: '15' },
      { name: 'rpo_minutes', label: 'Recovery Point Objective (RPO in mins)', type: 'number', required: false, placeholder: '0' },
    ],
  },
  {
    id: 'application',
    label: 'Application',
    category: 'Application',
    description: 'Core software microservice, backend worker, or application component',
    icon: 'Cpu',
    is_system: false,
    attributes: ['runtime', 'framework', 'repository_url', 'health_check_path'],
    form_fields: [
      { name: 'runtime', label: 'Execution Runtime', type: 'select', required: true, options: ['Go 1.23', 'Java OpenJDK 21', 'Node.js 22', 'Python 3.12', 'Rust 1.82', '.NET 8'], default_value: 'Go 1.23' },
      { name: 'framework', label: 'Application Framework', type: 'text', required: false, placeholder: 'e.g. Chi, Spring Boot, Express, FastAPI' },
      { name: 'repository_url', label: 'Git Repository URL', type: 'text', required: false, placeholder: 'git@github.com:org/service.git' },
      { name: 'health_check_path', label: 'HTTP Health Endpoint', type: 'text', required: false, placeholder: '/healthz' },
    ],
  },
  {
    id: 'database',
    label: 'Database',
    category: 'Data',
    description: 'Persistent transactional database, cache, or data store',
    icon: 'Database',
    is_system: false,
    attributes: ['engine', 'version', 'port', 'storage_gb'],
    form_fields: [
      { name: 'engine', label: 'Database Engine', type: 'select', required: true, options: ['PostgreSQL', 'MySQL', 'Redis', 'CockroachDB', 'MongoDB', 'Oracle'], default_value: 'PostgreSQL' },
      { name: 'version', label: 'Engine Major Version', type: 'text', required: true, placeholder: '16.4' },
      { name: 'port', label: 'Network Port', type: 'number', required: true, placeholder: '5432' },
      { name: 'storage_gb', label: 'Allocated Storage (GB)', type: 'number', required: false, placeholder: '250' },
    ],
  },
  {
    id: 'vm_server',
    label: 'VM Server',
    category: 'Infrastructure',
    description: 'Virtual machine server instance with compute, storage, and networking specs',
    icon: 'Server',
    is_system: false,
    attributes: ['server_name', 'ip_address', 'operating_system', 'memory_size', 'allocated_storage'],
    form_fields: [
      { name: 'server_name', label: 'Server Name', type: 'text', required: true, placeholder: 'e.g. srv-prod-vm01' },
      { name: 'ip_address', label: 'IP Address', type: 'text', required: true, placeholder: 'e.g. 10.240.12.8' },
      { name: 'operating_system', label: 'Operating System', type: 'select', required: true, options: ['Ubuntu 22.04 LTS', 'Debian 12', 'RHEL 9', 'Windows Server 2022', 'Alpine Linux'], default_value: 'Ubuntu 22.04 LTS' },
      { name: 'memory_size', label: 'Memory Size', type: 'text', required: true, placeholder: 'e.g. 64 GB' },
      { name: 'allocated_storage', label: 'Allocated Storage', type: 'text', required: true, placeholder: 'e.g. 500 GB NVMe' },
    ],
  },
  {
    id: 'vm_cluster',
    label: 'VM Cluster',
    category: 'Infrastructure',
    description: 'Virtual machine hypervisor cluster or compute cluster pool',
    icon: 'Server',
    is_system: false,
  },
  {
    id: 'physical_host',
    label: 'Bare Metal Host',
    category: 'Infrastructure',
    description: 'Physical server hardware, bare-metal hypervisor, or dedicated host',
    icon: 'HardDrive',
    is_system: false,
  },
  {
    id: 'network_firewall',
    label: 'Network Firewall',
    category: 'Network',
    description: 'Network perimeter gateway, firewall device, or load balancer',
    icon: 'Network',
    is_system: false,
  },
];

export const DEFAULT_CATEGORIES: CategoryDefinition[] = [
  {
    id: 'infrastructure',
    name: 'Infrastructure',
    description: 'Physical and virtual compute, storage, and datacenter hardware',
    icon: 'Server',
    color: 'amber',
    class_count: 3,
    ci_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'data',
    name: 'Data',
    description: 'Databases, caches, object storage, and messaging queues',
    icon: 'Database',
    color: 'emerald',
    class_count: 1,
    ci_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'application',
    name: 'Application',
    description: 'Web services, microservices, background jobs, and API gateways',
    icon: 'Cpu',
    color: 'cyan',
    class_count: 1,
    ci_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'service',
    name: 'Service',
    description: 'High-level business capabilities and digital customer services',
    icon: 'Layers',
    color: 'violet',
    class_count: 1,
    ci_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'network',
    name: 'Network',
    description: 'Load balancers, firewalls, routers, switches, and edge proxies',
    icon: 'Network',
    color: 'rose',
    class_count: 1,
    ci_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export const DEFAULT_RELATIONSHIP_TYPES: RelationshipTypeDefinition[] = [
  {
    id: 'depends_on',
    label: 'Depends On',
    reverse_label: 'Depended On By',
    description: 'Upstream CI functionally depends on downstream component',
    color: 'cyan',
    edge_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'hosted_on',
    label: 'Hosted On',
    reverse_label: 'Hosts',
    description: 'Virtual or logical workload hosted on physical/virtual compute infrastructure',
    color: 'amber',
    edge_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'connects_to',
    label: 'Connects To',
    reverse_label: 'Connected From',
    description: 'Network or protocol socket connection between endpoints',
    color: 'emerald',
    edge_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
  {
    id: 'reads_from',
    label: 'Reads From',
    reverse_label: 'Read By',
    description: 'Data consumer reading from database, replica, or topic',
    color: 'violet',
    edge_count: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

export function useCIClasses() {
  return useQuery({
    queryKey: ['admin', 'ci-classes'],
    queryFn: async () => {
      try {
        const apiClasses = await api.get('admin/ci-classes').json<CIClassDefinition[]>();
        if (apiClasses && apiClasses.length > 0) {
          return apiClasses;
        }
      } catch (e) {
        console.warn('Failed to fetch CI classes from API, using default system classes', e);
      }
      return DEFAULT_CI_CLASSES;
    },
  });
}

export function useCreateCIClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateCIClassRequest) => {
      return await api.post('admin/ci-classes', { json: data }).json<CIClassDefinition>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ci-classes'] });
    },
  });
}

export function useUpdateCIClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCIClassRequest }) => {
      return await api.put(`admin/ci-classes/${id}`, { json: data }).json<CIClassDefinition>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ci-classes'] });
    },
  });
}

export function useDeleteCIClass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return await api.delete(`admin/ci-classes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ci-classes'] });
    },
  });
}

// 7. Categories Management
export function useCategories() {
  return useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: async () => {
      try {
        const res = await api.get('admin/categories').json<CategoryDefinition[]>();
        if (res && res.length > 0) return res;
      } catch (e) {
        console.warn('Failed to fetch categories, using defaults', e);
      }
      return DEFAULT_CATEGORIES;
    },
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateCategoryRequest) => {
      return await api.post('admin/categories', { json: data }).json<CategoryDefinition>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'ci-classes'] });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateCategoryRequest }) => {
      return await api.put(`admin/categories/${id}`, { json: data }).json<CategoryDefinition>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'ci-classes'] });
    },
  });
}

export function useDeleteCategory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return await api.delete(`admin/categories/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'categories'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'ci-classes'] });
    },
  });
}

// 8. Custom Relationship Types
export function useRelationshipTypes() {
  return useQuery({
    queryKey: ['admin', 'relationship-types'],
    queryFn: async () => {
      try {
        const res = await api.get('admin/relationship-types').json<RelationshipTypeDefinition[]>();
        if (res && res.length > 0) return res;
      } catch (e) {
        console.warn('Failed to fetch relationship types, using defaults', e);
      }
      return DEFAULT_RELATIONSHIP_TYPES;
    },
  });
}

export function useCreateRelationshipType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateRelationshipTypeRequest) => {
      return await api.post('admin/relationship-types', { json: data }).json<RelationshipTypeDefinition>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'relationship-types'] });
      queryClient.invalidateQueries({ queryKey: ['edges'] });
      queryClient.invalidateQueries({ queryKey: ['graph'] });
    },
  });
}

export function useUpdateRelationshipType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateRelationshipTypeRequest }) => {
      return await api.put(`admin/relationship-types/${id}`, { json: data }).json<RelationshipTypeDefinition>();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'relationship-types'] });
      queryClient.invalidateQueries({ queryKey: ['edges'] });
      queryClient.invalidateQueries({ queryKey: ['graph'] });
    },
  });
}

export function useDeleteRelationshipType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      return await api.delete(`admin/relationship-types/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'relationship-types'] });
      queryClient.invalidateQueries({ queryKey: ['edges'] });
      queryClient.invalidateQueries({ queryKey: ['graph'] });
    },
  });
}


