import React, { useState, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { Stage, Layer, Rect, Text, Transformer } from 'react-konva';
import { Download, Upload, CheckCircle, FileText, Loader2, MousePointer2 } from 'lucide-react';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

const App = () => {
  const [docData, setDocData] = useState<any>(null);
  const [blocks, setBlocks] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [pdfFile, setPdfFile] = useState<Blob | null>(null);
  // Guardar os bytes originais do PDF para o pdf-lib poder modificar
  const [pdfBytes, setPdfBytes] = useState<ArrayBuffer | null>(null);

  const shapeRef = useRef<any>(null);
  const trRef = useRef<any>(null);

  useEffect(() => {
    if (selectedIndex !== null && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [selectedIndex]);

  // 1. UPLOAD E PROCESSAMENTO
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setSelectedIndex(null);
    setDownloadUrl(null);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch('http://localhost:8000/api/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Falha no processamento da IA');
      const data = await response.json();

      const pdfBlobResponse = await fetch(data.pdf_url);
      const blob = await pdfBlobResponse.blob();
      const arrayBuffer = await blob.arrayBuffer();

      setPdfFile(blob);
      setPdfBytes(arrayBuffer);
      setBlocks(data.blocks);
      setDocData(data);
    } catch (err: any) {
      console.error(err);
      alert('Erro: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const onPageLoadSuccess = (page: any) => {
    const viewport = page.getViewport({ scale: 1.5 });
    setPageSize({ width: viewport.width, height: viewport.height });
  };

  const scale = docData ? pageSize.width / docData.pdf_size.width : 1;

  // 2. LÓGICA DE EDIÇÃO E REFLOW
  const handleContentChange = (newContent: string) => {
    if (selectedIndex === null) return;

    const updated = [...blocks];
    const b = updated[selectedIndex];

    const lines = newContent.split('\n').length || 1;
    const lineHeight = b.font_size * 1.2;
    const newH = Math.max(lineHeight, lines * lineHeight);
    const diff = newH - (b.box[3] - b.box[1]);

    b.content = newContent;
    b.box[3] = b.box[1] + newH;
    b.isModified = true;

    updated.forEach((other, idx) => {
      if (idx !== selectedIndex && other.box[1] > b.box[1]) {
        const hasHorizontalOverlap =
          Math.min(b.box[2], other.box[2]) > Math.max(b.box[0], other.box[0]);
        if (hasHorizontalOverlap) {
          other.box[1] += diff;
          other.box[3] += diff;
          other.isShifted = true;
        }
      }
    });

    setBlocks(updated);
  };

  const handleTransformEnd = (e: any) => {
    if (selectedIndex === null) return;
    const node = e.target;

    const newX = node.x();
    const newY = node.y();
    const newW = node.width() * node.scaleX();
    const newH = node.height() * node.scaleY();

    const updated = [...blocks];
    updated[selectedIndex].box = [
      newX / scale,
      newY / scale,
      (newX + newW) / scale,
      (newY + newH) / scale,
    ];
    updated[selectedIndex].isModified = true;

    node.scaleX(1);
    node.scaleY(1);

    setBlocks(updated);
  };

  // 3. EXPORTAÇÃO COM PDF-LIB
  const savePdf = async () => {
    if (!pdfBytes) return;
    setLoading(true);

    try {
      // Carregar o PDF original
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);

      const page = pdfDoc.getPages()[0];
      const { height: pageHeight } = page.getSize();

      for (const b of blocks) {
        if (!b.isModified && !b.isShifted) continue;

        const [x1, y1, x2, y2] = b.box;
        const boxWidth = x2 - x1;
        const boxHeight = y2 - y1;

        const pdfX = x1;
        const pdfYBottom = pageHeight - y2;

        // 1. Cobrir o texto original com um rectângulo branco
        page.drawRectangle({
          x: pdfX,
          y: pdfYBottom,
          width: boxWidth,
          height: boxHeight,
          color: rgb(1, 1, 1),
          borderWidth: 0,
        });

        // 2. Escrever o novo texto
        const fontSize = b.font_size ?? 11;
        const lineHeight = fontSize * 1.2;
        const sanitized = (b.content as string)
          .replace(/[\u200b\u200c\u200d\u00ad\ufeff]/g, '')
          .replace(/[^\x00-\xFF]/g, '?');
        const lines = wrapText(sanitized, boxWidth, fontSize, helveticaFont);

        lines.forEach((line, lineIdx) => {
          const textY = pageHeight - y1 - fontSize - lineIdx * lineHeight;

          // Só desenha se ainda estiver dentro da caixa
          if (textY >= pdfYBottom) {
            page.drawText(line, {
              x: pdfX + 1,
              y: textY,
              size: fontSize,
              font: helveticaFont,
              color: rgb(0, 0, 0),
              maxWidth: boxWidth - 2,
            });
          }
        });
      }

      // Gerar o PDF modificado e fazer download direto
      const modifiedPdfBytes = await pdfDoc.save();
      const blob = new Blob([modifiedPdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);

      // Revogar URL anterior se existir
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      setDownloadUrl(url);
    } catch (err) {
      console.error(err);
      alert('Erro ao exportar PDF.');
    } finally {
      setLoading(false);
    }
  };

  // Utilitário: quebrar texto em linhas que caibam na largura da caixa
  const wrapText = (
    text: string,
    maxWidth: number,
    fontSize: number,
    font: any
  ): string[] => {
    const result: string[] = [];
    const paragraphs = text.split('\n');

    for (const paragraph of paragraphs) {
      if (paragraph.trim() === '') {
        result.push('');
        continue;
      }
      const words = paragraph.split(' ');
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        let lineWidth = 0;
        try {
          lineWidth = font.widthOfTextAtSize(testLine, fontSize);
        } catch {
          lineWidth = testLine.length * fontSize * 0.6;
        }

        if (lineWidth > maxWidth && currentLine !== '') {
          result.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }
      if (currentLine) result.push(currentLine);
    }

    return result;
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white flex flex-col items-center p-6 font-sans">
      {!docData && (
        <div className="mt-20 bg-zinc-900 p-16 rounded-3xl border border-zinc-800 text-center shadow-2xl max-w-lg w-full">
          <div className="bg-blue-600/10 w-20 h-20 rounded-2xl flex items-center justify-center mx-auto mb-8">
            <FileText className="w-10 h-10 text-blue-500" />
          </div>
          <h1 className="text-4xl font-black mb-2 tracking-tighter">PDF EDITOR IA</h1>
          <p className="text-zinc-500 mb-10 text-lg">Edição Profissional com Redação</p>

          <label className="cursor-pointer group">
            <div className="bg-blue-600 group-hover:bg-blue-700 text-white font-bold py-4 px-8 rounded-2xl transition-all shadow-lg shadow-blue-900/20 flex items-center justify-center gap-3">
              <Upload className="w-5 h-5" /> Selecionar Documento
            </div>
            <input type="file" onChange={handleUpload} className="hidden" accept=".pdf" />
          </label>

          {loading && (
            <div className="mt-10 flex items-center justify-center gap-3 text-blue-400 font-mono text-sm animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" /> PROCESSANDO...
            </div>
          )}
        </div>
      )}

      {docData && (
        <div className="flex gap-10 w-full max-w-400 justify-center items-start">
          <div className="relative bg-zinc-900 rounded-2xl shadow-2xl border-2 border-zinc-800 overflow-hidden">
            {pdfFile && (
              <>
                <Document file={pdfFile}>
                  <Page
                    pageNumber={1}
                    scale={1.5}
                    onLoadSuccess={onPageLoadSuccess}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                  />
                </Document>

                <div className="absolute top-0 left-0">
                  <Stage width={pageSize.width} height={pageSize.height}>
                    <Layer>
                      {blocks.map((block, i) => {
                        const [x1, y1, x2, y2] = block.box;
                        const isSelected = selectedIndex === i;
                        const isChanged = block.isModified || block.isShifted;

                        return (
                          <React.Fragment key={i}>
                            <Rect
                              ref={isSelected ? shapeRef : null}
                              x={x1 * scale}
                              y={y1 * scale}
                              width={(x2 - x1) * scale}
                              height={(y2 - y1) * scale}
                              fill={isChanged ? 'white' : 'rgba(59, 130, 246, 0.05)'}
                              stroke={
                                isSelected
                                  ? '#3b82f6'
                                  : isChanged
                                  ? '#f59e0b'
                                  : 'rgba(255,255,255,0.1)'
                              }
                              strokeWidth={isSelected ? 3 : 1}
                              draggable={isSelected}
                              onClick={() => setSelectedIndex(i)}
                              onDragEnd={handleTransformEnd}
                              onTransformEnd={handleTransformEnd}
                              onMouseEnter={(e: any) =>
                                (e.target.getStage().container().style.cursor = 'pointer')
                              }
                              onMouseLeave={(e: any) =>
                                (e.target.getStage().container().style.cursor = 'default')
                              }
                            />

                            {(isChanged || isSelected) && (
                              <Text
                                x={x1 * scale + 2}
                                y={y1 * scale + 2}
                                text={block.content}
                                fontSize={block.font_size * scale}
                                width={(x2 - x1) * scale - 4}
                                fill="black"
                                listening={false}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                      {selectedIndex !== null && (
                        <Transformer
                          ref={trRef}
                          rotateEnabled={false}
                          keepRatio={false}
                          boundBoxFunc={(oldBox, newBox) => {
                            if (newBox.width < 10 || newBox.height < 10) return oldBox;
                            return newBox;
                          }}
                        />
                      )}
                    </Layer>
                  </Stage>
                </div>
              </>
            )}
          </div>

          {/* SIDEBAR EDITOR */}
          <div className="w-96 flex flex-col gap-6 sticky top-6">
            <div className="bg-zinc-900 p-8 rounded-3xl border border-zinc-800 shadow-xl">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <MousePointer2 className="w-5 h-5 text-blue-500" /> Editor de Texto
              </h2>

              {selectedIndex !== null ? (
                <div className="flex flex-col gap-5">
                  <textarea
                    className="w-full h-64 p-5 bg-zinc-950 border border-zinc-700 rounded-2xl text-sm text-zinc-300 focus:ring-2 focus:ring-blue-500 outline-none resize-none transition-all shadow-inner"
                    value={blocks[selectedIndex].content}
                    onChange={(e) => handleContentChange(e.target.value)}
                  />
                  <div className="text-xs text-zinc-500 bg-zinc-800/50 p-4 rounded-xl">
                    Dica: Podes arrastar ou redimensionar a caixa azul no PDF para ajustar o layout.
                  </div>
                  <button
                    onClick={() => setSelectedIndex(null)}
                    className="w-full bg-blue-600 hover:bg-blue-500 text-white py-4 rounded-2xl font-bold transition-all"
                  >
                    Pronto
                  </button>
                </div>
              ) : (
                <div className="py-20 text-center text-zinc-600 italic border-2 border-dashed border-zinc-800 rounded-3xl px-6">
                  Clica numa caixa no PDF para editar o seu conteúdo.
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={savePdf}
                disabled={loading || !docData}
                className="w-full py-5 bg-white text-black rounded-3xl font-black text-lg hover:bg-zinc-200 transition-all disabled:bg-zinc-800 flex items-center justify-center gap-3"
              >
                {loading ? <Loader2 className="animate-spin" /> : 'APLICAR ALTERAÇÕES'}
              </button>

              {downloadUrl && (
                <a
                  href={downloadUrl}
                  className="flex items-center justify-center gap-3 bg-emerald-600 hover:bg-emerald-500 text-white p-5 rounded-3xl font-black shadow-xl animate-in slide-in-from-bottom-4 duration-500"
                  download="documento_editado.pdf"
                >
                  <Download className="w-6 h-6" /> DESCARREGAR PDF
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default App;