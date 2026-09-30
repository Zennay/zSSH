import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../claude-plugin/", import.meta.url));
const files = [".claude-plugin/plugin.json", ".mcp.json", "skills/vps/SKILL.md", "README.md"];

export function validateMcpUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/mcp") {
    throw new Error("Use your HTTPS /mcp endpoint without credentials, query parameters or fragments");
  }
  return url.href;
}

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}

// Fixed, reviewed text files; a dependency-free ZIP with deterministic timestamps.
export function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const filename = Buffer.from(name);
    const body = Buffer.from(value);
    const crc = crc32(body);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(body.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, body);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(33, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(body.length, 20);
    record.writeUInt32LE(body.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export async function packagePlugin({ url, output = "dist/zssh-claude.zip" } = {}) {
  const endpoint = url ? validateMcpUrl(url) : null;
  const entries = await Promise.all(files.map(async name => [name, await readFile(path.join(root, name), "utf8")]));
  if (endpoint) {
    for (const entry of entries) {
      if (entry[0] === ".mcp.json") entry[1] = JSON.stringify({ mcpServers: { zssh: { type: "http", url: endpoint } } }, null, 2) + "\n";
      if (entry[0] === ".claude-plugin/plugin.json") {
        const manifest = JSON.parse(entry[1]);
        delete manifest.userConfig;
        entry[1] = JSON.stringify(manifest, null, 2) + "\n";
      }
    }
  }
  await mkdir(path.dirname(path.resolve(output)), { recursive: true });
  await writeFile(output, zip(entries));
  return path.resolve(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i];
    if (!["--url", "--out"].includes(key) || !process.argv[i + 1]) throw new Error("Usage: npm run plugin:pack -- [--url https://your-domain/mcp] [--out file.zip]");
    options[key === "--url" ? "url" : "output"] = process.argv[++i];
  }
  console.log(await packagePlugin(options));
}
