import type { PieceLog } from '@sensinth/core';

/** A piece that was played, as it is kept on this device. */
export interface PieceRecord {
  /** When it started, ms since the epoch; also its id. */
  id: number;
  /** Which piece of its session, from 1. */
  number: number;
  styleId: string;
  styleName: string;
  key: string;
  bpm: number;
  seconds: number;
  /** It played to its last chord (false: stopped before the end). */
  complete: boolean;
  /** Its form, and what each sensor did in it. */
  log: PieceLog;
  /** The recording, when this browser can record. */
  audio?: Blob;
}

/** How many pieces are kept: each new one replaces the oldest. */
export const KEEP_PIECES = 3;

const DB = 'sensinth';
const STORE = 'pieces';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'));
  });
}

/**
 * The last few pieces, newest first, kept in the browser's own database so
 * they survive a reload. Where there is no database (a private window), they
 * are kept until the page closes.
 */
export class PieceShelf {
  private memory: PieceRecord[] = [];
  private persistent = typeof indexedDB !== 'undefined';
  /** Called whenever the shelf changes. */
  onChange: () => void = () => {};

  async list(): Promise<PieceRecord[]> {
    if (this.persistent) {
      try {
        const db = await open();
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        await done(tx);
        db.close();
        return (req.result as PieceRecord[]).sort((a, b) => b.id - a.id);
      } catch {
        this.persistent = false;
      }
    }
    return [...this.memory].sort((a, b) => b.id - a.id);
  }

  /** Adds a piece and drops the oldest beyond `KEEP_PIECES`. */
  async add(piece: PieceRecord): Promise<void> {
    if (this.persistent) {
      try {
        const db = await open();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        store.put(piece);
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          const ids = (keys.result as number[]).sort((a, b) => b - a);
          for (const id of ids.slice(KEEP_PIECES)) store.delete(id);
        };
        await done(tx);
        db.close();
        this.onChange();
        return;
      } catch {
        this.persistent = false;
      }
    }
    this.memory = [piece, ...this.memory].sort((a, b) => b.id - a.id).slice(0, KEEP_PIECES);
    this.onChange();
  }
}

/** Audio formats a browser may record, best first. */
const TAPE_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm'];

export function tapeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return TAPE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/** The file extension of a recording. */
export function tapeExtension(blob: Blob | undefined): string {
  const type = blob?.type ?? '';
  return type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
}

/**
 * Records what plays, one piece at a time. Each piece gets its own recorder
 * on the same stream, so one can end while the next has already begun.
 */
export class Tape {
  private readonly dest: MediaStreamAudioDestinationNode | undefined;
  private readonly type = tapeType();

  constructor(ctx: AudioContext, from: AudioNode) {
    if (this.type) {
      this.dest = ctx.createMediaStreamDestination();
      from.connect(this.dest);
    }
  }

  get available(): boolean {
    return this.dest !== undefined;
  }

  /** Starts recording; the function returned stops it and gives the recording. */
  start(): () => Promise<Blob | undefined> {
    const { dest, type } = this;
    if (!dest || !type) return () => Promise.resolve(undefined);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(dest.stream, { mimeType: type, audioBitsPerSecond: 160_000 });
    } catch {
      return () => Promise.resolve(undefined);
    }
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    const stopped = new Promise<Blob | undefined>((resolve) => {
      recorder.onstop = () => resolve(chunks.length > 0 ? new Blob(chunks, { type }) : undefined);
      recorder.onerror = () => resolve(undefined);
    });
    recorder.start(2000);
    return () => {
      if (recorder.state !== 'inactive') recorder.stop();
      return stopped;
    };
  }
}
