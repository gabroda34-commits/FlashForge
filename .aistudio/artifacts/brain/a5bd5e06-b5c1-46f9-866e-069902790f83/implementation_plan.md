# FlashForge — SWF Binary Inspector & ActionScript Decompiler

FlashForge is an in-browser Shockwave Flash (`.swf`) binary parser, ActionScript decompiler, and asset extractor designed for software preservationists, legacy web archivists, and developers migrating Flash applications to modern web standards. It parses uncompressed (`FWS`) and zlib-compressed (`CWS`) SWF files directly in the browser to reconstruct readable ActionScript 1/2 (AVM1) and ActionScript 3 (AVM2) source code alongside raw bytecode disassembly, tag metadata, and embedded media assets.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and feature choices have been confirmed from your answers and will guide the implementation.

- **Confirmed Decision 1 — Dual Virtual Machine Support (AVM1 & AVM2)**: Full binary parsing and decompilation for both ActionScript 1/2 (`DoAction`, `DoInitAction`) and ActionScript 3 (`DoABC`, `DoABC2`) bytecode blocks, reconstructing classes, methods, control flow, and expressions alongside raw p-code instructions.
- **Confirmed Decision 2 — Full Inspection & Asset Extraction Suite**: Side-by-side decompiled ActionScript source and p-code disassembly, complete SWF tag tree and header inspection, constant pool browsers, embedded asset extraction (shapes/vectors rendered to SVG, raster images, and audio tags), and one-click ZIP archive export.
- **Confirmed Decision 3 — Sample SWF Library + Local Drag-and-Drop**: Includes built-in, synthetically generated real binary `.swf` test files (covering AVM1 interactive timelines, AVM2 object-oriented classes, and vector shape graphics) so the decompiler can be tested immediately, paired with local drag-and-drop `.swf` file parsing.

---

### 1. Overview & Core Concept

- **What It Does**: Unpacks `.swf` binary streams in the browser (handling `FWS` raw and `CWS` zlib-compressed headers, bit-packed `RECT` stage dimensions, frame rate, and tag streams), disassembles AVM1 stack instructions and AVM2 ABC (ActionScript ByteCode) constant pools, traits, and method bodies, reconstructs structured ActionScript source code, previews vector shapes as SVG, and packages all extracted scripts and assets into a downloadable `.zip` archive.
- **Target Audience / Persona**: Game preservationists, digital archivists, security researchers auditing legacy Flash applets, and frontend engineers porting classic ActionScript projects to HTML5/TypeScript.
- **Key Value**: Eliminates the need for legacy desktop Java tools by providing an instant, client-side reverse-engineering workbench with synchronized bytecode-to-source mapping and clean archive export.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Load or Select Sample**: Users either drag-and-drop any `.swf` binary onto the workspace dropzone or select one of three authentic built-in binary SWF samples (*"AVM2 Physics Engine (AS3)"*, *"AVM1 Arcade Controller (AS2)"*, or *"Vector Shape & Audio Showcase"*).
  2. **Navigate Package & Tag Hierarchy**: The left sidebar (`260px` width) organizes the parsed SWF into structured collapsible trees: **Scripts** (packages, classes, frame actions), **SWF Tags** (chronological binary tag stream with offsets and sizes), **Constant Pools** (strings, namespaces, multinames), and **Assets** (shapes, images, sounds).
  3. **Inspect Decompiled Source & P-Code**: Selecting a script or class opens the main split-pane code workbench—showing syntax-highlighted ActionScript (`as`) on the left and synchronized AVM1/AVM2 bytecode disassembly (`p-code` with hex offsets and stack operations) on the right.
  4. **Preview & Export**: Users can inspect vector shapes rendered directly to interactive SVG previews, search across all extracted scripts and constants in real time, copy individual files, or click **Export Archive (.zip)** to download the complete decompiled project tree.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Precision developer console and binary reverse-engineering workbench with crisp 1px structural hairlines, dense tabular metrics, and zero decorative clutter.
  - *Color Palette & Mood*: Deep slate workbench canvas (`#0B0F17` background, `#111827` structural panels, `#1E293B` 1px borders) with high-contrast alabaster typography (`#F8FAFC`), muted slate metadata (`#94A3B8`), and Flash-inspired amber/crimson technical accents (`#F59E0B` for active selection and `#EF4444` for SWF binary markers). Semantic states use emerald (`#16A34A`) for valid decompression, amber (`#D97706`) for obfuscated/unhandled opcodes, and crimson (`#DC2626`) for corrupted headers.
  - *Typography & Hierarchy*:
    - **Display & UI Structure**: `Plus Jakarta Sans` (600/700) for headers, breadcrumbs, and panel titles.
    - **Body & Controls**: `Public Sans` (400/500) for dense scannability in tree views and inspector tables.
    - **Code, Offsets & Telemetry**: `JetBrains Mono` with `font-variant-numeric: tabular-nums` for ActionScript source code, p-code disassembly, hexadecimal byte offsets, and tag sizes.
  - *Component Styling & Layout*: Designed for a full `1440px` desktop viewport using a single-elevation flat panel architecture separated by `1px solid` borders. Top navigation adheres strictly to the 3-zone contract: Brand wordmark on the left, 4 concise view navigation links (`Scripts`, `Tag Tree`, `Constants`, `Assets`) in the center, and 1 primary action (`Export ZIP`) on the right. All metadata uses clean unboxed text with `·` separators.
