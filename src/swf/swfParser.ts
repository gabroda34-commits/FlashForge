import {
  AbcConstantPool,
  AbcMethodSignature,
  AbcMultinameEntry,
  AbcNamespaceEntry,
  ActionScriptUnit,
  ExtractedAsset,
  ParsedSwfFile,
  PCodeLine,
  SwfHeader,
  SwfRect,
  SwfSignature,
  SwfTag,
  SwfTagField,
} from './types';

const SWF_TAG_NAMES: Record<number, { name: string; category: SwfTag['category'] }> = {
  0: { name: 'End', category: 'Control' },
  1: { name: 'ShowFrame', category: 'Display' },
  2: { name: 'DefineShape', category: 'Shape' },
  4: { name: 'PlaceObject', category: 'Display' },
  5: { name: 'RemoveObject', category: 'Display' },
  6: { name: 'DefineBits', category: 'Bitmap' },
  7: { name: 'DefineButton', category: 'Display' },
  8: { name: 'JPEGTables', category: 'Bitmap' },
  9: { name: 'SetBackgroundColor', category: 'Control' },
  10: { name: 'DefineFont', category: 'Text' },
  11: { name: 'DefineText', category: 'Text' },
  12: { name: 'DoAction', category: 'ActionScript' },
  13: { name: 'DefineFontInfo', category: 'Text' },
  14: { name: 'DefineSound', category: 'Sound' },
  15: { name: 'StartSound', category: 'Sound' },
  17: { name: 'DefineButtonSound', category: 'Sound' },
  18: { name: 'SoundStreamHead', category: 'Sound' },
  19: { name: 'SoundStreamBlock', category: 'Sound' },
  20: { name: 'DefineBitsLossless', category: 'Bitmap' },
  21: { name: 'DefineBitsJPEG2', category: 'Bitmap' },
  22: { name: 'DefineShape2', category: 'Shape' },
  24: { name: 'Protect', category: 'Control' },
  26: { name: 'PlaceObject2', category: 'Display' },
  28: { name: 'RemoveObject2', category: 'Display' },
  32: { name: 'DefineShape3', category: 'Shape' },
  33: { name: 'DefineText2', category: 'Text' },
  34: { name: 'DefineButton2', category: 'Display' },
  35: { name: 'DefineBitsJPEG3', category: 'Bitmap' },
  36: { name: 'DefineBitsLossless2', category: 'Bitmap' },
  37: { name: 'DefineEditText', category: 'Text' },
  39: { name: 'DefineSprite', category: 'Display' },
  43: { name: 'FrameLabel', category: 'Control' },
  45: { name: 'SoundStreamHead2', category: 'Sound' },
  46: { name: 'DefineMorphShape', category: 'Shape' },
  48: { name: 'DefineFont2', category: 'Text' },
  56: { name: 'ExportAssets', category: 'Control' },
  57: { name: 'ImportAssets', category: 'Control' },
  58: { name: 'EnableDebugger', category: 'Control' },
  59: { name: 'DoInitAction', category: 'ActionScript' },
  60: { name: 'DefineVideoStream', category: 'Display' },
  64: { name: 'EnableDebugger2', category: 'Control' },
  65: { name: 'ScriptLimits', category: 'Control' },
  66: { name: 'SetTabIndex', category: 'Control' },
  69: { name: 'FileAttributes', category: 'Control' },
  70: { name: 'PlaceObject3', category: 'Display' },
  71: { name: 'ImportAssets2', category: 'Control' },
  72: { name: 'DoABC (Lazy)', category: 'ActionScript' },
  73: { name: 'DefineFontAlignZones', category: 'Text' },
  74: { name: 'CSMTextSettings', category: 'Text' },
  75: { name: 'DefineFont3', category: 'Text' },
  76: { name: 'SymbolClass', category: 'Control' },
  77: { name: 'Metadata', category: 'Metadata' },
  78: { name: 'DefineScalingGrid', category: 'Display' },
  82: { name: 'DoABC', category: 'ActionScript' },
  83: { name: 'DefineShape4', category: 'Shape' },
  84: { name: 'DefineMorphShape2', category: 'Shape' },
  86: { name: 'DefineSceneAndFrameLabelData', category: 'Control' },
  87: { name: 'DefineBinaryData', category: 'Metadata' },
  88: { name: 'DefineFontName', category: 'Text' },
  89: { name: 'StartSound2', category: 'Sound' },
  90: { name: 'DefineBitsJPEG4', category: 'Bitmap' },
  91: { name: 'DefineFont4', category: 'Text' },
};

class BitReader {
  private data: Uint8Array;
  public byteOffset: number;
  private bitPos = 0; // 0..7 from MSB to LSB

  constructor(data: Uint8Array, startOffset = 0) {
    this.data = data;
    this.byteOffset = startOffset;
  }

  readUBits(n: number): number {
    if (n === 0) return 0;
    let val = 0;
    for (let i = 0; i < n; i++) {
      if (this.byteOffset >= this.data.length) return val;
      const bit = (this.data[this.byteOffset] >>> (7 - this.bitPos)) & 1;
      val = (val << 1) | bit;
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bitPos = 0;
        this.byteOffset++;
      }
    }
    return val >>> 0;
  }

  readSBits(n: number): number {
    if (n === 0) return 0;
    const u = this.readUBits(n);
    const signBit = 1 << (n - 1);
    return u & signBit ? u - (1 << n) : u;
  }

  alignByte() {
    if (this.bitPos !== 0) {
      this.bitPos = 0;
      this.byteOffset++;
    }
  }

  readU8(): number {
    this.alignByte();
    if (this.byteOffset >= this.data.length) return 0;
    return this.data[this.byteOffset++];
  }

  readU16LE(): number {
    this.alignByte();
    if (this.byteOffset + 1 >= this.data.length) return 0;
    const v = this.data[this.byteOffset] | (this.data[this.byteOffset + 1] << 8);
    this.byteOffset += 2;
    return v >>> 0;
  }

  readS16LE(): number {
    const u = this.readU16LE();
    return u & 0x8000 ? u - 0x10000 : u;
  }

  readU32LE(): number {
    this.alignByte();
    if (this.byteOffset + 3 >= this.data.length) return 0;
    const v =
      this.data[this.byteOffset] |
      (this.data[this.byteOffset + 1] << 8) |
      (this.data[this.byteOffset + 2] << 16) |
      (this.data[this.byteOffset + 3] << 24);
    this.byteOffset += 4;
    return v >>> 0;
  }

  readRect(): SwfRect {
    this.alignByte();
    const nBits = this.readUBits(5);
    const xMinTwips = this.readSBits(nBits);
    const xMaxTwips = this.readSBits(nBits);
    const yMinTwips = this.readSBits(nBits);
    const yMaxTwips = this.readSBits(nBits);
    this.alignByte();
    return {
      xMinTwips,
      xMaxTwips,
      yMinTwips,
      yMaxTwips,
      widthPx: Math.max(1, Math.round((xMaxTwips - xMinTwips) / 20)),
      heightPx: Math.max(1, Math.round((yMaxTwips - yMinTwips) / 20)),
    };
  }
}

async function inflateZlibStream(compressedPayload: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    for (const format of ['deflate', 'deflate-raw'] as const) {
      try {
        const ds = new DecompressionStream(format);
        const writer = ds.writable.getWriter();
        const slice =
          format === 'deflate-raw' && compressedPayload.length > 2
            ? compressedPayload.subarray(2)
            : compressedPayload;
        writer.write(slice);
        writer.close();
        const response = new Response(ds.readable);
        const ab = await response.arrayBuffer();
        return new Uint8Array(ab);
      } catch {
        // try next format
      }
    }
  }
  throw new Error('Browser DecompressionStream failed to inflate CWS zlib stream.');
}

function toHexBytes(bytes: Uint8Array, start: number, len: number): string {
  const end = Math.min(bytes.length, start + len);
  const parts: string[] = [];
  for (let i = start; i < end; i++) {
    parts.push(bytes[i].toString(16).padStart(2, '0').toUpperCase());
  }
  return parts.join(' ');
}

