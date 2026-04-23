#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const TYPE_ALIASES = {
    char: 'int8',
    int8: 'int8',
    uchar: 'uint8',
    uint8: 'uint8',
    short: 'int16',
    int16: 'int16',
    ushort: 'uint16',
    uint16: 'uint16',
    int: 'int32',
    int32: 'int32',
    uint: 'uint32',
    uint32: 'uint32',
    float: 'float32',
    float32: 'float32',
    double: 'float64',
    float64: 'float64'
};

const TYPE_SIZE = {
    int8: 1,
    uint8: 1,
    int16: 2,
    uint16: 2,
    int32: 4,
    uint32: 4,
    float32: 4,
    float64: 8
};

const parseArgs = () => {
    const args = process.argv.slice(2);
    const out = {};
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = args[i + 1];
        if (!next || next.startsWith('--')) {
            out[key] = 'true';
            continue;
        }
        out[key] = next;
        i += 1;
    }
    return out;
};

const parseVec3 = (raw, label) => {
    const value = String(raw ?? '').trim();
    if (!value) {
        throw new Error(`Missing ${label} (expected x,y,z)`);
    }
    const parts = value.split(',').map((v) => Number(v.trim()));
    if (parts.length !== 3 || parts.some((v) => !Number.isFinite(v))) {
        throw new Error(`Invalid ${label} '${value}' (expected x,y,z)`);
    }
    return { x: parts[0], y: parts[1], z: parts[2] };
};

const normalize = (v) => {
    const len = Math.hypot(v.x, v.y, v.z);
    if (len <= 1e-9) {
        throw new Error('Cone axis must be non-zero');
    }
    return { x: v.x / len, y: v.y / len, z: v.z / len };
};

const readNumber = (buffer, offset, type) => {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    switch (type) {
        case 'int8': return view.getInt8(offset);
        case 'uint8': return view.getUint8(offset);
        case 'int16': return view.getInt16(offset, true);
        case 'uint16': return view.getUint16(offset, true);
        case 'int32': return view.getInt32(offset, true);
        case 'uint32': return view.getUint32(offset, true);
        case 'float32': return view.getFloat32(offset, true);
        case 'float64': return view.getFloat64(offset, true);
        default:
            throw new Error(`Unsupported numeric type '${type}'`);
    }
};

const pointInsideCone = (p, apex, axis, tanAngle, maxRange) => {
    const dx = p.x - apex.x;
    const dy = p.y - apex.y;
    const dz = p.z - apex.z;

    const t = dx * axis.x + dy * axis.y + dz * axis.z;
    if (t < 0 || t > maxRange) return false;

    const rx = dx - t * axis.x;
    const ry = dy - t * axis.y;
    const rz = dz - t * axis.z;
    const r2 = rx * rx + ry * ry + rz * rz;
    const limit = t * tanAngle;

    return r2 <= limit * limit;
};

const findHeaderEnd = (buf) => {
    const ascii = buf.toString('utf8', 0, Math.min(buf.length, 1024 * 1024));
    const idx = ascii.indexOf('end_header');
    if (idx < 0) {
        throw new Error('Invalid PLY: missing end_header');
    }

    const nlIdx = ascii.indexOf('\n', idx);
    if (nlIdx < 0) {
        throw new Error('Invalid PLY: malformed end_header line');
    }

    return nlIdx + 1;
};

const parseHeader = (headerText) => {
    const lines = headerText.replace(/\r/g, '').split('\n').filter(Boolean);
    if (lines[0] !== 'ply') {
        throw new Error('Invalid PLY magic');
    }

    const formatLine = lines.find((l) => l.startsWith('format '));
    if (!formatLine || !formatLine.includes('binary_little_endian')) {
        throw new Error('Only binary_little_endian PLY is supported');
    }

    let inVertex = false;
    let vertexCount = null;
    const properties = [];

    for (const line of lines) {
        if (line.startsWith('element ')) {
            const parts = line.split(/\s+/);
            inVertex = parts[1] === 'vertex';
            if (inVertex) {
                vertexCount = Number(parts[2]);
            }
            continue;
        }

        if (inVertex && line.startsWith('property ')) {
            const parts = line.split(/\s+/);
            if (parts[1] === 'list') {
                throw new Error('PLY with list properties is not supported by select-cone');
            }
            const canonicalType = TYPE_ALIASES[parts[1]];
            if (!canonicalType) {
                throw new Error(`Unsupported PLY property type '${parts[1]}'`);
            }
            properties.push({
                type: canonicalType,
                name: parts[2]
            });
        }
    }

    if (!Number.isFinite(vertexCount) || vertexCount < 0) {
        throw new Error('Invalid vertex count in PLY header');
    }

    if (properties.length === 0) {
        throw new Error('PLY vertex element has no scalar properties');
    }

    const offsets = new Map();
    let stride = 0;
    for (const p of properties) {
        offsets.set(p.name, { offset: stride, type: p.type });
        stride += TYPE_SIZE[p.type];
    }

    for (const required of ['x', 'y', 'z']) {
        if (!offsets.has(required)) {
            throw new Error(`PLY is missing required '${required}' property`);
        }
    }

    return {
        vertexCount,
        stride,
        offsets
    };
};

