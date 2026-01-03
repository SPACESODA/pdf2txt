const { useState, useRef, useEffect } = React;
const h = React.createElement;
const Fragment = React.Fragment;

// --- Error Boundary ---
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, errorInfo) {
        console.error("ErrorBoundary caught an error", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return h(
                'div',
                { className: 'p-8 text-center' },
                h('h1', { className: 'text-2xl font-bold text-red-500 mb-4 tracking-tight' }, 'Something went wrong.'),
                h(
                    'pre',
                    { className: 'bg-zinc-900/50 p-4 rounded text-left overflow-auto text-sm text-red-400 border border-red-900/20' },
                    this.state.error ? this.state.error.toString() : null
                ),
                h(
                    'button',
                    {
                        onClick: () => window.location.reload(),
                        className: 'mt-6 px-6 py-2 bg-white text-black rounded-full font-medium hover:bg-zinc-200 transition-colors'
                    },
                    'Reload Page'
                )
            );
        }
        return this.props.children;
    }
}

// --- Components ---

// Helper to convert kebab-case to PascalCase for Lucide keys
const toPascalCase = (str) =>
    str.replace(/(^\w|-\w)/g, (clear) => clear.replace('-', '').toUpperCase());

const Icon = ({ name, className }) => {
    const ref = useRef(null);

    useEffect(() => {
        if (!ref.current) return;

        const lucideName = toPascalCase(name);
        const iconDef = lucide.icons[lucideName];

        if (iconDef) {
            const svg = lucide.createElement(iconDef);
            if (className) {
                svg.setAttribute('class', `lucide lucide-${name} ${className}`);
            }

            ref.current.innerHTML = '';
            ref.current.appendChild(svg);
        } else {
            console.warn(`Icon not found: ${name} (mapped to ${lucideName})`);
        }
    }, [name, className]);

    return h('span', { ref, className: 'inline-flex items-center justify-center pointer-events-none' });
};

const FileRow = ({ fileData, onDownload, onRemove, outputFormat }) => {
    const IconStatus = () => {
        if (fileData.status === 'processing') return h(Icon, { name: 'loader-2', className: 'w-5 h-5 text-white animate-spin' });
        if (fileData.status === 'done') return h(Icon, { name: 'check', className: 'w-5 h-5 text-white' });
        if (fileData.status === 'error') return h(Icon, { name: 'alert-circle', className: 'w-5 h-5 text-red-400' });
        if (fileData.status === 'skipped') return h(Icon, { name: 'x-circle', className: 'w-5 h-5 text-zinc-500' });
        return h(Icon, { name: 'file-text', className: 'w-5 h-5 text-zinc-400' });
    };

    const statusBg = {
        queued: 'bg-zinc-800/50',
        processing: 'bg-white/10',
        done: 'bg-white/10',
        error: 'bg-red-500/10',
        skipped: 'bg-zinc-800/50'
    };

    const downloadLabel = outputFormat === 'md' ? 'Download Markdown' : 'Download TXT';

    return h(
        'div',
        { className: 'flex items-center justify-between p-3 md:p-4 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-xl transition-all mb-3 group' },
        h(
            'div',
            { className: 'flex items-center space-x-3 md:space-x-4 overflow-hidden' },
            h(
                'div',
                { className: `w-10 h-10 min-w-[2.5rem] rounded-full flex items-center justify-center flex-shrink-0 ${statusBg[fileData.status] || statusBg.queued}` },
                h(IconStatus)
            ),
            h(
                'div',
                { className: 'flex flex-col min-w-0 mr-4' },
                h('span', { className: 'font-medium text-zinc-200 truncate block tracking-wide text-sm' }, fileData.file.name),
                h(
                    'span',
                    { className: 'text-[11px] text-zinc-500 uppercase tracking-wider font-medium mt-0.5' },
                    `${(fileData.file.size / 1024 / 1024).toFixed(2)} MB • ${fileData.status}`
                ),
                fileData.errorMsg
                    ? h(
                        'span',
                        {
                            className: 'text-[10px] text-red-400 font-medium mt-1 leading-snug bg-red-500/10 px-2 py-1 rounded inline-block w-fit max-w-full break-words border border-red-500/20'
                        },
                        fileData.errorMsg
                    )
                    : null
            )
        ),
        h(
            'div',
            { className: 'flex items-center space-x-2' },
            fileData.status === 'done' && fileData.md
                ? h(
                    'button',
                    {
                        onClick: () => onDownload(fileData.id),
                        className: 'w-8 h-8 flex items-center justify-center text-zinc-200 hover:text-white hover:bg-white/10 rounded-full transition-colors',
                        title: downloadLabel
                    },
                    h(Icon, { name: 'download', className: 'w-4 h-4' })
                )
                : null,
            h(
                'button',
                {
                    onClick: () => onRemove(fileData.id),
                    className: 'w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors',
                    title: fileData.status === 'processing' ? 'Cancel Processing' : 'Remove File'
                },
                h(Icon, { name: 'x', className: 'w-4 h-4' })
            )
        )
    );
};