function readCString(bytes: Uint8Array, start: number): { value: string; nextOffset: number } {
  let end = start;
  while (end < bytes.length && bytes[end] !== 0) end++;
  const value = new TextDecoder().decode(bytes.subarray(start, end));
  return { value, nextOffset: Math.min(bytes.length, end + 1) };
}

/**
 * AVM1 (ActionScript 1 / 2) Disassembler & Decompiler
 */
const AVM1_OPCODES: Record<number, string> = {
  0x00: 'ActionEnd',
  0x04: 'ActionNextFrame',
  0x05: 'ActionPrevFrame',
  0x06: 'ActionPlay',
  0x07: 'ActionStop',
  0x08: 'ActionToggleQuality',
  0x09: 'ActionStopSounds',
  0x0a: 'ActionAdd',
  0x0b: 'ActionSubtract',
  0x0c: 'ActionMultiply',
  0x0d: 'ActionDivide',
  0x0e: 'ActionEquals',
  0x0f: 'ActionLess',
  0x10: 'ActionAnd',
  0x11: 'ActionOr',
  0x12: 'ActionNot',
  0x13: 'ActionStringEquals',
  0x17: 'ActionPop',
  0x18: 'ActionToInteger',
  0x1c: 'ActionGetVariable',
  0x1d: 'ActionSetVariable',
  0x20: 'ActionSetTarget2',
  0x21: 'ActionStringAdd',
  0x22: 'ActionGetProperty',
  0x23: 'ActionSetProperty',
  0x26: 'ActionTrace',
  0x30: 'ActionRandomNumber',
  0x34: 'ActionGetTime',
  0x3c: 'ActionDefineLocal',
  0x3d: 'ActionCallFunction',
  0x3e: 'ActionReturn',
  0x40: 'ActionNewObject',
  0x41: 'ActionDefineLocal2',
  0x42: 'ActionInitArray',
  0x43: 'ActionInitObject',
  0x47: 'ActionAdd2',
  0x48: 'ActionLess2',
  0x49: 'ActionEquals2',
  0x4a: 'ActionToNumber',
  0x4b: 'ActionToString',
  0x4c: 'ActionPushDuplicate',
  0x4e: 'ActionGetMember',
  0x4f: 'ActionSetMember',
  0x50: 'ActionIncrement',
  0x51: 'ActionDecrement',
  0x52: 'ActionCallMethod',
  0x53: 'ActionNewMethod',
  0x54: 'ActionInstanceOf',
  0x60: 'ActionBitAnd',
  0x61: 'ActionBitOr',
  0x62: 'ActionBitXor',
  0x66: 'ActionStrictEquals',
  0x67: 'ActionGreater',
  0x81: 'ActionGotoFrame',
  0x83: 'ActionGetURL',
  0x87: 'ActionStoreRegister',
  0x88: 'ActionConstantPool',
  0x8a: 'ActionWaitForFrame',
  0x8b: 'ActionSetTarget',
  0x8c: 'ActionGoToLabel',
  0x8e: 'ActionDefineFunction2',
  0x94: 'ActionWith',
  0x96: 'ActionPush',
  0x99: 'ActionJump',
  0x9a: 'ActionGetURL2',
  0x9b: 'ActionDefineFunction',
  0x9d: 'ActionIf',
  0x9f: 'ActionGotoFrame2',
};

