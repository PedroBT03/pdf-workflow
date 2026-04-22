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
  onSelectTarget: (target: SelectedTarget) => void;
  // Finder titles logic
  buildFinderOverlayTitle: (block: any) => string;
}

export const BoundingBoxes: React.FC<BoundingBoxesProps> = ({
  blocks,
  currentPage,
  pageDimensions,
  editSessionEnabled,
  selectedTarget,
  onSelectTarget,
  buildFinderOverlayTitle,
}) => {
  const { scale, width, height } = pageDimensions;

  const usesZeroBasedPages = blocks.some((block) => Number(block?.page) === 0);

  const toScreenBox = (rawBox: any): { left: number; top: number; width: number; height: number } | null => {
    if (!Array.isArray(rawBox) || rawBox.length !== 4) return null;

    const nums = rawBox.map((value) => Number(value));
    if (nums.some((value) => Number.isNaN(value) || !Number.isFinite(value))) return null;

    let [x1, y1, x2, y2] = nums;

    // Some pipelines emit [x, y, width, height] instead of [x1, y1, x2, y2].
    if (x2 <= x1 || y2 <= y1) {
      x2 = x1 + x2;
      y2 = y1 + y2;
    }

    const isNormalized = Math.max(Math.abs(x1), Math.abs(y1), Math.abs(x2), Math.abs(y2)) <= 1.2;
    if (isNormalized) {
      // Normalized values are already relative to the rendered page size.
      const left = x1 * width;
      const top = y1 * height;
      const boxWidth = Math.max(8, (x2 - x1) * width);
      const boxHeight = Math.max(8, (y2 - y1) * height);
      return { left, top, width: boxWidth, height: boxHeight };
    }

    // Absolute PDF points map through the render scale.
    const left = x1 * scale;
    const top = y1 * scale;
    const boxWidth = Math.max(8, (x2 - x1) * scale);
    const boxHeight = Math.max(8, (y2 - y1) * scale);
    return { left, top, width: boxWidth, height: boxHeight };
  };

  // Filter blocks belonging to the current page
  const currentPageBlocks = blocks
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

        // Visual states
        const isSelectedBlock = selectedTarget?.kind === 'block' && selectedTarget.blockIndex === index;
        const isTextFinderHighlighted = Boolean(block?.text_finder_highlighted);
        const isBlockFinderHighlighted = Boolean(block?.block_finder_highlighted);
        
        const highlightMode = isTextFinderHighlighted && isBlockFinderHighlighted ? 'both' 
          : isTextFinderHighlighted ? 'text' 
          : isBlockFinderHighlighted ? 'block' 
          : 'none';

        // Shared class logic for interactivity and colors
        const getBoxClasses = (isSelected: boolean) => `
          absolute overflow-hidden transition-colors border
          ${editSessionEnabled ? 'pointer-events-auto cursor-pointer' : highlightMode !== 'none' ? 'pointer-events-auto cursor-help opacity-60' : 'pointer-events-none opacity-60'}
          ${isSelected ? 'border-2 border-amber-300 bg-amber-300/20 z-10' : 
            highlightMode === 'both' ? 'border-rose-300 bg-rose-300/20 hover:bg-rose-300/30' :
            highlightMode === 'text' ? 'border-orange-300 bg-orange-300/20 hover:bg-orange-300/30' :
            highlightMode === 'block' ? 'border-violet-500 bg-violet-500/35 hover:bg-violet-500/45' :
            'border-blue-400/80 bg-blue-400/10'}
        `;

        // TABLE OVERLAY LOGIC
        if (isTableWithGrid(block)) {
          const tableRows = Array.isArray(block.block) ? block.block : [];
          const { rows, cols } = getTableDimensions(tableRows);
          const safeRows = Math.max(1, rows);
          const cellBoxesMatrix = getCellBoxesMatrix(block, safeRows, cols);
          const captionBoxes = getCaptionBoxes(block);

          return (
            <React.Fragment key={index}>
              {/* Render Table Cells */}
              {Array.from({ length: safeRows }).map((_, rIdx) =>
                Array.from({ length: cols }).map((__, cIdx) => {
                  const cellBox = cellBoxesMatrix[rIdx][cIdx];
                  if (!cellBox) return null;
                  
                  const isCellSelected = selectedTarget?.kind === 'tableCell' && 
                                        selectedTarget.blockIndex === index && 
                                        selectedTarget.row === rIdx && 
                                        selectedTarget.col === cIdx;

                  return (
                    <div
                      key={`cell-${index}-${rIdx}-${cIdx}`}
                      className={getBoxClasses(isCellSelected)}
                      style={(() => {
                        const cellScreenBox = toScreenBox(cellBox);
                        if (!cellScreenBox) return { display: 'none' as const };
                        return {
                          left: cellScreenBox.left,
                          top: cellScreenBox.top,
                          width: cellScreenBox.width,
                          height: cellScreenBox.height,
                        };
                      })()}
                      onClick={() => editSessionEnabled && onSelectTarget({ kind: 'tableCell', blockIndex: index, row: rIdx, col: cIdx })}
                      title={buildFinderOverlayTitle(block)}
                    />
                  );
                })
              )}
              {/* Render Table Captions */}
              {captionBoxes.map((capBox, capIdx) => {
                const isCapSelected = selectedTarget?.kind === 'tableCaption' && 
                                     selectedTarget.blockIndex === index && 
                                     selectedTarget.captionIndex === capIdx;
                return (
                  <div
                    key={`cap-${index}-${capIdx}`}
                    className={getBoxClasses(isCapSelected)}
                    style={(() => {
                      const captionScreenBox = toScreenBox(capBox);
                      if (!captionScreenBox) return { display: 'none' as const };
                      return {
                        left: captionScreenBox.left,
                        top: captionScreenBox.top,
                        width: captionScreenBox.width,
                        height: captionScreenBox.height,
                      };
                    })()}
                    onClick={() => editSessionEnabled && onSelectTarget({ kind: 'tableCaption', blockIndex: index, captionIndex: capIdx })}
                    title={buildFinderOverlayTitle(block)}
                  />
                );
              })}
            </React.Fragment>
          );
        }

        // STANDARD BLOCK OVERLAY
        return (
          <div
            key={index}
            className={getBoxClasses(isSelectedBlock)}
            style={{ left: screenBox.left, top: screenBox.top, width: screenBox.width, height: screenBox.height }}
            onClick={() => editSessionEnabled && onSelectTarget({ kind: 'block', blockIndex: index })}
            title={buildFinderOverlayTitle(block)}
          />
        );
      })}
    </div>
  );
};