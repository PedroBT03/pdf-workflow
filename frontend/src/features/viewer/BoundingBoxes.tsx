import React from 'react';
import { 
  isTableWithGrid, 
  getTableDimensions, 
  getCellBoxesMatrix, 
  getCaptionBoxes 
} from '../../lib/pdfArtifacts';
import { SelectedTarget } from '../../types';

interface BoundingBoxesProps {
  blocks: any[];
  currentPage: number;
  pageDimensions: { width: number; height: number; scale: number };
  editSessionEnabled: boolean;
  selectedTarget: SelectedTarget | null;
  pendingNewBlock?: { box: [number, number, number, number]; page: number } | null;
  onSelectTarget: (target: SelectedTarget) => void;
  buildFinderOverlayTitle: (block: any) => string;
}

export const BoundingBoxes: React.FC<BoundingBoxesProps> = ({
  blocks,
  currentPage,
  pageDimensions,
  editSessionEnabled,
  selectedTarget,
  pendingNewBlock,
  onSelectTarget,
  buildFinderOverlayTitle,
}) => {
  // Ensure we have fallback numbers to prevent NaN in CSS style attributes
  const width = pageDimensions?.width || 0;
  const height = pageDimensions?.height || 0;
  const scale = pageDimensions?.scale || 1;

  const usesZeroBasedPages = Array.isArray(blocks) && blocks.some((block) => Number(block?.page) === 0);

  const toScreenBox = (rawBox: any): { left: number; top: number; width: number; height: number } | null => {
    // Safety check: ensure box is a valid array before processing
    if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;

    const nums = rawBox.map((value) => Number(value));
    if (nums.some((value) => Number.isNaN(value) || !Number.isFinite(value))) return null;

    let [x1, y1, x2, y2] = nums;

    if (x2 <= x1 || y2 <= y1) {
      x2 = x1 + x2;
      y2 = y1 + y2;
    }

    const isNormalized = Math.max(Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2)) <= 1.2;
    if (isNormalized) {
      return { 
        left: x1 * width, 
        top: y1 * height, 
        width: Math.max(8, (x2 - x1) * width), 
        height: Math.max(8, (y2 - y1) * height) 
      };
    }

    return { 
      left: x1 * scale, 
      top: y1 * scale, 
      width: Math.max(8, (x2 - x1) * scale), 
      height: Math.max(8, (y2 - y1) * scale) 
    };
  };

  const currentPageBlocks = (Array.isArray(blocks) ? blocks : [])
    .map((block, index) => ({ block, index }))
    .filter(({ block }) => {
      const pageValue = Number(block?.page ?? 1);
      if (!Number.isFinite(pageValue)) return false;
      const expectedPage = usesZeroBasedPages ? currentPage - 1 : currentPage;
      return pageValue === expectedPage;
    });

  return (
    <div 
      className="absolute top-0 left-0 pointer-events-none" 
      style={{ width, height }}
    >
      {currentPageBlocks.map(({ block, index }) => {
        const screenBox = toScreenBox(block?.box);
        if (!screenBox) return null;

        const isSelectedBlock = selectedTarget?.kind === 'block' && selectedTarget.blockIndex === index;
        const isTextFinderHighlighted = Boolean(block?.text_finder_highlighted);
        const isBlockFinderHighlighted = Boolean(block?.block_finder_highlighted);
        
        const highlightMode = isTextFinderHighlighted && isBlockFinderHighlighted ? 'both' 
          : isTextFinderHighlighted ? 'text' 
          : isBlockFinderHighlighted ? 'block' 
          : 'none';

        const getBoxClasses = (isSelected: boolean) => `
          absolute overflow-hidden transition-colors border
          ${editSessionEnabled ? 'pointer-events-auto cursor-pointer' : highlightMode !== 'none' ? 'pointer-events-auto cursor-help opacity-60' : 'pointer-events-none opacity-60'}
          ${isSelected ? 'border-2 border-amber-300 bg-amber-300/20 z-10' : 
            highlightMode === 'both' ? 'border-rose-300 bg-rose-300/20 hover:bg-rose-300/30' :
            highlightMode === 'text' ? 'border-orange-300 bg-orange-300/20 hover:bg-orange-300/30' :
            highlightMode === 'block' ? 'border-violet-500 bg-violet-500/35 hover:bg-violet-500/45' :
            'border-blue-400/80 bg-blue-400/10'}
        `;

        if (isTableWithGrid(block)) {
          const tableRows = Array.isArray(block.block) ? block.block : [];
          const { rows, cols } = getTableDimensions(tableRows);
          const safeRows = Math.max(1, rows);
          const cellBoxesMatrix = getCellBoxesMatrix(block, safeRows, cols);
          const captionBoxes = getCaptionBoxes(block);

          return (
            <React.Fragment key={index}>
              {Array.from({ length: safeRows }).map((_, rIdx) =>
                Array.from({ length: cols }).map((__, cIdx) => {
                  const cellBox = cellBoxesMatrix[rIdx]?.[cIdx];
                  if (!cellBox) return null;
                  
                  const isCellSelected = selectedTarget?.kind === 'tableCell' && 
                                        selectedTarget.blockIndex === index && 
                                        selectedTarget.row === rIdx && 
                                        selectedTarget.col === cIdx;

                  const cellScreenBox = toScreenBox(cellBox);
                  if (!cellScreenBox) return null;

                  return (
                    <div
                      key={`cell-${index}-${rIdx}-${cIdx}`}
                      className={getBoxClasses(isCellSelected)}
                      style={{ ...cellScreenBox }}
                      onClick={() => editSessionEnabled && onSelectTarget({ kind: 'tableCell', blockIndex: index, row: rIdx, col: cIdx })}
                      title={buildFinderOverlayTitle(block)}
                    />
                  );
                })
              )}
              {captionBoxes.map((capBox, capIdx) => {
                const isCapSelected = selectedTarget?.kind === 'tableCaption' && 
                                     selectedTarget.blockIndex === index && 
                                     selectedTarget.captionIndex === capIdx;
                
                const captionScreenBox = toScreenBox(capBox);
                if (!captionScreenBox) return null;

                return (
                  <div
                    key={`cap-${index}-${capIdx}`}
                    className={getBoxClasses(isCapSelected)}
                    style={{ ...captionScreenBox }}
                    onClick={() => editSessionEnabled && onSelectTarget({ kind: 'tableCaption', blockIndex: index, captionIndex: capIdx })}
                    title={buildFinderOverlayTitle(block)}
                  />
                );
              })}
            </React.Fragment>
          );
        }

        return (
          <div
            key={index}
            className={getBoxClasses(isSelectedBlock)}
            style={{ ...screenBox }}
            onClick={() => editSessionEnabled && onSelectTarget({ kind: 'block', blockIndex: index })}
            title={buildFinderOverlayTitle(block)}
          />
        );
      })}

      {/* Render the unsaved drawn block if it exists and matches the current page */}
      {pendingNewBlock && pendingNewBlock.page === currentPage && width > 0 && (
        <div
          className="absolute border-2 border-dashed border-blue-400 bg-blue-400/20 z-50 shadow-[0_0_10px_rgba(59,130,246,0.5)]"
          style={{
            left: (pendingNewBlock.box[0] || 0) * scale,
            top: (pendingNewBlock.box[1] || 0) * scale,
            width: ((pendingNewBlock.box[2] || 0) - (pendingNewBlock.box[0] || 0)) * scale,
            height: ((pendingNewBlock.box[3] || 0) - (pendingNewBlock.box[1] || 0)) * scale,
          }}
        >
           <div className="absolute -top-6 left-0 bg-blue-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
             NEW BLOCK (UNSAVED)
           </div>
        </div>
      )}
    </div>
  );
};