import type { ParagraphAst, ParagraphIR, ParserAstTransform, ParserDiagnostic, ParserIrTransform } from "./types";

export const builtInAstTransforms: ParserAstTransform[] = [
  {
    name: "identity-ast",
    run(paragraph: ParagraphAst): ParagraphAst {
      return paragraph;
    },
  },
];

export const builtInIrTransforms: ParserIrTransform[] = [
  {
    name: "identity-ir",
    run(ir: ParagraphIR): ParagraphIR {
      return ir;
    },
  },
];

export function applyAstTransforms(
  paragraph: ParagraphAst,
  transforms: ParserAstTransform[],
  diagnostics: ParserDiagnostic[],
): ParagraphAst {
  return transforms.reduce((current, transform) => transform.run(current, diagnostics), paragraph);
}

export function applyIrTransforms(
  ir: ParagraphIR,
  transforms: ParserIrTransform[],
  diagnostics: ParserDiagnostic[],
): ParagraphIR {
  return transforms.reduce((current, transform) => transform.run(current, diagnostics), ir);
}
