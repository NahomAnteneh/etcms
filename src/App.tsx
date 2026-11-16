import { useState, useEffect, lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './store/auth-context';
import { ToastProvider } from './components/ui/toast';
import { AppShell } from './components/layout/app-shell';
import { SignInView } from './views/auth/signin-view';

// Route-level code splitting for the 5 streamlined workspaces
const DashboardView = lazy(() =>
  import('./views/dashboard/dashboard-view').then((m) => ({ default: m.DashboardView }))
);
const CatalogView = lazy(() =>
  import('./views/catalog/catalog-view').then((m) => ({ default: m.CatalogView }))
);
const GraphView = lazy(() =>
  import('./views/graph/graph-view').then((m) => ({ default: m.GraphView }))
);
const AuditView = lazy(() =>
  import('./views/audit/audit-view').then((m) => ({ default: m.AuditView }))
);
const SettingsView = lazy(() =>
  import('./views/settings/settings-view').then((m) => ({ default: m.SettingsView }))
);
const IntakeWizardView = lazy(() =>
  import('./views/intake/intake-wizard-view').then((m) => ({ default: m.IntakeWizardView }))
);

const VALID_VIEWS = ['dashboard', 'catalog', 'graph', 'audit', 'settings'] as const;
type ViewType = typeof VALID_VIEWS[number];

function getIntakeTokenFromLocation(): string | null {
  const path = window.location.pathname.replace(/^\//, '');
  const match = path.match(/^intake\/([a-zA-Z0-9_-]+)/i);
  return match ? match[1] : null;
}

function getInitialDashboardTab(): 'overview' | 'digest' | 'handshakes' | 'campaigns' {
  if (typeof window === 'undefined') return 'overview';
  const params = new URLSearchParams(window.location.search);
  const tabParam = params.get('tab')?.toLowerCase();
  if (tabParam && ['overview', 'digest', 'handshakes', 'campaigns'].includes(tabParam)) {
    return tabParam as any;
  }
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  if (['overview', 'digest', 'handshakes', 'campaigns'].includes(hash)) {
    return hash as any;
  }
  const path = window.location.pathname.replace(/^\//, '').toLowerCase();
  if (path === 'handshakes' || path === 'dashboard/handshakes') return 'handshakes';
  if (path === 'digest' || path === 'dashboard/digest') return 'digest';
  if (path === 'campaigns' || path === 'dashboard/campaigns') return 'campaigns';
  return 'overview';
}

function getViewFromLocation(): ViewType {
  const path = window.location.pathname.replace(/^\//, '').toLowerCase();
  const hash = window.location.hash.replace(/^#\/?/, '').toLowerCase();
  const target = (hash || path) as ViewType;
  if (VALID_VIEWS.includes(target)) {
    return target;
  }
  return 'dashboard';
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

function ViewLoadingFallback() {
  return (
    <div className="flex-1 w-full h-full space-y-3 animate-pulse select-none">
      {/* Sub-header / Toolbar Skeleton */}
      <div className="h-10 w-full bg-surface border border-hairline rounded-lg flex items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-28 bg-surface-sunken rounded" />
          <div className="h-4 w-20 bg-surface-sunken/60 rounded" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-6 w-20 bg-surface-sunken rounded" />
          <div className="h-6 w-16 bg-surface-sunken rounded" />
        </div>
      </div>
      {/* Content Canvas / Table Skeleton */}
      <div className="min-h-[460px] w-full bg-surface border border-hairline rounded-lg p-4 space-y-3">
        <div className="h-6 w-1/4 bg-surface-sunken rounded" />
        <div className="space-y-2 pt-2">
          <div className="h-9 w-full bg-surface-sunken/60 rounded" />
          <div className="h-9 w-full bg-surface-sunken/60 rounded" />
          <div className="h-9 w-full bg-surface-sunken/60 rounded" />
          <div className="h-9 w-full bg-surface-sunken/60 rounded" />
          <div className="h-9 w-full bg-surface-sunken/60 rounded" />
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [currentView, setCurrentView] = useState<string>(getViewFromLocation);
  const [dashboardTab, setDashboardTab] = useState<'overview' | 'digest' | 'handshakes' | 'campaigns'>(getInitialDashboardTab);
  const [intakeToken, setIntakeToken] = useState<string | null>(getIntakeTokenFromLocation);
  const [selectedCIForGraph, setSelectedCIForGraph] = useState<string | null>(null);
  const [selectedCIForCatalog, setSelectedCIForCatalog] = useState<string | null>(null);

  useEffect(() => {
    const handlePopState = () => {
      setCurrentView(getViewFromLocation());
      setDashboardTab(getInitialDashboardTab());
      setIntakeToken(getIntakeTokenFromLocation());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const handleSelectView = (view: string) => {
    setIntakeToken(null);
    let targetView = view;
    let targetQuery = '';
    let targetSubTab: 'overview' | 'digest' | 'handshakes' | 'campaigns' | null = null;
    if (view.includes('?')) {
      const parts = view.split('?');
      targetView = parts[0];
      targetQuery = '?' + parts[1];
      const params = new URLSearchParams(parts[1]);
      const tab = params.get('tab');
      if (tab && ['overview', 'digest', 'handshakes', 'campaigns'].includes(tab)) {
        targetSubTab = tab as any;
      }
    } else if (['overview', 'digest', 'handshakes', 'campaigns'].includes(view)) {
      targetView = 'dashboard';
      targetSubTab = view as any;
    }
    setCurrentView(targetView);
    if (targetSubTab) {
      setDashboardTab(targetSubTab);
    } else if (targetView === 'dashboard') {
      setDashboardTab('overview');
    }
    const newPath = targetSubTab && targetSubTab !== 'overview'
      ? `/dashboard?tab=${targetSubTab}`
      : targetQuery
      ? `/${targetView}${targetQuery}`
      : `/${targetView}`;
    if (window.location.pathname + window.location.search !== newPath) {
      window.history.pushState({ tab: targetSubTab || 'overview' }, '', newPath);
    }
  };

  const handleNavigateToGraph = (ciId: string) => {
    setSelectedCIForGraph(ciId);
    handleSelectView('graph');
  };

  const handleNavigateToCatalogCI = (ciId: string) => {
    setSelectedCIForCatalog(ciId);
    handleSelectView('catalog');
  };

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <AppContent
            currentView={currentView}
            dashboardTab={dashboardTab}
            intakeToken={intakeToken}
            selectedCIForGraph={selectedCIForGraph}
            selectedCIForCatalog={selectedCIForCatalog}
            handleSelectView={handleSelectView}
            handleNavigateToGraph={handleNavigateToGraph}
            handleNavigateToCatalogCI={handleNavigateToCatalogCI}
            setDashboardTab={setDashboardTab}
            setIntakeToken={setIntakeToken}
          />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function AppContent({
  currentView,
  dashboardTab,
  intakeToken,
  selectedCIForGraph,
  selectedCIForCatalog,
  handleSelectView,
  handleNavigateToGraph,
  handleNavigateToCatalogCI,
  setDashboardTab,
  setIntakeToken,
}: {
  currentView: string;
  dashboardTab: 'overview' | 'digest' | 'handshakes' | 'campaigns';
  intakeToken: string | null;
  selectedCIForGraph: string | null;
  selectedCIForCatalog: string | null;
  handleSelectView: (view: string) => void;
  handleNavigateToGraph: (ciId: string) => void;
  handleNavigateToCatalogCI: (ciId: string) => void;
  setDashboardTab: (tab: 'overview' | 'digest' | 'handshakes' | 'campaigns') => void;
  setIntakeToken: (token: string | null) => void;
}) {
  const { isAuthenticated, isLoading } = useAuth();

  // Decentralized Intake Wizard is accessible via intake token without full login
  if (intakeToken) {
    return (
      <AppShell
        currentView="catalog"
        onSelectView={handleSelectView}
        onNavigateToGraph={handleNavigateToGraph}
        onNavigateToCatalogCI={handleNavigateToCatalogCI}
      >
        <Suspense fallback={<ViewLoadingFallback />}>
          <IntakeWizardView
            token={intakeToken}
            onCompleted={() => handleSelectView('catalog')}
          />
        </Suspense>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-canvas flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 border-2 border-accent/20 border-t-accent rounded-full animate-spin" />
        <span className="text-xs font-mono text-secondary">Verifying session credentials...</span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <SignInView onSuccess={() => handleSelectView('dashboard')} />;
  }

  return (
    <AppShell
      currentView={currentView}
      onSelectView={handleSelectView}
      onNavigateToGraph={handleNavigateToGraph}
      onNavigateToCatalogCI={handleNavigateToCatalogCI}
    >
      <Suspense fallback={<ViewLoadingFallback />}>
        {currentView === 'dashboard' && (
          <DashboardView
            onNavigate={handleSelectView}
            onNavigateToCatalogCI={handleNavigateToCatalogCI}
            onNavigateToIntake={(token) => {
              setIntakeToken(token);
              window.history.pushState(null, '', `/intake/${token}`);
            }}
            initialTab={dashboardTab}
            onTabChange={(tab) => setDashboardTab(tab)}
          />
        )}
        {currentView === 'catalog' && (
          <CatalogView
            onNavigateToGraph={handleNavigateToGraph}
            initialSelectedCIId={selectedCIForCatalog}
          />
        )}
        {currentView === 'graph' && (
          <GraphView
            initialCIId={selectedCIForGraph}
            onNavigateToCatalogCI={handleNavigateToCatalogCI}
          />
        )}
        {currentView === 'audit' && <AuditView />}
        {currentView === 'settings' && <SettingsView />}
      </Suspense>
    </AppShell>
  );
}

export default App;
