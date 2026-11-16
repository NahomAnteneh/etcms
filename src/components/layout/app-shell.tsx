import React, { useState } from 'react';
import { PolarisNav } from './polaris-nav';
import { useQueryClient } from '@tanstack/react-query';

interface AppShellProps {
  currentView: string;
  onSelectView: (view: string) => void;
  onNavigateToGraph?: (ciId: string) => void;
  onNavigateToCatalogCI?: (ciId: string) => void;
  children: React.ReactNode;
}

export function AppShell({
  currentView,
  onSelectView,
  onNavigateToGraph,
  onNavigateToCatalogCI,
  children,
}: AppShellProps) {
  const [refreshing, setRefreshing] = useState(false);
  const queryClient = useQueryClient();

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setTimeout(() => {
      setRefreshing(false);
    }, 400);
  };

  return (
    <div className="h-screen w-screen flex flex-col bg-canvas text-primary antialiased selection:bg-accent-subtle selection:text-accent font-sans overflow-hidden">
      {/* Consolidated Single High-Density Header Navigation */}
      <PolarisNav
        currentView={currentView}
        onSelectView={onSelectView}
        onNavigateToGraph={onNavigateToGraph}
        onNavigateToCatalogCI={onNavigateToCatalogCI}
        onRefresh={handleRefresh}
        refreshing={refreshing}
      />

      {/* Main Workspace Body - Maximized Full-Screen Canvas */}
      <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto bg-canvas p-3 md:p-4 min-h-0 focus:outline-none">
        <div className="w-full h-full flex flex-col">
          {children}
        </div>
      </main>
    </div>
  );
}
