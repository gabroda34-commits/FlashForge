/**
 * Generates authentic, spec-compliant binary .swf files in memory so the
 * SWF binary parser, AVM1/AVM2 decompiler, tag tree inspector, and SVG shape
 * extractor operate on genuine SWF byte streams immediately on load.
 */

class ByteBuilder {
  private bytes: number[] = [];

  writeU8(v: number) {
    this.bytes.push(v & 0xff);
  }

  writeU16LE(v: number) {
    this.bytes.push(v & 0xff, (v >>> 8) & 0xff);
  }

  writeS16LE(v: number) {
    const val = v < 0 ? 0x10000 + v : v;
    this.writeU16LE(val);
  }

  writeU32LE(v: number) {
    this.bytes.push(
      v & 0xff,
      (v >>> 8) & 0xff,
      (v >>> 16) & 0xff,
      (v >>> 24) & 0xff
    );
  }

  writeS24LE(v: number) {
    const val = v < 0 ? 0x1000000 + v : v;
    this.bytes.push(val & 0xff, (val >>> 8) & 0xff, (val >>> 16) & 0xff);
  }

  writeU30(v: number) {
    let val = v >>> 0;
    do {
      let b = val & 0x7f;
      val >>>= 7;
      if (val > 0) b |= 0x80;
      this.bytes.push(b);
    } while (val > 0);
  }

  writeF64LE(v: number) {
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, v, true);
    const arr = new Uint8Array(buf);
    for (let i = 0; i < 8; i++) this.bytes.push(arr[i]);
  }

  writeCString(str: string) {
    const encoded = new TextEncoder().encode(str);
    for (let i = 0; i < encoded.length; i++) this.bytes.push(encoded[i]);
    this.bytes.push(0);
  }

  writeAbcString(str: string) {
    const encoded = new TextEncoder().encode(str);
    this.writeU30(encoded.length);
    for (let i = 0; i < encoded.length; i++) this.bytes.push(encoded[i]);
  }

  writeBytes(arr: Uint8Array | number[]) {
    for (let i = 0; i < arr.length; i++) this.bytes.push(arr[i]);
  }

  writeTag(code: number, payload: Uint8Array | number[]) {
    const len = payload.length;
    if (len < 0x3f) {
      this.writeU16LE((code << 6) | len);
    } else {
      this.writeU16LE((code << 6) | 0x3f);
      this.writeU32LE(len);
    }
    this.writeBytes(payload);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.bytes);
  }
}

class BitBuilder {
  private bytes: number[] = [];
  private currentByte = 0;
  private bitPos = 0; // 0..7 from MSB to LSB

  writeBits(value: number, numBits: number) {
    for (let i = numBits - 1; i >= 0; i--) {
      const bit = (value >>> i) & 1;
      this.currentByte |= bit << (7 - this.bitPos);
      this.bitPos++;
      if (this.bitPos === 8) {
        this.bytes.push(this.currentByte);
        this.currentByte = 0;
        this.bitPos = 0;
      }
    }
  }

  writeSBits(value: number, numBits: number) {
    const masked = value < 0 ? (1 << numBits) + value : value;
    this.writeBits(masked, numBits);
  }

  alignByte() {
    if (this.bitPos > 0) {
      this.bytes.push(this.currentByte);
      this.currentByte = 0;
      this.bitPos = 0;
    }
  }

  toUint8Array(): Uint8Array {
    this.alignByte();
    return new Uint8Array(this.bytes);
  }
}

function encodeSwfRect(xMin: number, xMax: number, yMin: number, yMax: number): Uint8Array {
  const bits = new BitBuilder();
  const nBits = 15;
  bits.writeBits(nBits, 5);
  bits.writeSBits(xMin, nBits);
  bits.writeSBits(xMax, nBits);
  bits.writeSBits(yMin, nBits);
  bits.writeSBits(yMax, nBits);
  return bits.toUint8Array();
}

