import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setDevUserId, getDevUserId, setBearerToken, getBearerToken, api } from '../api/client';
import { useCurrentUser, useOwnerGroups, type User, type OwnerGroup, type LoginResponse } from '../api/endpoints';

export type UserRole = 'platform_admin' | 'team_lead' | 'viewer';

export interface DevUserOption {
  id: string;
  name: string;
  role: UserRole;
  ownerGroupName: string;
}

export const ADMIN_USER_ID = '11111111-1111-1111-1111-111111111111';
export const TEAM_LEAD_USER_ID = '22222222-2222-2222-2222-222222222222';
export const VIEWER_USER_ID = '33333333-3333-3333-3333-333333333333';

export const DEV_USERS: DevUserOption[] = [
  {
    id: ADMIN_USER_ID,
    name: 'Admin User',
    role: 'platform_admin',
    ownerGroupName: 'Platform Engineering',
  },
  {
    id: TEAM_LEAD_USER_ID,
    name: 'Team Lead User',
    role: 'team_lead',
    ownerGroupName: 'Core Banking SRE',
  },
  {
    id: VIEWER_USER_ID,
    name: 'Viewer User',
    role: 'viewer',
    ownerGroupName: 'Audit & Compliance',
  },
];

interface AuthContextType {
  currentUser: User | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  activeRole: UserRole;
  isAdmin: boolean;
  ownerGroups: OwnerGroup[];
  activeOwnerGroup: OwnerGroup | undefined;
  userBoundaryName: string;
  setActiveOwnerGroup: (group: OwnerGroup | undefined) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  switchDevUser: (devUser: DevUserOption) => void;
  currentDevUserId: string | null;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [selectedDevId, setSelectedDevId] = useState<string | null>(getDevUserId());
  const { data: currentUser, isLoading, refetch } = useCurrentUser();
  const { data: ownerGroups = [] } = useOwnerGroups();
  const [activeOwnerGroup, setActiveOwnerGroupState] = useState<OwnerGroup | undefined>(undefined);

  const activeRole: UserRole = (currentUser?.role as UserRole) || 'platform_admin';
  const isAdmin = activeRole === 'platform_admin';

  // Enforce boundary scope:
  // Admin is Global Scope (undefined = enterprise-wide across all boundaries).
  // Non-admin is strictly bounded to their primary owner group.
  useEffect(() => {
    if (!currentUser) {
      setActiveOwnerGroupState(undefined);
      return;
    }

    if (currentUser.role === 'platform_admin') {
      // Platform Admin is Global Scope by default
      setActiveOwnerGroupState(undefined);
    } else {
      // Non-admin strictly belongs to their assigned boundary
      if (ownerGroups.length > 0 && currentUser.primary_owner_group_id) {
        const primary = ownerGroups.find((g) => g.id === currentUser.primary_owner_group_id);
        if (primary) {
          setActiveOwnerGroupState(primary);
        } else {
          setActiveOwnerGroupState(ownerGroups[0]);
        }
      }
    }
  }, [currentUser, ownerGroups]);

  // Only admins can focus/filter into a specific boundary; non-admins are strictly locked
  const setActiveOwnerGroup = useCallback((group: OwnerGroup | undefined) => {
    if (isAdmin) {
      setActiveOwnerGroupState(group);
    }
    // Non-admin cannot switch boundaries
  }, [isAdmin]);

  const login = async (email: string, password: string) => {
    const res = await api.post('auth/login', { json: { email, password } }).json<LoginResponse>();
    setBearerToken(res.token);
    setDevUserId(null);
    setSelectedDevId(null);
    queryClient.setQueryData(['users', 'me'], res.user);
    await refetch();
    queryClient.invalidateQueries();
  };

  const logout = async () => {
    try {
      await api.post('auth/logout');
    } catch {
      // ignore network errors
    }
    setBearerToken(null);
    setDevUserId(null);
    setSelectedDevId(null);
    queryClient.clear();
    await refetch();
  };

  const switchDevUser = (devUser: DevUserOption) => {
    setDevUserId(devUser.id);
    setSelectedDevId(devUser.id);
    const matchedGroup = ownerGroups.find((g) => g.name === devUser.ownerGroupName);
    if (matchedGroup && devUser.role !== 'platform_admin') {
      setActiveOwnerGroupState(matchedGroup);
    } else {
      setActiveOwnerGroupState(undefined);
    }
    refetch();
    queryClient.invalidateQueries();
  };

  const hasPermission = (permission: string): boolean => {
    if (isAdmin) return true;
    const perms = (currentUser as any)?.custom_role_permissions || [];
    return perms.includes('admin:all') || perms.includes(permission);
  };

  const userBoundaryName = isAdmin
    ? (activeOwnerGroup ? `Focused Boundary: ${activeOwnerGroup.name}` : 'Enterprise Scope (All Boundaries)')
    : (activeOwnerGroup?.name || 'Assigned Boundary');

  const isAuthenticated = !!currentUser || !!getBearerToken();

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isAuthenticated,
        isLoading,
        activeRole,
        isAdmin,
        ownerGroups,
        activeOwnerGroup,
        userBoundaryName,
        setActiveOwnerGroup,
        login,
        logout,
        switchDevUser,
        currentDevUserId: selectedDevId,
        hasPermission,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
