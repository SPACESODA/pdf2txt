// PDF Processing Logic - pdf2txt

const processPDF = async (file, options = {}) => {
    const MAX_PAGE_TEXT_BYTES = 200 * 1024 * 1024;
    const textEncoder = new TextEncoder();
    const signal = options.signal;
    // Optional PDF password for encrypted documents.
    const password = options.password;
    let pdf = null;
    const throwIfAborted = () => {
        if (signal && signal.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            throw err;
        }
    };
    try {
        throwIfAborted();
        const arrayBuffer = await file.arrayBuffer();
        const documentOptions = { data: arrayBuffer };
        if (typeof password === 'string' && password.length > 0) {
            documentOptions.password = password;
        }
        if (window.pdf2txtStandardFontDataUrl) {
            documentOptions.standardFontDataUrl = window.pdf2txtStandardFontDataUrl;
        }
        pdf = await pdfjsLib.getDocument(documentOptions).promise;

        let allItems = [];
        const pageHeights = {};

        // 1. Extract raw items
        // Iterate through every page to extract text chunks (items) with their X/Y coordinates and font height.
        // This 'soup' of items will later be sorted and structured into lines and paragraphs.
        for (let i = 1; i <= pdf.numPages; i++) {
            throwIfAborted();
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.0 });
            pageHeights[i] = viewport.height;
            const textContent = await page.getTextContent();

            let pageTextBytes = 0;
            let itemChecks = 0;
            for (const item of textContent.items) {
                if ((itemChecks += 1) % 200 === 0) {
                    throwIfAborted();
                }
                const text = item.str || '';
                if (!text) {
                    continue;
                }
                const isWhitespace = !text.trim();
                pageTextBytes += textEncoder.encode(text).length;
                if (pageTextBytes > MAX_PAGE_TEXT_BYTES) {
                    throw new Error(`Page ${i} text exceeds 200MB limit`);
                }
                // Approximate font height using transform matrix (scale Y)
                const height = Math.abs(item.transform[3]);
                const width = item.width || (text.length * height * 0.5);
                allItems.push({
                    str: isWhitespace ? ' ' : text,
                    x: item.transform[4],
                    y: viewport.height - item.transform[5], // Flip Y to top-down
                    h: height,
                    w: width,
                    page: i,
                    isWhitespace
                });
            }
            if (typeof page.cleanup === 'function') {
                page.cleanup();
            }
        }

        // Handle case: Empty PDF or Scanned PDF with no OCR
        if (allItems.length === 0) {
            // Return title with warning instead of crashing or empty file
            const title = file.name.replace(/\.[^/.]+$/, "");
            return `# ${title}\n\n[No text detected. This may be an image-only PDF.]`;
        }

        // 2. Statistical Analysis for Body Text Size (Mode)
        // Determine the most common font height (the "Mode") to identify the main body text.
        // Text significantly larger than this will be treated as headers.
        // Using Mode is more robust than Mean because headers and footnotes would skew the average.
        const heightCounts = {};
        allItems.forEach(i => {
            const h = Math.round(i.h * 10) / 10; // Round to 0.1
            heightCounts[h] = (heightCounts[h] || 0) + 1;
        });

        let bodyHeight = 12;
        let maxCount = 0;
        for (const h in heightCounts) {
            if (heightCounts[h] > maxCount) {
                maxCount = heightCounts[h];
                bodyHeight = parseFloat(h);
            }
        }

        // Heuristic thresholds based on body size
        const headerThreshold = bodyHeight * 1.15; // Slightly larger = H3
        const subHeaderThreshold = bodyHeight * 1.4; // Much larger = H2

        // 3. Robust Sorting & Grouping
        // PDF internal order is often random. MUST sort by position to restore reading order.
        // Primary Sort: Page Number
        // Secondary Sort: Y position (Top to Bottom)
        allItems.sort((a, b) => {
            if (a.page !== b.page) return a.page - b.page;
            // Robust Y sort: if very close, rely on X
            if (Math.abs(a.y - b.y) < 2) return a.x - b.x;
            return a.y - b.y;
        });

        const lineTolerance = Math.max(2, bodyHeight * 0.25);

        // Group items into visual lines.
        // PDF text chunks are often fragmented. Group items with similar Y-coordinates (dynamic tolerance) into a single line.
        const lines = [];
        if (allItems.length > 0) {
            let currentLine = { y: allItems[0].y, items: [allItems[0]], page: allItems[0].page };

            for (let i = 1; i < allItems.length; i++) {
                const item = allItems[i];
                const yDiff = Math.abs(item.y - currentLine.y);

                // Allow tolerance for "same line"
                if (item.page === currentLine.page && yDiff < lineTolerance) {
                    currentLine.items.push(item);
                } else {
                    // Finish current line using X sort
                    currentLine.items.sort((a, b) => a.x - b.x);
                    lines.push(currentLine);
                    currentLine = { y: item.y, items: [item], page: item.page };
                }
            }
            currentLine.items.sort((a, b) => a.x - b.x);
            lines.push(currentLine);
        }

        // 4. Convert Lines to Markdown
        let markdownLines = [];
        let lastY = -1;
        let lastPage = -1;
        let recentGap = null;
        let denseRun = 0;

        const isCJKChar = (ch) => /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/.test(ch);
        const getFirstChar = (text) => {
            for (const ch of text) {
                if (ch.trim()) return ch;
            }
            return "";
        };
        const getLastChar = (text) => {
            for (let i = text.length - 1; i >= 0; i--) {
                const ch = text[i];
                if (ch.trim()) return ch;
            }
            return "";
        };
        const shouldInsertSpace = (prevChar, nextChar) => {
            if (!prevChar || !nextChar) return true;
            return !(isCJKChar(prevChar) && isCJKChar(nextChar));
        };
        const buildLineText = (items) => {
            const cleaned = items.filter(i => i.str && (i.str.trim() || i.isWhitespace));
            if (!cleaned.length) return "";
            const nonSpace = cleaned.filter(i => !i.isWhitespace);
            let totalWidth = 0;
            let totalChars = 0;
            nonSpace.forEach(i => {
                const len = i.str.length;
                if (len > 0) {
                    totalWidth += i.w;
                    totalChars += len;
                }
            });
            const avgCharWidth = totalChars ? totalWidth / totalChars : 0;
            const baseThreshold = avgCharWidth ? avgCharWidth * 0.6 : 2;
            const gaps = [];
            for (let i = 1; i < nonSpace.length; i++) {
                const prev = nonSpace[i - 1];
                const curr = nonSpace[i];
                const gap = curr.x - (prev.x + prev.w);
                if (gap > 0) gaps.push(gap);
            }
            const sortedGaps = gaps.slice().sort((a, b) => a - b);
            const medianGap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length / 2)] : 0;
            const p90Gap = sortedGaps.length ? sortedGaps[Math.floor(sortedGaps.length * 0.9)] : 0;
            let wordGapThreshold = baseThreshold;
            if (sortedGaps.length >= 3) {
                if (p90Gap > medianGap * 1.6) {
                    wordGapThreshold = Math.max(baseThreshold, (medianGap + p90Gap) / 2);
                } else if (medianGap > 0) {
                    wordGapThreshold = Math.max(baseThreshold, medianGap * 1.4);
                }
            }

            const singleCharRate = nonSpace.length
                ? nonSpace.filter(i => i.str.length === 1).length / nonSpace.length
                : 0;

            const buildWithThreshold = (threshold) => {
                let result = "";
                let prev = null;
                cleaned.forEach(item => {
                    if (item.isWhitespace) {
                        if (!result.endsWith(" ")) {
                            result += " ";
                        }
                        prev = null;
                        return;
                    }
                    if (prev) {
                        const gap = item.x - (prev.x + prev.w);
                        if (gap > threshold && !result.endsWith(" ")) {
                            const prevChar = getLastChar(result);
                            const nextChar = getFirstChar(item.str);
                            if (shouldInsertSpace(prevChar, nextChar)) {
                                result += " ";
                            }
                        }
                    }
                    result += item.str;
                    prev = item;
                });
                return result.replace(/[ \t]+/g, " ").trim();
            };

            let line = buildWithThreshold(wordGapThreshold);
            if (!line.includes(" ") && singleCharRate > 0.6 && medianGap > 0) {
                const fallbackThreshold = Math.max(baseThreshold * 0.6, medianGap * 1.1);
                line = buildWithThreshold(fallbackThreshold);
            }
            return line;
        };

        const PAGE_NUMBER_BAND_RATIO = 0.1;
        const PAGE_NUMBER_MAX_FONT_RATIO = 0.95;
        const PAGE_NUMBER_MIN_REPEAT_RATIO = 0.4;
        const pageNumberYBucket = Math.max(4, bodyHeight * 0.5);
        const normalizePageMarker = (text) => {
            let normalized = text.toLowerCase();
            normalized = normalized.replace(/[\p{P}\p{S}]/gu, '');
            normalized = normalized.replace(/\p{N}/gu, '#');
            normalized = normalized.replace(/\s+/g, '');
            return normalized;
        };

        const lineMeta = lines.map(line => {
            const lineStr = buildLineText(line.items);
            const maxLineHeight = Math.max(...line.items.map(i => i.h));
            return { line, lineStr, maxLineHeight };
        });

        const pageMarkerClusters = new Map();
        lineMeta.forEach((meta, index) => {
            if (!meta.lineStr) return;
            const pageHeight = pageHeights[meta.line.page];
            if (!pageHeight) return;

            const bandSize = pageHeight * PAGE_NUMBER_BAND_RATIO;
            const inBand = meta.line.y <= bandSize || meta.line.y >= pageHeight - bandSize;
            if (!inBand) return;
            if (meta.maxLineHeight >= bodyHeight * PAGE_NUMBER_MAX_FONT_RATIO) return;

            const normalized = normalizePageMarker(meta.lineStr);
            if (!normalized) return;

            const band = meta.line.y <= bandSize ? 'top' : 'bottom';
            const yBucket = Math.round(meta.line.y / pageNumberYBucket);
            const key = `${normalized}|${band}|${yBucket}`;

            let cluster = pageMarkerClusters.get(key);
            if (!cluster) {
                cluster = { pages: new Set(), indices: [] };
                pageMarkerClusters.set(key, cluster);
            }
            cluster.pages.add(meta.line.page);
            cluster.indices.push(index);
        });

        const minRepeat = Math.ceil(pdf.numPages * PAGE_NUMBER_MIN_REPEAT_RATIO);
        const pageNumberLineIndices = new Set();
        pageMarkerClusters.forEach(cluster => {
            if (cluster.pages.size >= Math.max(2, minRepeat)) {
                cluster.indices.forEach(idx => pageNumberLineIndices.add(idx));
            }
        });

        lineMeta.forEach((meta, index) => {
            const line = meta.line;
            // Paragraph Detection: Significant vertical gap
            let gap = null;
            if (lastPage === line.page && lastY !== -1) {
                gap = line.y - lastY;
                // Normal line spacing is ~1.0-1.2x height. >1.5x implies paragraph break.
                if (gap > bodyHeight * 1.5) {
                    markdownLines.push("");
                }
                // Track dense runs (lists/tables often have tight spacing)
                if (gap < bodyHeight * 0.9) {
                    denseRun += 1;
                } else {
                    denseRun = 0;
                }
            } else {
                denseRun = 0;
            }
            recentGap = gap;
            lastY = line.y;
            lastPage = line.page;

            // Construct line string
            let lineStr = meta.lineStr;
            if (!lineStr) return;

            if (pageNumberLineIndices.has(index)) return;

            // Get max font size in this line to determine header status
            const maxLineHeight = meta.maxLineHeight;

            // Header Detection
            let prefix = "";
            if (maxLineHeight >= subHeaderThreshold) {
                prefix = "## ";
            } else if (maxLineHeight >= headerThreshold) {
                prefix = "### ";
            }

            // List Detection
            if (/^[•●\-]/.test(lineStr)) {
                lineStr = lineStr.replace(/^[•●\-]\s*/, "- ");
                prefix = ""; // Don't make lists headers
            } else if (/^\d+\./.test(lineStr)) {
                prefix = "";
            }

            const isList = /^(?:[-*•●]|\d+\.)/.test(lineStr);
            if (isList) {
                denseRun += 1;
            }

            if (
                recentGap !== null &&
                recentGap > bodyHeight * 1.8 &&
                prefix &&
                denseRun < 3 &&
                markdownLines.length > 0 &&
                markdownLines[markdownLines.length - 1] !== "---"
            ) {
                if (markdownLines[markdownLines.length - 1] !== "") {
                    markdownLines.push("");
                }
                markdownLines.push("---");
                if (markdownLines[markdownLines.length - 1] !== "") {
                    markdownLines.push("");
                }
            }

            markdownLines.push(prefix + lineStr);
        });

        // --- Post-Processing Cleaning ---

        let rawMD = markdownLines.join("\n");
        throwIfAborted();

        // 1. Merge hyphenated words at end of line
        rawMD = rawMD.replace(/([\p{L}\p{N}])-\n([\p{L}\p{N}])/gu, '$1$2');

        // 2. Merge hard-wrapped lines (CRITICAL for conversion)
        // Merge lines that look like a wrapped sentence, preserving paragraph breaks.
        const mergeWrappedLines = (text) => {
            const lines = text.split("\n");
            const merged = [];
            const isHeading = (line) => /^\s*#+\s/.test(line);
            const isList = (line) => /^\s*([-*•●]|\d+\.)\s+/.test(line);
            const isHardStop = (line) => /[.!?。！？]$/.test(line);
            const endsWithDash = (line) => /[-–—]$/.test(line);
            const isCJKCharLocal = (ch) => /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]/.test(ch);
            const getFirstCharLocal = (line) => {
                for (const ch of line) {
                    if (ch.trim()) return ch;
                }
                return "";
            };
            const getLastCharLocal = (line) => {
                for (let i = line.length - 1; i >= 0; i--) {
                    const ch = line[i];
                    if (ch.trim()) return ch;
                }
                return "";
            };
            const shouldInsertSpaceLocal = (prevChar, nextChar) => {
                if (!prevChar || !nextChar) return true;
                return !(isCJKCharLocal(prevChar) && isCJKCharLocal(nextChar));
            };

            if (lines.length === 0) return "";

            let buffer = lines[0];

            for (let i = 1; i < lines.length; i++) {
                if (i % 200 === 0) {
                    throwIfAborted();
                }
                const current = lines[i];

                // Conditions to flush the buffer (start a new line):
                // 1. Buffer is empty (was a blank line)
                // 2. Current line is empty (paragraph break)
                // 3. Current line is a Header or List Item
                // 4. Buffer was a Header or List Item (don't merge into it)
                // 5. Buffer ended with a hard stop (., !, ?) AND didn't end with a dash
                const shouldFlush =
                    !buffer.trim() ||
                    !current.trim() ||
                    isHeading(current) ||
                    isHeading(buffer) ||
                    isList(current) ||
                    isList(buffer) ||
                    (isHardStop(buffer) && !endsWithDash(buffer));

                if (shouldFlush) {
                    merged.push(buffer);
                    buffer = current;
                } else {
                    const bufferIsList = isList(buffer);
                    const currentIsList = isList(current);
                    if (bufferIsList && !currentIsList && !isHeading(current)) {
                        const prevChar = getLastCharLocal(buffer);
                        const nextChar = getFirstCharLocal(current);
                        const joiner = shouldInsertSpaceLocal(prevChar, nextChar) ? " " : "";
                        buffer += joiner + current.trim();
                    } else {
                        buffer += " " + current;
                    }
                }
            }
            if (buffer) merged.push(buffer);

            return merged.join("\n");
        };
        rawMD = mergeWrappedLines(rawMD);

        // 3. Normalize whitespace to ensure clean Markdown structure
        rawMD = rawMD.replace(/\n{3,}/g, '\n\n');

        // Add Title + Footer
        const title = file.name.replace(/\.[^/.]+$/, "");
        let finalMD = `# ${title}\n\n${rawMD}`;
        if (!finalMD.endsWith("\n\n")) {
            finalMD += "\n\n";
        }
        finalMD += "---\n\n";
        finalMD += "File converted using pdf2txt\nhttps://github.com/SPACESODA/pdf2txt\n\n";
        return finalMD;

    } finally {
        // Cleanup memory
        if (pdf) {
            pdf.destroy();
        }
    }
};

// Expose to window if needed (not strictly required if file is loaded as script, but good practice)
window.processPDF = processPDF;