function buildDefineShapeTagPayload(
  shapeId: number,
  fillColor: [number, number, number],
  strokeColor: [number, number, number],
  polygonTwips: Array<[number, number]>
): Uint8Array {
  const b = new ByteBuilder();
  b.writeU16LE(shapeId);
  // Bounds RECT (0..4000 twips = 200px)
  b.writeBytes(encodeSwfRect(0, 4000, 0, 4000));

  // SHAPEWITHSTYLE
  // FillStyleArray: count = 1, type = 0x00 (solid fill), RGB
  b.writeU8(1);
  b.writeU8(0x00);
  b.writeU8(fillColor[0]);
  b.writeU8(fillColor[1]);
  b.writeU8(fillColor[2]);

  // LineStyleArray: count = 1, width = 40 twips (2px), RGB
  b.writeU8(1);
  b.writeU16LE(40);
  b.writeU8(strokeColor[0]);
  b.writeU8(strokeColor[1]);
  b.writeU8(strokeColor[2]);

  // NumFillBits = 1, NumLineBits = 1 -> byte 0x11
  b.writeU8(0x11);

  const shapeBits = new BitBuilder();
  // StyleChangeRecord: TypeFlag=0, StateNewStyles=0, StateLineStyle=1, StateFillStyle1=1, StateFillStyle0=0, StateMoveTo=1
  shapeBits.writeBits(0, 1); // Non-edge
  shapeBits.writeBits(0, 1); // NewStyles
  shapeBits.writeBits(1, 1); // LineStyle
  shapeBits.writeBits(1, 1); // FillStyle1
  shapeBits.writeBits(0, 1); // FillStyle0
  shapeBits.writeBits(1, 1); // MoveTo

  const startX = polygonTwips[0][0];
  const startY = polygonTwips[0][1];
  const moveBits = 14;
  shapeBits.writeBits(moveBits, 5);
  shapeBits.writeSBits(startX, moveBits);
  shapeBits.writeSBits(startY, moveBits);
  shapeBits.writeBits(1, 1); // FillStyle1 = 1
  shapeBits.writeBits(1, 1); // LineStyle = 1

  let curX = startX;
  let curY = startY;
  for (let i = 1; i < polygonTwips.length; i++) {
    const [nx, ny] = polygonTwips[i];
    const dx = nx - curX;
    const dy = ny - curY;
    curX = nx;
    curY = ny;

    shapeBits.writeBits(1, 1); // Edge record
    shapeBits.writeBits(1, 1); // Straight edge
    const nBits = 12;
    shapeBits.writeBits(nBits - 2, 4); // NumBits - 2
    shapeBits.writeBits(1, 1); // GeneralLineFlag = 1
    shapeBits.writeSBits(dx, nBits);
    shapeBits.writeSBits(dy, nBits);
  }

  // EndShapeRecord: TypeFlag = 0, all 5 flags = 0
  shapeBits.writeBits(0, 6);
  b.writeBytes(shapeBits.toUint8Array());
  return b.toUint8Array();
}

function finalizeSwfBinary(version: number, widthPx: number, heightPx: number, fps: number, frameCount: number, tagsBytes: Uint8Array): Uint8Array {
  const headerPre = new ByteBuilder();
  headerPre.writeU8(0x46); // 'F'
  headerPre.writeU8(0x57); // 'W'
  headerPre.writeU8(0x53); // 'S'
  headerPre.writeU8(version);

  const rectBytes = encodeSwfRect(0, widthPx * 20, 0, heightPx * 20);
  const totalLength = 8 + rectBytes.length + 4 + tagsBytes.length;

  headerPre.writeU32LE(totalLength);
  headerPre.writeBytes(rectBytes);
  headerPre.writeU16LE(fps << 8); // 8.8 fixed point frame rate
  headerPre.writeU16LE(frameCount);
  headerPre.writeBytes(tagsBytes);

  return headerPre.toUint8Array();
}

