#!/usr/bin/env node
// Creates the Lambda deployment ZIP with plain Node.js (no zip/PowerShell needed).
// Entry names always use forward slashes, so the archive works on Lambda
// whether it was built on Windows, macOS or Linux.
//
// Usage:
//   node scripts/zip-lambda.js [sourceDir] [outputZip]
// Defaults: sourceDir = package_service/src, outputZip = package_service/dist/package-service.zip

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const sourceDir = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const outputZip = path.resolve(
    process.argv[3] || path.join(__dirname, "..", "..", "dist", "package-service.zip")
);

// Never ship secrets or old archives inside the Lambda package
const EXCLUDED_NAMES = new Set([".env", ".git", ".DS_Store", "Thumbs.db", "tests"]);
const isExcluded = (name) =>
    EXCLUDED_NAMES.has(name) || name.startsWith(".env.") || name.endsWith(".zip");

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(buffer) {
    let crc = 0xffffffff;
    for (let i = 0; i < buffer.length; i++) {
        crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
}

function collectFiles(dir, base = dir, result = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (isExcluded(entry.name)) continue;

        const fullPath = path.join(dir, entry.name);
        const fullPathResolved = path.resolve(fullPath);

        // Do not zip the output file into itself
        if (fullPathResolved === outputZip) continue;

        if (entry.isDirectory()) {
            collectFiles(fullPath, base, result);
        } else if (entry.isFile()) {
            result.push({
                fullPath,
                name: path.relative(base, fullPath).split(path.sep).join("/")
            });
        }
    }
    return result;
}

function buildZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const file of files) {
        const data = fs.readFileSync(file.fullPath);
        const compressed = zlib.deflateRawSync(data);
        const nameBuffer = Buffer.from(file.name, "utf8");
        const { time, day } = dosDateTime(fs.statSync(file.fullPath).mtime);
        const crc = crc32(data);

        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);          // version needed
        local.writeUInt16LE(0x0800, 6);      // UTF-8 names
        local.writeUInt16LE(8, 8);           // deflate
        local.writeUInt16LE(time, 10);
        local.writeUInt16LE(day, 12);
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(compressed.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuffer.length, 26);
        local.writeUInt16LE(0, 28);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix, v2.0
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0x0800, 8);
        central.writeUInt16LE(8, 10);
        central.writeUInt16LE(time, 12);
        central.writeUInt16LE(day, 14);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(compressed.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuffer.length, 28);
        central.writeUInt16LE(0, 30);
        central.writeUInt16LE(0, 32);
        central.writeUInt16LE(0, 34);
        central.writeUInt16LE(0, 36);
        central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // -rw-r--r--
        central.writeUInt32LE(offset, 42);

        localParts.push(local, nameBuffer, compressed);
        centralParts.push(central, nameBuffer);
        offset += local.length + nameBuffer.length + compressed.length;
    }

    const centralDirectory = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralDirectory.length, 12);
    end.writeUInt32LE(offset, 16);

    return Buffer.concat([...localParts, centralDirectory, end]);
}

function main() {
    if (!fs.existsSync(path.join(sourceDir, "lambda.js"))) {
        throw new Error(`lambda.js was not found in ${sourceDir}`);
    }

    if (!fs.existsSync(path.join(sourceDir, "node_modules", "serverless-http"))) {
        throw new Error("node_modules/serverless-http is missing. Run `npm ci --omit=dev` first.");
    }

    const files = collectFiles(sourceDir);
    if (files.length > 0xffff) {
        throw new Error("Too many files for a simple ZIP archive");
    }

    fs.mkdirSync(path.dirname(outputZip), { recursive: true });
    fs.writeFileSync(outputZip, buildZip(files));

    const sizeKb = (fs.statSync(outputZip).size / 1024).toFixed(1);
    console.log(`Created ${outputZip} (${files.length} files, ${sizeKb} KB)`);
}

try {
    main();
} catch (error) {
    console.error(`ZIP failed: ${error.message}`);
    process.exitCode = 1;
}
