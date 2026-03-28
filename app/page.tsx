import { Suspense } from 'react';
import { DashboardShell } from '@/components/dashboard/dashboard-shell';

export default function DashboardPage() {
  return (
    <Suspense fallback={null}>
      <DashboardShell />
    </Suspense>
  );
}