/**
 * Sample 1: AVM2 ActionScript 3 Physics & Particle Engine SWF
 * Contains real DoABC (Tag 82) with ABC constant pool, package classes, methods, and AVM2 instructions.
 */
export function buildSampleAvm2PhysicsSwf(): Uint8Array {
  const tags = new ByteBuilder();

  // Tag 69: FileAttributes (ActionScript3 = true, UseNetwork = true)
  tags.writeTag(69, [0x09, 0x00, 0x00, 0x00]);

  // Tag 9: SetBackgroundColor (#0F172A)
  tags.writeTag(9, [0x0f, 0x17, 0x2a]);

  // Tag 77: Metadata (RDF XML)
  const metaXml = new ByteBuilder();
  metaXml.writeCString(
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description dc:title="OrbitalVerletEngine" dc:creator="FlashForge SDK 4.6" dc:date="2012-08-14"/></rdf:RDF>'
  );
  tags.writeTag(77, metaXml.toUint8Array());

  // Tag 2: DefineShape (Hexagonal Orbital Core vector shape)
  tags.writeTag(
    2,
    buildDefineShapeTagPayload(
      1,
      [245, 158, 11], // Amber fill
      [254, 243, 199], // Light amber stroke
      [
        [2000, 400],
        [3400, 1200],
        [3400, 2800],
        [2000, 3600],
        [600, 2800],
        [600, 1200],
        [2000, 400],
      ]
    )
  );

  // Tag 82: DoABC (AVM2 ActionScript 3 Bytecode Block)
  const abc = new ByteBuilder();
  abc.writeU32LE(1); // flags: kDoAbcLazyInitializeFlag
  abc.writeCString('com/flashforge/physics/VerletSolver');
  abc.writeU16LE(16); // minor version
  abc.writeU16LE(46); // major version

  // Constant Pool
  // int pool (count = 3 -> 2 entries)
  abc.writeU30(3);
  abc.writeU30(60);
  abc.writeU30(1024);

  // uint pool (count = 2 -> 1 entry)
  abc.writeU30(2);
  abc.writeU30(0xffaa00);

  // double pool (count = 4 -> 3 entries)
  abc.writeU30(4);
  abc.writeF64LE(0.985); // damping
  abc.writeF64LE(9.80665); // gravity
  abc.writeF64LE(0.01666); // timeStep

  // string pool (count = 22 -> indices 1..21)
  const strings = [
    'com.flashforge.physics', // 1
    'VerletSolver', // 2
    'flash.display', // 3
    'Sprite', // 4
    'Object', // 5
    '', // 6
    'stepSimulation', // 7
    'applyGravitationalField', // 8
    'damping', // 9
    'gravity', // 10
    'activeParticles', // 11
    'Number', // 12
    'int', // 13
    'void', // 14
    'trace', // 15
    '[VerletSolver] Tick stepped: dt=0.0166s, damping=0.985', // 16
    'x', // 17
    'y', // 18
    'vx', // 19
    'vy', // 20
    'resolveBoundaryCollisions', // 21
  ];
  abc.writeU30(strings.length + 1);
  for (const s of strings) abc.writeAbcString(s);

  // namespace pool (count = 5 -> indices 1..4)
  abc.writeU30(5);
  abc.writeU8(0x16); abc.writeU30(1); // 1: PackageNamespace("com.flashforge.physics")
  abc.writeU8(0x16); abc.writeU30(3); // 2: PackageNamespace("flash.display")
  abc.writeU8(0x16); abc.writeU30(6); // 3: PackageNamespace("")
  abc.writeU8(0x08); abc.writeU30(1); // 4: Namespace("com.flashforge.physics")

  // ns_set pool (count = 1 -> 0 entries)
  abc.writeU30(1);

  // multiname pool (count = 16 -> indices 1..15)
  const qnames: Array<[number, number]> = [
    [1, 2],  // 1: com.flashforge.physics::VerletSolver
    [2, 4],  // 2: flash.display::Sprite
    [3, 5],  // 3: Object
    [3, 7],  // 4: stepSimulation
    [3, 8],  // 5: applyGravitationalField
    [3, 9],  // 6: damping
    [3, 10], // 7: gravity
    [3, 11], // 8: activeParticles
    [3, 12], // 9: Number
    [3, 13], // 10: int
    [3, 14], // 11: void
    [3, 15], // 12: trace
    [3, 17], // 13: x
    [3, 18], // 14: y
    [3, 21], // 15: resolveBoundaryCollisions
  ];
  abc.writeU30(qnames.length + 1);
  for (const [nsIdx, nameIdx] of qnames) {
    abc.writeU8(0x07); // QName
    abc.writeU30(nsIdx);
    abc.writeU30(nameIdx);
  }

  // Methods (5 methods: 0=cinit, 1=iinit, 2=stepSimulation, 3=applyGravitationalField, 4=script_init)
  abc.writeU30(5);
  // Method 0: cinit() : void
  abc.writeU30(0); abc.writeU30(11); abc.writeU30(0); abc.writeU8(0);
  // Method 1: VerletSolver() : void
  abc.writeU30(0); abc.writeU30(11); abc.writeU30(2); abc.writeU8(0);
  // Method 2: stepSimulation(dt:Number):void
  abc.writeU30(1); abc.writeU30(11); abc.writeU30(9); abc.writeU30(4); abc.writeU8(0);
  // Method 3: applyGravitationalField(mass:Number, radius:Number):Number
  abc.writeU30(2); abc.writeU30(9); abc.writeU30(9); abc.writeU30(9); abc.writeU30(5); abc.writeU8(0);
  // Method 4: script_init() : void
  abc.writeU30(0); abc.writeU30(11); abc.writeU30(0); abc.writeU8(0);

  // Metadata count = 0
  abc.writeU30(0);

  // Instance & Class count = 1
  abc.writeU30(1);
  // Instance 0: VerletSolver extends flash.display.Sprite
  abc.writeU30(1); // name = QName 1 (VerletSolver)
  abc.writeU30(2); // super_name = QName 2 (flash.display.Sprite)
  abc.writeU8(0x08); // flags = ClassProtectedNs
  abc.writeU30(4); // protectedNs = 4
  abc.writeU30(0); // intrf_count = 0
  abc.writeU30(1); // iinit = Method 1
  // Instance Traits (5 traits: 3 slots + 2 methods)
  abc.writeU30(5);
  // Trait 0: var damping:Number
  abc.writeU30(6); abc.writeU8(0); abc.writeU30(1); abc.writeU30(9); abc.writeU30(1); abc.writeU8(0x06);
  // Trait 1: var gravity:Number
  abc.writeU30(7); abc.writeU8(0); abc.writeU30(2); abc.writeU30(9); abc.writeU30(2); abc.writeU8(0x06);
  // Trait 2: var activeParticles:int
  abc.writeU30(8); abc.writeU8(0); abc.writeU30(3); abc.writeU30(10); abc.writeU30(1); abc.writeU8(0x03);
  // Trait 3: method stepSimulation
  abc.writeU30(4); abc.writeU8(1); abc.writeU30(0); abc.writeU30(2);
  // Trait 4: method applyGravitationalField
  abc.writeU30(5); abc.writeU8(1); abc.writeU30(0); abc.writeU30(3);

  // Class 0: cinit = 0, traits = 0
  abc.writeU30(0);
  abc.writeU30(0);

  // Scripts count = 1
  abc.writeU30(1);
  abc.writeU30(4); // init = Method 4
  abc.writeU30(1); // 1 trait (Class VerletSolver)
  abc.writeU30(1); abc.writeU8(4); abc.writeU30(1); abc.writeU30(0);

  // Method Bodies (5 bodies)
  abc.writeU30(5);

  // Body 0 (cinit)
  abc.writeU30(0); abc.writeU30(1); abc.writeU30(1); abc.writeU30(3); abc.writeU30(4);
  const code0 = [0xd0, 0x30, 0x47]; // getlocal_0, pushscope, returnvoid
  abc.writeU30(code0.length); abc.writeBytes(code0); abc.writeU30(0); abc.writeU30(0);

  // Body 1 (Constructor VerletSolver)
  abc.writeU30(1); abc.writeU30(3); abc.writeU30(1); abc.writeU30(4); abc.writeU30(5);
  const code1 = [
    0xd0, // getlocal_0
    0x30, // pushscope
    0xd0, // getlocal_0
    0x49, 0x00, // constructsuper 0
    0xd0, // getlocal_0
    0x2f, 0x01, // pushdouble 1 (0.985)
    0x68, 0x06, // initproperty damping
    0xd0, // getlocal_0
    0x2f, 0x02, // pushdouble 2 (9.80665)
    0x68, 0x07, // initproperty gravity
    0xd0, // getlocal_0
    0x24, 0x3c, // pushbyte 60
    0x68, 0x08, // initproperty activeParticles
    0x47, // returnvoid
  ];
  abc.writeU30(code1.length); abc.writeBytes(code1); abc.writeU30(0); abc.writeU30(0);

  // Body 2 (stepSimulation)
  abc.writeU30(2); abc.writeU30(4); abc.writeU30(3); abc.writeU30(4); abc.writeU30(5);
  const code2 = [
    0xd0, // getlocal_0
    0x30, // pushscope
    0x5d, 0x0c, // findpropstrict trace
    0x2c, 0x10, // pushstring 16 ("[VerletSolver] Tick stepped...")
    0x4f, 0x0c, 0x01, // callpropvoid trace, 1
    0xd0, // getlocal_0
    0xd0, // getlocal_0
    0x66, 0x06, // getproperty damping
    0xd1, // getlocal_1 (dt)
    0xa2, // multiply
    0x61, 0x06, // setproperty damping
    0xd0, // getlocal_0
    0xd1, // getlocal_1
    0x2f, 0x02, // pushdouble 2 (9.80665)
    0x46, 0x05, 0x02, // callproperty applyGravitationalField, 2
    0x29, // pop
    0x47, // returnvoid
  ];
  abc.writeU30(code2.length); abc.writeBytes(code2); abc.writeU30(0); abc.writeU30(0);

  // Body 3 (applyGravitationalField)
  abc.writeU30(3); abc.writeU30(4); abc.writeU30(3); abc.writeU30(4); abc.writeU30(5);
  const code3 = [
    0xd0, // getlocal_0
    0x30, // pushscope
    0xd0, // getlocal_0
    0x66, 0x07, // getproperty gravity
    0xd1, // getlocal_1 (mass)
    0xa2, // multiply
    0xd2, // getlocal_2 (radius)
    0xa3, // divide
    0x48, // returnvalue
  ];
  abc.writeU30(code3.length); abc.writeBytes(code3); abc.writeU30(0); abc.writeU30(0);

  // Body 4 (script_init)
  abc.writeU30(4); abc.writeU30(2); abc.writeU30(1); abc.writeU30(1); abc.writeU30(3);
  const code4 = [
    0xd0, // getlocal_0
    0x30, // pushscope
    0x65, 0x00, // getscopeobject 0
    0x60, 0x03, // getlex Object
    0x30, // pushscope
    0x60, 0x02, // getlex flash.display.Sprite
    0x30, // pushscope
    0x60, 0x02, // getlex flash.display.Sprite
    0x58, 0x00, // newclass 0
    0x1d, // popscope
    0x1d, // popscope
    0x68, 0x01, // initproperty VerletSolver
    0x47, // returnvoid
  ];
  abc.writeU30(code4.length); abc.writeBytes(code4); abc.writeU30(0); abc.writeU30(0);

  tags.writeTag(82, abc.toUint8Array());

  // Tag 76: SymbolClass (binds shape 1 -> OrbitalNode, 0 -> com.flashforge.physics.VerletSolver)
  const sym = new ByteBuilder();
  sym.writeU16LE(2);
  sym.writeU16LE(1);
  sym.writeCString('com.flashforge.physics.OrbitalCoreShape');
  sym.writeU16LE(0);
  sym.writeCString('com.flashforge.physics.VerletSolver');
  tags.writeTag(76, sym.toUint8Array());

  // Tag 1: ShowFrame
  tags.writeTag(1, []);
  // Tag 0: End
  tags.writeTag(0, []);

  return finalizeSwfBinary(10, 800, 600, 60, 1, tags.toUint8Array());
}

