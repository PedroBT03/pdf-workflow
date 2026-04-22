import { useState, useRef, useCallback } from 'react';

export const usePDFState = () => {
  const [pdfFile, setPdfFile] = useState<Blob | null>(null);
  const [sourceFilename, setSourceFilename] = useState('metadata');
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageJumpValue, setPageJumpValue] = useState('1');
  const [pageSizes, setPageSizes] = useState<Record<number, { width: number; height: number; scale: number }>>({});
  const [lastRenderedPageHeight, setLastRenderedPageHeight] = useState<number>(0);
  const [pageRefreshTick, setPageRefreshTick] = useState(0);

  const pdfViewerScrollRef = useRef<HTMLDivElement | null>(null);
  const savedViewerScrollTopRef = useRef(0);
  const savedWindowScrollTopRef = useRef(0);

  const navigateToPage = useCallback((nextPage: number) => {
    if (pdfViewerScrollRef.current) {
      savedViewerScrollTopRef.current = pdfViewerScrollRef.current.scrollTop;
    }
    savedWindowScrollTopRef.current = window.scrollY;
    
    const targetPage = Math.min(Math.max(1, nextPage), numPages || 1);
    setCurrentPage(targetPage);
    setPageJumpValue(String(targetPage));
  }, [numPages]);

  const onDocumentLoadSuccess = ({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setPageSizes({});
    setLastRenderedPageHeight(0);
    setCurrentPage((prev) => {
      const nextPage = Math.min(Math.max(1, prev), total || 1);
      setPageJumpValue(String(nextPage));
      return nextPage;
    });
  };

  const onPageLoadSuccess = (pageNumber: number, page: any) => {
    const viewport = page.getViewport({ scale: 1.5 });
    const nextScale = viewport.width / page.originalWidth;
    setLastRenderedPageHeight(viewport.height);
    setPageSizes(prev => ({
      ...prev,
      [pageNumber]: { width: viewport.width, height: viewport.height, scale: nextScale },
    }));
  };

  const forcePageRefresh = useCallback(() => setPageRefreshTick(prev => prev + 1), []);

  return {
    pdfFile, setPdfFile,
    sourceFilename, setSourceFilename,
    numPages, currentPage, setCurrentPage,
    pageJumpValue, setPageJumpValue,
    pageSizes, setPageSizes,
    lastRenderedPageHeight,
    pageRefreshTick, forcePageRefresh,
    pdfViewerScrollRef, savedViewerScrollTopRef, savedWindowScrollTopRef,
    navigateToPage,
    onDocumentLoadSuccess,
    onPageLoadSuccess
  };
};