import React, { createContext, useContext, useState, useEffect } from 'react';
import { setDevUserId, getDevUserId } from '../api/client';
import { useCurrentUser, useOwnerGroups, type User, type OwnerGroup } from '../api/endpoints';

export type UserRole = 'platform_admin' | 'team_lead' | 'viewer';

export interface DevUserOption {
  id: string;
  name: string;
  role: UserRole;
  ownerGroupName: string;
}

export const DEV_USERS: DevUserOption[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Admin User',
    role: 'platform_admin',
    ownerGroupName: 'Platform Engineering',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Team Lead User',
    role: 'team_lead',
    ownerGroupName: 'Core Banking SRE',
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Viewer User',
    role: 'viewer',
    ownerGroupName: 'Audit & Compliance',
  },
];

interface AuthContextType {
  currentUser: User | undefined;
  isLoading: boolean;
  activeRole: UserRole;
  ownerGroups: OwnerGroup[];
  activeOwnerGroup: OwnerGroup | undefined;
  setActiveOwnerGroup: (group: OwnerGroup) => void;
  switchDevUser: (devUser: DevUserOption) => void;
  currentDevUserId: string | null;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [selectedDevId, setSelectedDevId] = useState<string | null>(getDevUserId() || DEV_USERS[0].id);
  const { data: currentUser, isLoading, refetch } = useCurrentUser();
  const { data: ownerGroups = [] } = useOwnerGroups();
  const [activeOwnerGroup, setActiveOwnerGroup] = useState<OwnerGroup | undefined>(undefined);

  useEffect(() => {
    if (ownerGroups.length > 0 && !activeOwnerGroup) {
      setActiveOwnerGroup(ownerGroups[0]);
    }
  }, [ownerGroups, activeOwnerGroup]);

  const switchDevUser = (devUser: DevUserOption) => {
    setDevUserId(devUser.id);
    setSelectedDevId(devUser.id);
    refetch();
  };

  const activeRole: UserRole = currentUser?.role || 'platform_admin';

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        isLoading,
        activeRole,
        ownerGroups,
        activeOwnerGroup,
        setActiveOwnerGroup,
        switchDevUser,
        currentDevUserId: selectedDevId,
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