/**
 * Sample 2: AVM1 ActionScript 2 Arcade Ship Controller SWF
 * Contains real DoAction (Tag 12) and DoInitAction (Tag 59) with ConstantPool, Push, GetVariable, SetMember, If, etc.
 */
export function buildSampleAvm1ArcadeSwf(): Uint8Array {
  const tags = new ByteBuilder();

  // Tag 69: FileAttributes (ActionScript3 = false)
  tags.writeTag(69, [0x00, 0x00, 0x00, 0x00]);

  // Tag 9: SetBackgroundColor (#111827)
  tags.writeTag(9, [0x11, 0x18, 0x27]);

  // Tag 2: DefineShape (Arcade Starfighter Delta Wing vector shape)
  tags.writeTag(
    2,
    buildDefineShapeTagPayload(
      1,
      [56, 189, 248], // Sky cyan fill
      [224, 242, 254], // Crisp highlight stroke
      [
        [2000, 300],
        [3500, 3400],
        [2000, 2750],
        [500, 3400],
        [2000, 300],
      ]
    )
  );

  // Tag 26: PlaceObject2 (Place character 1 at depth 1)
  tags.writeTag(26, [0x06, 0x01, 0x00, 0x01, 0x00, 0x00]);

  // Tag 12: DoAction (Frame 1 AVM1 Bytecode)
  const actions = new ByteBuilder();

  // 0x88: ActionConstantPool
  const poolStrings = [
    'playerShip', // 0
    '_x', // 1
    '_y', // 2
    'velocityX', // 3
    'shieldEnergy', // 4
    'score', // 5
    'updateThrusters', // 6
    '[AVM1 Arcade] Starfighter initialized @ 60fps', // 7
    'GameLoopActive', // 8
  ];
  const poolPayload = new ByteBuilder();
  poolPayload.writeU16LE(poolStrings.length);
  for (const s of poolStrings) poolPayload.writeCString(s);
  const poolBytes = poolPayload.toUint8Array();
  actions.writeU8(0x88);
  actions.writeU16LE(poolBytes.length);
  actions.writeBytes(poolBytes);

  // trace("[AVM1 Arcade] Starfighter initialized @ 60fps")
  actions.writeU8(0x96); // ActionPush
  actions.writeU16LE(2);
  actions.writeU8(0x08); // Constant8
  actions.writeU8(7);    // pool[7]
  actions.writeU8(0x26); // ActionTrace

  // score = 1500
  actions.writeU8(0x96); // ActionPush
  actions.writeU16LE(7);
  actions.writeU8(0x08); actions.writeU8(5); // pool[5] "score"
  actions.writeU8(0x07); actions.writeU32LE(1500); // Integer 1500
  actions.writeU8(0x1d); // ActionSetVariable

  // shieldEnergy = 100
  actions.writeU8(0x96); // ActionPush
  actions.writeU16LE(7);
  actions.writeU8(0x08); actions.writeU8(4); // pool[4] "shieldEnergy"
  actions.writeU8(0x07); actions.writeU32LE(100); // Integer 100
  actions.writeU8(0x1d); // ActionSetVariable

  // playerShip._x = playerShip._x + velocityX
  actions.writeU8(0x96); // ActionPush "playerShip", "_x", "playerShip"
  actions.writeU16LE(6);
  actions.writeU8(0x08); actions.writeU8(0); // "playerShip"
  actions.writeU8(0x1c); // ActionGetVariable
  actions.writeU8(0x96);
  actions.writeU16LE(4);
  actions.writeU8(0x08); actions.writeU8(1); // "_x"
  actions.writeU8(0x08); actions.writeU8(0); // "playerShip"
  actions.writeU8(0x1c); // ActionGetVariable
  actions.writeU8(0x96);
  actions.writeU16LE(2);
  actions.writeU8(0x08); actions.writeU8(1); // "_x"
  actions.writeU8(0x4e); // ActionGetMember
  actions.writeU8(0x96);
  actions.writeU16LE(2);
  actions.writeU8(0x08); actions.writeU8(3); // "velocityX"
  actions.writeU8(0x1c); // ActionGetVariable
  actions.writeU8(0x47); // ActionAdd2
  actions.writeU8(0x4f); // ActionSetMember

  // playerShip.updateThrusters(1)
  actions.writeU8(0x96);
  actions.writeU16LE(11);
  actions.writeU8(0x07); actions.writeU32LE(1); // arg 1
  actions.writeU8(0x07); actions.writeU32LE(1); // argc = 1
  actions.writeU8(0x08); actions.writeU8(0); // "playerShip"
  actions.writeU8(0x1c); // ActionGetVariable
  actions.writeU8(0x96);
  actions.writeU16LE(2);
  actions.writeU8(0x08); actions.writeU8(6); // "updateThrusters"
  actions.writeU8(0x52); // ActionCallMethod
  actions.writeU8(0x17); // ActionPop

  // ActionEndFlag
  actions.writeU8(0x00);

  tags.writeTag(12, actions.toUint8Array());

  // Tag 43: FrameLabel ("MainLoop")
  const label = new ByteBuilder();
  label.writeCString('MainLoop');
  tags.writeTag(43, label.toUint8Array());

  // Tag 1: ShowFrame
  tags.writeTag(1, []);
  // Tag 0: End
  tags.writeTag(0, []);

  return finalizeSwfBinary(8, 640, 480, 60, 1, tags.toUint8Array());
}

