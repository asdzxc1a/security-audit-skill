import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  DOMAIN_SCHEMA_VERSION,
  type AuditEvent,
  type AuditRunState,
} from "../domain/contracts";
import { reduceAuditState, replayAuditEvents } from "../domain/reducer";
import {
  EVENT_STORE_SCHEMA_VERSION,
  type AuditEventStore,
  type AuditProjection,
} from "./contracts";
import { projectAuditState } from "./projection";

const MAX_EVENT_BYTES = 1024 * 1024;
const EVENT_FILE_PATTERN = /^([0-9]{16})\.json$/;
const CHECKSUM_PATTERN = /^[a-f0-9]{64}$/;

const KNOWN_EVENT_TYPES = new Set([
  "run_created",
  "phase_advanced",
  "coverage_unit_registered",
  "assignment_created",
  "assignment_started",
  "assignment_completed",
  "coverage_resolved",
  "coverage_requeued",
  "coverage_reopened",
  "coverage_unit_added_by_critic",
  "coverage_classified",
  "candidate_registered",
  "candidate_linked_to_coverage",
  "candidate_disposition_recorded",
  "candidate_final_verified",
  "evidence_requirement_opened",
  "evidence_requirement_resolved",
  "run_completed",
  "run_marked_incomplete",
  "run_failed",
  "run_cancelled",
]);

interface StoredEventEnvelope {
  readonly storeVersion: typeof EVENT_STORE_SCHEMA_VERSION;
  readonly previousChecksum: string | null;
  readonly checksum: string;
  readonly event: AuditEvent;
}

interface RunHead {
  readonly storeVersion: typeof EVENT_STORE_SCHEMA_VERSION;
  readonly runId: string;
  readonly sequence: number;
  readonly checksum: string;
}

export type EventStoreErrorCode =
  | "invalid_run_id"
  | "corrupt_store"
  | "duplicate_event_id"
  | "sequence_conflict"
  | "event_too_large"
  | "io_error";

export class EventStoreError extends Error {
  readonly code: EventStoreErrorCode;

  constructor(code: EventStoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EventStoreError";
    this.code = code;
  }
}

function fail(code: EventStoreErrorCode, message: string, cause?: unknown): never {
  throw new EventStoreError(code, message, cause === undefined ? undefined : { cause });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRunId(runId: string): void {
  if (typeof runId !== "string" || runId.trim() !== runId || runId.length === 0) {
    fail("invalid_run_id", "runId must be non-empty trimmed text");
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("corrupt_store", "cannot canonicalize non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => canonicalJson(entry)).join(",") + "]";
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return (
      "{" +
      keys
        .map((key) => {
          const entry = value[key];
          if (entry === undefined) fail("corrupt_store", "cannot canonicalize undefined value");
          return JSON.stringify(key) + ":" + canonicalJson(entry);
        })
        .join(",") +
      "}"
    );
  }
  fail("corrupt_store", "unsupported canonical JSON value");
}

function checksumEvent(event: AuditEvent): string {
  return crypto.createHash("sha256").update(canonicalJson(event), "utf8").digest("hex");
}

function replayStoredEvents(events: readonly AuditEvent[]): AuditRunState | null {
  try {
    return replayAuditEvents(events);
  } catch (error) {
    fail("corrupt_store", "stored event stream is rejected by the domain reducer", error);
  }
}

function runDirectoryKey(runId: string): string {
  return crypto.createHash("sha256").update(runId, "utf8").digest("hex");
}

function eventFileName(sequence: number): string {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 9_999_999_999_999_999) {
    fail("sequence_conflict", "event sequence is outside the durable filename range");
  }
  return String(sequence).padStart(16, "0") + ".json";
}

