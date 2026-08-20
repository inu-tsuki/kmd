import { describe, expect, it } from "vitest";
import {
  StateStore,
  type StateKey,
  type StateSnapshot,
  type StateValue,
} from "@kmd/core/state/StateStore";

function documentKey(name: string): StateKey {
  return {
    level: "document",
    name,
    qualifiedName: `var.${name}`,
    declarationRange: { start: 0, end: name.length },
  };
}

function sceneKey(name: string, start = 100): StateKey {
  return {
    level: "scene",
    name,
    qualifiedName: `scene:${start}:${name}`,
    declarationRange: { start, end: start + name.length },
  };
}

describe("StateStore", () => {
  it("snapshots document state only and rebuilds scene state on entry", () => {
    const trust = documentKey("trust");
    const temp = sceneKey("temp");
    const store = new StateStore([{ key: trust, value: 2 }]);
    expect(store.enterScene([{ key: temp, value: 9 }]).ok).toBe(true);

    const snapshot = store.snapshot();
    expect(snapshot).toEqual({ schemaVersion: 1, document: { "var.trust": 2 } });

    store.set(trust, 7);
    store.set(temp, 12);
    expect(store.restore(snapshot).ok).toBe(true);
    expect(store.get(trust)).toBe(2);
    expect(store.get(temp)).toBe(12);

    expect(store.enterScene([]).ok).toBe(true);
    expect(store.get(temp)).toBeUndefined();
  });

  it("deep-clones point/domain values at every public boundary", () => {
    const route = documentKey("route");
    const source: StateValue = {
      type: "domain",
      start: { type: "point", x: 1, y: 2 },
      end: { type: "point", x: 3, y: 4 },
    };
    const store = new StateStore([{ key: route, value: source }]);

    source.start.x = 99;
    const read = store.get(route);
    expect(read).toMatchObject({ start: { x: 1 } });
    if (typeof read === "object" && read.type === "domain") read.end.y = 88;
    expect(store.get(route)).toMatchObject({ end: { y: 4 } });

    const snapshot = store.snapshot();
    const snapshotValue = snapshot.document["var.route"];
    if (typeof snapshotValue === "object" && snapshotValue.type === "domain") {
      snapshotValue.start.y = 77;
    }
    expect(store.get(route)).toMatchObject({ start: { y: 2 } });
  });

  it("validates restore and scene entry atomically", () => {
    const trust = documentKey("trust");
    const oldScene = sceneKey("old");
    const store = new StateStore([{ key: trust, value: 1 }]);
    store.enterScene([{ key: oldScene, value: true }]);

    const invalidSnapshot = {
      schemaVersion: 1,
      document: { "var.trust": 5, "var.bad": Number.NaN },
    } as StateSnapshot;
    expect(store.restore(invalidSnapshot)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "state-invalid-snapshot", key: "var.bad" }],
    });
    expect(store.get(trust)).toBe(1);

    const invalidEntry = store.enterScene([
      { key: sceneKey("next", 200), value: 4 },
      { key: documentKey("wrong"), value: 5 },
    ]);
    expect(invalidEntry.ok).toBe(false);
    expect(store.get(oldScene)).toBe(true);
    expect(store.get(sceneKey("next", 200))).toBeUndefined();
  });

  it("validates an interactive document patch before committing any write", () => {
    const score = documentKey("score");
    const route = documentKey("route");
    const store = new StateStore([
      { key: score, value: 1 },
      { key: route, value: "start" },
    ]);

    expect(store.applyDocumentPatchAtomic({ score: 2, route: Number.NaN }, [score, route]))
      .toMatchObject({ ok: false, diagnostics: [{ code: "state-invalid-value" }] });
    expect(store.get(score)).toBe(1);
    expect(store.get(route)).toBe("start");

    expect(store.applyDocumentPatchAtomic({ hidden: true }, [score, route]))
      .toMatchObject({ ok: false, diagnostics: [{ code: "state-write-not-permitted" }] });
    expect(store.applyDocumentPatchAtomic(new Map([["score", 3]]), [score]))
      .toMatchObject({ ok: false, diagnostics: [{ code: "state-invalid-patch" }] });
    expect(store.applyDocumentPatchAtomic({ score: 3 }, [score, sceneKey("temp")]))
      .toMatchObject({ ok: false, diagnostics: [{ code: "state-write-not-permitted" }] });
    expect(store.get(score)).toBe(1);

    const patch = { score: 4, route: "win" };
    expect(store.applyDocumentPatchAtomic(patch, [score, route])).toEqual({
      ok: true,
      diagnostics: [],
    });
    patch.score = 99;
    expect(store.get(score)).toBe(4);
    expect(store.get(route)).toBe("win");
  });

  it("allows a compiler-bound document key to receive its first value atomically", () => {
    const score = documentKey("score");
    const store = new StateStore();

    expect(store.has(score)).toBe(false);
    expect(store.applyDocumentPatchAtomic({ score: 7 }, [score])).toEqual({
      ok: true,
      diagnostics: [],
    });
    expect(store.get(score)).toBe(7);
  });

  it("rejects extra fields and accessors in untrusted structured values", () => {
    const point = documentKey("point");
    const store = new StateStore([{ key: point, value: 1 }]);
    const withFunction = {
      type: "point",
      x: 1,
      y: 2,
      execute: () => 42,
    };
    expect(store.applyDocumentPatchAtomic({ point: withFunction }, [point]))
      .toMatchObject({ ok: false, diagnostics: [{ code: "state-invalid-value" }] });
    expect(store.get(point)).toBe(1);

    let getterCalls = 0;
    const withAccessor = Object.defineProperties({}, {
      type: { value: "point", enumerable: true },
      x: { get: () => { getterCalls += 1; return 1; }, enumerable: true },
      y: { value: 2, enumerable: true },
    });
    expect(store.applyDocumentPatchAtomic({ point: withAccessor }, [point]))
      .toMatchObject({ ok: false, diagnostics: [{ code: "state-invalid-value" }] });
    expect(getterCalls).toBe(0);
    expect(store.get(point)).toBe(1);
  });

  it("rejects invalid values and returns stable inspection order", () => {
    const store = new StateStore();
    expect(store.set(documentKey("bad"), Number.POSITIVE_INFINITY)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "state-invalid-value" }],
    });
    expect(store.set(documentKey("alsoBad"), [] as unknown as StateValue).ok).toBe(false);
    expect(store.set({
      ...sceneKey("bad"),
      qualifiedName: "scene:unknown:bad",
    }, 1)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "state-key-level-mismatch" }],
    });

    store.set(documentKey("zeta"), 1);
    store.set(documentKey("alpha"), 2);
    expect(store.entries("document").map((entry) => entry.qualifiedName))
      .toEqual(["var.alpha", "var.zeta"]);
  });
});
