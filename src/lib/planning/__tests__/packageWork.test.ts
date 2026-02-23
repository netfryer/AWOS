import { describe, it, expect } from "vitest";
import { validateWorkPackages, type AtomicWorkPackage } from "../packageWork.js";

describe("validateWorkPackages", () => {
  const validWorker: AtomicWorkPackage = {
    id: "worker-1",
    role: "Worker",
    name: "Worker 1",
    description: "Implement",
    acceptanceCriteria: ["A", "B", "C"],
    inputs: {},
    outputs: {},
    dependencies: [],
    estimatedTokens: 500,
  };

  const validQa: AtomicWorkPackage = {
    id: "qa-1",
    role: "QA",
    name: "QA 1",
    description: "Review worker-1",
    acceptanceCriteria: ["A", "B", "C"],
    inputs: {},
    outputs: { pass: true, qualityScore: 0.5, defects: [] },
    dependencies: ["worker-1"],
    estimatedTokens: 200,
  };

  it("passes for valid Worker + QA packages", () => {
    expect(() => validateWorkPackages([validWorker, validQa])).not.toThrow();
  });

  it("throws for QA package with missing Worker dependency", () => {
    const badQa: AtomicWorkPackage = {
      ...validQa,
      id: "qa-bad",
      dependencies: ["nonexistent-worker"],
    };
    expect(() => validateWorkPackages([validWorker, badQa])).toThrow(
      /QA dependency "nonexistent-worker" must reference a Worker package/
    );
  });

  it("throws for QA package with zero dependencies", () => {
    const badQa: AtomicWorkPackage = {
      ...validQa,
      id: "qa-no-dep",
      dependencies: [],
    };
    expect(() => validateWorkPackages([validWorker, badQa])).toThrow(
      /QA package must have exactly 1 dependency/
    );
  });

  it("throws for QA package depending on another QA", () => {
    const qa2: AtomicWorkPackage = {
      ...validQa,
      id: "qa-2",
      dependencies: ["qa-1"],
    };
    expect(() => validateWorkPackages([validWorker, validQa, qa2])).toThrow(
      /QA dependency "qa-1" must reference a Worker package/
    );
  });

  it("throws for circular dependencies", () => {
    const pkgA: AtomicWorkPackage = {
      ...validWorker,
      id: "a",
      dependencies: ["b"],
    };
    const pkgB: AtomicWorkPackage = {
      ...validWorker,
      id: "b",
      acceptanceCriteria: ["A", "B", "C"],
      dependencies: ["a"],
    };
    expect(() => validateWorkPackages([pkgA, pkgB])).toThrow(/Circular dependencies/);
  });
});
