/**
 * Programmatic GLB builder for creating box meshes with PBR materials.
 * Supports transparency via baseColorFactor alpha and alphaMode BLEND.
 *
 * GLB is Y-up per glTF spec. Forma expects Z-up for volumeMesh,
 * so consumers must handle the Y-up -> Z-up transform when placing elements.
 */

interface BoxOptions {
  /** Width in meters (X axis) */
  width: number;
  /** Height in meters (Y axis in GLB / Z axis in Forma) */
  height: number;
  /** Depth in meters (Z axis in GLB / Y axis in Forma) */
  depth: number;
  /** RGBA base color, each component 0-1. Alpha < 1 enables transparency. */
  color: [number, number, number, number];
  /**
   * Optional glTF node translation [x, y, z] baked into the GLB.
   * For placing at a Forma scene point (Xf, Yf, Zf), pass [Xf, Zf, -Yf]
   * (Forma→glTF coordinate mapping). Also includes +90° X rotation.
   */
  translation?: [number, number, number];
}

export function buildBoxGlb(options: BoxOptions): ArrayBuffer {
  const { width, height, depth, color } = options;

  const hw = width / 2;
  const hd = depth / 2;
  // Bottom at Y=0, top at Y=height (GLB Y-up).
  // After Y-up to Z-up rotation, bottom sits at Z=0 (terrain level).
  const yBot = 0;
  const yTop = height;

  // 24 vertices (4 per face, unique normals)
  // prettier-ignore
  const positions = new Float32Array([
    // Front face (Z+)
    -hw, yBot,  hd,   hw, yBot,  hd,   hw, yTop,  hd,  -hw, yTop,  hd,
    // Back face (Z-)
    hw, yBot, -hd,  -hw, yBot, -hd,  -hw, yTop, -hd,   hw, yTop, -hd,
    // Top face (Y+)
    -hw, yTop,  hd,   hw, yTop,  hd,   hw, yTop, -hd,  -hw, yTop, -hd,
    // Bottom face (Y-)
    -hw, yBot, -hd,   hw, yBot, -hd,   hw, yBot,  hd,  -hw, yBot,  hd,
    // Right face (X+)
    hw, yBot,  hd,   hw, yBot, -hd,   hw, yTop, -hd,   hw, yTop,  hd,
    // Left face (X-)
    -hw, yBot, -hd,  -hw, yBot,  hd,  -hw, yTop,  hd,  -hw, yTop, -hd,
  ]);

  // prettier-ignore
  const normals = new Float32Array([
    0,0,1, 0,0,1, 0,0,1, 0,0,1,
    0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
    0,1,0, 0,1,0, 0,1,0, 0,1,0,
    0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
    1,0,0, 1,0,0, 1,0,0, 1,0,0,
    -1,0,0, -1,0,0, -1,0,0, -1,0,0,
  ]);

  // 12 triangles, 36 indices
  // prettier-ignore
  const indices = new Uint16Array([
    0,1,2, 0,2,3,
    4,5,6, 4,6,7,
    8,9,10, 8,10,11,
    12,13,14, 12,14,15,
    16,17,18, 16,18,19,
    20,21,22, 20,22,23,
  ]);

  // Compute bounding box
  const min = [-hw, yBot, -hd];
  const max = [hw, yTop, hd];

  const isTransparent = color[3] < 1.0;

  // Build glTF JSON
  const gltf: Record<string, unknown> = {
    asset: { version: "2.0", generator: "forma-transparent-test" },
    scene: 0,
    scenes: [{ nodes: [options.translation ? 1 : 0] }],
    nodes: options.translation
      ? [
          // Node 0: mesh node (child)
          { mesh: 0 },
          // Node 1: wrapper with translation only (renderer handles Y-up→Z-up)
          {
            children: [0],
            translation: options.translation,
          },
        ]
      : [{ mesh: 0 }],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1 },
            indices: 2,
            material: 0,
          },
        ],
      },
    ],
    materials: [
      {
        pbrMetallicRoughness: {
          baseColorFactor: color,
          metallicFactor: 0.0,
          roughnessFactor: 0.8,
        },
        ...(isTransparent
          ? { alphaMode: "BLEND", doubleSided: true }
          : { alphaMode: "OPAQUE" }),
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126, // FLOAT
        count: 24,
        type: "VEC3",
        min,
        max,
      },
      {
        bufferView: 1,
        componentType: 5126,
        count: 24,
        type: "VEC3",
      },
      {
        bufferView: 2,
        componentType: 5123, // UNSIGNED_SHORT
        count: 36,
        type: "SCALAR",
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      {
        buffer: 0,
        byteOffset: positions.byteLength,
        byteLength: normals.byteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: positions.byteLength + normals.byteLength,
        byteLength: indices.byteLength,
        target: 34963,
      },
    ],
    buffers: [
      {
        byteLength:
          positions.byteLength + normals.byteLength + indices.byteLength,
      },
    ],
  };

  // Combine binary data
  const binLength =
    positions.byteLength + normals.byteLength + indices.byteLength;
  // Pad to 4-byte alignment
  const binPadded = binLength + ((4 - (binLength % 4)) % 4);
  const binBuffer = new ArrayBuffer(binPadded);
  const binView = new Uint8Array(binBuffer);
  binView.set(new Uint8Array(positions.buffer), 0);
  binView.set(new Uint8Array(normals.buffer), positions.byteLength);
  binView.set(
    new Uint8Array(indices.buffer),
    positions.byteLength + normals.byteLength,
  );

  // Encode JSON chunk
  const jsonStr = JSON.stringify(gltf);
  const jsonEncoder = new TextEncoder();
  const jsonBytes = jsonEncoder.encode(jsonStr);
  const jsonPadded = jsonBytes.byteLength + ((4 - (jsonBytes.byteLength % 4)) % 4);
  const jsonChunk = new Uint8Array(jsonPadded);
  jsonChunk.set(jsonBytes);
  // Pad with spaces (0x20) per GLB spec
  for (let i = jsonBytes.byteLength; i < jsonPadded; i++) {
    jsonChunk[i] = 0x20;
  }

  // Build GLB
  const totalLength = 12 + 8 + jsonPadded + 8 + binPadded;
  const glb = new ArrayBuffer(totalLength);
  const view = new DataView(glb);
  let offset = 0;

  // Header
  view.setUint32(offset, 0x46546c67, true); offset += 4; // magic "glTF"
  view.setUint32(offset, 2, true); offset += 4; // version
  view.setUint32(offset, totalLength, true); offset += 4; // total length

  // JSON chunk
  view.setUint32(offset, jsonPadded, true); offset += 4;
  view.setUint32(offset, 0x4e4f534a, true); offset += 4; // "JSON"
  new Uint8Array(glb, offset, jsonPadded).set(jsonChunk);
  offset += jsonPadded;

  // BIN chunk
  view.setUint32(offset, binPadded, true); offset += 4;
  view.setUint32(offset, 0x004e4942, true); offset += 4; // "BIN\0"
  new Uint8Array(glb, offset, binPadded).set(binView);

  return glb;
}
