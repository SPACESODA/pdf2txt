// PDF.js asset URLs shared across config and retry logic.
const PDF2TXT_WORKER_SRC = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
const PDF2TXT_STANDARD_FONTS_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/';

// Expose URLs for late PDF.js initialization or retry flows.
window.pdf2txtWorkerSrc = PDF2TXT_WORKER_SRC;
window.pdf2txtStandardFontDataUrl = PDF2TXT_STANDARD_FONTS_URL;

// Guard to avoid errors if PDF.js fails to load.
if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDF2TXT_WORKER_SRC;
    pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = PDF2TXT_STANDARD_FONTS_URL;
}
