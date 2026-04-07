'use client';

import { formatDashboardTime } from '@/lib/dashboard-time';

interface LastUpdateProps {
  fetchedAt?: string;
  isLoading?: boolean;
}

export function LastUpdate({ fetchedAt, isLoading = false }: LastUpdateProps) {
  return (
    <div className="flex items-center gap-2 text-xs font-medium text-white">
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${isLoading ? 'animate-pulse' : ''}`}
        style={{ backgroundColor: '#0BC5B3' }}
      />
      <span>
        Last update: <span className="text-white">{formatDashboardTime(fetchedAt)}</span>
      </span>
    </div>
  );
}