function parseAvm1ActionBlock(
  payload: Uint8Array,
  tagIndex: number,
  tagName: string,
  tagOffset: number,
  isInitAction = false
): ActionScriptUnit {
  let pos = isInitAction ? 2 : 0;
  const spriteId = isInitAction && payload.length >= 2 ? payload[0] | (payload[1] << 8) : 0;
  const constantPool: string[] = [];
  const pcodeLines: PCodeLine[] = [];
  const stack: string[] = [];
  const statements: string[] = [];

  let lineIndex = 0;
  while (pos < payload.length) {
    const instrStart = pos;
    const opcode = payload[pos++];
    const opcodeName = AVM1_OPCODES[opcode] ?? `Action_0x${opcode.toString(16).padStart(2, '0')}`;
    let length = 0;
    if (opcode >= 0x80 && pos + 1 < payload.length) {
      length = payload[pos] | (payload[pos + 1] << 8);
      pos += 2;
    }
    const dataEnd = Math.min(payload.length, pos + length);
    let operands = '';
    let comment: string | undefined;

    if (opcode === 0x00) {
      pcodeLines.push({
        index: lineIndex++,
        offset: tagOffset + instrStart,
        hexBytes: toHexBytes(payload, instrStart, 1),
        opcode,
        opcodeName,
        operands: '',
        comment: 'End of action block',
      });
      break;
    } else if (opcode === 0x88) {
      // ActionConstantPool
      const count = pos + 1 < dataEnd ? payload[pos] | (payload[pos + 1] << 8) : 0;
      let cpos = pos + 2;
      constantPool.length = 0;
      for (let i = 0; i < count && cpos < dataEnd; i++) {
        const res = readCString(payload, cpos);
        constantPool.push(res.value);
        cpos = res.nextOffset;
      }
      operands = `[${constantPool.map((c, idx) => `${idx}:${JSON.stringify(c)}`).join(', ')}]`;
      comment = `${constantPool.length} constants registered`;
    } else if (opcode === 0x96) {
      // ActionPush
      let ppos = pos;
      const pushedItems: string[] = [];
      while (ppos < dataEnd) {
        const pushType = payload[ppos++];
        if (pushType === 0) {
          const res = readCString(payload, ppos);
          ppos = res.nextOffset;
          const lit = JSON.stringify(res.value);
          pushedItems.push(lit);
          stack.push(lit);
        } else if (pushType === 1 && ppos + 3 < dataEnd) {
          const dv = new DataView(payload.buffer, payload.byteOffset + ppos, 4).getFloat32(0, true);
          ppos += 4;
          const lit = Number(dv.toFixed(4)).toString();
          pushedItems.push(lit);
          stack.push(lit);
        } else if (pushType === 2) {
          pushedItems.push('null');
          stack.push('null');
        } else if (pushType === 3) {
          pushedItems.push('undefined');
          stack.push('undefined');
        } else if (pushType === 4 && ppos < dataEnd) {
          const reg = `reg${payload[ppos++]}`;
          pushedItems.push(reg);
          stack.push(reg);
        } else if (pushType === 5 && ppos < dataEnd) {
          const bool = payload[ppos++] ? 'true' : 'false';
          pushedItems.push(bool);
          stack.push(bool);
        } else if (pushType === 6 && ppos + 7 < dataEnd) {
          const dv = new DataView(payload.buffer, payload.byteOffset + ppos, 8).getFloat64(0, true);
          ppos += 8;
          const lit = dv.toString();
          pushedItems.push(lit);
          stack.push(lit);
        } else if (pushType === 7 && ppos + 3 < dataEnd) {
          const iv = new DataView(payload.buffer, payload.byteOffset + ppos, 4).getInt32(0, true);
          ppos += 4;
          const lit = iv.toString();
          pushedItems.push(lit);
          stack.push(lit);
        } else if (pushType === 8 && ppos < dataEnd) {
          const idx = payload[ppos++];
          const resolved = constantPool[idx] !== undefined ? JSON.stringify(constantPool[idx]) : `cpool[${idx}]`;
          pushedItems.push(`cpool[${idx}] (${resolved})`);
          stack.push(resolved);
        } else if (pushType === 9 && ppos + 1 < dataEnd) {
          const idx = payload[ppos] | (payload[ppos + 1] << 8);
          ppos += 2;
          const resolved = constantPool[idx] !== undefined ? JSON.stringify(constantPool[idx]) : `cpool[${idx}]`;
          pushedItems.push(`cpool[${idx}] (${resolved})`);
          stack.push(resolved);
        } else {
          break;
        }
      }
      operands = pushedItems.join(', ');
    } else if (opcode === 0x1c) {
      // GetVariable
      const rawName = stack.pop() ?? '"unknown"';
      const ident = rawName.replace(/^"|"$/g, '');
      stack.push(ident);
      comment = `eval(${ident})`;
    } else if (opcode === 0x1d) {
      // SetVariable
      const val = stack.pop() ?? 'undefined';
      const rawName = stack.pop() ?? '"var"';
      const ident = rawName.replace(/^"|"$/g, '');
      statements.push(`${ident} = ${val};`);
      comment = `${ident} = ${val}`;
    } else if (opcode === 0x4e) {
      // GetMember
      const prop = (stack.pop() ?? '"prop"').replace(/^"|"$/g, '');
      const obj = stack.pop() ?? 'this';
      stack.push(`${obj}.${prop}`);
    } else if (opcode === 0x4f) {
      // SetMember
      const val = stack.pop() ?? 'undefined';
      const prop = (stack.pop() ?? '"prop"').replace(/^"|"$/g, '');
      const obj = stack.pop() ?? 'this';
      statements.push(`${obj}.${prop} = ${val};`);
      comment = `${obj}.${prop} = ${val}`;
    } else if (opcode === 0x0a || opcode === 0x47 || opcode === 0x21) {
      const b = stack.pop() ?? '0';
      const a = stack.pop() ?? '0';
      stack.push(`${a} + ${b}`);
    } else if (opcode === 0x0b) {
      const b = stack.pop() ?? '0';
      const a = stack.pop() ?? '0';
      stack.push(`${a} - ${b}`);
    } else if (opcode === 0x0c) {
      const b = stack.pop() ?? '1';
      const a = stack.pop() ?? '1';
      stack.push(`${a} * ${b}`);
    } else if (opcode === 0x0d) {
      const b = stack.pop() ?? '1';
      const a = stack.pop() ?? '1';
      stack.push(`${a} / ${b}`);
    } else if (opcode === 0x52) {
      // ActionCallMethod
      const method = (stack.pop() ?? '"method"').replace(/^"|"$/g, '');
      const obj = stack.pop() ?? 'this';
      const argcRaw = stack.pop() ?? '0';
      const argc = Math.max(0, Math.min(16, parseInt(argcRaw, 10) || 0));
      const args: string[] = [];
      for (let i = 0; i < argc; i++) args.push(stack.pop() ?? 'undefined');
      const callExpr = `${obj}.${method}(${args.join(', ')})`;
      stack.push(callExpr);
      comment = callExpr;
    } else if (opcode === 0x3d) {
      // ActionCallFunction
      const fn = (stack.pop() ?? '"fn"').replace(/^"|"$/g, '');
      const argcRaw = stack.pop() ?? '0';
      const argc = Math.max(0, Math.min(16, parseInt(argcRaw, 10) || 0));
      const args: string[] = [];
      for (let i = 0; i < argc; i++) args.push(stack.pop() ?? 'undefined');
      const callExpr = `${fn}(${args.join(', ')})`;
      stack.push(callExpr);
      comment = callExpr;
    } else if (opcode === 0x17) {
      // ActionPop
      const popped = stack.pop();
      if (popped && !popped.startsWith('"') && popped.includes('(')) {
        statements.push(`${popped};`);
      }
    } else if (opcode === 0x26) {
      // ActionTrace
      const msg = stack.pop() ?? '""';
      statements.push(`trace(${msg});`);
      comment = `trace(${msg})`;
    } else if (opcode === 0x06) {
      statements.push('play();');
    } else if (opcode === 0x07) {
      statements.push('stop();');
    } else if (opcode === 0x09) {
      statements.push('stopAllSounds();');
    } else if (opcode === 0x81 && pos + 1 < dataEnd) {
      const frame = (payload[pos] | (payload[pos + 1] << 8)) + 1;
      operands = `frame ${frame}`;
      statements.push(`gotoAndStop(${frame});`);
    } else if (opcode === 0x8c) {
      const lbl = readCString(payload, pos).value;
      operands = JSON.stringify(lbl);
      statements.push(`gotoAndPlay(${JSON.stringify(lbl)});`);
    } else if (opcode === 0x99 && pos + 1 < dataEnd) {
      const offsetDelta = new DataView(payload.buffer, payload.byteOffset + pos, 2).getInt16(0, true);
      operands = `${offsetDelta >= 0 ? '+' : ''}${offsetDelta}`;
    } else if (opcode === 0x9d && pos + 1 < dataEnd) {
      const offsetDelta = new DataView(payload.buffer, payload.byteOffset + pos, 2).getInt16(0, true);
      const cond = stack.pop() ?? 'condition';
      operands = `${offsetDelta >= 0 ? '+' : ''}${offsetDelta}`;
      statements.push(`if (${cond}) { /* branch ${operands} */ }`);
    }

    pcodeLines.push({
      index: lineIndex++,
      offset: tagOffset + instrStart,
      hexBytes: toHexBytes(payload, instrStart, Math.min(12, dataEnd - instrStart)),
      opcode,
      opcodeName,
      operands,
      comment,
      sourceLineHint: statements.length + 3,
    });

    pos = dataEnd;
  }

  const headerComment = isInitAction
    ? `// AVM1 DoInitAction (Sprite ID: ${spriteId}) — Tag #${tagIndex} @ 0x${tagOffset.toString(16).toUpperCase()}`
    : `// AVM1 Frame ActionScript (DoAction) — Tag #${tagIndex} @ 0x${tagOffset.toString(16).toUpperCase()}`;

  const bodyLines =
    statements.length > 0
      ? statements.map((s) => `  ${s}`).join('\n')
      : '  // Stack operations disassembled in P-Code pane';

  const decompiledSource = `${headerComment}\nfunction onFrameTimeline():Void {\n${bodyLines}\n}\n`;

  const scriptName = isInitAction ? `InitAction_Sprite_${spriteId}` : `FrameActions_Tag${tagIndex}`;

  return {
    id: `avm1-${tagIndex}`,
    name: scriptName,
    packagePath: 'timeline.avm1',
    fullName: `timeline.avm1.${scriptName}`,
    vmType: 'AVM1',
    kind: 'FrameScript',
    tagIndex,
    tagName,
    byteOffset: tagOffset,
    byteLength: payload.length,
    decompiledSource,
    pcodeLines,
    constantsReferenced: constantPool,
    methodsCount: 1,
    traitsCount: constantPool.length,
  };
}

/**
 * AVM2 (ActionScript 3 / DoABC) Binary Reader, Disassembler & Decompiler
 */
class AbcReader {
  private data: Uint8Array;
  public pos: number;

  constructor(data: Uint8Array, start = 0) {
    this.data = data;
    this.pos = start;
  }

  readU8(): number {
    return this.pos < this.data.length ? this.data[this.pos++] : 0;
  }

  readU16(): number {
    if (this.pos + 1 >= this.data.length) return 0;
    const v = this.data[this.pos] | (this.data[this.pos + 1] << 8);
    this.pos += 2;
    return v >>> 0;
  }

  readS24(): number {
    if (this.pos + 2 >= this.data.length) return 0;
    const v = this.data[this.pos] | (this.data[this.pos + 1] << 8) | (this.data[this.pos + 2] << 16);
    this.pos += 3;
    return v & 0x800000 ? v - 0x1000000 : v;
  }

  readU32(): number {
    if (this.pos + 3 >= this.data.length) return 0;
    const v =
      this.data[this.pos] |
      (this.data[this.pos + 1] << 8) |
      (this.data[this.pos + 2] << 16) |
      (this.data[this.pos + 3] << 24);
    this.pos += 4;
    return v >>> 0;
  }

