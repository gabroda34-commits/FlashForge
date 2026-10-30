import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Code2,
  Copy,
  Cpu,
  Download,
  FileCode,
  FileUp,
  FolderOpen,
  Hash,
  Image as ImageIcon,
  Layers,
  Play,
  Search,
  Volume2,
  AlertTriangle,
} from 'lucide-react';
import { BUILT_IN_SWF_SAMPLES, SampleSwfDescriptor } from './swf/sampleSwfGenerator';
import { parseSwfBinary } from './swf/swfParser';
import {
  AbcConstantPool,
  ActionScriptUnit,
  ExtractedAsset,
  ParsedSwfFile,
  SwfTag,
} from './swf/types';
import { createZipArchive, ZipEntryInput } from './swf/zipBuilder';

type WorkspaceTab = 'scripts' | 'tags' | 'constants' | 'assets';
type CodeViewMode = 'split' | 'source' | 'pcode' | 'hex';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatHexOffset(offset: number): string {
  return `0x${offset.toString(16).padStart(6, '0').toUpperCase()}`;
}

/**
 * Lightweight syntax highlighter for ActionScript 1/2/3 source lines
 */
function highlightActionScriptLine(line: string): React.ReactNode {
  const trimmed = line.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('/*')) {
    return <span className="text-slate-500 italic">{line}</span>;
  }

  const tokenRegex =
    /("(?:[^"\\]|\\.)*"|\b(?:package|import|public|private|protected|class|extends|implements|function|var|const|if|else|for|while|return|super|this|new|true|false|null|undefined|void|int|uint|Number|String|Boolean|Object|Sprite|Void|trace|play|stop|gotoAndPlay|gotoAndStop)\b|\b\d+(?:\.\d+)?\b)/g;

  const parts = line.split(tokenRegex);
  return parts.map((part, idx) => {
    if (!part) return null;
    if (part.startsWith('"') && part.endsWith('"')) {
      return (
        <span key={idx} className="text-emerald-400">
          {part}
        </span>
      );
    }
    if (
      /^(package|import|public|private|protected|class|extends|implements|function|var|const|if|else|for|while|return|super|this|new)$/.test(
        part
      )
    ) {
      return (
        <span key={idx} className="text-amber-400 font-medium">
          {part}
        </span>
      );
    }
    if (/^(void|int|uint|Number|String|Boolean|Object|Sprite|Void)$/.test(part)) {
      return (
        <span key={idx} className="text-sky-400">
          {part}
        </span>
      );
    }
    if (/^(true|false|null|undefined|\d+(\.\d+)?)$/.test(part)) {
      return (
        <span key={idx} className="text-purple-300">
          {part}
        </span>
      );
    }
    if (/^(trace|play|stop|gotoAndPlay|gotoAndStop)$/.test(part)) {
      return (
        <span key={idx} className="text-amber-200">
          {part}
        </span>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export default function App() {
  const [parsedSwf, setParsedSwf] = useState<ParsedSwfFile | null>(null);
  const [activeSampleId, setActiveSampleId] = useState<string>(BUILT_IN_SWF_SAMPLES[0].id);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('scripts');
  const [codeViewMode, setCodeViewMode] = useState<CodeViewMode>('split');
  const [selectedScriptId, setSelectedScriptId] = useState<string>('');
  const [selectedTagIndex, setSelectedTagIndex] = useState<number>(0);
  const [selectedPoolIndex, setSelectedPoolIndex] = useState<number>(0);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [highlightedLine, setHighlightedLine] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    scripts: true,
    tags: true,
    assets: true,
  });

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 2800);
  };

  const loadSwfBytes = async (bytes: Uint8Array, fileName: string, sampleId = '') => {
    try {
      setErrorMessage(null);
      const parsed = await parseSwfBinary(bytes, fileName);
      setParsedSwf(parsed);
      setActiveSampleId(sampleId);
      setSelectedScriptId(parsed.scripts[0]?.id ?? '');
      setSelectedTagIndex(parsed.tags[0]?.index ?? 0);
      setSelectedPoolIndex(0);
      setSelectedAssetId(parsed.assets[0]?.id ?? '');
      setHighlightedLine(null);
    } catch (err) {
      setErrorMessage((err as Error).message || 'Failed to parse SWF binary stream.');
    }
  };

  const handleSelectSample = (sample: SampleSwfDescriptor) => {
    const raw = sample.buildBinary();
    void loadSwfBytes(raw, sample.fileName, sample.id);
  };

  useEffect(() => {
    handleSelectSample(BUILT_IN_SWF_SAMPLES[0]);
  }, []);

  const handleFileUpload = async (file: File) => {
    const buffer = await file.arrayBuffer();
    await loadSwfBytes(new Uint8Array(buffer), file.name, '');
    triggerToast(`Loaded ${file.name} (${formatBytes(buffer.byteLength)})`);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await handleFileUpload(file);
    }
  };

  const selectedScript: ActionScriptUnit | undefined = useMemo(() => {
    if (!parsedSwf) return undefined;
    return (
      parsedSwf.scripts.find((s) => s.id === selectedScriptId) ?? parsedSwf.scripts[0]
    );
  }, [parsedSwf, selectedScriptId]);

  const selectedTag: SwfTag | undefined = useMemo(() => {
    if (!parsedSwf) return undefined;
    return (
      parsedSwf.tags.find((t) => t.index === selectedTagIndex) ?? parsedSwf.tags[0]
    );
  }, [parsedSwf, selectedTagIndex]);

  const selectedPool: AbcConstantPool | undefined = useMemo(() => {
    if (!parsedSwf) return undefined;
    return parsedSwf.constantPools[selectedPoolIndex] ?? parsedSwf.constantPools[0];
  }, [parsedSwf, selectedPoolIndex]);

  const selectedAsset: ExtractedAsset | undefined = useMemo(() => {
    if (!parsedSwf) return undefined;
    return (
      parsedSwf.assets.find((a) => a.id === selectedAssetId) ?? parsedSwf.assets[0]
    );
  }, [parsedSwf, selectedAssetId]);

  const filteredScripts = useMemo(() => {
    if (!parsedSwf) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parsedSwf.scripts;
    return parsedSwf.scripts.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        s.decompiledSource.toLowerCase().includes(q) ||
        s.pcodeLines.some(
          (p) =>
            p.opcodeName.toLowerCase().includes(q) ||
            p.operands.toLowerCase().includes(q)
        )
    );
  }, [parsedSwf, searchQuery]);

  const filteredTags = useMemo(() => {
    if (!parsedSwf) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parsedSwf.tags;
    return parsedSwf.tags.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        String(t.code).includes(q)
    );
  }, [parsedSwf, searchQuery]);

  const filteredAssets = useMemo(() => {
    if (!parsedSwf) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return parsedSwf.assets;
    return parsedSwf.assets.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.type.toLowerCase().includes(q) ||
        a.details.toLowerCase().includes(q)
    );
  }, [parsedSwf, searchQuery]);

  const handleCopyText = async (text: string, id: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    triggerToast(`Copied ${label} to clipboard`);
    setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 1800);
  };

  const downloadBlob = (bytes: Uint8Array | string, filename: string, mimeType: string) => {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExportZipArchive = () => {
    if (!parsedSwf) return;
    const entries: ZipEntryInput[] = [];
    const baseName = parsedSwf.fileName.replace(/\.swf$/i, '');

    // 1. Original and uncompressed SWF binary
    entries.push({
      path: `${baseName}/binary/${parsedSwf.fileName}`,
      data: parsedSwf.rawBytes,
    });

    // 2. All decompiled ActionScript (.as) and disassembled (.pcode) units
    for (const unit of parsedSwf.scripts) {
      const pkgDir = unit.packagePath.replace(/\./g, '/');
      entries.push({
        path: `${baseName}/src/${pkgDir}/${unit.name}.as`,
        data: unit.decompiledSource,
      });

      const pcodeText = unit.pcodeLines
        .map(
          (l) =>
            `${formatHexOffset(l.offset)}  ${l.hexBytes.padEnd(18, ' ')}  ${l.opcodeName.padEnd(
              22,
              ' '
            )} ${l.operands}${l.comment ? ` ; ${l.comment}` : ''}`
        )
        .join('\n');
      entries.push({
        path: `${baseName}/pcode/${pkgDir}/${unit.name}.pcode.txt`,
        data: pcodeText,
      });
    }

    // 3. Extracted SVG, Bitmap, and Audio Assets
    for (const asset of parsedSwf.assets) {
      entries.push({
        path: `${baseName}/assets/${asset.name}.${asset.extension}`,
        data: asset.rawBytes,
      });
    }

    // 4. Structured SWF Header & Tag Stream Manifest JSON
    const report = {
      fileName: parsedSwf.fileName,
      extractedAt: parsedSwf.parsedAt,
      header: parsedSwf.header,
      scriptsCount: parsedSwf.scripts.length,
      assetsCount: parsedSwf.assets.length,
      tags: parsedSwf.tags.map((t) => ({
        index: t.index,
        code: t.code,
        name: t.name,
        category: t.category,
        offset: formatHexOffset(t.offset),
        length: t.length,
        summary: t.summary,
      })),
    };
    entries.push({
      path: `${baseName}/swf_manifest.json`,
      data: JSON.stringify(report, null, 2),
    });

    const zipBytes = createZipArchive(entries);
    downloadBlob(zipBytes, `${baseName}_decompiled.zip`, 'application/zip');
    triggerToast(`Exported ${entries.length} files to ${baseName}_decompiled.zip`);
  };

  const toggleSection = (key: string) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-[#0B0F17] text-[#F8FAFC] select-none"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      {/* Top Bar — Strict 3-Zone Contract */}
      <header className="h-14 flex items-center justify-between gap-8 px-6 border-b border-slate-800 bg-[#0F1522] shrink-0">
        {/* Zone 1: Brand Title (Single text element wordmark) */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('scripts');
          }}
          className="font-display text-base font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          FlashForge
        </a>

        {/* Zone 2: 4 Single-line Navigation Links */}
        <nav className="flex items-center gap-6 text-sm font-medium">
          <button
            type="button"
            onClick={() => setActiveTab('scripts')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'scripts'
                ? 'border-amber-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            ActionScript ({parsedSwf?.scripts.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tags')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'tags'
                ? 'border-amber-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Tag Tree ({parsedSwf?.tags.length ?? 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('constants')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'constants'
                ? 'border-amber-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Constant Pools
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('assets')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 ${
              activeTab === 'assets'
                ? 'border-amber-500 text-slate-100'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            Assets ({parsedSwf?.assets.length ?? 0})
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleExportZipArchive}
            disabled={!parsedSwf}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Archive className="w-3.5 h-3.5" />
            Export Archive (.zip)
          </button>
        </div>
      </header>

      {/* Main Workbench Area */}
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar (272px width) */}
        <aside className="w-[272px] border-r border-slate-800 bg-[#0E131F] flex flex-col shrink-0">
          {/* File Dropzone & Built-in Samples */}
          <div className="p-4 border-b border-slate-800 space-y-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".swf,application/x-shockwave-flash"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFileUpload(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-md border text-left transition-colors cursor-pointer ${
                isDragging
                  ? 'border-amber-400 bg-amber-500/10 text-amber-200'
                  : 'border-slate-700/80 bg-[#131B2E] hover:border-slate-600 text-slate-200'
              }`}
            >
              <div className="min-w-0 pr-2">
                <div className="text-xs font-semibold truncate">Open Local .SWF File</div>
                <div className="text-[11px] text-slate-400 truncate">
                  Drop FWS / CWS binary or browse
                </div>
              </div>
              <FileUp className="w-4 h-4 text-amber-400 shrink-0" />
            </button>

            {/* Sample Selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Built-in Binary Samples</span>
                {parsedSwf && (
                  <button
                    type="button"
                    onClick={() =>
                      downloadBlob(
                        parsedSwf.rawBytes,
                        parsedSwf.fileName,
                        'application/x-shockwave-flash'
                      )
                    }
                    className="text-amber-400 hover:underline cursor-pointer whitespace-nowrap"
                  >
                    Download .swf
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {BUILT_IN_SWF_SAMPLES.map((sample) => {
                  const isActive = activeSampleId === sample.id;
                  return (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => handleSelectSample(sample)}
                      className={`w-full text-left px-2.5 py-1.5 rounded text-xs transition-colors flex items-center justify-between gap-2 cursor-pointer ${
                        isActive
                          ? 'bg-amber-500/15 text-amber-300 font-medium border border-amber-500/30'
                          : 'text-slate-300 hover:bg-slate-800/60 border border-transparent'
                      }`}
                    >
                      <span className="truncate">{sample.title}</span>
                      <span className="text-[10px] font-mono text-slate-400 shrink-0">
                        {sample.vmBadge}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Search Filter */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter scripts, opcodes, tags..."
                className="w-full pl-8 pr-3 py-1.5 bg-[#090D15] border border-slate-800 rounded text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-amber-500/60"
              />
            </div>
          </div>

          {/* Package & Tag Explorer Tree */}
          <div className="flex-1 overflow-y-auto p-3 space-y-4">
            {/* Scripts Tree */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('scripts')}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  {expandedSections.scripts ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  ActionScript Units
                </span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {filteredScripts.length}
                </span>
              </button>
              {expandedSections.scripts && (
                <div className="mt-1 space-y-0.5 pl-2">
                  {filteredScripts.map((unit) => {
                    const active =
                      activeTab === 'scripts' && selectedScript?.id === unit.id;
                    return (
                      <button
                        key={unit.id}
                        type="button"
                        onClick={() => {
                          setSelectedScriptId(unit.id);
                          setActiveTab('scripts');
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-800 text-amber-300 font-medium'
                            : 'text-slate-300 hover:bg-slate-800/50'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          <FileCode className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                          <span className="truncate">{unit.name}</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">
                          {unit.vmType}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Assets Tree */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('assets')}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  {expandedSections.assets ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  Extracted Assets
                </span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {filteredAssets.length}
                </span>
              </button>
              {expandedSections.assets && (
                <div className="mt-1 space-y-0.5 pl-2">
                  {filteredAssets.map((asset) => {
                    const active =
                      activeTab === 'assets' && selectedAsset?.id === asset.id;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          setSelectedAssetId(asset.id);
                          setActiveTab('assets');
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded text-xs text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-800 text-amber-300 font-medium'
                            : 'text-slate-300 hover:bg-slate-800/50'
                        }`}
                      >
                        <span className="flex items-center gap-2 min-w-0">
                          {asset.type === 'audio' ? (
                            <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          ) : (
                            <ImageIcon className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                          )}
                          <span className="truncate">{asset.name}</span>
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 uppercase shrink-0">
                          {asset.extension}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* SWF Tag Stream Tree */}
            <div>
              <button
                type="button"
                onClick={() => toggleSection('tags')}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 py-1 hover:text-white cursor-pointer"
              >
                <span className="flex items-center gap-1.5">
                  {expandedSections.tags ? (
                    <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-slate-500" />
                  )}
                  SWF Binary Tags
                </span>
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  {filteredTags.length}
                </span>
              </button>
              {expandedSections.tags && (
                <div className="mt-1 space-y-0.5 pl-2">
                  {filteredTags.map((tag) => {
                    const active =
                      activeTab === 'tags' && selectedTag?.index === tag.index;
                    return (
                      <button
                        key={tag.index}
                        type="button"
                        onClick={() => {
                          setSelectedTagIndex(tag.index);
                          setActiveTab('tags');
                        }}
                        className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded text-xs text-left transition-colors cursor-pointer ${
                          active
                            ? 'bg-slate-800 text-amber-300 font-medium'
                            : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                        }`}
                      >
                        <span className="truncate">
                          <span className="font-mono text-[11px] text-slate-500 mr-1.5">
                            #{tag.index}
                          </span>
                          {tag.name}
                        </span>
                        <span className="font-mono text-[10px] text-slate-500 tabular-nums shrink-0">
                          {tag.length}B
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 flex flex-col min-w-0 bg-[#0B0F17]">
          {/* Error Banner */}
          {errorMessage && (
            <div className="px-6 py-3 bg-red-950/60 border-b border-red-800/70 flex items-center justify-between text-xs text-red-200">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="text-red-300 hover:text-white underline ml-4 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* SWF Header Telemetry Strip (Unboxed metadata with · separators) */}
          {parsedSwf && (
            <div className="px-6 py-3 border-b border-slate-800 bg-[#0F1522]/60 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                <span className="font-semibold text-white">{parsedSwf.fileName}</span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="font-mono">{parsedSwf.header.compressionName}</span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="font-mono tabular-nums">
                  SWF v{parsedSwf.header.version}
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="font-mono tabular-nums">
                  {parsedSwf.header.frameSize.widthPx} × {parsedSwf.header.frameSize.heightPx} px
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="font-mono tabular-nums">
                  {parsedSwf.header.frameRate} fps
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="font-mono tabular-nums">
                  {formatBytes(parsedSwf.header.uncompressedFileLength)}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>
                  VM:{' '}
                  <strong className="text-slate-200 font-mono">
                    {parsedSwf.header.actionScript3 ? 'AVM2 (ActionScript 3.0)' : 'AVM1 (ActionScript 1/2)'}
                  </strong>
                </span>
                <span aria-hidden="true" className="text-slate-600">
                  ·
                </span>
                <span className="flex items-center gap-1.5 font-mono">
                  Stage
                  <span
                    className="inline-block w-3 h-3 rounded-xs border border-slate-600"
                    style={{ backgroundColor: parsedSwf.header.backgroundColor }}
                  />
                  {parsedSwf.header.backgroundColor}
                </span>
              </div>
            </div>
          )}

          {/* TAB 1: ACTIONSCRIPT DECOMPILER & P-CODE DISASSEMBLER */}
          {activeTab === 'scripts' && parsedSwf && (
            <div className="flex-1 flex flex-col min-h-0">
              {/* Contextual Workbench Toolbar */}
              <div className="px-6 py-2.5 border-b border-slate-800 flex flex-wrap items-center justify-between gap-4 bg-[#0D121D]">
                <div className="flex items-center gap-2 text-xs text-slate-400 min-w-0">
                  <Code2 className="w-4 h-4 text-amber-400 shrink-0" />
                  {selectedScript ? (
                    <div className="flex items-center gap-2 truncate">
                      <span className="font-mono text-slate-200 font-medium truncate">
                        {selectedScript.fullName}.as
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{selectedScript.vmType}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        Tag #{selectedScript.tagIndex} ({selectedScript.tagName})
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {formatHexOffset(selectedScript.byteOffset)} ({selectedScript.byteLength} B)
                      </span>
                    </div>
                  ) : (
                    <span>No ActionScript bytecode blocks found in this SWF</span>
                  )}
                </div>

                {/* Segmented View Mode Control + Copy/Download Actions */}
                {selectedScript && (
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-1 p-0.5 bg-[#090C14] border border-slate-800 rounded-md">
                      {(
                        [
                          { id: 'split', label: 'Split (AS + P-Code)' },
                          { id: 'source', label: 'ActionScript' },
                          { id: 'pcode', label: 'P-Code' },
                          { id: 'hex', label: 'Hex Dump' },
                        ] as const
                      ).map((mode) => (
                        <button
                          key={mode.id}
                          type="button"
                          onClick={() => setCodeViewMode(mode.id)}
                          className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                            codeViewMode === mode.id
                              ? 'bg-slate-800 text-amber-300'
                              : 'text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {mode.label}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        handleCopyText(
                          selectedScript.decompiledSource,
                          `copy-${selectedScript.id}`,
                          `${selectedScript.name}.as`
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      {copiedId === `copy-${selectedScript.id}` ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                      Copy .as
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        downloadBlob(
                          selectedScript.decompiledSource,
                          `${selectedScript.name}.as`,
                          'text/plain;charset=utf-8'
                        )
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-200 bg-slate-800/80 hover:bg-slate-700 border border-slate-700 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download .as
                    </button>
                  </div>
                )}
              </div>

              {/* Dual-Pane Code & Disassembly Viewport */}
              {selectedScript ? (
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
                  {/* Left Pane: Decompiled ActionScript Source */}
                  {(codeViewMode === 'split' || codeViewMode === 'source') && (
                    <div
                      className={`${
                        codeViewMode === 'split' ? 'lg:col-span-6' : 'lg:col-span-12'
                      } flex flex-col min-h-0 bg-[#0B0F17]`}
                    >
                      <div className="px-4 py-2 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400 bg-[#0E131F]">
                        <span className="font-medium text-slate-200">
                          Decompiled ActionScript Source ({selectedScript.vmType === 'AVM2' ? 'AS 3.0' : 'AS 1.0/2.0'})
                        </span>
                        <span className="font-mono tabular-nums">
                          {selectedScript.decompiledSource.split('\n').length} lines
                        </span>
                      </div>
                      <div className="flex-1 overflow-auto p-4 font-mono text-xs leading-6 select-text">
                        {selectedScript.decompiledSource.split('\n').map((line, idx) => {
                          const lineNumber = idx + 1;
                          const isHighlighted = highlightedLine === lineNumber;
                          return (
                            <div
                              key={idx}
                              onClick={() =>
                                setHighlightedLine(
                                  highlightedLine === lineNumber ? null : lineNumber
                                )
                              }
                              className={`flex items-start px-2 rounded cursor-pointer transition-colors ${
                                isHighlighted
                                  ? 'bg-amber-500/15 text-slate-100'
                                  : 'hover:bg-slate-800/40'
                              }`}
                            >
                              <span className="w-9 text-right pr-4 text-slate-600 select-none tabular-nums shrink-0">
                                {lineNumber}
                              </span>
                              <span className="whitespace-pre overflow-x-auto">
                                {highlightActionScriptLine(line)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Right Pane: Synchronized P-Code Bytecode Disassembly */}
                  {(codeViewMode === 'split' || codeViewMode === 'pcode') && (
                    <div
                      className={`${
                        codeViewMode === 'split' ? 'lg:col-span-6' : 'lg:col-span-12'
                      } flex flex-col min-h-0 bg-[#090D14]`}
                    >
                      <div className="px-4 py-2 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400 bg-[#0E131F]">
                        <span className="font-medium text-slate-200">
                          {selectedScript.vmType} Bytecode Disassembly (P-Code)
                        </span>
                        <span className="font-mono tabular-nums">
                          {selectedScript.pcodeLines.length} instructions
                        </span>
                      </div>
                      <div className="flex-1 overflow-auto select-text">
                        <table className="w-full text-left border-collapse font-mono text-xs">
                          <thead className="sticky top-0 bg-[#0E131F] text-slate-400 border-b border-slate-800 text-[11px]">
                            <tr>
                              <th className="py-1.5 px-3 font-medium">Offset</th>
                              <th className="py-1.5 px-3 font-medium">Raw Bytes</th>
                              <th className="py-1.5 px-3 font-medium">Opcode</th>
                              <th className="py-1.5 px-3 font-medium">Operands & Stack Evaluation</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/50">
                            {selectedScript.pcodeLines.map((ins) => (
                              <tr
                                key={ins.index}
                                onClick={() => {
                                  if (ins.sourceLineHint) {
                                    setHighlightedLine(ins.sourceLineHint);
                                  }
                                }}
                                className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                              >
                                <td className="py-1.5 px-3 text-slate-500 tabular-nums whitespace-nowrap">
                                  {formatHexOffset(ins.offset)}
                                </td>
                                <td className="py-1.5 px-3 text-slate-400 tabular-nums whitespace-nowrap">
                                  {ins.hexBytes}
                                </td>
                                <td className="py-1.5 px-3 text-amber-300 font-medium whitespace-nowrap">
                                  {ins.opcodeName}
                                </td>
                                <td className="py-1.5 px-3 text-slate-200">
                                  <span>{ins.operands}</span>
                                  {ins.comment && (
                                    <span className="ml-2 text-emerald-400/90">
                                      ; {ins.comment}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Raw Hex Dump Mode */}
                  {codeViewMode === 'hex' && (
                    <div className="lg:col-span-12 flex flex-col min-h-0 bg-[#090D14]">
                      <div className="px-4 py-2 border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400 bg-[#0E131F]">
                        <span className="font-medium text-slate-200">
                          Tag #{selectedScript.tagIndex} Raw Bytecode Hex Slice
                        </span>
                        <span className="font-mono tabular-nums">
                          {selectedScript.byteLength} bytes @ {formatHexOffset(selectedScript.byteOffset)}
                        </span>
                      </div>
                      <div className="flex-1 overflow-auto p-4 font-mono text-xs space-y-1 select-text">
                        {Array.from({
                          length: Math.ceil(selectedScript.byteLength / 16),
                        }).map((_, rowIdx) => {
                          const sliceStart =
                            selectedScript.byteOffset + rowIdx * 16;
                          const rowBytes = parsedSwf.uncompressedBytes.subarray(
                            sliceStart,
                            Math.min(
                              selectedScript.byteOffset + selectedScript.byteLength,
                              sliceStart + 16
                            )
                          );
                          const hexCols = Array.from(rowBytes)
                            .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
                            .join(' ');
                          const asciiCols = Array.from(rowBytes)
                            .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
                            .join('');
                          return (
                            <div
                              key={rowIdx}
                              className="flex items-center gap-6 px-2 py-0.5 hover:bg-slate-800/40 rounded"
                            >
                              <span className="text-slate-500 tabular-nums w-20 shrink-0">
                                {formatHexOffset(sliceStart)}
                              </span>
                              <span className="text-amber-200/90 tabular-nums w-[390px] shrink-0">
                                {hexCols}
                              </span>
                              <span className="text-emerald-400/80 tracking-wider">
                                {asciiCols}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                  <Cpu className="w-8 h-8 text-slate-600 mb-3" />
                  <h2 className="text-sm font-semibold text-slate-200">
                    No ActionScript Bytecode Tags Found
                  </h2>
                  <p className="text-xs text-slate-400 max-w-md mt-1">
                    This SWF file does not contain DoAction (AVM1) or DoABC (AVM2) tags. Switch to the Tag Tree or Assets tab to inspect shapes and media.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SWF TAG TREE & BINARY INSPECTOR */}
          {activeTab === 'tags' && parsedSwf && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
              {/* Tag Table */}
              <div className="lg:col-span-7 flex flex-col min-h-0">
                <div className="px-4 py-2.5 border-b border-slate-800 bg-[#0E131F] flex items-center justify-between text-xs text-slate-400">
                  <span className="font-semibold text-slate-200">
                    Chronological SWF Tag Stream
                  </span>
                  <span className="font-mono tabular-nums">
                    {filteredTags.length} tags
                  </span>
                </div>
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead className="sticky top-0 bg-[#0E131F] text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2 px-3 font-medium">#</th>
                        <th className="py-2 px-3 font-medium">Tag Name</th>
                        <th className="py-2 px-3 font-medium">Category</th>
                        <th className="py-2 px-3 font-medium text-right">Offset</th>
                        <th className="py-2 px-3 font-medium text-right">Length</th>
                        <th className="py-2 px-3 font-medium">Summary</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredTags.map((t) => {
                        const isSelected = selectedTag?.index === t.index;
                        return (
                          <tr
                            key={t.index}
                            onClick={() => setSelectedTagIndex(t.index)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-amber-500/15 text-amber-200'
                                : 'hover:bg-slate-800/40 text-slate-300'
                            }`}
                          >
                            <td className="py-2 px-3 font-mono text-slate-500 tabular-nums">
                              {t.index}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-100 whitespace-nowrap">
                              {t.name}{' '}
                              <span className="font-mono text-[11px] text-slate-500">
                                ({t.code})
                              </span>
                            </td>
                            <td className="py-2 px-3 text-slate-400 whitespace-nowrap">
                              {t.category}
                            </td>
                            <td className="py-2 px-3 font-mono text-right text-slate-400 tabular-nums">
                              {formatHexOffset(t.offset)}
                            </td>
                            <td className="py-2 px-3 font-mono text-right text-slate-300 tabular-nums">
                              {t.length} B
                            </td>
                            <td className="py-2 px-3 text-slate-400 truncate max-w-[240px]">
                              {t.summary}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Selected Tag Detail & Hex Inspector */}
              <div className="lg:col-span-5 flex flex-col min-h-0 bg-[#090D14]">
                {selectedTag && (
                  <>
                    <div className="px-4 py-2.5 border-b border-slate-800 bg-[#0E131F] flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">
                        Tag #{selectedTag.index} — {selectedTag.name} (Code {selectedTag.code})
                      </span>
                      <span className="font-mono text-slate-400 tabular-nums">
                        {formatHexOffset(selectedTag.offset)}
                      </span>
                    </div>
                    <div className="p-4 border-b border-slate-800 space-y-2 text-xs">
                      <div className="grid grid-cols-2 gap-2 text-slate-400">
                        <div>
                          Header Format:{' '}
                          <span className="text-slate-200 font-mono">
                            {selectedTag.isLongHeader ? 'Long (6B)' : 'Short (2B)'}
                          </span>
                        </div>
                        <div>
                          Payload Size:{' '}
                          <span className="text-slate-200 font-mono tabular-nums">
                            {selectedTag.length} bytes
                          </span>
                        </div>
                      </div>
                      {selectedTag.fields.length > 0 && (
                        <div className="pt-2 border-t border-slate-800/80 space-y-1.5">
                          {selectedTag.fields.map((f, i) => (
                            <div
                              key={i}
                              className="flex items-start justify-between gap-4"
                            >
                              <span className="text-slate-400">{f.label}</span>
                              <span className="font-mono text-amber-300 text-right break-all">
                                {f.value}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 overflow-auto p-4 font-mono text-xs space-y-1 select-text">
                      <div className="text-[11px] text-slate-500 mb-2">
                        Raw Payload Hex Dump (First {Math.min(selectedTag.rawPayload.length, 512)} bytes)
                      </div>
                      {Array.from({
                        length: Math.ceil(
                          Math.min(selectedTag.rawPayload.length, 512) / 16
                        ),
                      }).map((_, rIdx) => {
                        const off = rIdx * 16;
                        const slice = selectedTag.rawPayload.subarray(off, off + 16);
                        const hex = Array.from(slice)
                          .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
                          .join(' ');
                        const ascii = Array.from(slice)
                          .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : '.'))
                          .join('');
                        return (
                          <div key={rIdx} className="flex items-center gap-4">
                            <span className="text-slate-500 tabular-nums w-16 shrink-0">
                              +{off.toString(16).padStart(4, '0').toUpperCase()}
                            </span>
                            <span className="text-slate-200 tabular-nums w-80 shrink-0">
                              {hex}
                            </span>
                            <span className="text-emerald-400/80">{ascii}</span>
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: CONSTANT POOLS INSPECTOR */}
          {activeTab === 'constants' && parsedSwf && (
            <div className="flex-1 flex flex-col min-h-0">
              {selectedPool ? (
                <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
                  {/* Strings & Numbers */}
                  <div className="lg:col-span-6 flex flex-col min-h-0">
                    <div className="px-4 py-2.5 border-b border-slate-800 bg-[#0E131F] flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">
                        AVM2 String Constant Pool ({selectedPool.abcName})
                      </span>
                      <span className="font-mono text-slate-400 tabular-nums">
                        {selectedPool.strings.length} strings
                      </span>
                    </div>
                    <div className="flex-1 overflow-auto">
                      <table className="w-full text-left border-collapse text-xs font-mono">
                        <thead className="sticky top-0 bg-[#0E131F] text-slate-400 border-b border-slate-800">
                          <tr>
                            <th className="py-2 px-4 w-20">Index</th>
                            <th className="py-2 px-4">UTF-8 String Literal</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/50">
                          {selectedPool.strings.map((s, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/40">
                              <td className="py-1.5 px-4 text-slate-500 tabular-nums">
                                #{idx + 1}
                              </td>
                              <td className="py-1.5 px-4 text-emerald-400 break-all">
                                {JSON.stringify(s)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Multinames & Method Signatures */}
                  <div className="lg:col-span-6 flex flex-col min-h-0 bg-[#090D14]">
                    <div className="px-4 py-2.5 border-b border-slate-800 bg-[#0E131F] flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-200">
                        Multinames ({selectedPool.multinames.length}) & Method Signatures ({selectedPool.methods.length})
                      </span>
                      <span className="font-mono text-slate-400">
                        ABC {selectedPool.majorVersion}.{selectedPool.minorVersion}
                      </span>
                    </div>
                    <div className="flex-1 overflow-auto divide-y divide-slate-800">
                      <div className="p-4 space-y-2">
                        <h3 className="text-xs font-semibold text-slate-300">
                          QNames & Multinames
                        </h3>
                        <div className="space-y-1 font-mono text-xs">
                          {selectedPool.multinames.map((mn) => (
                            <div
                              key={mn.index}
                              className="flex items-center justify-between py-1 px-2 rounded hover:bg-slate-800/40"
                            >
                              <span className="text-slate-500 tabular-nums">
                                mn#{mn.index} ({mn.kindName})
                              </span>
                              <span className="text-amber-300">
                                {mn.namespace ? `${mn.namespace}::${mn.name}` : mn.name}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="p-4 space-y-2">
                        <h3 className="text-xs font-semibold text-slate-300">
                          Numeric Constants (Int / UInt / Double)
                        </h3>
                        <div className="font-mono text-xs text-slate-300 space-y-1">
                          <div>
                            Integers:{' '}
                            <span className="text-purple-300">
                              [{selectedPool.integers.join(', ') || 'none'}]
                            </span>
                          </div>
                          <div>
                            UIntegers:{' '}
                            <span className="text-purple-300">
                              [
                              {selectedPool.uintegers
                                .map((u) => `0x${u.toString(16)}`)
                                .join(', ') || 'none'}
                              ]
                            </span>
                          </div>
                          <div>
                            Doubles:{' '}
                            <span className="text-purple-300">
                              [{selectedPool.doubles.join(', ') || 'none'}]
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* Fallback to AVM1 Constant Pool table when inspecting an AVM1 SWF */
                <div className="flex-1 flex flex-col min-h-0">
                  <div className="px-6 py-3 border-b border-slate-800 bg-[#0E131F] flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">
                      AVM1 ActionConstantPool Entries
                    </span>
                    <span className="font-mono text-slate-400 tabular-nums">
                      {parsedSwf.scripts.reduce(
                        (acc, s) => acc + s.constantsReferenced.length,
                        0
                      )}{' '}
                      constants
                    </span>
                  </div>
                  <div className="flex-1 overflow-auto p-6">
                    <table className="w-full text-left border-collapse text-xs font-mono border border-slate-800">
                      <thead className="bg-[#0E131F] text-slate-400 border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-4 w-24">Pool Index</th>
                          <th className="py-2 px-4 w-48">Source Script</th>
                          <th className="py-2 px-4">Constant String Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {parsedSwf.scripts.flatMap((s) =>
                          s.constantsReferenced.map((c, idx) => (
                            <tr key={`${s.id}-${idx}`} className="hover:bg-slate-800/40">
                              <td className="py-2 px-4 text-slate-500 tabular-nums">
                                cpool[{idx}]
                              </td>
                              <td className="py-2 px-4 text-slate-300">{s.name}</td>
                              <td className="py-2 px-4 text-emerald-400">
                                {JSON.stringify(c)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: EMBEDDED ASSETS (SHAPES, BITMAPS & AUDIO) */}
          {activeTab === 'assets' && parsedSwf && (
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
              {/* Asset Grid */}
              <div className="lg:col-span-6 p-6 overflow-auto space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-slate-200">
                    Extracted Shapes, Bitmaps & Sound Streams
                  </h2>
                  <span className="text-xs text-slate-400 font-mono tabular-nums">
                    {filteredAssets.length} items
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {filteredAssets.map((asset) => {
                    const isSelected = selectedAsset?.id === asset.id;
                    return (
                      <div
                        key={asset.id}
                        onClick={() => setSelectedAssetId(asset.id)}
                        className={`p-4 rounded-md border transition-colors cursor-pointer flex flex-col justify-between gap-3 ${
                          isSelected
                            ? 'border-amber-500 bg-amber-500/10'
                            : 'border-slate-800 bg-[#0F1522] hover:border-slate-700'
                        }`}
                      >
                        <div className="h-32 rounded bg-[#090C14] border border-slate-800/80 flex items-center justify-center p-3 overflow-hidden">
                          {asset.type === 'shape-svg' && asset.svgMarkup && (
                            <div
                              className="w-full h-full flex items-center justify-center [&>svg]:max-h-full [&>svg]:max-w-full"
                              dangerouslySetInnerHTML={{ __html: asset.svgMarkup }}
                            />
                          )}
                          {asset.type === 'bitmap' && asset.dataUrl && (
                            <img
                              src={asset.dataUrl}
                              alt={asset.name}
                              referrerPolicy="no-referrer"
                              className="max-h-full max-w-full object-contain"
                            />
                          )}
                          {asset.type === 'audio' && (
                            <div className="flex flex-col items-center gap-2 text-emerald-400">
                              <Volume2 className="w-8 h-8" />
                              <span className="text-[11px] font-mono">
                                {asset.extension.toUpperCase()} Audio Stream
                              </span>
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="flex items-center justify-between text-xs font-semibold text-slate-100">
                            <span>
                              {asset.name}.{asset.extension}
                            </span>
                            <span className="font-mono text-slate-400 tabular-nums">
                              #{asset.characterId}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400 mt-0.5 truncate">
                            {asset.details}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Asset Inspector & Export Pane */}
              <div className="lg:col-span-6 flex flex-col min-h-0 bg-[#090D14]">
                {selectedAsset ? (
                  <>
                    <div className="px-6 py-3 border-b border-slate-800 bg-[#0E131F] flex items-center justify-between">
                      <div className="text-xs">
                        <span className="font-semibold text-slate-100">
                          {selectedAsset.name}.{selectedAsset.extension}
                        </span>
                        <span className="mx-2 text-slate-600">·</span>
                        <span className="text-slate-400 font-mono">
                          Tag #{selectedAsset.tagIndex} ({selectedAsset.tagName})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          downloadBlob(
                            selectedAsset.rawBytes,
                            `${selectedAsset.name}.${selectedAsset.extension}`,
                            selectedAsset.mimeType
                          )
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-950 bg-amber-500 hover:bg-amber-400 rounded transition-colors cursor-pointer"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Download .{selectedAsset.extension}
                      </button>
                    </div>

                    <div className="flex-1 p-6 overflow-auto space-y-6">
                      {selectedAsset.type === 'shape-svg' && selectedAsset.svgMarkup && (
                        <>
                          <div className="h-56 rounded-md bg-[#0B0F17] border border-slate-800 flex items-center justify-center p-6">
                            <div
                              className="w-full h-full flex items-center justify-center [&>svg]:max-h-full [&>svg]:max-w-full"
                              dangerouslySetInnerHTML={{
                                __html: selectedAsset.svgMarkup,
                              }}
                            />
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs text-slate-400">
                              <span>Reconstructed SVG Vector Source</span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyText(
                                    selectedAsset.svgMarkup!,
                                    `svg-${selectedAsset.id}`,
                                    'SVG markup'
                                  )
                                }
                                className="text-amber-400 hover:underline cursor-pointer"
                              >
                                Copy SVG
                              </button>
                            </div>
                            <pre className="p-4 rounded bg-[#0B0F17] border border-slate-800 font-mono text-xs text-emerald-300 overflow-x-auto select-text">
                              {selectedAsset.svgMarkup}
                            </pre>
                          </div>
                        </>
                      )}

                      {selectedAsset.type === 'audio' && selectedAsset.dataUrl && (
                        <div className="p-6 rounded-md bg-[#0B0F17] border border-slate-800 space-y-4">
                          <div className="text-xs text-slate-300 font-medium">
                            Embedded SWF Sound Tag Preview ({selectedAsset.details})
                          </div>
                          <audio
                            controls
                            src={selectedAsset.dataUrl}
                            className="w-full"
                          />
                        </div>
                      )}

                      {selectedAsset.type === 'bitmap' && selectedAsset.dataUrl && (
                        <div className="p-6 rounded-md bg-[#0B0F17] border border-slate-800 flex items-center justify-center">
                          <img
                            src={selectedAsset.dataUrl}
                            alt={selectedAsset.name}
                            referrerPolicy="no-referrer"
                            className="max-h-72 object-contain"
                          />
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs text-slate-500">
                    Select an extracted asset to inspect or export.
                  </div>
                )}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-md bg-slate-900 border border-amber-500/50 text-xs font-medium text-slate-100 shadow-lg flex items-center gap-2">
          <Check className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
}
