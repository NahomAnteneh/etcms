import { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from './store/auth-context';
import { AppShell } from './components/layout/app-shell';
import { DashboardView } from './views/dashboard/dashboard-view';
import { CatalogView } from './views/catalog/catalog-view';
import { GraphView } from './views/graph/graph-view';
import { DigestView } from './views/digest/digest-view';
import { HandshakesView } from './views/handshakes/handshakes-view';
import { CampaignsView } from './views/campaigns/campaigns-view';
import { AuditView } from './views/audit/audit-view';
import { IntakeWizardView } from './views/intake/intake-wizard-view';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export function App() {
  const [currentView, setCurrentView] = useState<string>('dashboard');
  const [selectedCIForGraph, setSelectedCIForGraph] = useState<string | null>(null);
  const [magicToken, setMagicToken] = useState<string | null>(null);

  // Check if URL matches /intake/:token
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/\/intake\/([a-zA-Z0-9_-]+)/);
    if (match && match[1]) {
      setMagicToken(match[1]);
    }
  }, []);

  // If visiting via magic link, render the dedicated tokenized wizard
  if (magicToken) {
    return (
      <QueryClientProvider client={queryClient}>
        <IntakeWizardView
          token={magicToken}
          onCompleted={() => {
            window.location.href = '/';
          }}
        />
      </QueryClientProvider>
    );
  }

  const handleNavigateToGraph = (ciId: string) => {
    setSelectedCIForGraph(ciId);
    setCurrentView('graph');
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppShell currentView={currentView} onSelectView={setCurrentView}>
          {currentView === 'dashboard' && <DashboardView onNavigate={setCurrentView} />}
          {currentView === 'catalog' && (
            <CatalogView onNavigateToGraph={handleNavigateToGraph} />
          )}
          {currentView === 'graph' && (
            <GraphView initialCIId={selectedCIForGraph} />
          )}
          {currentView === 'digest' && (
            <DigestView onNavigateToCatalog={() => setCurrentView('catalog')} />
          )}
          {currentView === 'handshakes' && <HandshakesView />}
          {currentView === 'campaigns' && <CampaignsView />}
          {currentView === 'audit' && <AuditView />}
        </AppShell>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
