import { MAX_MOBILE_SNAPSHOT_BYTES, parseMobileSnapshot } from "./mobileSnapshot";
import type { MobileSnapshotV1 } from "./mobileSnapshotTypes";

export class MobileStorageError extends Error {
  constructor(
    public readonly code:
      "unavailable" | "changed" | "corrupt" | "version" | "stale" | "epoch" | "busy",
    message: string,
  ) {
    super(message);
    this.name = "MobileStorageError";
  }
}
export interface SnapshotBinding {
  installationId: string;
  profileId: string;
  epoch: string;
}
export interface StoredSnapshot {
  id: string;
  installationId: string;
  profileId: string;
  epoch: string;
  sequence: string;
  envelopeVersion: number;
  viewerVersion: number;
  schemaVersion: number;
  revision: string;
  key: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}
export interface StoreState {
  record?: StoredSnapshot;
  fence: string;
  active: string | null;
}
export interface SnapshotBackend {
  remembered?(): Promise<boolean>;
  remember?(fence?: string): Promise<void>;
  state(id: string): Promise<StoreState>;
  list(): Promise<{ records: StoredSnapshot[]; active: string | null }>;
  commit(record: StoredSnapshot, priorRevision: string | null, fence: string): Promise<void>;
  remove(id?: string): Promise<void>;
  select(id: string): Promise<void>;
  subscribe?(listener: (removed: boolean) => void): () => void;
}
function metadata(r: StoredSnapshot): Uint8Array<ArrayBuffer> {
  // This ordered header is AES-GCM authenticated data; preserve field order.
  return new TextEncoder().encode(
    JSON.stringify([
      r.envelopeVersion,
      r.viewerVersion,
      r.schemaVersion,
      r.installationId,
      r.profileId,
      r.epoch,
      r.sequence,
      r.revision,
    ]),
  );
}
function checkRecord(r: StoredSnapshot): void {
  if (!r || r.envelopeVersion !== 1 || r.viewerVersion !== 1 || r.schemaVersion !== 1)
    throw new MobileStorageError(
      "version",
      "This saved copy needs a newer viewer. Reconnect to your desktop.",
    );
  // Retain short-circuit order: syntax/type checks precede BigInt and property reads.
  const invalidStoredCopy =
    r.id !== `${r.installationId}/${r.profileId}` ||
    !/^[A-Za-z0-9_-]+$/.test(r.installationId) ||
    !/^[A-Za-z0-9_-]+$/.test(r.profileId) ||
    !/^[A-Za-z0-9_-]+$/.test(r.epoch) ||
    !/^[a-f0-9]{32}$/.test(r.revision) ||
    !/^(0|[1-9]\d{0,19})$/.test(r.sequence) ||
    BigInt(r.sequence) > 18446744073709551615n ||
    !(r.iv instanceof Uint8Array) ||
    r.iv.byteLength !== 12 ||
    !(r.ciphertext instanceof ArrayBuffer) ||
    r.ciphertext.byteLength < 16 ||
    r.ciphertext.byteLength > MAX_MOBILE_SNAPSHOT_BYTES + 16 ||
    !r.key ||
    r.key.type !== "secret" ||
    r.key.extractable ||
    r.key.algorithm.name !== "AES-GCM" ||
    (r.key.algorithm as AesKeyAlgorithm).length !== 256 ||
    !r.key.usages.includes("encrypt") ||
    !r.key.usages.includes("decrypt");
  if (invalidStoredCopy)
    throw new MobileStorageError(
      "corrupt",
      "A saved copy could not be opened. Reconnect to refresh it or remove the saved copy.",
    );
}
export function randomRevision(crypto: Crypto): string {
  return [...crypto.getRandomValues(new Uint8Array(16))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
}

/** No network or desktop API. Bindings/epoch-reset approval come from authenticated pairing,
 * never from JSON. Crypto runs before the backend's short atomic compare-and-swap transaction. */
export class MobileRepository {
  async remembered(): Promise<boolean> {
    return (await this.backend.remembered?.()) ?? false;
  }
  async remember(fence?: string): Promise<void> {
    if (!this.backend.remember)
      throw new MobileStorageError(
        "unavailable",
        "This browser cannot remember access. Enable browser storage and pair again.",
      );
    await this.backend.remember(fence);
  }
  async accessFence(): Promise<string> {
    return (await this.backend.state("")).fence;
  }
  private readonly inFlight = new Set<string>();
  private generation = 0;
  constructor(
    private readonly backend: SnapshotBackend,
    private readonly crypto: Crypto = globalThis.crypto,
  ) {}
  /** Capture this before starting a network request, so a response cannot resurrect
   * copies forgotten while the request was in flight, including across browser tabs. */
  async prepareRefresh(binding: SnapshotBinding): Promise<{ id: string; fence: string }> {
    const id = `${binding.installationId}/${binding.profileId}`;
    return { id, fence: (await this.backend.state(id)).fence };
  }
  async replace(
    json: string,
    binding: SnapshotBinding,
    options: { replaceEpoch?: string; guard?: { id: string; fence: string } } = {},
  ): Promise<"saved" | "unchanged"> {
    const snapshot = parseMobileSnapshot(json, binding);
    if (snapshot.epoch !== binding.epoch)
      throw new MobileStorageError(
        "epoch",
        "The snapshot epoch does not match the approved desktop connection.",
      );
    const id = `${binding.installationId}/${binding.profileId}`;
    if (this.inFlight.has(id))
      throw new MobileStorageError("busy", "A refresh for this profile is already in progress.");
    this.inFlight.add(id);
    const generation = this.generation;
    try {
      // Validate the removal fence and prior identity before preparing encrypted replacement.
      const state = await this.backend.state(id),
        old = state.record;
      if (options.guard && (options.guard.id !== id || options.guard.fence !== state.fence))
        throw new MobileStorageError(
          "changed",
          "This refresh began before saved data was removed. Refresh again.",
        );
      if (old) {
        checkRecord(old);
        if (old.epoch !== binding.epoch && options.replaceEpoch !== old.epoch)
          throw new MobileStorageError(
            "epoch",
            "Reconnect to confirm that your desktop identity has changed.",
          );
        if (old.epoch === snapshot.epoch) {
          if (BigInt(snapshot.sequence) < BigInt(old.sequence))
            throw new MobileStorageError(
              "stale",
              "An older refresh was ignored. Your saved snapshot is unchanged.",
            );
          if (snapshot.sequence === old.sequence) return "unchanged";
        }
      }
      if (!this.crypto?.subtle)
        throw new MobileStorageError(
          "unavailable",
          "Encrypted storage is unavailable in this browser. Use the trusted desktop web address.",
        );
      // Prepare crypto outside the backend's short compare-and-swap transaction.
      const key =
        old?.key ??
        (await this.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
          "encrypt",
          "decrypt",
        ]));
      const record: StoredSnapshot = {
        id,
        installationId: binding.installationId,
        profileId: binding.profileId,
        epoch: snapshot.epoch,
        sequence: snapshot.sequence,
        envelopeVersion: 1,
        viewerVersion: 1,
        schemaVersion: 1,
        revision: randomRevision(this.crypto),
        key,
        iv: this.crypto.getRandomValues(new Uint8Array(12)),
        ciphertext: new ArrayBuffer(0),
      };
      record.ciphertext = await this.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: record.iv, additionalData: metadata(record), tagLength: 128 },
        key,
        new TextEncoder().encode(json),
      );
      if (generation !== this.generation)
        throw new MobileStorageError(
          "changed",
          "Saved data was removed while this refresh was prepared. Refresh again.",
        );
      // The backend also checks revision/fence atomically, including cross-tab removal.
      await this.backend.commit(record, old?.revision ?? null, state.fence);
      return "saved";
    } finally {
      this.inFlight.delete(id);
    }
  }
  async load(): Promise<{
    snapshots: MobileSnapshotV1[];
    active: string | null;
    errors: MobileStorageError[];
  }> {
    const { records, active } = await this.backend.list(),
      snapshots: MobileSnapshotV1[] = [],
      errors: MobileStorageError[] = [];
    for (const record of records) {
      try {
        checkRecord(record);
        const plaintext = await this.crypto.subtle.decrypt(
          { name: "AES-GCM", iv: record.iv, additionalData: metadata(record), tagLength: 128 },
          record.key,
          record.ciphertext,
        );
        const snapshot = parseMobileSnapshot(
          new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
          { installationId: record.installationId, profileId: record.profileId },
        );
        if (snapshot.sequence !== record.sequence || snapshot.epoch !== record.epoch)
          throw new Error("header mismatch");
        snapshots.push(snapshot);
      } catch (error) {
        errors.push(
          error instanceof MobileStorageError
            ? error
            : new MobileStorageError(
                "corrupt",
                "A saved copy could not be opened. Reconnect to refresh it or remove the saved copy.",
              ),
        );
      }
    }
    return { snapshots, active, errors };
  }
  async remove(id: string): Promise<void> {
    this.generation++;
    await this.backend.remove(id);
  }
  async forget(): Promise<void> {
    this.generation++;
    await this.backend.remove();
  }
  async select(id: string): Promise<void> {
    await this.backend.select(id);
  }
  subscribe(listener: () => void): () => void {
    return (
      this.backend.subscribe?.((removed) => {
        if (removed) this.generation++;
        listener();
      }) ?? (() => undefined)
    );
  }
}
