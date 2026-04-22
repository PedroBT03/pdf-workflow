import React from 'react';
import { UpgradeMode, UPGRADE_MODE_LABELS } from '../../lib/workflow';

interface UpgradeActionProps {
  upgradeMode: UpgradeMode;
  setUpgradeMode: (mode: UpgradeMode) => void;
  isActionInProgress: boolean;
}

export const UpgradeAction: React.FC<UpgradeActionProps> = ({
  upgradeMode,
  setUpgradeMode,
  isActionInProgress,
}) => {
  return (
    <div className="grid gap-4">
      <div>
        <label className="block text-xs text-zinc-400 mb-2">
          Upgrade Strategy
        </label>
        <select
          value={upgradeMode}
          onChange={(e) => setUpgradeMode(e.target.value as UpgradeMode)}
          disabled={isActionInProgress}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-sm text-zinc-200 outline-none focus:border-blue-500 transition-colors"
        >
          {Object.entries(UPGRADE_MODE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>

      {/* Dynamic description helper based on selection */}
      <div className="text-[11px] text-zinc-500 leading-relaxed bg-zinc-950/20 p-3 rounded-xl border border-zinc-800/50">
        <p>
          {upgradeMode === 'text' && 
            "Focuses on fixing encoding issues, joining broken words, and correcting unicode characters."}
          {upgradeMode === 'figures' && 
            "Identifies adjacent image fragments that belong to the same illustration and merges them into a single block."}
          {upgradeMode === 'both' && 
            "Performs both text normalization and figure merging sequentially."}
        </p>
      </div>
    </div>
  );
};