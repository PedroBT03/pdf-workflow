import React, { useEffect, useMemo, useRef, useState } from 'react';

interface DrawingBox { x1: number; y1: number; x2: number; y2: number; }

interface BlockDrawerProps {
  isActive: boolean;
  currentPage: number;
  pageDimensions: { width: number; height: number; scale: number };
  onBlockCreated: (box: [number, number, number, number], page: number) => void;
  onCancel: () => void;
}

export const BlockDrawer: React.FC<BlockDrawerProps> = ({
  isActive,
  currentPage,
  pageDimensions,
  onBlockCreated,
  onCancel,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const isPointerCapturedRef = useRef(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingBox, setDrawingBox] = useState<DrawingBox | null>(null);

  // Fallback dimensions to prevent crashes if metadata is missing
  const width = pageDimensions?.width || 0;
  const height = pageDimensions?.height || 0;
  const scale = pageDimensions?.scale || 1;

  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  const getLocalPoint = (clientX: number, clientY: number) => {
    if (!overlayRef.current) return { x: 0, y: 0 };
    const rect = overlayRef.current.getBoundingClientRect();
    return {
      x: clamp(clientX - rect.left, 0, rect.width),
      y: clamp(clientY - rect.top, 0, rect.height),
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !isActive || width === 0) return;
    e.preventDefault();
    overlayRef.current?.setPointerCapture(e.pointerId);
    isPointerCapturedRef.current = true;
    setIsDrawing(true);
    const { x, y } = getLocalPoint(e.clientX, e.clientY);
    setDrawingBox({ x1: x, y1: y, x2: x, y2: y });
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawingBox) return;
    const { x, y } = getLocalPoint(e.clientX, e.clientY);
    setDrawingBox((prev) => prev ? { ...prev, x2: x, y2: y } : null);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPointerCapturedRef.current) {
      overlayRef.current?.releasePointerCapture(e.pointerId);
      isPointerCapturedRef.current = false;
    }
    if (!isDrawing || !drawingBox) return;
    setIsDrawing(false);

    const w = Math.abs(drawingBox.x2 - drawingBox.x1);
    const h = Math.abs(drawingBox.y2 - drawingBox.y1);

    // Only create block if the drag distance is significant
    if (w > 5 && h > 5) {
      const x1 = Math.min(drawingBox.x1, drawingBox.x2) / scale;
      const y1 = Math.min(drawingBox.y1, drawingBox.y2) / scale;
      const x2 = Math.max(drawingBox.x1, drawingBox.x2) / scale;
      const y2 = Math.max(drawingBox.y1, drawingBox.y2) / scale;
      onBlockCreated([x1, y1, x2, y2], currentPage);
    }

    setDrawingBox(null);
    onCancel();
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isPointerCapturedRef.current) {
      overlayRef.current?.releasePointerCapture(e.pointerId);
      isPointerCapturedRef.current = false;
    }
    setIsDrawing(false);
    setDrawingBox(null);
  };

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isActive) {
        setDrawingBox(null);
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [isActive, onCancel]);

  // Prevent rendering if inactive or dimensions are zero
  if (!isActive || width === 0 || height === 0) return null;

  const previewStyle = isDrawing && drawingBox ? {
    left: Math.min(drawingBox.x1, drawingBox.x2),
    top: Math.min(drawingBox.y1, drawingBox.y2),
    width: Math.abs(drawingBox.x2 - drawingBox.x1),
    height: Math.abs(drawingBox.y2 - drawingBox.y1),
  } : null;

  return (
    <div
      ref={overlayRef}
      className="absolute top-0 left-0 z-100"
      style={{ width, height }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
    >
      <div className="absolute inset-0 bg-blue-500/5 cursor-crosshair" />
      {previewStyle && (
        <div
          className="absolute border-2 border-blue-500 bg-blue-500/10 pointer-events-none"
          style={previewStyle}
        />
      )}
    </div>
  );
};