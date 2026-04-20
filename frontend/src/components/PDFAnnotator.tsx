import React, { useEffect, useState, useRef } from 'react';
import { Stage, Layer, Rect, Text } from 'react-konva';
// @ts-ignore: react-pdf does not provide type declarations in this project
import { Document, Page, pdfjs } from 'react-pdf';

// Configure pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.js`;

interface BoundingBox {
  page: number;
  type: string;
  box: [number, number, number, number]; // [x1, y1, x2, y2]
  legend?: string;
}

// Render a PDF page with Konva overlays aligned to metadata bounding boxes.
const PDFAnnotator = ({ pdfUrl, metadata }: { pdfUrl: string, metadata: any }) => {
  const [scale, setScale] = useState(1);
  const [pageDimensions, setPageDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Update rendered page dimensions and coordinate scale after page load.
  const handlePageLoadSuccess = (page: any) => {
    const { width, height, originalWidth } = page;
    
    // Calculate the ratio between the rendered width and the PDF's internal coordinate system
    // This is crucial because metadata coordinates are based on originalWidth
    const currentScale = width / originalWidth;
    setScale(currentScale);
    setPageDimensions({ width, height });
  };

  return (
    <div className="relative border shadow-lg" ref={containerRef} style={{ width: 'fit-content' }}>
      {/* Layer 1: The Visual PDF */}
      <Document file={pdfUrl}>
        <Page 
          pageNumber={1} 
          onLoadSuccess={handlePageLoadSuccess}
          renderTextLayer={false}
          renderAnnotationLayer={false}
        />
      </Document>

      {/* Layer 2: Interactive Canvas exactly overlapping the PDF page */}
      {pageDimensions.width > 0 && (
        <div className="absolute top-0 left-0 pointer-events-none">
          <Stage width={pageDimensions.width} height={pageDimensions.height}>
            <Layer>
              {metadata.blocks.map((block: BoundingBox, i: number) => {
                // Converting [x1, y1, x2, y2] to [x, y, width, height]
                const [x1, y1, x2, y2] = block.box;
                
                return (
                  <React.Fragment key={i}>
                    <Rect
                      x={x1 * scale}
                      y={y1 * scale}
                      width={(x2 - x1) * scale}
                      height={(y2 - y1) * scale}
                      stroke="rgba(255, 0, 0, 0.5)"
                      strokeWidth={2}
                      fill="rgba(255, 0, 0, 0.1)"
                      className="pointer-events-auto cursor-pointer"
                      onClick={() => alert(`Editing ${block.type}`)}
                    />
                  </React.Fragment>
                );
              })}
            </Layer>
          </Stage>
        </div>
      )}
    </div>
  );
};

export default PDFAnnotator;