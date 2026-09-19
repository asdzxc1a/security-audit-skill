import fs from "node:fs";
import path from "node:path";

import { sha256Hex } from "./canonical";
import type { MethodologyBlock, MethodologyCatalog } from "./contracts";
import { isSafeRepositoryPath } from "./source-snapshot";

const MAX_METHODOLOGY_FILE_BYTES = 1024 * 1024;

export class MethodologyCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MethodologyCatalogError";
  }
}

interface Marker {
  readonly level: number;
  readonly text: string;
  readonly lineIndex: number;
}

function parseMarkers(lines: readonly string[]): Marker[] {
  const markers: Marker[] = [];
  for (let index = 0; index < lines.length; index++) {
    const heading = /^(#{2,4})\s+(.+?)\s*$/.exec(lines[index]);
    if (heading) {
      markers.push({ level: heading[1].length, text: heading[2], lineIndex: index });
      continue;
    }
    const label = /^\*\*([^*]+)\*\*(?:\s+\(subagent_type:[^)]+\))?\s*$/.exec(lines[index]);
    if (label) {
      markers.push({ level: 5, text: label[1], lineIndex: index });
    }
  }
  return markers;
}

function parseDocument(file: string, content: string): MethodologyBlock[] {
  const lines = content.split(/\r?\n/);
  const markers = parseMarkers(lines);
  const blocks: MethodologyBlock[] = [];

  for (let index = 0; index < markers.length; index++) {
    const marker = markers[index];
    let end = lines.length;
    for (let next = index + 1; next < markers.length; next++) {
      if (markers[next].level <= marker.level) {
        end = markers[next].lineIndex;
        break;
      }
    }
    const blockContent = lines.slice(marker.lineIndex, end).join("\n").trimEnd() + "\n";
    const bytes = Buffer.byteLength(blockContent, "utf8");
    const ref = file + "#" + marker.text;
    blocks.push(
      Object.freeze({
        ref,
        file,
        heading: marker.text,
        level: marker.level,
        sha256: sha256Hex(Buffer.from(blockContent, "utf8")),
        bytes,
        content: blockContent,
      }),
    );
  }
  return blocks;
}

export function loadMethodologyCatalog(rootDirectory: string): MethodologyCatalog {
  const root = fs.realpathSync(rootDirectory);
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  const blocks = new Map<string, MethodologyBlock>();

  for (const entry of entries) {
    if (!isSafeRepositoryPath(entry.name)) {
      throw new MethodologyCatalogError("unsafe methodology filename: " + entry.name);
    }
    const file = path.join(root, entry.name);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new MethodologyCatalogError("methodology document must be a regular file: " + entry.name);
    }
    if (stat.size > MAX_METHODOLOGY_FILE_BYTES) {
      throw new MethodologyCatalogError("methodology document exceeds byte limit: " + entry.name);
    }
    const content = fs.readFileSync(file, "utf8");
    for (const block of parseDocument(entry.name, content)) {
      if (blocks.has(block.ref)) {
        throw new MethodologyCatalogError("duplicate methodology block ref: " + block.ref);
      }
      blocks.set(block.ref, block);
    }
  }

  return Object.freeze({ blocks });
}

function validateMethodologyBlock(block: MethodologyBlock): void {
  if (
    !block ||
    !isSafeRepositoryPath(block.file) ||
    typeof block.heading !== "string" ||
    block.heading.length === 0 ||
    block.ref !== block.file + "#" + block.heading ||
    !Number.isInteger(block.level) ||
    block.level < 2 ||
    block.level > 5
  ) {
    throw new MethodologyCatalogError("invalid methodology block metadata");
  }
  const bytes = Buffer.byteLength(block.content, "utf8");
  const sha256 = sha256Hex(Buffer.from(block.content, "utf8"));
  if (block.bytes !== bytes || block.sha256 !== sha256) {
    throw new MethodologyCatalogError("methodology block integrity mismatch: " + block.ref);
  }
}

export function selectMethodologyBlocks(
  catalog: MethodologyCatalog,
  refs: readonly string[],
): MethodologyBlock[] {
  if (!Array.isArray(refs)) throw new MethodologyCatalogError("methodology refs must be an array");
  const unique = [...new Set(refs)].sort();
  if (unique.length !== refs.length) {
    throw new MethodologyCatalogError("methodology refs must be unique");
  }
  return unique.map((ref) => {
    const block = catalog.blocks.get(ref);
    if (!block) throw new MethodologyCatalogError("unknown methodology block: " + ref);
    validateMethodologyBlock(block);
    return block;
  });
}