/**
 * Sample 3: Hybrid Vector Geometry, Audio & Timeline Showcase SWF
 * Contains multiple DefineShape tags, DefineSound PCM wave asset, and timeline control actions.
 */
export function buildSampleVectorAudioSwf(): Uint8Array {
  const tags = new ByteBuilder();

  // Tag 69: FileAttributes
  tags.writeTag(69, [0x00, 0x00, 0x00, 0x00]);

  // Tag 9: SetBackgroundColor (#090D16)
  tags.writeTag(9, [0x09, 0x0d, 0x16]);

  // Tag 2: DefineShape #1 (Emerald Diamond Crystal)
  tags.writeTag(
    2,
    buildDefineShapeTagPayload(
      1,
      [16, 185, 129],
      [167, 243, 208],
      [
        [2000, 250],
        [3650, 2000],
        [2000, 3750],
        [350, 2000],
        [2000, 250],
      ]
    )
  );

  // Tag 2: DefineShape #2 (Crimson Octagon Badge)
  tags.writeTag(
    2,
    buildDefineShapeTagPayload(
      2,
      [239, 68, 68],
      [254, 202, 202],
      [
        [1300, 400],
        [2700, 400],
        [3600, 1300],
        [3600, 2700],
        [2700, 3600],
        [1300, 3600],
        [400, 2700],
        [400, 1300],
        [1300, 400],
      ]
    )
  );

  // Tag 14: DefineSound (Synthesized 11kHz 8-bit Mono PCM Synth Chime)
  const soundPayload = new ByteBuilder();
  soundPayload.writeU16LE(3); // SoundId = 3
  // SoundFormat = 3 (Uncompressed little-endian), SoundRate = 1 (11kHz), SoundSize = 0 (8-bit), SoundType = 0 (Mono) -> (3 << 4) | (1 << 2) = 0x34
  soundPayload.writeU8(0x34);
  const sampleCount = 2200; // 0.2s chime
  soundPayload.writeU32LE(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    const env = Math.max(0, 1 - i / sampleCount);
    const wave = Math.sin((2 * Math.PI * 523.25 * i) / 11025) * 0.6 + Math.sin((2 * Math.PI * 659.25 * i) / 11025) * 0.4;
    const pcm8 = Math.round(128 + wave * env * 110);
    soundPayload.writeU8(Math.max(0, Math.min(255, pcm8)));
  }
  tags.writeTag(14, soundPayload.toUint8Array());

  // Tag 12: DoAction (Audio & Stage Controller Script)
  const actions = new ByteBuilder();
  const pool = ['stageQuality', 'HIGH', 'soundChannel', 'playChime', '[MediaShowcase] Vector & PCM synth assets ready'];
  const poolBytes = new ByteBuilder();
  poolBytes.writeU16LE(pool.length);
  for (const s of pool) poolBytes.writeCString(s);
  const pb = poolBytes.toUint8Array();
  actions.writeU8(0x88);
  actions.writeU16LE(pb.length);
  actions.writeBytes(pb);

  // stageQuality = "HIGH"
  actions.writeU8(0x96);
  actions.writeU16LE(4);
  actions.writeU8(0x08); actions.writeU8(0);
  actions.writeU8(0x08); actions.writeU8(1);
  actions.writeU8(0x1d); // SetVariable

  // trace("[MediaShowcase] Vector & PCM synth assets ready")
  actions.writeU8(0x96);
  actions.writeU16LE(2);
  actions.writeU8(0x08); actions.writeU8(4);
  actions.writeU8(0x26); // Trace

  actions.writeU8(0x07); // ActionStop
  actions.writeU8(0x00); // End
  tags.writeTag(12, actions.toUint8Array());

  // Tag 1: ShowFrame
  tags.writeTag(1, []);
  // Tag 0: End
  tags.writeTag(0, []);

  return finalizeSwfBinary(9, 720, 480, 30, 1, tags.toUint8Array());
}