  readU30(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      if (this.pos >= this.data.length) break;
      const b = this.data[this.pos++];
      result |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  readS32(): number {
    return this.readU30() | 0;
  }

  readDouble(): number {
    if (this.pos + 7 >= this.data.length) return 0;
    const v = new DataView(this.data.buffer, this.data.byteOffset + this.pos, 8).getFloat64(0, true);
    this.pos += 8;
    return v;
  }

  readCString(): string {
    const res = readCString(this.data, this.pos);
    this.pos = res.nextOffset;
    return res.value;
  }

  readAbcString(): string {
    const len = this.readU30();
    const end = Math.min(this.data.length, this.pos + len);
    const s = new TextDecoder().decode(this.data.subarray(this.pos, end));
    this.pos = end;
    return s;
  }
}

function disassembleAvm2MethodBody(
  codeBytes: Uint8Array,
  baseOffset: number,
  pool: AbcConstantPool
): { pcode: PCodeLine[]; statements: string[] } {
  const r = new AbcReader(codeBytes, 0);
  const pcode: PCodeLine[] = [];
  const stack: string[] = [];
  const statements: string[] = [];
  let idx = 0;

  const str = (i: number) => (i > 0 && i <= pool.strings.length ? pool.strings[i - 1] : `str#${i}`);
  const mname = (i: number) => (i > 0 && i <= pool.multinames.length ? pool.multinames[i - 1].name : `mn#${i}`);
  const dbl = (i: number) => (i > 0 && i <= pool.doubles.length ? pool.doubles[i - 1] : 0);

  while (r.pos < codeBytes.length) {
    const start = r.pos;
    const op = r.readU8();
    let opName = `op_0x${op.toString(16).padStart(2, '0')}`;
    let operands = '';
    let comment: string | undefined;

    switch (op) {
      case 0x10: {
        opName = 'jump';
        const delta = r.readS24();
        operands = `${delta >= 0 ? '+' : ''}${delta}`;
        break;
      }
      case 0x11:
      case 0x12:
      case 0x13:
      case 0x14:
      case 0x15:
      case 0x16: {
        const names: Record<number, string> = {
          0x11: 'iftrue',
          0x12: 'iffalse',
          0x13: 'ifeq',
          0x14: 'ifne',
          0x15: 'iflt',
          0x16: 'ifle',
        };
        opName = names[op];
        const delta = r.readS24();
        operands = `${delta >= 0 ? '+' : ''}${delta}`;
        break;
      }
      case 0x1d:
        opName = 'popscope';
        break;
      case 0x20:
        opName = 'pushnull';
        stack.push('null');
        break;
      case 0x21:
        opName = 'pushundefined';
        stack.push('undefined');
        break;
      case 0x24: {
        opName = 'pushbyte';
        const b = (r.readU8() << 24) >> 24;
        operands = `${b}`;
        stack.push(`${b}`);
        break;
      }
      case 0x25: {
        opName = 'pushshort';
        const s = r.readU30();
        operands = `${s}`;
        stack.push(`${s}`);
        break;
      }
      case 0x26:
        opName = 'pushtrue';
        stack.push('true');
        break;
      case 0x27:
        opName = 'pushfalse';
        stack.push('false');
        break;
      case 0x28:
        opName = 'pushnan';
        stack.push('NaN');
        break;
      case 0x29:
        opName = 'pop';
        break;
      case 0x2a: {
        opName = 'dup';
        const top = stack[stack.length - 1] ?? 'this';
        stack.push(top);
        break;
      }
      case 0x2c: {
        opName = 'pushstring';
        const sIdx = r.readU30();
        const val = JSON.stringify(str(sIdx));
        operands = `${val}`;
        stack.push(val);
        break;
      }
      case 0x2d: {
        opName = 'pushint';
        const iIdx = r.readU30();
        const val = pool.integers[iIdx - 1] ?? 0;
        operands = `${val}`;
        stack.push(`${val}`);
        break;
      }
      case 0x2e: {
        opName = 'pushuint';
        const uIdx = r.readU30();
        const val = pool.uintegers[uIdx - 1] ?? 0;
        operands = `0x${val.toString(16)}`;
        stack.push(`0x${val.toString(16)}`);
        break;
      }
      case 0x2f: {
        opName = 'pushdouble';
        const dIdx = r.readU30();
        const val = dbl(dIdx);
        operands = `${val}`;
        stack.push(`${val}`);
        break;
      }
      case 0x30:
        opName = 'pushscope';
        stack.pop();
        break;
      case 0x46: {
        opName = 'callproperty';
        const mn = mname(r.readU30());
        const argc = r.readU30();
        const args: string[] = [];
        for (let i = 0; i < argc; i++) args.unshift(stack.pop() ?? 'arg');
        const obj = stack.pop() ?? 'this';
        const target = obj === 'this' ? mn : `${obj}.${mn}`;
        const call = `${target}(${args.join(', ')})`;
        operands = `${mn}, ${argc}`;
        comment = call;
        stack.push(call);
        statements.push(`${call};`);
        break;
      }
      case 0x47:
        opName = 'returnvoid';
        break;
      case 0x48: {
        opName = 'returnvalue';
        const ret = stack.pop() ?? 'result';
        statements.push(`return ${ret};`);
        comment = `return ${ret}`;
        break;
      }
      case 0x49: {
        opName = 'constructsuper';
        const argc = r.readU30();
        const args: string[] = [];
        for (let i = 0; i < argc; i++) args.unshift(stack.pop() ?? 'arg');
        stack.pop();
        operands = `${argc}`;
        statements.push(`super(${args.join(', ')});`);
        break;
      }
      case 0x4f: {
        opName = 'callpropvoid';
        const mn = mname(r.readU30());
        const argc = r.readU30();
        const args: string[] = [];
        for (let i = 0; i < argc; i++) args.unshift(stack.pop() ?? 'arg');
        const obj = stack.pop() ?? 'this';
        const target = obj === 'this' ? mn : `${obj}.${mn}`;
        const call = `${target}(${args.join(', ')})`;
        operands = `${mn}, ${argc}`;
        comment = call;
        statements.push(`${call};`);
        break;
      }
      case 0x58: {
        opName = 'newclass';
        const cIdx = r.readU30();
        operands = `class#${cIdx}`;
        break;
      }
      case 0x5d: {
        opName = 'findpropstrict';
        const mn = mname(r.readU30());
        operands = mn;
        stack.push('this');
        break;
      }
      case 0x5e: {
        opName = 'findproperty';
        const mn = mname(r.readU30());
        operands = mn;
        stack.push('this');
        break;
      }
      case 0x60: {
        opName = 'getlex';
        const mn = mname(r.readU30());
        operands = mn;
        stack.push(mn);
        break;
      }
      case 0x61:
      case 0x68: {
        opName = op === 0x68 ? 'initproperty' : 'setproperty';
        const mn = mname(r.readU30());
        const val = stack.pop() ?? 'value';
        const obj = stack.pop() ?? 'this';
        const lhs = obj === 'this' ? `this.${mn}` : `${obj}.${mn}`;
        operands = mn;
        comment = `${lhs} = ${val}`;
        statements.push(`${lhs} = ${val};`);
        break;
      }
      case 0x62: {
        opName = 'getlocal';
        const reg = r.readU30();
        operands = `loc_${reg}`;
        stack.push(reg === 0 ? 'this' : `param${reg}`);
        break;
      }
      case 0x63: {
        opName = 'setlocal';
        const reg = r.readU30();
        const val = stack.pop() ?? 'val';
        operands = `loc_${reg}`;
        statements.push(`var loc_${reg}:* = ${val};`);
        break;
      }
      case 0x65: {
        opName = 'getscopeobject';
        operands = `${r.readU8()}`;
        stack.push('this');
        break;
      }
      case 0x66: {
        opName = 'getproperty';
        const mn = mname(r.readU30());
        const obj = stack.pop() ?? 'this';
        const expr = obj === 'this' ? `this.${mn}` : `${obj}.${mn}`;
        operands = mn;
        stack.push(expr);
        break;
      }
      case 0xa0: {
        opName = 'add';
        const b = stack.pop() ?? '0';
        const a = stack.pop() ?? '0';
        stack.push(`(${a} + ${b})`);
        break;
      }
      case 0xa1: {
        opName = 'subtract';
        const b = stack.pop() ?? '0';
        const a = stack.pop() ?? '0';
        stack.push(`(${a} - ${b})`);
        break;
      }
      case 0xa2: {
        opName = 'multiply';
        const b = stack.pop() ?? '1';
        const a = stack.pop() ?? '1';
        stack.push(`(${a} * ${b})`);
        break;
      }
      case 0xa3: {
        opName = 'divide';
        const b = stack.pop() ?? '1';
        const a = stack.pop() ?? '1';
        stack.push(`(${a} / ${b})`);
        break;
      }
      case 0xd0:
        opName = 'getlocal_0';
        stack.push('this');
        break;
      case 0xd1:
        opName = 'getlocal_1';
        stack.push('param1');
        break;
      case 0xd2:
        opName = 'getlocal_2';
        stack.push('param2');
        break;
      case 0xd3:
        opName = 'getlocal_3';
        stack.push('param3');
        break;
      case 0xd4:
      case 0xd5:
      case 0xd6:
      case 0xd7: {
        const regIdx = op - 0xd4;
        opName = `setlocal_${regIdx}`;
        const val = stack.pop() ?? 'val';
        statements.push(`loc_${regIdx} = ${val};`);
        break;
      }
      default:
        break;
    }

    pcode.push({
      index: idx++,
      offset: baseOffset + start,
      hexBytes: toHexBytes(codeBytes, start, Math.max(1, r.pos - start)),
      opcode: op,
      opcodeName: opName,
      operands,
      comment,
    });
  }

  return { pcode, statements };
}

function parseDoAbcTag(
  payload: Uint8Array,
  tagIndex: number,
  tagName: string,
  tagOffset: number,
  isExtendedDoAbc: boolean
): { pool: AbcConstantPool; units: ActionScriptUnit[] } {
  const r = new AbcReader(payload, 0);
  let abcName = `abc_block_${tagIndex}`;
  if (isExtendedDoAbc) {
    r.readU32(); // flags
    abcName = r.readCString() || abcName;
  }

  const minorVersion = r.readU16();
  const majorVersion = r.readU16();

  // 1. Integers
  const intCount = r.readU30();
  const integers: number[] = [];
  for (let i = 1; i < intCount; i++) integers.push(r.readS32());

  // 2. UIntegers
  const uintCount = r.readU30();
  const uintegers: number[] = [];
  for (let i = 1; i < uintCount; i++) uintegers.push(r.readU30());

  // 3. Doubles
  const doubleCount = r.readU30();
  const doubles: number[] = [];
  for (let i = 1; i < doubleCount; i++) doubles.push(r.readDouble());

  // 4. Strings
  const stringCount = r.readU30();
  const strings: string[] = [];
  for (let i = 1; i < stringCount; i++) strings.push(r.readAbcString());

  const getStr = (idx: number) => (idx > 0 && idx <= strings.length ? strings[idx - 1] : '*');

  // 5. Namespaces
  const nsCount = r.readU30();
  const namespaces: AbcNamespaceEntry[] = [];
  const nsKindNames: Record<number, string> = {
    0x08: 'Namespace',
    0x16: 'PackageNamespace',
    0x17: 'PackageInternalNs',
    0x18: 'ProtectedNamespace',
    0x19: 'ExplicitNamespace',
    0x1a: 'StaticProtectedNs',
    0x05: 'PrivateNs',
  };
  for (let i = 1; i < nsCount; i++) {
    const kind = r.readU8();
    const nameIdx = r.readU30();
    namespaces.push({
      index: i,
      kindName: nsKindNames[kind] ?? `NS_0x${kind.toString(16)}`,
      name: nameIdx === 0 ? '' : getStr(nameIdx),
    });
  }

  const getNs = (idx: number) => (idx > 0 && idx <= namespaces.length ? namespaces[idx - 1].name : '');

  // 6. Namespace sets
  const nsSetCount = r.readU30();
  for (let i = 1; i < nsSetCount; i++) {
    const c = r.readU30();
    for (let j = 0; j < c; j++) r.readU30();
  }

  // 7. Multinames
  const mnCount = r.readU30();
  const multinames: AbcMultinameEntry[] = [];
  for (let i = 1; i < mnCount; i++) {
    const kind = r.readU8();
    let name = '*';
    let namespace = '';
    let kindName = 'QName';
    if (kind === 0x07 || kind === 0x0d) {
      kindName = kind === 0x07 ? 'QName' : 'QNameA';
      const nsIdx = r.readU30();
      const nameIdx = r.readU30();
      namespace = getNs(nsIdx);
      name = getStr(nameIdx);
    } else if (kind === 0x0f || kind === 0x10) {
      kindName = 'RTQName';
      name = getStr(r.readU30());
    } else if (kind === 0x11 || kind === 0x12) {
      kindName = 'RTQNameL';
    } else if (kind === 0x09 || kind === 0x0e) {
      kindName = 'Multiname';
      name = getStr(r.readU30());
      r.readU30(); // ns_set
    } else if (kind === 0x1b || kind === 0x1c) {
      kindName = 'MultinameL';
      r.readU30(); // ns_set
    } else if (kind === 0x1d) {
      kindName = 'TypeName';
      const baseMn = r.readU30();
      const paramCount = r.readU30();
      for (let p = 0; p < paramCount; p++) r.readU30();
      name = multinames[baseMn - 1]?.name ?? 'Vector';
    }
    multinames.push({ index: i, kindName, name, namespace });
  }

  const getMn = (idx: number) => (idx > 0 && idx <= multinames.length ? multinames[idx - 1] : { name: '*', namespace: '', kindName: 'Any', index: 0 });

  // 8. Method Signatures
  const methodCount = r.readU30();
  const methods: AbcMethodSignature[] = [];
  for (let i = 0; i < methodCount; i++) {
    const paramCount = r.readU30();
    const returnTypeIdx = r.readU30();
    const paramTypes: string[] = [];
    for (let p = 0; p < paramCount; p++) {
      paramTypes.push(getMn(r.readU30()).name);
    }
    const nameIdx = r.readU30();
    const flagsByte = r.readU8();
    if (flagsByte & 0x08) {
      const optCount = r.readU30();
      for (let o = 0; o < optCount; o++) {
        r.readU30();
        r.readU8();
      }
    }
    if (flagsByte & 0x80) {
      for (let p = 0; p < paramCount; p++) r.readU30();
    }
    methods.push({
      index: i,
      name: nameIdx > 0 ? getStr(nameIdx) : `method_${i}`,
      paramTypes,
      returnType: returnTypeIdx === 0 ? '*' : getMn(returnTypeIdx).name,
      flags: [],
    });
  }

  // 9. Metadata
  const metadataCount = r.readU30();
  for (let i = 0; i < metadataCount; i++) {
    r.readU30();
    const itemCount = r.readU30();
    for (let j = 0; j < itemCount; j++) {
      r.readU30();
      r.readU30();
    }
  }

  // Helper to read Traits
  interface ParsedTrait {
    name: string;
    kind: number;
    typeName: string;
    methodIndex?: number;
  }
  const readTraits = (): ParsedTrait[] => {
    const count = r.readU30();
    const list: ParsedTrait[] = [];
    for (let i = 0; i < count; i++) {
      const nameMn = getMn(r.readU30());
      const kindByte = r.readU8();
      const kind = kindByte & 0x0f;
      const attrs = kindByte >>> 4;
      let typeName = '*';
      let methodIndex: number | undefined;
      if (kind === 0 || kind === 6) {
        // Slot or Const
        r.readU30(); // slot_id
        typeName = getMn(r.readU30()).name;
        const vindex = r.readU30();
        if (vindex !== 0) r.readU8(); // vkind
      } else if (kind === 1 || kind === 2 || kind === 3) {
        // Method / Getter / Setter
        r.readU30(); // disp_id
        methodIndex = r.readU30();
      } else if (kind === 4) {
        // Class
        r.readU30(); // slot_id
        r.readU30(); // classi
      } else if (kind === 5) {
        // Function
        r.readU30(); // slot_id
        methodIndex = r.readU30();
      }
      if (attrs & 0x04) {
        const mdCount = r.readU30();
        for (let m = 0; m < mdCount; m++) r.readU30();
      }
      list.push({ name: nameMn.name, kind, typeName, methodIndex });
    }
    return list;
  };

  // 10. Instances & Classes
  const classCount = r.readU30();
  interface ParsedClassInfo {
    name: string;
    packagePath: string;
    superName: string;
    superPackage: string;
    iinitIndex: number;
    cinitIndex: number;
    instanceTraits: ParsedTrait[];
    classTraits: ParsedTrait[];
  }
  const classes: ParsedClassInfo[] = [];

  for (let i = 0; i < classCount; i++) {
    const mn = getMn(r.readU30());
    const superMn = getMn(r.readU30());
    const flags = r.readU8();
    if (flags & 0x08) r.readU30(); // protectedNs
    const intrfCount = r.readU30();
    for (let j = 0; j < intrfCount; j++) r.readU30();
    const iinitIndex = r.readU30();
    const instanceTraits = readTraits();
    classes.push({
      name: mn.name,
      packagePath: mn.namespace || 'default',
      superName: superMn.name,
      superPackage: superMn.namespace,
      iinitIndex,
      cinitIndex: 0,
      instanceTraits,
      classTraits: [],
    });
  }

  for (let i = 0; i < classCount; i++) {
    classes[i].cinitIndex = r.readU30();
    classes[i].classTraits = readTraits();
  }

  // 11. Scripts
  const scriptCount = r.readU30();
  for (let i = 0; i < scriptCount; i++) {
    r.readU30(); // init
    readTraits();
  }

  // 12. Method Bodies
  const bodyCount = r.readU30();
  const pool: AbcConstantPool = {
    sourceTagIndex: tagIndex,
    abcName,
    minorVersion,
    majorVersion,
    integers,
    uintegers,
    doubles,
    strings,
    namespaces,
    multinames,
    methods,
  };

  const methodBodiesMap = new Map<number, { pcode: PCodeLine[]; statements: string[] }>();

  for (let i = 0; i < bodyCount && r.pos < payload.length; i++) {
    const methodIdx = r.readU30();
    r.readU30(); // max_stack
    r.readU30(); // local_count
    r.readU30(); // init_scope_depth
    r.readU30(); // max_scope_depth
    const codeLength = r.readU30();
    const codeStart = r.pos;
    const codeSlice = payload.subarray(codeStart, Math.min(payload.length, codeStart + codeLength));
    r.pos = Math.min(payload.length, codeStart + codeLength);

    const dis = disassembleAvm2MethodBody(codeSlice, tagOffset + codeStart, pool);
    methodBodiesMap.set(methodIdx, dis);

    const excCount = r.readU30();
    for (let e = 0; e < excCount; e++) {
      r.readU30();
      r.readU30();
      r.readU30();
      r.readU30();
      r.readU30();
    }
    readTraits();
  }

  // Build ActionScript 3 Class Units
  const units: ActionScriptUnit[] = [];
  for (let c = 0; c < classes.length; c++) {
    const cls = classes[c];
    const allPcode: PCodeLine[] = [];
    const lines: string[] = [];

    lines.push(`package ${cls.packagePath === 'default' ? '' : cls.packagePath} {`);
    if (cls.superPackage && cls.superPackage !== cls.packagePath) {
      lines.push(`  import ${cls.superPackage}.${cls.superName};`);
    }
    lines.push('');
    const extClause = cls.superName && cls.superName !== 'Object' && cls.superName !== '*' ? ` extends ${cls.superName}` : '';
    lines.push(`  public class ${cls.name}${extClause} {`);

    // Properties / Slots
    const slotTraits = cls.instanceTraits.filter((t) => t.kind === 0 || t.kind === 6);
    for (const slot of slotTraits) {
      const kw = slot.kind === 6 ? 'const' : 'var';
      lines.push(`    public ${kw} ${slot.name}:${slot.typeName};`);
    }
    if (slotTraits.length > 0) lines.push('');

    // Constructor
    const ctorBody = methodBodiesMap.get(cls.iinitIndex);
    const ctorSig = methods[cls.iinitIndex];
    const ctorParams =
      ctorSig?.paramTypes.map((pt, idx) => `param${idx + 1}:${pt}`).join(', ') ?? '';
    lines.push(`    public function ${cls.name}(${ctorParams}) {`);
    if (ctorBody) {
      for (const st of ctorBody.statements) {
        lines.push(`      ${st}`);
      }
      for (const pc of ctorBody.pcode) {
        allPcode.push({ ...pc, comment: pc.comment ? `[${cls.name}::ctor] ${pc.comment}` : `[${cls.name}::ctor]` });
      }
    } else {
      lines.push(`      super();`);
    }
    lines.push(`    }`);

    // Methods
    const methodTraits = cls.instanceTraits.filter((t) => t.kind === 1 || t.kind === 2 || t.kind === 3);
    for (const mt of methodTraits) {
      lines.push('');
      const sig = mt.methodIndex !== undefined ? methods[mt.methodIndex] : undefined;
      const params =
        sig?.paramTypes.map((pt, idx) => `param${idx + 1}:${pt}`).join(', ') ?? '';
      const retType = sig?.returnType ?? 'void';
      lines.push(`    public function ${mt.name}(${params}):${retType} {`);
      const mBody = mt.methodIndex !== undefined ? methodBodiesMap.get(mt.methodIndex) : undefined;
      if (mBody && mBody.statements.length > 0) {
        for (const st of mBody.statements) {
          lines.push(`      ${st}`);
        }
      } else {
        lines.push(`      // Disassembled in AVM2 P-Code view`);
      }
      if (mBody) {
        for (const pc of mBody.pcode) {
          allPcode.push({
            ...pc,
            comment: pc.comment ? `[${mt.name}] ${pc.comment}` : `[${mt.name}]`,
          });
        }
      }
      lines.push(`    }`);
    }

    lines.push(`  }`);
    lines.push(`}`);

    units.push({
      id: `avm2-${tagIndex}-${c}`,
      name: cls.name,
      packagePath: cls.packagePath,
      fullName: cls.packagePath && cls.packagePath !== 'default' ? `${cls.packagePath}.${cls.name}` : cls.name,
      vmType: 'AVM2',
      kind: 'Class',
      tagIndex,
      tagName,
      byteOffset: tagOffset,
      byteLength: payload.length,
      decompiledSource: lines.join('\n'),
      pcodeLines: allPcode,
      constantsReferenced: strings.filter((s) => s.length > 0),
      methodsCount: methodTraits.length + 1,
      traitsCount: cls.instanceTraits.length + cls.classTraits.length,
    });
  }

  return { pool, units };
}

/**
 * Vector DefineShape Binary Parser -> SVG Renderer
 */
function parseDefineShapeToSvg(payload: Uint8Array, tagCode: number, tagIndex: number): ExtractedAsset | null {
  if (payload.length < 10) return null;
  const br = new BitReader(payload, 0);
  const shapeId = br.readU16LE();
  const bounds = br.readRect();

  // FillStyleArray
  let fillCount = br.readU8();
  if (fillCount === 0xff && tagCode >= 22) {
    fillCount = br.readU16LE();
  }
  const fillColors: string[] = ['#F59E0B'];
  for (let i = 0; i < fillCount; i++) {
    const type = br.readU8();
    if (type === 0x00) {
      const r = br.readU8();
      const g = br.readU8();
      const b = br.readU8();
      if (tagCode >= 32) br.readU8(); // RGBA
      fillColors.push(`rgb(${r}, ${g}, ${b})`);
    } else {
      break;
    }
  }

  // LineStyleArray
  let lineCount = br.readU8();
  if (lineCount === 0xff) lineCount = br.readU16LE();
  const strokeColors: string[] = ['#F8FAFC'];
  let strokeWidthPx = 2;
  for (let i = 0; i < lineCount; i++) {
    const widthTwips = br.readU16LE();
    strokeWidthPx = Math.max(1.5, Math.round(widthTwips / 20));
    const r = br.readU8();
    const g = br.readU8();
    const b = br.readU8();
    if (tagCode >= 32) br.readU8();
    strokeColors.push(`rgb(${r}, ${g}, ${b})`);
  }

  const numFillBits = br.readUBits(4);
  const numLineBits = br.readUBits(4);

  let curX = 0;
  let curY = 0;
  const pathCommands: string[] = [];

  let safety = 0;
  while (br.byteOffset < payload.length && safety++ < 2000) {
    const typeFlag = br.readUBits(1);
    if (typeFlag === 0) {
      const stateNewStyles = br.readUBits(1);
      const stateLineStyle = br.readUBits(1);
      const stateFillStyle1 = br.readUBits(1);
      const stateFillStyle0 = br.readUBits(1);
      const stateMoveTo = br.readUBits(1);

      if (
        stateNewStyles === 0 &&
        stateLineStyle === 0 &&
        stateFillStyle1 === 0 &&
        stateFillStyle0 === 0 &&
        stateMoveTo === 0
      ) {
        break; // EndShapeRecord
      }
      if (stateMoveTo) {
        const moveBits = br.readUBits(5);
        curX = br.readSBits(moveBits);
        curY = br.readSBits(moveBits);
        pathCommands.push(`M ${(curX / 20).toFixed(1)} ${(curY / 20).toFixed(1)}`);
      }
      if (stateFillStyle0) br.readUBits(numFillBits);
      if (stateFillStyle1) br.readUBits(numFillBits);
      if (stateLineStyle) br.readUBits(numLineBits);
      if (stateNewStyles) break;
    } else {
      const straightFlag = br.readUBits(1);
      const numBits = br.readUBits(4) + 2;
      if (straightFlag === 1) {
        const generalLineFlag = br.readUBits(1);
        let dx = 0;
        let dy = 0;
        if (generalLineFlag === 1) {
          dx = br.readSBits(numBits);
          dy = br.readSBits(numBits);
        } else {
          const vertFlag = br.readUBits(1);
          if (vertFlag === 0) dx = br.readSBits(numBits);
          else dy = br.readSBits(numBits);
        }
        curX += dx;
        curY += dy;
        pathCommands.push(`L ${(curX / 20).toFixed(1)} ${(curY / 20).toFixed(1)}`);
      } else {
        const cdx = br.readSBits(numBits);
        const cdy = br.readSBits(numBits);
        const adx = br.readSBits(numBits);
        const ady = br.readSBits(numBits);
        const cx = curX + cdx;
        const cy = curY + cdy;
        curX = cx + adx;
        curY = cy + ady;
        pathCommands.push(
          `Q ${(cx / 20).toFixed(1)} ${(cy / 20).toFixed(1)} ${(curX / 20).toFixed(1)} ${(curY / 20).toFixed(1)}`
        );
      }
    }
  }

  if (pathCommands.length > 1) {
    pathCommands.push('Z');
  }

  const w = Math.max(60, bounds.widthPx);
  const h = Math.max(60, bounds.heightPx);
  const fill = fillColors[fillColors.length - 1] ?? '#F59E0B';
  const stroke = strokeColors[strokeColors.length - 1] ?? '#FEF3C7';
  const d =
    pathCommands.length > 0
      ? pathCommands.join(' ')
      : `M ${w * 0.5} ${h * 0.15} L ${w * 0.85} ${h * 0.8} L ${w * 0.15} ${h * 0.8} Z`;

  const svgMarkup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">
  <path d="${d}" fill="${fill}" fill-opacity="0.88" stroke="${stroke}" stroke-width="${strokeWidthPx}" stroke-linejoin="round" />
</svg>`;

  return {
    id: `shape-${shapeId}-${tagIndex}`,
    characterId: shapeId,
    name: `Shape_${shapeId}`,
    type: 'shape-svg',
    mimeType: 'image/svg+xml',
    extension: 'svg',
    tagIndex,
    tagName: SWF_TAG_NAMES[tagCode]?.name ?? 'DefineShape',
    byteLength: payload.length,
    dimensions: `${w} × ${h} px`,
    details: `${pathCommands.length} vector edge records · Fill ${fill}`,
    svgMarkup,
    rawBytes: new TextEncoder().encode(svgMarkup),
  };
}

/**
 * Wrap 8-bit Mono PCM into playable WAV Data URL for DefineSound preview
 */
function wrapPcm8ToWavBytes(pcmData: Uint8Array, sampleRate: number): Uint8Array {
  const wav = new Uint8Array(44 + pcmData.length);
  const view = new DataView(wav.buffer);
  const writeAscii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) wav[off + i] = s.charCodeAt(i);
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcmData.length, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // AudioFormat = 1 (PCM)
  view.setUint16(22, 1, true); // NumChannels = 1
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // ByteRate
  view.setUint16(32, 1, true); // BlockAlign
  view.setUint16(34, 8, true); // BitsPerSample
  writeAscii(36, 'data');
  view.setUint32(40, pcmData.length, true);
  wav.set(pcmData, 44);
  return wav;
}

/**
 * Main Binary SWF Parser Entry Point
 */
export async function parseSwfBinary(
  rawBytes: Uint8Array,
  fileName: string
): Promise<ParsedSwfFile> {
  if (rawBytes.length < 8) {
    throw new Error('Invalid SWF file: Binary stream is shorter than 8-byte SWF header.');
  }

  const sig = String.fromCharCode(rawBytes[0], rawBytes[1], rawBytes[2]);
  if (sig !== 'FWS' && sig !== 'CWS' && sig !== 'ZWS') {
    throw new Error(
      `Unsupported magic signature "${sig}" (0x${toHexBytes(rawBytes, 0, 3)}). Expected FWS (uncompressed), CWS (zlib), or ZWS (LZMA).`
    );
  }

  const version = rawBytes[3];
  const uncompressedFileLength =
    (rawBytes[4] |
      (rawBytes[5] << 8) |
      (rawBytes[6] << 16) |
      (rawBytes[7] << 24)) >>>
    0;

  const warnings: string[] = [];
  let uncompressedBytes: Uint8Array;

  if (sig === 'CWS') {
    const inflatedBody = await inflateZlibStream(rawBytes.subarray(8));
    uncompressedBytes = new Uint8Array(8 + inflatedBody.length);
    uncompressedBytes.set(rawBytes.subarray(0, 8), 0);
    uncompressedBytes[0] = 0x46; // 'F'
    uncompressedBytes.set(inflatedBody, 8);
  } else if (sig === 'ZWS') {
    warnings.push('ZWS (LZMA) compression detected; inspecting raw header and unencrypted segments.');
    uncompressedBytes = rawBytes;
  } else {
    uncompressedBytes = rawBytes;
  }

  const br = new BitReader(uncompressedBytes, 8);
  const frameSize = br.readRect();
  const rawFrameRate = br.readU16LE();
  const frameRate = Number((rawFrameRate / 256).toFixed(2)) || 30;
  const frameCount = br.readU16LE();

  const tags: SwfTag[] = [];
  const scripts: ActionScriptUnit[] = [];
  const constantPools: AbcConstantPool[] = [];
  const assets: ExtractedAsset[] = [];

  let backgroundColor = '#0F172A';
  let useNetwork = false;
  let actionScript3 = false;
  let hasMetadata = false;

  let tagIndex = 0;
  while (br.byteOffset + 2 <= uncompressedBytes.length) {
    const tagStartOffset = br.byteOffset;
    const tagCodeAndLength = br.readU16LE();
    const tagCode = tagCodeAndLength >>> 6;
    let tagLength = tagCodeAndLength & 0x3f;
    let isLongHeader = false;
    if (tagLength === 0x3f) {
      isLongHeader = true;
      tagLength = br.readU32LE();
    }

    const headerLength = br.byteOffset - tagStartOffset;
    const payloadEnd = Math.min(uncompressedBytes.length, br.byteOffset + tagLength);
    const payload = uncompressedBytes.subarray(br.byteOffset, payloadEnd);
    br.byteOffset = payloadEnd;

    const meta = SWF_TAG_NAMES[tagCode] ?? {
      name: `UnknownTag_${tagCode}`,
      category: 'Metadata' as const,
    };

    const fields: SwfTagField[] = [];
    let summary = `${payload.length} bytes`;

    if (tagCode === 69 && payload.length >= 1) {
      // FileAttributes
      const flags = payload[0];
      useNetwork = Boolean(flags & 0x01);
      actionScript3 = Boolean(flags & 0x08);
      hasMetadata = Boolean(flags & 0x10);
      summary = `AS3=${actionScript3}, UseNetwork=${useNetwork}, HasMetadata=${hasMetadata}`;
      fields.push(
        { label: 'ActionScript 3.0 (AVM2)', value: String(actionScript3) },
        { label: 'UseNetwork', value: String(useNetwork) },
        { label: 'HasMetadata', value: String(hasMetadata) }
      );
    } else if (tagCode === 9 && payload.length >= 3) {
      // SetBackgroundColor
      const hex = `#${payload[0].toString(16).padStart(2, '0')}${payload[1]
        .toString(16)
        .padStart(2, '0')}${payload[2].toString(16).padStart(2, '0')}`.toUpperCase();
      backgroundColor = hex;
      summary = `Stage Color ${hex}`;
      fields.push({ label: 'RGB Hex', value: hex });
    } else if (tagCode === 43 && payload.length > 0) {
      const lbl = readCString(payload, 0).value;
      summary = `Label "${lbl}"`;
      fields.push({ label: 'Frame Label', value: lbl });
    } else if (tagCode === 77 && payload.length > 0) {
      const xml = readCString(payload, 0).value;
      summary = xml.slice(0, 72) + (xml.length > 72 ? '...' : '');
      fields.push({ label: 'RDF Metadata XML', value: xml });
    } else if (tagCode === 76 && payload.length >= 2) {
      const count = payload[0] | (payload[1] << 8);
      let spos = 2;
      const bindings: string[] = [];
      for (let i = 0; i < count && spos + 2 <= payload.length; i++) {
        const cid = payload[spos] | (payload[spos + 1] << 8);
        const res = readCString(payload, spos + 2);
        spos = res.nextOffset;
        bindings.push(`#${cid} → ${res.value}`);
        fields.push({ label: `Symbol #${cid}`, value: res.value });
      }
      summary = bindings.join(', ');
    } else if (tagCode === 12 || tagCode === 59) {
      // DoAction / DoInitAction (AVM1)
      const unit = parseAvm1ActionBlock(
        payload,
        tagIndex,
        meta.name,
        tagStartOffset + headerLength,
        tagCode === 59
      );
      scripts.push(unit);
      summary = `${unit.pcodeLines.length} AVM1 instructions · ${unit.constantsReferenced.length} pool constants`;
      fields.push(
        { label: 'Virtual Machine', value: 'AVM1 (ActionScript 1.0 / 2.0)' },
        { label: 'P-Code Instructions', value: unit.pcodeLines.length },
        { label: 'Constant Pool Entries', value: unit.constantsReferenced.length }
      );
    } else if (tagCode === 82 || tagCode === 72) {
      // DoABC / DoABCDefine (AVM2)
      try {
        const { pool, units } = parseDoAbcTag(
          payload,
          tagIndex,
          meta.name,
          tagStartOffset + headerLength,
          tagCode === 82
        );
        constantPools.push(pool);
        scripts.push(...units);
        summary = `ABC "${pool.abcName}" · ${units.length} AS3 class(es) · ${pool.strings.length} strings`;
        fields.push(
          { label: 'Virtual Machine', value: `AVM2 (ABC ${pool.majorVersion}.${pool.minorVersion})` },
          { label: 'ABC Block Name', value: pool.abcName },
          { label: 'Classes Extracted', value: units.length },
          { label: 'String Pool Count', value: pool.strings.length },
          { label: 'Multiname Pool Count', value: pool.multinames.length }
        );
      } catch (err) {
        warnings.push(`Partial DoABC parse in tag #${tagIndex}: ${(err as Error).message}`);
      }
    } else if (tagCode === 2 || tagCode === 22 || tagCode === 32) {
      const shapeAsset = parseDefineShapeToSvg(payload, tagCode, tagIndex);
      if (shapeAsset) {
        assets.push(shapeAsset);
        summary = `Character #${shapeAsset.characterId} (${shapeAsset.dimensions})`;
        fields.push(
          { label: 'Character ID', value: shapeAsset.characterId },
          { label: 'Bounds', value: shapeAsset.dimensions ?? '' }
        );
      }
    } else if (tagCode === 14 && payload.length >= 7) {
      // DefineSound
      const soundId = payload[0] | (payload[1] << 8);
      const flags = payload[2];
      const formatCode = flags >>> 4;
      const rateCode = (flags >>> 2) & 0x03;
      const rates = [5512, 11025, 22050, 44100];
      const sampleRate = rates[rateCode] ?? 11025;
      const sampleCount =
        (payload[3] | (payload[4] << 8) | (payload[5] << 16) | (payload[6] << 24)) >>> 0;
      const audioPayload = payload.subarray(7);
      const isPcm = formatCode === 0 || formatCode === 3;
      const wavBytes = isPcm ? wrapPcm8ToWavBytes(audioPayload, sampleRate) : audioPayload;
      let binary = '';
      for (let i = 0; i < wavBytes.length; i++) binary += String.fromCharCode(wavBytes[i]);
      const mimeType = isPcm ? 'audio/wav' : 'audio/mpeg';
      const dataUrl = `data:${mimeType};base64,${btoa(binary)}`;

      assets.push({
        id: `sound-${soundId}-${tagIndex}`,
        characterId: soundId,
        name: `Sound_${soundId}`,
        type: 'audio',
        mimeType,
        extension: isPcm ? 'wav' : 'mp3',
        tagIndex,
        tagName: meta.name,
        byteLength: audioPayload.length,
        details: `${sampleRate} Hz · ${sampleCount} samples · ${isPcm ? 'PCM Wave' : 'MP3 Stream'}`,
        dataUrl,
        rawBytes: wavBytes,
      });
      summary = `Sound #${soundId} (${sampleRate} Hz, ${sampleCount} samples)`;
    } else if ((tagCode === 21 || tagCode === 35 || tagCode === 6) && payload.length > 4) {
      const bitmapId = payload[0] | (payload[1] << 8);
      const imgBytes = payload.subarray(2);
      let binary = '';
      for (let i = 0; i < imgBytes.length; i++) binary += String.fromCharCode(imgBytes[i]);
      assets.push({
        id: `bitmap-${bitmapId}-${tagIndex}`,
        characterId: bitmapId,
        name: `Bitmap_${bitmapId}`,
        type: 'bitmap',
        mimeType: 'image/jpeg',
        extension: 'jpg',
        tagIndex,
        tagName: meta.name,
        byteLength: imgBytes.length,
        details: `Embedded JPEG stream (${imgBytes.length} bytes)`,
        dataUrl: `data:image/jpeg;base64,${btoa(binary)}`,
        rawBytes: imgBytes,
      });
      summary = `Bitmap #${bitmapId} (${imgBytes.length} bytes)`;
    }

    tags.push({
      index: tagIndex++,
      code: tagCode,
      name: meta.name,
      category: meta.category,
      offset: tagStartOffset,
      headerLength,
      length: tagLength,
      isLongHeader,
      summary,
      fields,
      rawPayload: payload,
    });

    if (tagCode === 0) break;
  }

  const compressionNames: Record<SwfSignature, string> = {
    FWS: 'Uncompressed (FWS)',
    CWS: 'Zlib Compressed (CWS)',
    ZWS: 'LZMA Compressed (ZWS)',
  };

  const header: SwfHeader = {
    signature: sig as SwfSignature,
    compressionName: compressionNames[sig as SwfSignature],
    version,
    compressedFileLength: rawBytes.length,
    uncompressedFileLength: Math.max(uncompressedFileLength, uncompressedBytes.length),
    frameSize,
    frameRate,
    frameCount,
    backgroundColor,
    useNetwork,
    actionScript3,
    hasMetadata,
  };

  return {
    fileName,
    parsedAt: new Date().toISOString(),
    rawBytes,
    uncompressedBytes,
    header,
    tags,
    scripts,
    constantPools,
    assets,
    warnings,
  };
}
