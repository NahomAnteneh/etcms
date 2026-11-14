import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
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

// 1. Current User & Owner Groups
export function useCurrentUser() {
  return useQuery({
    queryKey: ['users', 'me'],
    queryFn: () => api.get('users/me').json<User>(),
    retry: 1,
  });
}

export function useOwnerGroups() {
  return useQuery({
    queryKey: ['owner-groups'],
    queryFn: () => api.get('owner-groups').json<OwnerGroup[]>(),
  });
}

// 2. Health & Governance Metrics
export function useCMDBHealthMetrics() {
  return useQuery({
    queryKey: ['health', 'metrics'],
    queryFn: () => api.get('health/metrics').json<HealthMetricsResponse>(),
    refetchInterval: 30000,
  });
}

// 3. CI Catalog & Search
export function useCICatalog(params?: {
  ci_class?: string;
  environment?: string;
  lifecycle_state?: string;
  criticality_tier?: string;
  owner_group_id?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['cis', params],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v !== undefined && v !== null && v !== '') {
            searchParams.set(k, String(v));
          }
        });
      }
      return api.get('cis', { searchParams }).json<{ items: CIEnvelope[]; total: number }>();
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
export function usePendingEdges() {
  return useQuery({
    queryKey: ['owner-groups', 'pending-edges'],
    queryFn: async () => {
      const res = await api.get('owner-groups/pending-edges').json<PendingEdgesResponse>();
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
    mutationFn: (edgeId: string) => api.post(`edges/${edgeId}/reject`).json<any>(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'pending-edges'] });
      queryClient.invalidateQueries({ queryKey: ['owner-groups', 'me', 'digest'] });
      queryClient.invalidateQueries({ queryKey: ['health', 'metrics'] });
    },
  });
}

// 7. Owner Group Verification Digest
export function useOwnerDigest() {
  return useQuery({
    queryKey: ['owner-groups', 'me', 'digest'],
    queryFn: () => api.get('owner-groups/me/digest').json<ActiveDigestResponse>(),
  });
}

// 8. Intake Campaign Management & Progress
export function useCampaigns() {
  return useQuery({
    queryKey: ['admin', 'intake', 'campaigns'],
    queryFn: () => api.get('admin/intake/campaigns').json<CampaignResponse[]>(),
  });
}

export function useCampaignProgress(campaignId: string | null) {
  return useQuery({
    queryKey: ['admin', 'intake', 'campaigns', campaignId, 'progress'],
    queryFn: () => api.get(`admin/intake/campaigns/${campaignId}/progress`).json<CampaignProgressResponse>(),
    enabled: !!campaignId,
  });
}
