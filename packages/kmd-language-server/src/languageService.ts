import { parser } from '@kmd/core/parser/Parser';
import type { Diagnostic } from 'vscode-languageserver/node';
import { toLspDiagnostics } from './diagnostics';

export function validateKmdText(source: string): Diagnostic[] {
  return toLspDiagnostics(source, parser.validate(source));
}