- **Interactive Feedback & Motion**: Instantaneous tab switching and tree expansion ($\le 150\text{ms}$), synchronized line highlighting when hovering corresponding p-code blocks and ActionScript statements, live search filtering across scripts and constant pools, and clear toast notifications on clipboard copy or ZIP export completion.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Client-Side Binary Parsing & Zlib Decompression**:
  - *Chosen Approach*: Execute all SWF header parsing, `CWS` zlib inflation (via browser `DecompressionStream` / `pako`), bit-stream reading, and ABC bytecode decompilation in client-side TypeScript.
  - *Why*: Provides zero-latency inspection, complete privacy for proprietary or archival SWF files, and instant responsiveness when clicking between tags, classes, and hex slices.
  - *Alternatives Considered*: Server-side CLI wrapper was passed over to avoid upload bottlenecks and external binary dependencies.
- **Decision 2 — Authentic Binary SWF Generator for Built-In Samples**:
  - *Chosen Approach*: Construct real, spec-compliant binary `.swf` byte arrays in memory (complete with valid `FWS`/`CWS` headers, `FileAttributes`, `SetBackgroundColor`, `DefineShape`, `DoAction` AVM1 opcodes, and `DoABC` AVM2 constant pools, method bodies, and class traits) that pass through the exact same binary parser as user-uploaded `.swf` files.
  - *Why*: Guarantees the parser and decompiler operate on genuine SWF binary structures rather than hardcoded mock strings, while letting users test every feature immediately on launch.
- **Decision 3 — Dual-Pane Source + P-Code Disassembly View**:
  - *Chosen Approach*: Pair high-level reconstructed ActionScript (`class`, `function`, `if/else`, `while`, property access) with low-level stack instructions (`pushstring`, `getlex`, `callpropvoid`, `ActionPush`, `ActionCallMethod`) and raw hex bytes.
  - *Why*: Complex or obfuscated SWF files often require verifying high-level decompiler output against the exact AVM stack instructions and constant pool indices.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                           TOP BAR (3-Zone Contract)                        │
