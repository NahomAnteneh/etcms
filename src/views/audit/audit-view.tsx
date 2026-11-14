import { useState } from 'react';
import {
  Shield,
  FileSpreadsheet,
} from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../components/ui/card';
import { useAuth } from '../../store/auth-context';

export function AuditView() {
  const { activeRole, activeOwnerGroup } = useAuth();
  const [isExporting, setIsExporting] = useState(false);

  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      const url = `/api/v1/audit-logs/export${
        activeRole !== 'platform_admin' && activeOwnerGroup
          ? `?owner_group_id=${activeOwnerGroup.id}`
          : ''
      }`;
      const response = await fetch(url, {
        headers: {
          'X-Dev-User-ID': '11111111-1111-1111-1111-111111111111',
        },
      });
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = `etcms-audit-export-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(downloadUrl);
      document.body.removeChild(a);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl w-full mx-auto animate-in fade-in-50 duration-150">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-subtle">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-primary flex items-center gap-2">
            Immutable Audit Trail & Compliance Export
          </h1>
          <p className="text-xs text-secondary mt-1">
            Database trigger-enforced append-only audit log. Every configuration item mutation is indelibly recorded.
          </p>
        </div>

        <Button variant="primary" size="sm" onClick={handleExportCSV} isLoading={isExporting}>
          <FileSpreadsheet className="w-3.5 h-3.5 mr-1 stroke-[1.5]" />
          Export Streaming CSV
        </Button>
      </div>

      {/* Compliance Information Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xs uppercase tracking-wider text-primary">
            <Shield className="w-4 h-4 text-inservice stroke-[1.5]" />
            Database-Enforced Immutability Guarantees
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs text-secondary">
          <p>
            The <code className="text-inservice font-mono text-2xs">audit_logs</code> table is protected by PostgreSQL triggers <code className="text-inservice font-mono text-2xs">audit_logs_no_update_delete</code> and <code className="text-inservice font-mono text-2xs">audit_logs_no_truncate</code>. Any attempt to modify or truncate historical records is rejected by the database engine.
          </p>
          <div className="p-3 bg-surface-sunken rounded-md border border-subtle text-2xs text-secondary">
            <span className="font-semibold text-primary block mb-0.5">Formula Injection Sanitization</span>
            CSV exports strictly sanitize every text cell starting with <code className="text-accent font-mono">=</code>, <code className="text-accent font-mono">+</code>, <code className="text-accent font-mono">-</code>, <code className="text-accent font-mono">@</code>, <code className="text-accent font-mono">\t</code>, or <code className="text-accent font-mono">\r</code> by prefixing with a single quote to prevent spreadsheet code execution.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
