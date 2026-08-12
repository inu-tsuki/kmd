import { layout } from "../layout/LayoutEngine";

export class RuntimeValueResolver {
  public static resolveReference(value: any): number | undefined {
    if (typeof value !== "string") return undefined;

    const markerMatch = value.match(/^([\w-]+)\.([\w-]+)\.([xy])$/);
    if (markerMatch) {
      const [, name, type, coord] = markerMatch;
      const marker = layout.globalMarkers.get(`${name}.${type}`);
      if (marker) return coord === "x" ? marker.x : marker.y;
    }

    const varMatch = value.match(/^var\.([\w-]+)$/);
    if (varMatch) {
      const variable = layout.globalMarkers.get(`var.${varMatch[1]}`);
      if (variable) return variable.x;
    }

    return undefined;
  }

  public static resolveNumeric(value: any, fallback: number): number {
    if (typeof value === "number") return value;

    const referenced = this.resolveReference(value);
    if (referenced !== undefined) return referenced;

    const numeric = typeof value === "string" ? parseFloat(value) : NaN;
    return Number.isNaN(numeric) ? fallback : numeric;
  }
}
