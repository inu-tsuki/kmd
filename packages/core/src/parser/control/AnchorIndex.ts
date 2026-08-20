import type { DocumentAst } from "../document/types";
import type { AnchorLocation, ControlDiagnostic } from "./types";

/** 锚点只参与文档控制流寻址，因此使用独立索引，不进入 DefinitionIndex 的主语/值查找链。 */
export class AnchorIndex {
  private readonly locations: AnchorLocation[] = [];
  private readonly firstByName = new Map<string, AnchorLocation>();
  private readonly indexDiagnostics: ControlDiagnostic[] = [];

  public add(location: AnchorLocation): AnchorLocation {
    const stored = cloneLocation(location);
    const existing = this.firstByName.get(stored.name);
    if (existing !== undefined) {
      this.indexDiagnostics.push({
        code: "control-duplicate-anchor",
        severity: "error",
        message: `Anchor "${stored.name}" is declared more than once in this document.`,
        range: { ...stored.declarationRange },
        relatedRange: { ...existing.declarationRange },
      });
    } else {
      this.firstByName.set(stored.name, stored);
    }
    this.locations.push(stored);
    return cloneLocation(stored);
  }

  public resolve(name: string): AnchorLocation | null {
    const location = this.firstByName.get(name);
    return location === undefined ? null : cloneLocation(location);
  }

  public all(): AnchorLocation[] {
    return this.locations.map(cloneLocation);
  }

  public diagnostics(): ControlDiagnostic[] {
    return this.indexDiagnostics.map((entry) => ({
      ...entry,
      range: { ...entry.range },
      relatedRange: entry.relatedRange === undefined ? undefined : { ...entry.relatedRange },
    }));
  }

  public static fromDocument(document: DocumentAst): AnchorIndex {
    const index = new AnchorIndex();
    for (const scene of document.scenes) {
      for (const line of scene.lines) {
        if (line.type !== "anchor-line" && line.type !== "anchor-content-line") continue;
        index.add({
          id: `anchor:${scene.index}:${line.index}:${line.name}:${line.nameRange.start}`,
          name: line.name,
          sceneIndex: scene.index,
          lineIndex: line.index,
          position: { offset: line.range.start },
          declarationRange: { ...line.nameRange },
          rendered: line.type === "anchor-content-line",
        });
      }
    }
    return index;
  }
}

function cloneLocation(location: AnchorLocation): AnchorLocation {
  return {
    ...location,
    position: { ...location.position },
    declarationRange: { ...location.declarationRange },
  };
}