function fsyncDirectory(directory: string): void {
  if (process.platform === "win32") return;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    fail("io_error", "failed to sync event-store directory " + directory, error);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function writeFileDurably(file: string, contents: string): void {
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(
      file,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
      0o600,
    );
    const bytes = Buffer.from(contents, "utf8");
    let written = 0;
    while (written < bytes.length) {
      const count = fs.writeSync(descriptor, bytes, written, bytes.length - written);
      if (count <= 0) fail("io_error", "durable write made no forward progress");
      written += count;
    }
    fs.fsyncSync(descriptor);
  } catch (error) {
    fail("io_error", "failed to write durable event-store file " + file, error);
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function parseJsonFile(file: string): unknown {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    fail("corrupt_store", "missing event-store file " + file, error);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("corrupt_store", "event-store path is not a regular non-symlink file: " + file);
  }
  if (stat.size > MAX_EVENT_BYTES) {
    fail("corrupt_store", "event-store file exceeds byte limit: " + file);
  }
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    fail("corrupt_store", "invalid JSON in event-store file " + file, error);
  }
}

function parseEnvelope(value: unknown, file: string): StoredEventEnvelope {
  if (!isObject(value)) fail("corrupt_store", "invalid event envelope in " + file);
  if (value.storeVersion !== EVENT_STORE_SCHEMA_VERSION) {
    fail("corrupt_store", "unsupported event-store version in " + file);
  }
  if (
    value.previousChecksum !== null &&
    (typeof value.previousChecksum !== "string" || !CHECKSUM_PATTERN.test(value.previousChecksum))
  ) {
    fail("corrupt_store", "invalid previous checksum in " + file);
  }
  if (typeof value.checksum !== "string" || !CHECKSUM_PATTERN.test(value.checksum)) {
    fail("corrupt_store", "invalid event checksum in " + file);
  }
  if (!isObject(value.event)) fail("corrupt_store", "missing event object in " + file);

  const event = value.event as unknown as AuditEvent;
  if (
    event.schemaVersion !== DOMAIN_SCHEMA_VERSION ||
    typeof event.eventId !== "string" ||
    typeof event.runId !== "string" ||
    !Number.isSafeInteger(event.sequence) ||
    typeof event.type !== "string" ||
    !KNOWN_EVENT_TYPES.has(event.type)
  ) {
    fail("corrupt_store", "invalid event identity fields in " + file);
  }

  const checksum = checksumEvent(event);
  if (checksum !== value.checksum) {
    fail("corrupt_store", "event checksum mismatch in " + file);
  }

  return {
    storeVersion: EVENT_STORE_SCHEMA_VERSION,
    previousChecksum: value.previousChecksum,
    checksum: value.checksum,
    event,
  };
}

function parseHead(value: unknown, file: string): RunHead {
  if (!isObject(value)) fail("corrupt_store", "invalid HEAD record in " + file);
  if (
    value.storeVersion !== EVENT_STORE_SCHEMA_VERSION ||
    typeof value.runId !== "string" ||
    typeof value.sequence !== "number" ||
    !Number.isSafeInteger(value.sequence) ||
    value.sequence < 1 ||
    typeof value.checksum !== "string" ||
    !CHECKSUM_PATTERN.test(value.checksum)
  ) {
    fail("corrupt_store", "invalid HEAD record in " + file);
  }
  return {
    storeVersion: EVENT_STORE_SCHEMA_VERSION,
    runId: value.runId,
    sequence: value.sequence,
    checksum: value.checksum,
  };
}

function assertStoredState(state: AuditRunState | null, runId: string): AuditRunState {
  if (state === null) fail("corrupt_store", "stored event stream for " + runId + " has no run state");
  return state;
}

export class FileAuditEventStore implements AuditEventStore {
  readonly root: string;

