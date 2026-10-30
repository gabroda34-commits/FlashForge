export type SwfSignature = 'FWS' | 'CWS' | 'ZWS';

export interface SwfRect {
  xMinTwips: number;
  xMaxTwips: number;
  yMinTwips: number;
  yMaxTwips: number;
  widthPx: number;
  heightPx: number;
}

export interface SwfHeader {
  signature: SwfSignature;
  compressionName: string;
  version: number;
  compressedFileLength: number;
  uncompressedFileLength: number;
  frameSize: SwfRect;
  frameRate: number;
  frameCount: number;
  backgroundColor: string;
  useNetwork: boolean;
  actionScript3: boolean;
  hasMetadata: boolean;
}

export interface SwfTagField {
  label: string;
  value: string | number;
}

export interface SwfTag {
  index: number;
  code: number;
  name: string;
  category: 'Control' | 'ActionScript' | 'Shape' | 'Bitmap' | 'Sound' | 'Text' | 'Display' | 'Metadata';
  offset: number;
  headerLength: number;
  length: number;
  isLongHeader: boolean;
  summary: string;
  fields: SwfTagField[];
  rawPayload: Uint8Array;
}

export interface PCodeLine {
  index: number;
  offset: number;
  hexBytes: string;
  opcode: number;
  opcodeName: string;
  operands: string;
  comment?: string;
  sourceLineHint?: number;
}

export interface ActionScriptUnit {
  id: string;
  name: string;
  packagePath: string;
  fullName: string;
  vmType: 'AVM1' | 'AVM2';
  kind: 'Class' | 'FrameScript' | 'ClipAction' | 'Method';
  tagIndex: number;
  tagName: string;
  byteOffset: number;
  byteLength: number;
  decompiledSource: string;
  pcodeLines: PCodeLine[];
  constantsReferenced: string[];
  methodsCount: number;
  traitsCount: number;
}

export interface AbcNamespaceEntry {
  index: number;
  kindName: string;
  name: string;
}

export interface AbcMultinameEntry {
  index: number;
  kindName: string;
  name: string;
  namespace: string;
}

export interface AbcMethodSignature {
  index: number;
  name: string;
  paramTypes: string[];
  returnType: string;
  flags: string[];
}

export interface AbcConstantPool {
  sourceTagIndex: number;
  abcName: string;
  minorVersion: number;
  majorVersion: number;
  integers: number[];
  uintegers: number[];
  doubles: number[];
  strings: string[];
  namespaces: AbcNamespaceEntry[];
  multinames: AbcMultinameEntry[];
  methods: AbcMethodSignature[];
}

export interface ExtractedAsset {
  id: string;
  characterId: number;
  name: string;
  type: 'shape-svg' | 'bitmap' | 'audio' | 'binary';
  mimeType: string;
  extension: string;
  tagIndex: number;
  tagName: string;
  byteLength: number;
  dimensions?: string;
  details: string;
  svgMarkup?: string;
  dataUrl?: string;
  rawBytes: Uint8Array;
}

export interface ParsedSwfFile {
  fileName: string;
  parsedAt: string;
  rawBytes: Uint8Array;
  uncompressedBytes: Uint8Array;
  header: SwfHeader;
  tags: SwfTag[];
  scripts: ActionScriptUnit[];
  constantPools: AbcConstantPool[];
  assets: ExtractedAsset[];
  warnings: string[];
}