│  [FlashForge]          [Scripts · Tag Tree · Constants · Assets]  [Export] │
├────────────────────┬───────────────────────────────────────────────────────┤
│  SIDEBAR (260px)   │               MAIN WORKSPACE VIEWPORT                 │
│                    │                                                       │
│  ┌──────────────┐  │  ┌─────────────────────────────────────────────────┐  │
│  │ SWF Dropzone │  │  │ Contextual Toolbar (File Switcher, Search, Mode)│  │
│  │ & Samples    │  │  ├────────────────────────┬────────────────────────┤  │
│  └──────┬───────┘  │  │                        │                        │  │
│         │          │  │  Decompiled Source     │  P-Code Disassembly    │  │
│  ┌──────▼───────┐  │  │  (ActionScript 1/2/3)  │  & Hex Byte Inspector  │  │
│  │ Package &    │  │  │                        │                        │  │
│  │ Tag Explorer ├──┼─►│  • Syntax Highlighting │  • Offset & Opcode     │  │
│  │              │  │  │  • Class / Frame Tree  │  • Constant Pool Refs  │  │
│  │ • AVM2 ABC   │  │  │  • Copy / Download .as │  • Stack Delta Trace   │  │
│  │ • AVM1 Frame │  │  │                        │                        │  │
│  │ • SWF Tags   │  │  ├────────────────────────┴────────────────────────┤  │
│  │ • Shapes/SVG │  │  │  Tag Metadata / Constant Pool / SVG Asset View  │  │
│  └──────────────┘  │  └─────────────────────────────────────────────────┘  │
└────────────────────┴───────────────────────────────────────────────────────┘
                                        ▲
                                        │
┌───────────────────────────────────────┴────────────────────────────────────┐
│                    SWF BINARY & DECOMPILATION ENGINE                       │
│  ┌─────────────────┐   ┌────────────────────┐   ┌───────────────────────┐  │
│  │ SwfBitReader &  │──►│ AVM1 (DoAction)    │──►│ AST & Control-Flow    │  │
│  │ Zlib Inflater   │   │ & AVM2 (DoABC)     │   │ Reconstructor (.as)   │  │
│  │ (FWS / CWS)     │   │ Bytecode Parser    │   │ + SVG Shape Converter │  │
│  └─────────────────┘   └────────────────────┘   └───────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `ParsedSwfFile`: Contains file metadata (filename, compression signature `FWS`/`CWS`/`ZWS`, SWF version, uncompressed byte length, frame size `RECT` in twips/pixels, frame rate, frame count), raw `Uint8Array` buffer, parsed `SwfTag[]` list, extracted `ActionScriptUnit[]` (AVM1 frame scripts and AVM2 classes), `AbcConstantPool` tables, and `ExtractedAsset[]` items (SVG shapes, raster bitmaps, audio descriptors).
  - `ActionScriptUnit`: Represents a decompiled script unit with `id`, `name`, `packagePath`, `vmType` (`AVM1` | `AVM2`), `decompiledSource` (formatted ActionScript code), `pcodeLines` (array of `{ offset, hexBytes, opcodeName, operands, comment }`), and referenced constants.
- **Interactive Component & State Mapping**:
  - **File Loader & Sample Selector**: Accepts `.swf` files via drag-and-drop or file picker, validates magic bytes (`0x46 0x57 0x53` for FWS, `0x43 0x57 0x53` for CWS), decompresses if needed, and updates `ParsedSwfFile` state; includes error recovery banner for non-SWF or truncated files.
  - **Explorer Tree & Global Search**: Filters classes, tags, and constant pool strings live by keyword; clicking any node switches the active inspector view and highlights the target item.
  - **Code & P-Code Split Workbench**: Supports toggling between *Split View (Source + P-Code)*, *ActionScript Source Only*, *P-Code Disassembly*, and *Raw Hex Dump*, plus line-click cross-highlighting and single-file `.as` download.
  - **ZIP Archive Exporter**: Bundles all reconstructed `.as` files (organized by package directory), disassembled `.pcode` listings, `swf_report.json` header/tag manifest, and extracted `.svg`/bitmap assets into a downloadable `.zip` archive using client-side ZIP generation.
