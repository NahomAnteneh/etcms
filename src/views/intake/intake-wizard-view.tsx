import { useState, useEffect } from 'react';
import {
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Search,
  Plus,
  Trash2,
  Save,
} from 'lucide-react';
import { api, ApiProblemError, setIntakeToken } from '../../api/client';
import { useCISearch, type CISearchResult } from '../../api/endpoints';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card } from '../../components/ui/card';
import { RFC9457Alert } from '../../components/governance/rfc9457-alert';

interface IntakeWizardViewProps {
  token: string;
  onCompleted?: () => void;
}

interface DraftCI {
  temp_id: string;
  name: string;
  ci_class: 'business_service' | 'application' | 'database' | 'vm_cluster' | 'physical_host' | 'network_firewall';
  environment: 'prod' | 'dr' | 'staging';
  criticality_tier: 'tier_0' | 'tier_1' | 'tier_2' | 'tier_3';
  technical_contact: string;
  primary_endpoint: string;
}

interface DraftEdge {
  temp_id: string;
  source_temp_id: string; // Consumer Application
  target_ci_id: string;   // Provider Dependency
  target_name: string;
  edge_type: 'depends_on' | 'hosted_on' | 'connects_to' | 'reads_from';
}

export function IntakeWizardView({ token, onCompleted }: IntakeWizardViewProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [session, setSession] = useState<any>(null);
  const [isLoadingSession, setIsLoadingSession] = useState(true);
  const [activeProblem, setActiveProblem] = useState<ApiProblemError['problem'] | null>(null);

  // Draft Data State
  const [cis, setCis] = useState<DraftCI[]>([]);
  const [edges, setEdges] = useState<DraftEdge[]>([]);
  const [lockVersion, setLockVersion] = useState<number>(1);
  const [autoSaveStatus, setAutoSaveStatus] = useState<string>('Synced');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [publicationSuccess, setPublicationSuccess] = useState(false);

  // Search-First Dependency Picker State
  const [depSearchQuery, setDepSearchQuery] = useState('');
  const { data: searchResults = [] } = useCISearch(depSearchQuery);
  const [selectedAppForDep, setSelectedAppForDep] = useState<string>('');

  // Set intake token on client
  useEffect(() => {
    if (token) {
      setIntakeToken(token);
      loadSession();
    }
  }, [token]);

  const loadSession = async () => {
    setIsLoadingSession(true);
    setActiveProblem(null);
    try {
      const data = await api.get(`intake/${token}`).json<any>();
      setSession(data);
      if (data.existing_draft) {
        setCis(data.existing_draft.cis || []);
        setEdges(data.existing_draft.edges || []);
        setLockVersion(data.existing_draft.lock_version || 1);
      } else {
        // Initialize with default CI template
        setCis([
          {
            temp_id: 'app-1',
            name: '',
            ci_class: 'application',
            environment: 'prod',
            criticality_tier: 'tier_1',
            technical_contact: data.team_lead_email || '',
            primary_endpoint: '',
          },
        ]);
      }
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    } finally {
      setIsLoadingSession(false);
    }
  };

  // Auto-Save Draft
  const saveDraft = async () => {
    if (!token) return;
    setAutoSaveStatus('Saving draft...');
    try {
      const res = await api
        .put(`intake/${token}`, {
          headers: {
            'If-Match': `"${lockVersion}"`,
          },
          json: {
            payload: { cis, edges },
          },
        })
        .json<any>();
      setLockVersion(res.lock_version);
      setAutoSaveStatus(`Saved at ${new Date().toLocaleTimeString()} (v${res.lock_version})`);
    } catch (err) {
      if (err instanceof ApiProblemError) {
        setActiveProblem(err.problem);
        setAutoSaveStatus('Auto-save conflict');
      }
    }
  };

  // Submit Final Baseline
  const handleSubmitBaseline = async () => {
    setIsSubmitting(true);
    setActiveProblem(null);
    try {
      await api.post(`intake/${token}/submit`, {
        json: {
          payload: { cis, edges },
        },
      });
      setPublicationSuccess(true);
      if (onCompleted) onCompleted();
    } catch (err) {
      if (err instanceof ApiProblemError) setActiveProblem(err.problem);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 1: CI Form Updaters
  const addCI = () => {
    const newId = `app-${cis.length + 1}`;
    setCis((prev) => [
      ...prev,
      {
        temp_id: newId,
        name: '',
        ci_class: 'application',
        environment: 'prod',
        criticality_tier: 'tier_1',
        technical_contact: session?.team_lead_email || '',
        primary_endpoint: '',
      },
    ]);
  };

  const updateCI = (index: number, field: keyof DraftCI, value: string) => {
    setCis((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], [field]: value };
      return copy;
    });
  };

  const removeCI = (index: number) => {
    setCis((prev) => prev.filter((_, i) => i !== index));
  };

  // Step 2 & 3: Dependency Addition
  const addDependencyEdge = (targetResult: CISearchResult, edgeType: DraftEdge['edge_type']) => {
    const sourceId = selectedAppForDep || cis[0]?.temp_id;
    if (!sourceId || !targetResult.ci.ci_id) return;

    // Avoid duplicates
    if (edges.some((e) => e.source_temp_id === sourceId && e.target_ci_id === targetResult.ci.ci_id)) {
      return;
    }

    setEdges((prev) => [
      ...prev,
      {
        temp_id: `edge-${prev.length + 1}`,
        source_temp_id: sourceId,
        target_ci_id: targetResult.ci.ci_id!,
        target_name: targetResult.ci.name,
        edge_type: edgeType,
      },
    ]);
    setDepSearchQuery('');
  };

  const removeEdge = (index: number) => {
    setEdges((prev) => prev.filter((_, i) => i !== index));
  };

  if (isLoadingSession) {
    return (
      <div className="min-h-screen bg-obsidian-900 flex items-center justify-center text-xs text-obsidian-400">
        Authenticating magic link token...
      </div>
    );
  }

  if (publicationSuccess) {
    return (
      <div className="min-h-screen bg-obsidian-900 flex items-center justify-center p-4">
        <div className="w-full max-w-lg bg-obsidian-850 border border-emerald-800/80 rounded-xl p-8 text-center space-y-4 shadow-2xl">
          <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto" />
          <h2 className="text-xl font-bold text-white">Baseline v1.0 Successfully Published!</h2>
          <p className="text-xs text-obsidian-300 leading-relaxed">
            Your services and cross-boundary dependency relationships have been registered into the operational CMDB. Upstream dependencies targeting other teams have been placed in their verification inbox for confirmation.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-obsidian-900 text-obsidian-100 flex flex-col antialiased">
      {/* Top Banner */}
      <header className="h-14 bg-obsidian-850 border-b border-obsidian-750 px-6 flex items-center justify-between select-none">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded bg-blue-600 flex items-center justify-center text-white font-bold text-xs">
            ET
          </div>
          <div>
            <div className="text-sm font-semibold text-white">
              Service Intake: <span className="text-blue-400">{session?.department_name}</span>
            </div>
            <div className="text-3xs text-obsidian-400">Team Lead: {session?.team_lead_email}</div>
          </div>
        </div>

        {/* Step Indicator & Auto-Save Badge */}
        <div className="flex items-center gap-4">
          <div className="text-2xs font-mono text-obsidian-400 flex items-center gap-1.5">
            <Save className="w-3.5 h-3.5 text-blue-400" />
            <span>{autoSaveStatus}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-obsidian-950 p-1 rounded border border-obsidian-750 text-2xs font-mono">
            <span
              className={`px-2 py-0.5 rounded ${
                step === 1 ? 'bg-blue-600 text-white font-bold' : 'text-obsidian-400'
              }`}
            >
              1. Services
            </span>
            <span
              className={`px-2 py-0.5 rounded ${
                step === 2 ? 'bg-blue-600 text-white font-bold' : 'text-obsidian-400'
              }`}
            >
              2. Search-First Deps
            </span>
            <span
              className={`px-2 py-0.5 rounded ${
                step === 3 ? 'bg-blue-600 text-white font-bold' : 'text-obsidian-400'
              }`}
            >
              3. Review & Submit
            </span>
          </div>
        </div>
      </header>

      {/* Main Wizard Form Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto p-6 space-y-6">
        {activeProblem && (
          <RFC9457Alert problem={activeProblem} onDismiss={() => setActiveProblem(null)} />
        )}

        {/* STEP 1: REGISTER SERVICES */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-white">Step 1: Register Team Services & Applications</h2>
                <p className="text-xs text-obsidian-400">
                  Provide the 10-field operational envelope for each service owned by your team. Asset-tracking fields (cost, vendor, warranty) are strictly excluded.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={addCI}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add Service
              </Button>
            </div>

            <div className="space-y-4">
              {cis.map((ci, index) => (
                <Card key={ci.temp_id} className="bg-obsidian-850/80 border-obsidian-750 p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-obsidian-750">
                    <span className="text-xs font-mono font-semibold uppercase text-blue-400">
                      Service #{index + 1} ({ci.temp_id})
                    </span>
                    {cis.length > 1 && (
                      <button
                        onClick={() => removeCI(index)}
                        className="text-red-400 hover:text-red-300 text-xs flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-2xs font-mono uppercase text-obsidian-400 mb-1">
                        Service / Application Name *
                      </label>
                      <Input
                        value={ci.name}
                        onChange={(e) => updateCI(index, 'name', e.target.value)}
                        placeholder="e.g. core-payments-service"
                      />
                    </div>

                    <div>
                      <label className="block text-2xs font-mono uppercase text-obsidian-400 mb-1">
                        CI Class *
                      </label>
                      <select
                        value={ci.ci_class}
                        onChange={(e) => updateCI(index, 'ci_class', e.target.value as any)}
                        className="h-8 w-full rounded border border-obsidian-700 bg-obsidian-950 px-2 text-xs text-white"
                      >
                        <option value="application">Application</option>
                        <option value="business_service">Business Service</option>
                        <option value="database">Database</option>
                        <option value="vm_cluster">VM Cluster</option>
                        <option value="physical_host">Physical Host</option>
                        <option value="network_firewall">Network Firewall</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-2xs font-mono uppercase text-obsidian-400 mb-1">
                        Environment *
                      </label>
                      <select
                        value={ci.environment}
                        onChange={(e) => updateCI(index, 'environment', e.target.value as any)}
                        className="h-8 w-full rounded border border-obsidian-700 bg-obsidian-950 px-2 text-xs text-white"
                      >
                        <option value="prod">Production</option>
                        <option value="dr">Disaster Recovery</option>
                        <option value="staging">Staging</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-2xs font-mono uppercase text-obsidian-400 mb-1">
                        Criticality Tier *
                      </label>
                      <select
                        value={ci.criticality_tier}
                        onChange={(e) => updateCI(index, 'criticality_tier', e.target.value as any)}
                        className="h-8 w-full rounded border border-obsidian-700 bg-obsidian-950 px-2 text-white text-xs"
                      >
                        <option value="tier_0">Tier 0 (Mission Critical)</option>
                        <option value="tier_1">Tier 1 (High)</option>
                        <option value="tier_2">Tier 2 (Standard)</option>
                        <option value="tier_3">Tier 3 (Low)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-2xs font-mono uppercase text-obsidian-400 mb-1">
                        Technical Contact *
                      </label>
                      <Input
                        value={ci.technical_contact}
                        onChange={(e) => updateCI(index, 'technical_contact', e.target.value)}
                        placeholder="Engineer handle or email"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="block text-2xs font-mono uppercase text-obsidian-400 mb-1">
                        Primary Endpoint (VIP, FQDN, or URL)
                      </label>
                      <Input
                        value={ci.primary_endpoint}
                        onChange={(e) => updateCI(index, 'primary_endpoint', e.target.value)}
                        placeholder="e.g. 10.20.4.15 or https://payments.internal.net"
                      />
                    </div>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-obsidian-750">
              <Button variant="secondary" size="sm" onClick={saveDraft}>
                Save Draft
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  saveDraft();
                  setStep(2);
                }}
                disabled={cis.some((c) => !c.name.trim())}
              >
                Next: Search-First Dependencies <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 2: SEARCH-FIRST DEPENDENCIES */}
        {step === 2 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white">Step 2: Search-First Dependency Mapping</h2>
              <p className="text-xs text-obsidian-400">
                To prevent duplicate databases and hosts, search the enterprise catalog first before linking infrastructure providers.
              </p>
            </div>

            {/* Target App Selector */}
            <div className="p-3 bg-obsidian-850/80 border border-obsidian-750 rounded-lg flex items-center gap-3">
              <span className="text-xs font-mono uppercase text-obsidian-400">For Application:</span>
              <select
                value={selectedAppForDep || cis[0]?.temp_id}
                onChange={(e) => setSelectedAppForDep(e.target.value)}
                className="h-8 rounded border border-obsidian-700 bg-obsidian-950 px-2.5 text-xs text-white"
              >
                {cis.map((ci) => (
                  <option key={ci.temp_id} value={ci.temp_id}>
                    {ci.name || ci.temp_id} ({ci.environment})
                  </option>
                ))}
              </select>
            </div>

            {/* Trigram Catalog Search */}
            <div className="p-4 bg-obsidian-850/80 border border-obsidian-750 rounded-lg space-y-3">
              <span className="text-xs font-semibold text-white block">Search Catalog for Infrastructure</span>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-obsidian-400 absolute left-3 top-2.5" />
                <Input
                  value={depSearchQuery}
                  onChange={(e) => setDepSearchQuery(e.target.value)}
                  placeholder="Search existing databases, hosts, or clusters (e.g. pg-cluster, oracle-prod)..."
                  className="pl-8"
                />
              </div>

              {/* Search Results Picker */}
              {searchResults.length > 0 && (
                <div className="max-h-52 overflow-y-auto divide-y divide-obsidian-750 bg-obsidian-950 rounded border border-obsidian-750">
                  {searchResults.map((res) => (
                    <div
                      key={res.ci.ci_id}
                      className="p-2.5 flex items-center justify-between hover:bg-obsidian-900 transition-colors"
                    >
                      <div>
                        <div className="font-semibold text-xs text-white">{res.ci.name}</div>
                        <div className="text-3xs font-mono text-obsidian-400">
                          {res.ci.ci_class} • {res.ci.environment} • {res.ownership.owner_group_name}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => addDependencyEdge(res, 'reads_from')}
                        >
                          + Reads From
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => addDependencyEdge(res, 'hosted_on')}
                        >
                          + Hosted On
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => addDependencyEdge(res, 'connects_to')}
                        >
                          + Connects To
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Staged Edges */}
            <div className="space-y-2">
              <span className="text-2xs font-mono uppercase text-obsidian-400 font-semibold block">
                Declared Dependency Relationships ({edges.length}):
              </span>

              {edges.length === 0 ? (
                <p className="text-xs text-obsidian-500 italic p-4 bg-obsidian-950/40 rounded border border-obsidian-800 text-center">
                  No dependencies linked yet. Use the search box above to add databases or hosts.
                </p>
              ) : (
                <div className="space-y-2">
                  {edges.map((edge, idx) => (
                    <div
                      key={edge.temp_id}
                      className="p-3 bg-obsidian-850 border border-obsidian-750 rounded flex items-center justify-between text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-blue-400">
                          {cis.find((c) => c.temp_id === edge.source_temp_id)?.name || edge.source_temp_id}
                        </span>
                        <span className="text-2xs font-mono uppercase bg-obsidian-950 px-1.5 py-0.5 rounded text-obsidian-300">
                          {edge.edge_type.replace('_', ' ')} &rarr;
                        </span>
                        <span className="font-semibold text-emerald-400">{edge.target_name}</span>
                      </div>

                      <button
                        onClick={() => removeEdge(idx)}
                        className="text-red-400 hover:text-red-300 text-xs"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-obsidian-750">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  saveDraft();
                  setStep(3);
                }}
              >
                Next: Review & Submit <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* STEP 3: REVIEW & ATOMIC SUBMIT */}
        {step === 3 && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white">Step 3: Review & Publish Baseline v1.0</h2>
              <p className="text-xs text-obsidian-400">
                Confirm your service registration and dependencies. Once published, your CIs enter service and cross-team dependencies enter the handshake queue.
              </p>
            </div>

            <div className="p-4 bg-obsidian-850/80 border border-obsidian-750 rounded-lg space-y-3">
              <span className="text-xs font-semibold text-white block">Summary of Publication Payload:</span>
              <ul className="text-xs text-obsidian-300 space-y-1">
                <li>• Services to Register: <span className="font-bold text-white">{cis.length}</span></li>
                <li>• Dependencies Declared: <span className="font-bold text-white">{edges.length}</span></li>
                <li>• Target Department: <span className="font-bold text-white">{session?.department_name}</span></li>
              </ul>
            </div>

            <div className="flex items-center justify-between pt-4 border-t border-obsidian-750">
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Back
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSubmitBaseline}
                isLoading={isSubmitting}
              >
                Publish Baseline v1.0
              </Button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