const args = parseArgs();
const inputPath = args.input;
const outputPath = args.output;

if (!inputPath || !outputPath) {
    console.error('Usage: node scripts/select-cone.mjs --input <file.ply> --output <file.ply> [--apex x,y,z --axis x,y,z --angleDeg 30 --range 5 --autoFromData true]');
    process.exit(2);
}

const envAuto = String(process.env.SELECT_CONE_AUTO_FROM_DATA || 'false').toLowerCase() === 'true';
const autoFromData = String(args.autoFromData ?? envAuto).toLowerCase() === 'true';

const angleDeg = Number(args.angleDeg ?? process.env.SELECT_CONE_ANGLE_DEG ?? 30);
const maxRange = Number(args.range ?? process.env.SELECT_CONE_RANGE ?? 5);
if (!Number.isFinite(angleDeg) || angleDeg <= 0 || angleDeg >= 89.9) {
    throw new Error(`Invalid cone angle '${angleDeg}'. Expected (0, 89.9)`);
}
if (!Number.isFinite(maxRange) || maxRange <= 0) {
    throw new Error(`Invalid cone range '${maxRange}'. Expected > 0`);
}

const inputBytes = fs.readFileSync(inputPath);
const dataOffset = findHeaderEnd(inputBytes);
const headerText = inputBytes.subarray(0, dataOffset).toString('utf8');
const parsed = parseHeader(headerText);

if (inputBytes.length < dataOffset + parsed.vertexCount * parsed.stride) {
    throw new Error('PLY data is shorter than expected from header');
}

const xInfo = parsed.offsets.get('x');
const yInfo = parsed.offsets.get('y');
const zInfo = parsed.offsets.get('z');

let apex;
let axis;
const explicitApex = args.apex ?? process.env.SELECT_CONE_APEX;
const explicitAxis = args.axis ?? process.env.SELECT_CONE_AXIS;

if (explicitApex && explicitAxis) {
    apex = parseVec3(explicitApex, 'apex');
    axis = normalize(parseVec3(explicitAxis, 'axis'));
} else if (autoFromData) {
    if (parsed.vertexCount < 1) {
        throw new Error('Cannot auto-derive cone from empty point cloud');
    }

    const p0Base = dataOffset;
    const p1Base = dataOffset + (parsed.vertexCount > 1 ? parsed.stride : 0);

    const p0 = {
        x: readNumber(inputBytes, p0Base + xInfo.offset, xInfo.type),
        y: readNumber(inputBytes, p0Base + yInfo.offset, yInfo.type),
        z: readNumber(inputBytes, p0Base + zInfo.offset, zInfo.type)
    };
    const p1 = {
        x: readNumber(inputBytes, p1Base + xInfo.offset, xInfo.type),
        y: readNumber(inputBytes, p1Base + yInfo.offset, yInfo.type),
        z: readNumber(inputBytes, p1Base + zInfo.offset, zInfo.type)
    };

    apex = p0;
    axis = normalize({ x: p1.x - p0.x || 1, y: p1.y - p0.y, z: p1.z - p0.z });
} else {
    throw new Error('Define apex+axis (SELECT_CONE_APEX/SELECT_CONE_AXIS) or enable SELECT_CONE_AUTO_FROM_DATA=true');
}

const tanAngle = Math.tan(angleDeg * Math.PI / 180);
const selectedRows = [];

for (let i = 0; i < parsed.vertexCount; i++) {
    const base = dataOffset + i * parsed.stride;
    const p = {
        x: readNumber(inputBytes, base + xInfo.offset, xInfo.type),
        y: readNumber(inputBytes, base + yInfo.offset, yInfo.type),
        z: readNumber(inputBytes, base + zInfo.offset, zInfo.type)
    };

    if (pointInsideCone(p, apex, axis, tanAngle, maxRange)) {
        selectedRows.push(i);
    }
}

if (selectedRows.length === 0) {
    throw new Error('Cone selection produced 0 points. Adjust SELECT_CONE_APEX/AXIS/ANGLE/RANGE.');
}

const outputHeader = headerText.replace(/element\s+vertex\s+\d+/, `element vertex ${selectedRows.length}`);
const outputHeaderBytes = Buffer.from(outputHeader, 'utf8');
const out = Buffer.alloc(outputHeaderBytes.length + selectedRows.length * parsed.stride);
outputHeaderBytes.copy(out, 0);

let outOffset = outputHeaderBytes.length;
for (const rowIndex of selectedRows) {
    const srcOffset = dataOffset + rowIndex * parsed.stride;
    inputBytes.copy(out, outOffset, srcOffset, srcOffset + parsed.stride);
    outOffset += parsed.stride;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, out);

console.log(`[select-cone] input=${parsed.vertexCount} selected=${selectedRows.length} angleDeg=${angleDeg} range=${maxRange}`);
console.log(`[select-cone] apex=${apex.x.toFixed(4)},${apex.y.toFixed(4)},${apex.z.toFixed(4)} axis=${axis.x.toFixed(4)},${axis.y.toFixed(4)},${axis.z.toFixed(4)}`);
