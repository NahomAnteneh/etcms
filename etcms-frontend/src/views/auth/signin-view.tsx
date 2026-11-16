import React, { useState } from 'react';
import { Lock, Mail, Shield, ArrowRight, Eye, EyeOff, AlertCircle, Database } from 'lucide-react';
import { useAuth } from '../../store/auth-context';

interface SignInViewProps {
  onSuccess?: () => void;
}

export const SignInView: React.FC<SignInViewProps> = ({ onSuccess }) => {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      setError('Please provide both email and password.');
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      await login(email.trim(), password.trim());
      if (onSuccess) onSuccess();
    } catch (err: any) {
      setError(err?.problem?.detail || err?.message || 'Invalid email or password. Please verify your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-primary flex flex-col justify-center items-center p-4 selection:bg-accent-subtle selection:text-accent font-sans">
      <div className="relative w-full max-w-md z-10 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-md bg-header-bg border border-border-hairline shadow-sm mb-1 text-accent">
            <Database className="w-6 h-6 stroke-[2]" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-primary flex items-center justify-center gap-2">
            <span>ETCMS</span>
            <span className="text-3xs px-2 py-0.5 rounded font-mono bg-accent-subtle text-accent border border-accent/30 font-semibold uppercase tracking-wider">
              CMDB Workspace
            </span>
          </h1>
          <p className="text-xs text-secondary font-medium">Enterprise Topological Configuration Management</p>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-2xs font-mono bg-surface-sunken border border-subtle text-secondary">
            <Shield className="w-3.5 h-3.5 text-accent stroke-[1.75]" />
            <span>Anti-ITAM Strict Operational CMDB</span>
          </div>
        </div>

        {/* Login Card */}
        <div className="bg-surface border border-hairline rounded-md p-6 sm:p-7 shadow-snow space-y-5">
          <div>
            <h2 className="text-sm font-semibold text-primary">Sign in to console</h2>
            <p className="text-2xs text-secondary mt-0.5">Enter enterprise credentials to access your configuration boundary.</p>
          </div>

          {error && (
            <div className="p-3 rounded-md bg-tier0-bg border border-tier0-border text-tier0 text-xs flex items-start gap-2.5" role="alert">
              <AlertCircle className="w-4 h-4 shrink-0 text-tier0 mt-0.5" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="signin-email" className="block text-2xs font-semibold uppercase tracking-wider text-muted font-mono mb-1.5">
                Work Email *
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="signin-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@enterprise.com"
                  required
                  autoFocus
                  className="w-full pl-9 pr-3 py-1.5 rounded-md bg-surface border border-control text-primary placeholder:text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors font-mono"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="signin-password" className="block text-2xs font-semibold uppercase tracking-wider text-muted font-mono">
                  Password *
                </label>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-muted absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  className="w-full pl-9 pr-9 py-1.5 rounded-md bg-surface border border-control text-primary placeholder:text-muted text-xs focus:outline-none focus:ring-2 focus:ring-accent focus:border-accent transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-primary p-1 cursor-pointer rounded"
                >
                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 py-2 px-4 rounded-md bg-accent hover:bg-accent-hover active:brightness-95 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {isLoading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span>Sign In</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer info */}
        <p className="text-center text-3xs text-muted font-mono">
          ETCMS Operational Boundary Architecture • Dedicated Session Tokens
        </p>
      </div>
    </div>
  );
};