export interface SampleSwfDescriptor {
  id: string;
  title: string;
  fileName: string;
  vmBadge: 'AVM2 (AS3)' | 'AVM1 (AS2)';
  description: string;
  buildBinary: () => Uint8Array;
}

export const BUILT_IN_SWF_SAMPLES: SampleSwfDescriptor[] = [
  {
    id: 'avm2-physics',
    title: 'AVM2 Physics Engine (AS3)',
    fileName: 'OrbitalVerletEngine_AS3.swf',
    vmBadge: 'AVM2 (AS3)',
    description: 'ActionScript 3 DoABC bytecode with VerletSolver class, traits, constant pool, and vector shape.',
    buildBinary: buildSampleAvm2PhysicsSwf,
  },
  {
    id: 'avm1-arcade',
    title: 'AVM1 Arcade Controller (AS2)',
    fileName: 'StarfighterArcade_AS2.swf',
    vmBadge: 'AVM1 (AS2)',
    description: 'ActionScript 2 DoAction stack instructions, constant pool, property mutation, and delta-wing geometry.',
    buildBinary: buildSampleAvm1ArcadeSwf,
  },
  {
    id: 'vector-audio-showcase',
    title: 'Vector Shapes & Audio Showcase',
    fileName: 'VectorSynthShowcase.swf',
    vmBadge: 'AVM1 (AS2)',
    description: 'Multi-shape DefineShape vector records, embedded 11kHz PCM DefineSound audio tag, and timeline actions.',
    buildBinary: buildSampleVectorAudioSwf,
  },
];
