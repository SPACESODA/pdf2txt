const { useState, useCallback, useRef, useEffect } = React;

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
            return (
                <div className="p-8 text-center">
                    <h1 className="text-2xl font-bold text-red-500 mb-4 tracking-tight">Something went wrong.</h1>
                    <pre className="bg-zinc-900/50 p-4 rounded text-left overflow-auto text-sm text-red-400 border border-red-900/20">
                        {this.state.error && this.state.error.toString()}
                    </pre>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-6 px-6 py-2 bg-white text-black rounded-full font-medium hover:bg-zinc-200 transition-colors"
                    >
                        Reload Page
                    </button>
                </div>
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

    return <span ref={ref} className="inline-flex items-center justify-center pointer-events-none" />;
};

const FileRow = ({ fileData, onDownload, onRemove }) => {
    const IconStatus = () => {
        if (fileData.status === 'processing') return <Icon name="loader-2" className="w-5 h-5 text-white animate-spin" />;
        if (fileData.status === 'done') return <Icon name="check" className="w-5 h-5 text-white" />;
        if (fileData.status === 'error') return <Icon name="alert-circle" className="w-5 h-5 text-red-400" />;
        if (fileData.status === 'skipped') return <Icon name="x-circle" className="w-5 h-5 text-zinc-500" />;
        return <Icon name="file-text" className="w-5 h-5 text-zinc-400" />;
    };

    const statusBg = {
        queued: 'bg-zinc-800/50',
        processing: 'bg-white/10',
        done: 'bg-white/10',
        error: 'bg-red-500/10',
        skipped: 'bg-zinc-800/50'
    };

    return (
        <div className="flex items-center justify-between p-4 bg-zinc-800 border border-zinc-700 hover:border-zinc-500 rounded-xl transition-all mb-3 group">
            <div className="flex items-center space-x-4 overflow-hidden">
                <div className={`w-10 h-10 min-w-[2.5rem] rounded-full flex items-center justify-center flex-shrink-0 ${statusBg[fileData.status] || statusBg.queued}`}>
                    <IconStatus />
                </div>
                <div className="flex flex-col min-w-0 mr-4">
                    <span className="font-medium text-zinc-200 truncate block tracking-wide text-sm">{fileData.file.name}</span>
                    <span className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mt-0.5">
                        {(fileData.file.size / 1024 / 1024).toFixed(2)} MB • {fileData.status}
                    </span>
                    {fileData.errorMsg && (
                        <span className="text-[10px] text-red-400 font-medium mt-1 leading-snug bg-red-500/10 px-2 py-1 rounded inline-block w-fit max-w-full break-words border border-red-500/20">
                            {fileData.errorMsg}
                        </span>
                    )}
                </div>
            </div>
            <div className="flex items-center space-x-2">
                {fileData.status === 'done' && fileData.md && (
                    <button
                        onClick={() => onDownload(fileData.id)}
                        className="w-8 h-8 flex items-center justify-center text-zinc-200 hover:text-white hover:bg-white/10 rounded-full transition-colors"
                        title="Download Markdown"
                    >
                        <Icon name="download" className="w-4 h-4" />
                    </button>
                )}
                <button
                    onClick={() => onRemove(fileData.id)}
                    className="w-8 h-8 flex items-center justify-center text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-full transition-colors"
                    title="Remove File"
                >
                    <Icon name="x" className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
};

const App = () => {
    const [files, setFiles] = useState([]);
    const [isDragging, setIsDragging] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const fileInputRef = useRef(null);

    const MAX_FILE_SIZE = 1024 * 1024 * 1024;

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
        }

        setFiles(prev => {
            const newQueue = [...prev];

            validFiles.forEach(f => {
                // Deduplication: Check Name + Size
                const exists = prev.some(existing => existing.file.name === f.name && existing.file.size === f.size);
                if (exists) return; // Skip duplicates

                let status = 'queued';
                let errorMsg = null;

                // Size Limit Check
                if (f.size > MAX_FILE_SIZE) {
                    status = 'skipped';
                    errorMsg = 'File over 1GB';
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
        setFiles(prev => prev.filter(f => f.id !== id));
    };

    const updateFileStatus = (id, status, md = null, errorMsg = null) => {
        setFiles(prev => prev.map(f =>
            f.id === id ? { ...f, status, md: md || f.md, errorMsg } : f
        ));
    };

    const convertAll = async () => {
        setIsProcessing(true);
        const queue = files.filter(f => f.status === 'queued');

        trackEvent('pdf | Batch Convert Started', { count: queue.length });

        // Process sequentially
        for (const item of queue) {
            updateFileStatus(item.id, 'processing');

            await new Promise(r => setTimeout(r, 50));

            try {
                if (typeof window.processPDF !== 'function') {
                    throw new Error("PDF Processing logic not loaded (processPDF is undefined). Check app/pdf2md.js.");
                }

                const markdown = await window.processPDF(item.file);
                updateFileStatus(item.id, 'done', markdown);
                trackEvent('pdf | Conversion Success', { fileName: item.file.name });
            } catch (err) {
                console.error(err);
                let msg = 'Error converting file';

                // Handle Password Protected PDF
                if (err.name === 'PasswordException') {
                    msg = 'Password protected PDF';
                } else if (err.message && err.message.includes('password')) {
                    msg = 'Password protected PDF';
                } else {
                    msg = err.message || 'Unknown error';
                }

                updateFileStatus(item.id, 'error', null, msg);
                trackEvent('pdf | Conversion Failed', { fileName: item.file.name, error: msg });
            }
        }
        setIsProcessing(false);
    };

    const sanitizeFilename = (name) => {
        let base = name.replace(/\.[^/.]+$/, "");
        base = base.replace(/[<>:"/\\|?*]/g, '_');
        return base + ".md";
    };

    const downloadFile = (id) => {
        const file = files.find(f => f.id === id);
        if (!file || !file.md) return;

        const blob = new Blob([file.md], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sanitizeFilename(file.file.name);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const downloadAllZip = async () => {
        const zip = new JSZip();
        const processed = files.filter(f => f.status === 'done');

        if (processed.length === 0) return;

        trackEvent('pdf | Download Zip', { count: processed.length });

        processed.forEach(f => {
            zip.file(sanitizeFilename(f.file.name), f.md);
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

        a.download = `md_files_${timestamp}.zip`;
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

    return (
        <div className="flex flex-col h-full max-w-4xl mx-auto w-full p-6 md:pt-8 md:pb-4">

            {/* Main Workspace: Floating Glass Card */}
            <div className="flex-1 flex flex-col md:flex-row gap-6 overflow-hidden min-h-0">

                {/* Drop Zone: Minimalist Vertical Strip */}
                <div
                    className={`md:w-1/3 flex-shrink-0 border border-dashed rounded-2xl flex flex-col items-center justify-center p-8 transition-all cursor-pointer group
                        ${isDragging
                            ? 'border-white bg-white/10 shadow-[0_0_30px_rgba(255,255,255,0.2)]'
                            : 'border-zinc-600 hover:border-zinc-400 bg-zinc-900 hover:bg-zinc-800'}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current.click()}
                >
                    <input
                        type="file"
                        multiple
                        accept="application/pdf"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileInput}
                    />
                    <div className="w-14 h-14 bg-zinc-800 border border-zinc-600 rounded-2xl mb-5 text-white flex items-center justify-center shadow-2xl group-hover:scale-110 transition-transform duration-300">
                        <Icon name="plus" className="w-6 h-6 opacity-100" />
                    </div>
                    <h3 className="text-base font-medium text-white mb-1">Add Documents</h3>
                    <p className="text-xs text-zinc-300 text-center leading-relaxed">
                        Drop PDFs here or click to browse <br />
                        <span className="text-zinc-400">max 1GB per file</span>
                    </p>
                </div>

                {/* File Queue: Glass Container */}
                <div className="flex-1 flex flex-col min-h-0 bg-zinc-900 rounded-2xl border border-zinc-700 overflow-hidden">

                    {/* Toolbar */}
                    <div className="px-5 py-4 border-b border-zinc-700 flex items-center justify-between bg-white/[0.02]">
                        <div className="text-xs font-semibold tracking-wider text-zinc-300 uppercase">
                            Queue ({stats.done}/{stats.total})
                        </div>
                        <div className="flex space-x-3">
                            {stats.total > 0 && (
                                <button
                                    onClick={() => { trackEvent('pdf | Queue Cleared'); setFiles([]); }}
                                    disabled={isProcessing}
                                    className="p-2 text-zinc-400 hover:text-red-400 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Clear All"
                                >
                                    <Icon name="trash-2" className="w-4 h-4" />
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Scrollable List */}
                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                        {files.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-zinc-300 space-y-4">
                                <div className="w-16 h-16 rounded-full bg-zinc-800 border border-zinc-600 flex items-center justify-center">
                                    <Icon name="layout-list" className="w-8 h-8 text-zinc-400" />
                                </div>
                                <p className="text-zinc-300 text-sm font-medium">Queue is empty</p>
                            </div>
                        ) : (
                            files.map(file => (
                                <FileRow
                                    key={file.id}
                                    fileData={file}
                                    onRemove={removeFile}
                                    onDownload={downloadFile}
                                />
                            ))
                        )}
                    </div>

                    {/* Action Bar (Footer) */}
                    {files.length > 0 && (
                        <div className="p-4 border-t border-zinc-700 bg-white/[0.02] flex justify-end gap-3">
                            {stats.done > 0 && (
                                <button
                                    onClick={downloadAllZip}
                                    disabled={isProcessing}
                                    className="px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-sm font-semibold shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                >
                                    <Icon name="archive" className="w-4 h-4" />
                                    <span>Download Zip</span>
                                </button>
                            )}
                            {stats.queued > 0 && (
                                <button
                                    type="button"
                                    onClick={(e) => { e.preventDefault(); convertAll(); }}
                                    disabled={isProcessing}
                                    className="px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black text-sm font-semibold shadow-[0_0_20px_rgba(255,255,255,0.1)] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
                                >
                                    {isProcessing ? (
                                        <><Icon name="loader-2" className="w-4 h-4 animate-spin" /> <span>Processing...</span></>
                                    ) : (
                                        <><Icon name="sparkles" className="w-4 h-4" /> <span>Convert All</span></>
                                    )}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const rootElement = document.getElementById('root');
if (rootElement) {
    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <ErrorBoundary>
            <App />
        </ErrorBoundary>
    );
} else {
    document.addEventListener('DOMContentLoaded', () => {
        const root = ReactDOM.createRoot(document.getElementById('root'));
        root.render(
            <ErrorBoundary>
                <App />
            </ErrorBoundary>
        );
    });
}
