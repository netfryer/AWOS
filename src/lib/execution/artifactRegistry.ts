/**
 * In-memory ArtifactRegistry for worker outputs with stable sha256 hashing.
 * Supports caps, eviction, and excerpt retrieval.
 */

// ─── src/lib/execution/artifactRegistry.ts ─────────────────────────────────

import { createHash, randomUUID } from "crypto";

const MAX_CONTENT_SIZE = 200_000;
const DEFAULT_MAX_ARTIFACTS = 200;
const DEFAULT_MAX_TOTAL_CHARS = 10_000_000;
const DEFAULT_EXCERPT_HEAD = 8000;
const DEFAULT_EXCERPT_TAIL = 2000;

export interface CreateArtifactInput {
  packageId: string;
  modelId: string;
  content: string;
  createdAtISO: string;
}

export interface Artifact {
  artifactId: string;
  packageId: string;
  modelId: string;
  content: string;
  hash: string;
  createdAtISO: string;
  contentLength: number;
  isEvicted?: boolean;
}

export interface ArtifactMetadata {
  artifactId: string;
  packageId: string;
  modelId: string;
  hash: string;
  createdAtISO: string;
  contentLength: number;
  isEvicted?: boolean;
}

export interface ArtifactExcerptLimits {
  head?: number;
  tail?: number;
}

export interface ArtifactExcerpt {
  head: string;
  tail: string;
  totalLength: number;
  isEvicted: boolean;
}

interface ArtifactEntry {
  artifactId: string;
  packageId: string;
  modelId: string;
  content: string;
  hash: string;
  createdAtISO: string;
  contentLength: number;
  isEvicted: boolean;
  insertOrder: number;
}

export class InMemoryArtifactRegistry {
  private artifacts = new Map<string, ArtifactEntry>();
  private byPackageId = new Map<string, string[]>();
  private insertOrder = 0;
  private totalChars = 0;
  private readonly maxArtifacts: number;
  private readonly maxTotalChars: number;

  constructor(options?: { maxArtifacts?: number; maxTotalChars?: number }) {
    this.maxArtifacts = options?.maxArtifacts ?? DEFAULT_MAX_ARTIFACTS;
    this.maxTotalChars = options?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  }

  createArtifact(input: CreateArtifactInput): { artifactId: string; hash: string } {
    const content =
      input.content.length > MAX_CONTENT_SIZE
        ? input.content.slice(0, MAX_CONTENT_SIZE)
        : input.content;
    const hash = createHash("sha256").update(content, "utf8").digest("hex");
    const artifactId = randomUUID();
    const contentLength = content.length;
    const order = ++this.insertOrder;

    const entry: ArtifactEntry = {
      artifactId,
      packageId: input.packageId,
      modelId: input.modelId,
      content,
      hash,
      createdAtISO: input.createdAtISO,
      contentLength,
      isEvicted: false,
      insertOrder: order,
    };

    this.artifacts.set(artifactId, entry);
    const list = this.byPackageId.get(input.packageId) ?? [];
    list.push(artifactId);
    this.byPackageId.set(input.packageId, list);
    this.totalChars += contentLength;

    this.evictUntilWithinCaps();

    return { artifactId, hash };
  }

  private evictUntilWithinCaps(): void {
    const entries = [...this.artifacts.values()].sort((a, b) => a.insertOrder - b.insertOrder);
    for (const e of entries) {
      if (this.artifacts.size <= this.maxArtifacts && this.totalChars <= this.maxTotalChars) break;
      if (e.isEvicted) continue;
      this.totalChars -= e.contentLength;
      e.content = "";
      e.isEvicted = true;
    }
  }

  getArtifact(artifactId: string): Artifact | undefined {
    const e = this.artifacts.get(artifactId);
    if (!e) return undefined;
    return {
      artifactId: e.artifactId,
      packageId: e.packageId,
      modelId: e.modelId,
      content: e.content,
      hash: e.hash,
      createdAtISO: e.createdAtISO,
      contentLength: e.contentLength,
      isEvicted: e.isEvicted,
    };
  }

  getArtifactByPackageId(packageId: string): Artifact | undefined {
    const ids = this.byPackageId.get(packageId);
    if (!ids?.length) return undefined;
    const latestId = ids[ids.length - 1];
    return this.getArtifact(latestId);
  }

  getArtifactExcerptByPackageId(
    packageId: string,
    limits?: ArtifactExcerptLimits
  ): ArtifactExcerpt {
    const headLimit = limits?.head ?? DEFAULT_EXCERPT_HEAD;
    const tailLimit = limits?.tail ?? DEFAULT_EXCERPT_TAIL;

    const ids = this.byPackageId.get(packageId);
    if (!ids?.length) {
      return { head: "", tail: "", totalLength: 0, isEvicted: false };
    }
    const latestId = ids[ids.length - 1];
    const e = this.artifacts.get(latestId);
    if (!e) {
      return { head: "", tail: "", totalLength: 0, isEvicted: false };
    }

    const totalLength = e.contentLength;
    const isEvicted = e.isEvicted;
    const content = e.content;

    if (content.length === 0) {
      return { head: "", tail: "", totalLength, isEvicted };
    }

    let head: string;
    let tail: string;
    if (content.length <= headLimit + tailLimit) {
      head = content;
      tail = "";
    } else {
      head = content.slice(0, headLimit);
      tail = content.slice(-tailLimit);
    }

    return { head, tail, totalLength, isEvicted };
  }

  listArtifacts(): ArtifactMetadata[] {
    return [...this.artifacts.values()].map((a) => ({
      artifactId: a.artifactId,
      packageId: a.packageId,
      modelId: a.modelId,
      hash: a.hash,
      createdAtISO: a.createdAtISO,
      contentLength: a.contentLength,
      isEvicted: a.isEvicted,
    }));
  }
}
