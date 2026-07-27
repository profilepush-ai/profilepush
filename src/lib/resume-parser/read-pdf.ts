import type { TextItem, TextItems } from './types';

declare global {
  interface Window {
    pdfjsLib: any;
  }
}

const PDF_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDF_WORKER_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

let loadPromise: Promise<void> | null = null;

function ensurePdfJs(): Promise<void> {
  if (window.pdfjsLib) return Promise.resolve();
  if (loadPromise) return loadPromise;
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDF_CDN;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

export const readPdf = async (fileUrl: string): Promise<TextItems> => {
  await ensurePdfJs();
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_CDN;

  const pdfFile = await pdfjs.getDocument(fileUrl).promise;
  let textItems: TextItems = [];

  for (let i = 1; i <= pdfFile.numPages; i++) {
    const page = await pdfFile.getPage(i);
    const textContent = await page.getTextContent();
    await page.getOperatorList();
    const commonObjs = page.commonObjs;

    const pageTextItems: TextItem[] = textContent.items
      .filter((item: any) => 'str' in item)
      .map((item: any) => {
        const { str: text, transform, fontName: pdfFontName, hasEOL, width, height } = item;
        const x: number = transform[4];
        const y: number = transform[5];

        let fontName = pdfFontName as string;
        try {
          const fontObj = commonObjs.get(pdfFontName);
          if (fontObj?.name) fontName = fontObj.name;
        } catch {
          // keep pdfFontName as fallback
        }

        const newText = (text as string).replace(/-­‐/g, '-');
        return {
          text: newText,
          x,
          y,
          width: width as number,
          height: height as number,
          fontName,
          hasEOL: !!hasEOL,
        };
      });

    textItems.push(...pageTextItems);
  }

  textItems = textItems.filter((item) => !(item.hasEOL === false && item.text.trim() === ''));
  return textItems;
};
