// Guard to avoid errors if pdf.js fails to load.
if (window.pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/';
    window.pdf2txtStandardFontDataUrl = pdfjsLib.GlobalWorkerOptions.standardFontDataUrl;
}