  constructor(root: string) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = fs.lstatSync(root);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("io_error", "event-store root must be a real directory");
    }
    this.root = fs.realpathSync(root);
  }

  append(event: AuditEvent): AuditRunState {
    requireRunId(event.runId);
    const stream = this.readStream(event.runId);

    const duplicate = stream.events.find((stored) => stored.eventId === event.eventId);
    if (duplicate) {
      if (canonicalJson(duplicate) === canonicalJson(event)) {
        return assertStoredState(replayStoredEvents(stream.events), event.runId);
      }
      fail("duplicate_event_id", "duplicate eventId " + event.eventId + " has different content");
    }

    const previousState = replayStoredEvents(stream.events);
    const nextState = reduceAuditState(previousState, event);

    const paths = this.ensureRunDirectories(event.runId);
    const checksum = checksumEvent(event);
    const envelope: StoredEventEnvelope = {
      storeVersion: EVENT_STORE_SCHEMA_VERSION,
      previousChecksum: stream.latestChecksum,
      checksum,
      event,
    };

    const finalFile = path.join(paths.events, eventFileName(event.sequence));
    const tempFile = path.join(
      paths.events,
      ".tmp-" + process.pid + "-" + crypto.randomUUID(),
    );

    const serialized = JSON.stringify(envelope, null, 2) + "\n";
    if (Buffer.byteLength(serialized, "utf8") > MAX_EVENT_BYTES) {
      fail("event_too_large", "event envelope exceeds durable byte limit");
    }

    try {
      writeFileDurably(tempFile, serialized);
      try {
        fs.linkSync(tempFile, finalFile);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EEXIST") {
          fail("sequence_conflict", "event sequence " + event.sequence + " already exists", error);
        }
        fail("io_error", "failed to publish event sequence " + event.sequence, error);
      }
      fs.unlinkSync(tempFile);
      fsyncDirectory(paths.events);
      this.writeHead(paths.run, {
        storeVersion: EVENT_STORE_SCHEMA_VERSION,
        runId: event.runId,
        sequence: event.sequence,
        checksum,
      });
    } catch (error) {
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // Leave no secondary error path; the original failure is authoritative.
        }
      }
      throw error;
    }

    return nextState;
  }

  readEvents(runId: string): readonly AuditEvent[] {
    requireRunId(runId);
    return this.readStream(runId).events;
  }

  loadState(runId: string): AuditRunState | null {
    return replayStoredEvents(this.readEvents(runId));
  }

  loadProjection(runId: string): AuditProjection | null {
    const state = this.loadState(runId);
    return state === null ? null : projectAuditState(state);
  }

  private runPaths(runId: string): { run: string; events: string; head: string } {
    const run = path.join(this.root, runDirectoryKey(runId));
    return {
      run,
      events: path.join(run, "events"),
      head: path.join(run, "HEAD.json"),
    };
  }

  private ensureDirectory(directory: string): void {
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        fail("io_error", "failed to create event-store directory " + directory, error);
      }
    }
    const stat = fs.lstatSync(directory);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("corrupt_store", "event-store directory is not a real directory: " + directory);
    }
  }

  private ensureRunDirectories(runId: string): { run: string; events: string; head: string } {
    const paths = this.runPaths(runId);
    this.ensureDirectory(paths.run);
    this.ensureDirectory(paths.events);
    return paths;
  }

  private writeHead(runDirectory: string, head: RunHead): void {
    const headFile = path.join(runDirectory, "HEAD.json");
    const tempFile = path.join(
      runDirectory,
      ".HEAD.tmp-" + process.pid + "-" + crypto.randomUUID(),
    );
    try {
      writeFileDurably(tempFile, JSON.stringify(head, null, 2) + "\n");
      fs.renameSync(tempFile, headFile);
      fsyncDirectory(runDirectory);
    } catch (error) {
      if (fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch {
          // Preserve original failure.
        }
      }
      if (error instanceof EventStoreError) throw error;
      fail("io_error", "failed to update event-store HEAD", error);
    }
  }

  private readHead(paths: { run: string; head: string }, runId: string): RunHead | null {
    if (!fs.existsSync(paths.head)) return null;
    const head = parseHead(parseJsonFile(paths.head), paths.head);
    if (head.runId !== runId) fail("corrupt_store", "HEAD runId mismatch");
    return head;
  }

  private readStream(runId: string): {
    events: AuditEvent[];
    envelopes: StoredEventEnvelope[];
    latestChecksum: string | null;
  } {
    const paths = this.runPaths(runId);
    if (!fs.existsSync(paths.run)) {
      return { events: [], envelopes: [], latestChecksum: null };
    }

    const runStat = fs.lstatSync(paths.run);
    if (runStat.isSymbolicLink() || !runStat.isDirectory()) {
      fail("corrupt_store", "run path is not a real directory");
    }
    if (!fs.existsSync(paths.events)) {
      fail("corrupt_store", "run directory is missing events directory");
    }
    const eventStat = fs.lstatSync(paths.events);
    if (eventStat.isSymbolicLink() || !eventStat.isDirectory()) {
      fail("corrupt_store", "events path is not a real directory");
    }

    const eventFiles: string[] = [];
    for (const entry of fs.readdirSync(paths.events, { withFileTypes: true })) {
      if (entry.name.startsWith(".tmp-")) continue;
      if (!entry.isFile() || !EVENT_FILE_PATTERN.test(entry.name)) {
        fail("corrupt_store", "unexpected event-store entry " + entry.name);
      }
      eventFiles.push(entry.name);
    }
    eventFiles.sort();

    const envelopes: StoredEventEnvelope[] = [];
    const events: AuditEvent[] = [];
    const eventIds = new Set<string>();
    let previousChecksum: string | null = null;

    for (let index = 0; index < eventFiles.length; index++) {
      const name = eventFiles[index];
      const match = EVENT_FILE_PATTERN.exec(name);
      if (!match) fail("corrupt_store", "invalid event filename " + name);
      const filenameSequence = Number(match[1]);
      const expectedSequence = index + 1;
      if (filenameSequence !== expectedSequence) {
        fail("corrupt_store", "event sequence gap at " + expectedSequence);
      }

      const file = path.join(paths.events, name);
      const envelope = parseEnvelope(parseJsonFile(file), file);
      if (envelope.event.runId !== runId) fail("corrupt_store", "event runId mismatch in " + name);
      if (envelope.event.sequence !== expectedSequence) {
        fail("corrupt_store", "event payload sequence mismatch in " + name);
      }
      if (envelope.previousChecksum !== previousChecksum) {
        fail("corrupt_store", "event checksum chain mismatch in " + name);
      }
      if (eventIds.has(envelope.event.eventId)) {
        fail("corrupt_store", "duplicate stored eventId " + envelope.event.eventId);
      }

      eventIds.add(envelope.event.eventId);
      envelopes.push(envelope);
      events.push(envelope.event);
      previousChecksum = envelope.checksum;
    }

    const head = this.readHead(paths, runId);
    if (events.length === 0) {
      if (head !== null) fail("corrupt_store", "HEAD exists without events");
      return { events, envelopes, latestChecksum: null };
    }

    const latest = envelopes[envelopes.length - 1];
    if (head === null) {
      this.writeHead(paths.run, {
        storeVersion: EVENT_STORE_SCHEMA_VERSION,
        runId,
        sequence: latest.event.sequence,
        checksum: latest.checksum,
      });
    } else if (head.sequence > latest.event.sequence) {
      fail("corrupt_store", "event stream is truncated behind HEAD");
    } else if (head.sequence === latest.event.sequence) {
      if (head.checksum !== latest.checksum) {
        fail("corrupt_store", "HEAD checksum does not match event tail");
      }
    } else {
      const witnessed = envelopes[head.sequence - 1];
      if (!witnessed || witnessed.checksum !== head.checksum) {
        fail("corrupt_store", "stale HEAD does not match its witnessed event");
      }
      this.writeHead(paths.run, {
        storeVersion: EVENT_STORE_SCHEMA_VERSION,
        runId,
        sequence: latest.event.sequence,
        checksum: latest.checksum,
      });
    }

    return { events, envelopes, latestChecksum: latest.checksum };
  }
}
