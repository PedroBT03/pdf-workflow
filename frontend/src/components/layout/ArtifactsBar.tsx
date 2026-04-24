import React from 'react';
import { Braces } from 'lucide-react';

interface ArtifactsBarProps {
  hasPdfArtifact: boolean;
  hasJsonArtifact: boolean;
  hasEditedJson: boolean;
  hasUpgradedArtifact: boolean;
  hasTextFinderArtifact: boolean;
  hasBlockFinderArtifact: boolean;
  hasBlockExtractorArtifact: boolean;
}

/**
 * Reusable badge component for the status bar
 */
const StatusBadge: React.FC<{ label: string; isAvailable: boolean }> = ({ label, isAvailable }) => (
  <div 
    className={`px-3 py-2 rounded-xl border transition-all duration-300 ${
      isAvailable 
        ? 'text-emerald-200 bg-emerald-950/30 border-emerald-900/50 shadow-[0_0_10px_rgba(16,185,129,0.05)]' 
        : 'text-zinc-500 bg-zinc-800/40 border-zinc-800 opacity-60'
    }`}
  >
    <span className="font-medium">{label}:</span> 
    <span className={`ml-1 uppercase text-[10px] tracking-widest font-bold ${isAvailable ? 'text-emerald-400' : 'text-zinc-600'}`}>
      {isAvailable ? 'available' : 'missing'}
    </span>
  </div>
);

export const ArtifactsBar: React.FC<ArtifactsBarProps> = ({
  hasPdfArtifact,
  hasJsonArtifact,
  hasEditedJson,
  hasUpgradedArtifact,
  hasTextFinderArtifact,
  hasBlockFinderArtifact,
  hasBlockExtractorArtifact,
}) => {
  return (
    <div className="w-full mb-3">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl shadow-xl p-4 flex items-center gap-4 flex-wrap">
        {/* Section Title */}
        <div className="flex items-center gap-2 text-sm text-zinc-300 pr-2 border-r border-zinc-800 mr-2">
          <Braces className="w-4 h-4 text-blue-500" />
          <span className="text-zinc-500 uppercase tracking-[0.2em] text-[11px] font-bold">
            Artifacts
          </span>
        </div>

        {/* Status Badges List */}
        <div className="flex flex-wrap gap-2 text-xs">
          <StatusBadge label="PDF" isAvailable={hasPdfArtifact} />
          <StatusBadge label="JSON" isAvailable={hasJsonArtifact} />
          <StatusBadge label="Edited" isAvailable={hasEditedJson} />
          <StatusBadge label="Upgraded" isAvailable={hasUpgradedArtifact} />
          <StatusBadge label="Text Finder" isAvailable={hasTextFinderArtifact} />
          <StatusBadge label="Block Finder" isAvailable={hasBlockFinderArtifact} />
          <StatusBadge label="Block Extractor" isAvailable={hasBlockExtractorArtifact} />
        </div>
      </div>
    </div>
  );
};