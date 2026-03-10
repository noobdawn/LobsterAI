import React, { useCallback, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from '../../store';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';

const DEFAULT_CONTEXT_LIMIT = 128000;
const COMPACT_MIN_PERCENTAGE = 50;

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return String(tokens);
}

function getUsageColor(percentage: number): string {
  if (percentage >= 80) return 'text-red-500';
  if (percentage >= 60) return 'text-yellow-500';
  return 'dark:text-claude-darkTextSecondary text-claude-textSecondary';
}

const ContextUsageIndicator: React.FC = () => {
  const currentSessionId = useSelector((state: RootState) => state.cowork.currentSessionId);
  const tokenUsage = useSelector((state: RootState) =>
    currentSessionId ? state.cowork.tokenUsage[currentSessionId] : null
  );
  const isStreaming = useSelector((state: RootState) => state.cowork.isStreaming);
  const isCompacting = useSelector((state: RootState) =>
    currentSessionId ? Boolean(state.cowork.compactingSessions[currentSessionId]) : false
  );
  const [showTooltip, setShowTooltip] = useState(false);

  const canCompact = !isCompacting && !isStreaming && (tokenUsage?.inputTokens ?? 0) / DEFAULT_CONTEXT_LIMIT * 100 >= COMPACT_MIN_PERCENTAGE;

  const handleCompact = useCallback(async () => {
    if (!currentSessionId || !canCompact) return;
    await coworkService.compactSession(currentSessionId);
  }, [currentSessionId, canCompact]);

  if (!currentSessionId) return null;

  // Show loading state even if tokenUsage is cleared during compaction
  if (!isCompacting && (!tokenUsage || tokenUsage.inputTokens <= 0)) return null;

  const inputTokens = tokenUsage?.inputTokens ?? 0;
  const contextLimit = DEFAULT_CONTEXT_LIMIT;
  const percentage = Math.min(100, (inputTokens / contextLimit) * 100);
  const remaining = Math.max(0, 100 - percentage);
  const colorClass = isCompacting ? 'dark:text-claude-darkTextSecondary text-claude-textSecondary' : getUsageColor(percentage);

  const label = isCompacting
    ? i18nService.t('compacting')
    : `${Math.round(percentage)}%`;

  const tooltipLines = isCompacting
    ? [i18nService.t('compacting')]
    : [
        `${Math.round(remaining)}% ${i18nService.t('contextRemaining')}`,
        `${formatTokenCount(inputTokens)} / ${formatTokenCount(contextLimit)} ${i18nService.t('contextUsage')}`,
        ...(canCompact ? [i18nService.t('clickToCompact')] : []),
      ];

  return (
    <div
      className="relative"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2.5 py-1.5 rounded-md text-xs whitespace-nowrap bg-gray-900 dark:bg-gray-700 text-white shadow-lg z-50 pointer-events-none">
          {tooltipLines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900 dark:border-t-gray-700" />
        </div>
      )}
      <button
        type="button"
        onClick={handleCompact}
        className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-medium transition-colors ${colorClass} hover:bg-claude-surfaceHover dark:hover:bg-claude-darkSurfaceHover`}
      >
        {isCompacting ? (
          <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5 flex-shrink-0" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.3" />
            <path
              d={describeArc(8, 8, 7, 0, percentage * 3.6)}
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        )}
        <span className="whitespace-nowrap">{label}</span>
      </button>
    </div>
  );
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

function describeArc(cx: number, cy: number, r: number, startAngle: number, endAngle: number): string {
  const clampedEnd = Math.min(endAngle, 359.99);
  const start = polarToCartesian(cx, cy, r, clampedEnd);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = clampedEnd - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

export default ContextUsageIndicator;