const App = () => {
    const [files, setFiles] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [engineReady, setEngineReady] = useState(false);
    const [engineError, setEngineError] = useState(false);
    const [outputFormat, setOutputFormat] = useState('txt');
    const [formatLocked, setFormatLocked] = useState(false);
    const fileInputRef = useRef(null);
    const abortControllersRef = useRef(new Map());
    const filesRef = useRef([]);

    const MAX_FILE_SIZE = 1024 * 1024 * 1024;

    useEffect(() => {
        let isMounted = true;
        const timer = setInterval(() => {
            const ready = typeof window.pdfjsLib !== 'undefined' && typeof window.processPDF === 'function';
            if (ready && isMounted) {
                setEngineReady(true);
                setEngineError(false);
                clearInterval(timer);
            }
        }, 100);
        return () => {
            isMounted = false;
            clearInterval(timer);
        };
    }, []);

    // Keep a live reference for async loops to avoid stale queue snapshots.
    const updateFiles = (updater) => {
        setFiles(prev => {
            const next = updater(prev);
            filesRef.current = next;
            return next;
        });
    };

    useEffect(() => {
        filesRef.current = files;
    }, [files]);

    const trackEvent = (name, data = {}) => {
        if (window.umami && typeof window.umami.track === 'function') {
            window.umami.track(name, data);
        }
    };

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const isPdfFile = (file) => {
        const lowerName = file.name.toLowerCase();
        return file.type === 'application/pdf' || file.type === 'application/x-pdf' || lowerName.endsWith('.pdf');
    };

    const addFiles = (newFiles) => {
        const validFiles = Array.from(newFiles).filter(isPdfFile);

        if (validFiles.length > 0) {
            trackEvent('pdf | Files Added', { count: validFiles.length });
            if (!isProcessing) {
                setFormatLocked(false);
            }
        }

        updateFiles(prev => {
            const newQueue = [...prev];

            validFiles.forEach(f => {
                // Deduplication: Check Name + Size
                const exists = prev.some(existing => existing.file.name === f.name && existing.file.size === f.size);
                if (exists) return; // Skip duplicates

                let status = 'queued';
                let errorMsg = null;

                // Size Limit Check
                if (f.size === 0) {
                    status = 'skipped';
                    errorMsg = 'File not available offline (0 bytes)';
                    trackEvent('pdf | File Skipped', { reason: 'Unavailable', fileName: f.name });
                } else if (f.size > MAX_FILE_SIZE) {
                    status = 'skipped';
                    errorMsg = 'File over 1 GB';
                    trackEvent('pdf | File Skipped', { reason: 'Too Large', fileName: f.name });
                }

                newQueue.push({
                    id: Math.random().toString(36).substr(2, 9),
                    file: f,
                    status: status,
                    errorMsg: errorMsg,
                    md: null
                });
            });

            return newQueue;
        });
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        addFiles(e.dataTransfer.files);
    };

    const handleFileInput = (e) => {
        addFiles(e.target.files);
        e.target.value = null; // reset
        // Try to restore focus to window so the user doesn't have to click twice
        window.focus();
    };

    const removeFile = (id) => {
        const controller = abortControllersRef.current.get(id);
        if (controller) {
            controller.abort();
        }
        updateFiles(prev => prev.map(f => {
            if (f.id !== id) return f;
            if (f.status === 'processing') {
                return { ...f, status: 'skipped', errorMsg: null, canceled: true };
            }
            return null;
        }).filter(Boolean));
    };

    const updateFileStatus = (id, status, md = null, errorMsg = null) => {
        updateFiles(prev => prev.map(f => {
            if (f.id !== id) return f;
            if (f.canceled) return f;
            return { ...f, status, md: md || f.md, errorMsg };
        }));
    };

    const waitForEngine = async () => {
        if (engineReady) return true;
        const maxWaitMs = 15000;
        const start = Date.now();
        while (Date.now() - start < maxWaitMs) {
            const ready = typeof window.pdfjsLib !== 'undefined' && typeof window.processPDF === 'function';
            if (ready) {
                setEngineReady(true);
                setEngineError(false);
                return true;
            }
            await new Promise(r => setTimeout(r, 100));
        }
        setEngineError(true);
        return false;
    };

    const convertAll = async () => {
        setFormatLocked(true);
        setIsProcessing(true);
        const ready = await waitForEngine();
        if (!ready) {
            setIsProcessing(false);
            setFormatLocked(false);
            return;
        }

        const initialQueueCount = filesRef.current.filter(f => f.status === 'queued').length;
        trackEvent('pdf | Batch Convert Started', { count: initialQueueCount });

        // Process sequentially
        let item;
        while ((item = filesRef.current.find(f => f.status === 'queued'))) {
            updateFileStatus(item.id, 'processing');
            const controller = new AbortController();
            abortControllersRef.current.set(item.id, controller);

            await new Promise(r => setTimeout(r, 50));

            let processPromise;
            try {
                if (typeof window.processPDF !== 'function') {
                    throw new Error("PDF Processing logic not loaded (processPDF is undefined). Check app/pdf2txt.js.");
                }

                processPromise = window.processPDF(item.file, { signal: controller.signal });
                // Race allows cancel to release the loop even if file reading stalls.
                let aborted = false;
                const abortPromise = new Promise((_, reject) => {
                    if (controller.signal.aborted) {
                        aborted = true;
                        const err = new Error('Aborted');
                        err.name = 'AbortError';
                        reject(err);
                        return;
                    }
                    controller.signal.addEventListener('abort', () => {
                        aborted = true;
                        const err = new Error('Aborted');
                        err.name = 'AbortError';
                        reject(err);
                    }, { once: true });
                });

                const markdown = await Promise.race([processPromise, abortPromise]);
                if (!aborted) {
                    updateFileStatus(item.id, 'done', markdown);
                    trackEvent('pdf | Conversion Success', { fileName: item.file.name });
                }
            } catch (err) {
                let msg = 'Error converting file';

                // Handle Password Protected PDF
                if (err.name === 'AbortError') {
                    updateFileStatus(item.id, 'skipped', null, null);
                    if (typeof processPromise !== 'undefined') {
                        processPromise.catch(() => { });
                    }
                    continue;
                } else if (err.name === 'PasswordException') {
                    msg = 'Password-protected PDF';
                } else if (err.message && err.message.includes('password')) {
                    msg = 'Password-protected PDF';
                } else if (err.name === 'NotReadableError' || err.name === 'NotFoundError') {
                    msg = 'File not available. Please make sure it is fully downloaded.';
                } else {
                    msg = err.message || 'Unknown error';
                }

                console.error(err);
                updateFileStatus(item.id, 'error', null, msg);
                trackEvent('pdf | Conversion Failed', { fileName: item.file.name, error: msg });
            } finally {
                abortControllersRef.current.delete(item.id);
            }
        }
        setIsProcessing(false);
        setFormatLocked(false);
    };

    const sanitizeFilename = (name, format) => {
        let base = name.replace(/\.[^/.]+$/, "");
        base = base.replace(/[<>:"/\\|?*]/g, '_');
        return base + (format === 'md' ? ".md" : ".txt");
    };

    const downloadFile = (id) => {
        const file = files.find(f => f.id === id);
        if (!file || !file.md) return;

        const mime = outputFormat === 'md' ? 'text/markdown' : 'text/plain';
        const blob = new Blob([file.md], { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sanitizeFilename(file.file.name, outputFormat);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const downloadAllZip = async () => {
        const ZipCtor = window.JSZip;
        if (typeof ZipCtor !== 'function') {
            window.alert('Zip download unavailable. Please refresh the browser and convert again.');
            return;
        }

        const zip = new ZipCtor();
        const processed = files.filter(f => f.status === 'done');

        if (processed.length === 0) return;

        trackEvent('pdf | Download Zip', { count: processed.length });

        processed.forEach(f => {
            zip.file(sanitizeFilename(f.file.name, outputFormat), f.md);
        });

        const content = await zip.generateAsync({ type: "blob" });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const timestamp = now.getFullYear() +
            String(now.getMonth() + 1).padStart(2, '0') +
            String(now.getDate()).padStart(2, '0') + '_' +
            String(now.getHours()).padStart(2, '0') +
            String(now.getMinutes()).padStart(2, '0');

        a.download = `${outputFormat}_files_${timestamp}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const stats = {
        total: files.length,
        done: files.filter(f => f.status === 'done').length,
        queued: files.filter(f => f.status === 'queued').length
    };

    const zipAvailable = typeof window.JSZip === 'function';

    return h(
        'div',
        { className: 'flex flex-col lg:h-full max-w-4xl mx-auto w-full mt-6 lg:mt-0 lg:pt-8 pb-4 lg:pb-2' },
        h(
            'div',
            { className: 'flex-1 flex flex-col lg:flex-row gap-4 lg:gap-6 lg:overflow-hidden min-h-0' },
            h(
                'div',
                {
                    className: `lg:w-1/3 flex-shrink-0 border border-dashed rounded-2xl flex lg:flex-col items-center justify-center p-4 lg:p-8 gap-4 lg:gap-0 transition-all cursor-pointer group ${isDragging
                        ? 'border-white bg-white/10 shadow-[0_0_30px_rgba(255,255,255,0.2)]'
                        : 'border-zinc-600 hover:border-zinc-400 bg-zinc-900 hover:bg-zinc-800'
                        }`,
                    onDragOver: handleDragOver,
                    onDragLeave: handleDragLeave,
                    onDrop: handleDrop,
                    onClick: () => fileInputRef.current.click()
                },
                h('input', {
                    type: 'file',
                    multiple: true,
                    accept: 'application/pdf',
                    className: 'hidden',
                    ref: fileInputRef,
                    onChange: handleFileInput
                }),
                h(
                    'div',
                    { className: 'w-10 h-10 lg:w-14 lg:h-14 bg-zinc-800 border border-zinc-600 rounded-xl lg:rounded-2xl lg:mb-5 text-white flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform duration-300 flex-shrink-0' },
                    h(Icon, { name: 'plus', className: 'w-5 h-5 lg:w-6 lg:h-6 opacity-100' })
                ),
                h(
                    'div',
                    { className: 'text-left lg:text-center' },
                    h('h3', { className: 'text-sm lg:text-base font-medium text-white mb-0.5 lg:mb-1' }, 'Add PDFs'),
                    h(
                        'p',
                        { className: 'text-xs text-zinc-300 lg:text-center leading-relaxed' },
                        h('span', { className: 'hidden lg:inline' }, 'Drop files here or click to browse'),
                        h('span', { className: 'lg:hidden' }, 'Tap to browse files'),
                        h('br', { className: 'hidden lg:block' }),
                        h('span', { className: 'hidden lg:inline text-zinc-500 text-[10px] lg:text-xs ml-1 lg:ml-0' }, 'Max 1 GB')
                    )
                )
            ),
            h(
                'div',
                { className: 'flex-1 flex flex-col lg:min-h-0 min-h-[50vh] max-h-[75vh] lg:max-h-none bg-zinc-900 rounded-2xl border border-zinc-700 overflow-hidden' },
                h(
                    'div',
                    { className: 'px-5 py-4 border-b border-zinc-700 flex items-center justify-between bg-white/[0.02]' },
                    h(
                        'div',
                        { className: 'flex items-center gap-2' },
                        h(
                            'div',
                            { className: 'text-xs font-semibold tracking-wider text-zinc-300 uppercase' },
                            `Queue (${stats.done}/${stats.total})`
                        ),
                        !engineReady && !engineError
                            ? h(
                                'div',
                                { className: 'text-[10px] font-medium tracking-wider text-zinc-500 uppercase' },
                                'PDF engine loading...'
                            )
                            : null,
                        engineError
                            ? h(
                                'div',
                                { className: 'text-[10px] font-semibold tracking-wider text-red-200 uppercase bg-red-500/10 border border-red-500/20 px-2 py-1 rounded-full' },
                                "PDF engine didn't load. Please refresh the page."
                            )
                            : null
                    ),
                    h(
                        'div',
                        { className: 'flex space-x-3' },
                        stats.total > 0
                            ? h(
                                'button',
                                {
                                    onClick: () => { trackEvent('pdf | Queue Cleared'); updateFiles(() => []); },
                                    disabled: isProcessing,
                                    className: 'p-2 text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed',
                                    title: 'Clear All'
                                },
                                h(Icon, { name: 'trash-2', className: 'w-4 h-4' })
                            )
                            : null
                    )
                ),
                h(
                    'div',
                    { className: 'flex-1 overflow-y-auto p-2 md:p-4 custom-scrollbar' },
                    files.length === 0
                        ? h(
                            'div',
                            { className: 'h-full flex flex-col items-center justify-center text-zinc-300 space-y-4 py-8' },
                            h(
                                'div',
                                { className: 'w-16 h-16 rounded-full bg-zinc-800 flex items-center justify-center' },
                                h(Icon, { name: 'layout-list', className: 'w-8 h-8 text-zinc-400' })
                            ),
                            h('p', { className: 'text-zinc-600 text-sm font-medium' }, 'Queue is empty')
                        )
                        : files.map(file => h(FileRow, {
                            key: file.id,
                            fileData: file,
                            onRemove: removeFile,
                            onDownload: downloadFile,
                            outputFormat
                        }))
                ),
                files.length > 0
                    ? h(
                        'div',
                        { className: 'p-4 border-t border-zinc-700 bg-white/[0.02] flex flex-nowrap items-center gap-3 overflow-x-auto' },
                        h(
                            'div',
                            {
                                className: `flex items-center gap-2 text-xs font-medium text-zinc-300 mr-auto ${formatLocked ? 'opacity-20 pointer-events-none' : ''}`
                            },
                            h(
                                'div',
                                { className: 'inline-flex rounded-full border border-zinc-700 bg-zinc-900 p-0.5' },
                                h(
                                    'button',
                                    {
                                        type: 'button',
                                        onClick: (e) => { e.preventDefault(); if (!formatLocked) setOutputFormat('txt'); },
                                        disabled: formatLocked,
                                        'aria-pressed': outputFormat === 'txt',
                                        'aria-disabled': formatLocked,
                                        className: `px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide transition-colors ${outputFormat === 'txt'
                                            ? 'bg-white text-black'
                                            : 'text-zinc-400 hover:text-white'
                                            }`
                                    },
                                    'TXT'
                                ),
                                h(
                                    'button',
                                    {
                                        type: 'button',
                                        onClick: (e) => { e.preventDefault(); if (!formatLocked) setOutputFormat('md'); },
                                        disabled: formatLocked,
                                        'aria-pressed': outputFormat === 'md',
                                        'aria-disabled': formatLocked,
                                        className: `px-3 py-1 rounded-full text-[11px] font-semibold tracking-wide transition-colors ${outputFormat === 'md'
                                            ? 'bg-white text-black'
                                            : 'text-zinc-400 hover:text-white'
                                            }`
                                    },
                                    'MD'
                                )
                            )
                        ),
                        stats.done > 0
                            ? h(
                                'button',
                                {
                                    onClick: downloadAllZip,
                                    disabled: isProcessing || !zipAvailable,
                                    className: 'px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-sm font-semibold shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2',
                                    title: zipAvailable ? 'Download Zip' : 'Zip download unavailable (JSZip not loaded yet)'
                                },
                                h(Icon, { name: 'archive', className: 'w-4 h-4' }),
                                h('span', null, 'Download Zip')
                            )
                            : null,
                        stats.queued > 0
                            ? h(
                                'button',
                                {
                                    type: 'button',
                                    onClick: (e) => { e.preventDefault(); convertAll(); },
                                    disabled: isProcessing || !engineReady,
                                    className: 'px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-sm font-semibold shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2',
                                    title: !engineReady ? 'PDF engine is loading' : 'Convert All'
                                },
                                isProcessing
                                    ? h(
                                        Fragment,
                                        null,
                                        h(Icon, { name: 'loader-2', className: 'w-4 h-4 animate-spin' }),
                                        h('span', null, 'Processing...')
                                    )
                                    : h(
                                        Fragment,
                                        null,
                                        h(Icon, { name: 'sparkles', className: 'w-4 h-4' }),
                                        h('span', null, 'Convert All')
                                    )
                            )
                            : null
                    )
                    : null
            )
        )
    );
};

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        h(
            ErrorBoundary,
            null,
            h(App)
        )
    );
} else {
    document.addEventListener('DOMContentLoaded', () => {
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(
            h(
                ErrorBoundary,
                null,
                h(App)
            )
        );
    });
}
