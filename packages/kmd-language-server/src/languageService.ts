import { parser } from '@kmd/core/parser/Parser';
import type { Diagnostic } from 'vscode-languageserver/node';
import type { CompletionItem, Position } from 'vscode-languageserver/node';
import { toLspDiagnostics } from './diagnostics';
import { provideKmdCompletions } from './completion';

export function validateKmdText(source: string): Diagnostic[] {
  return toLspDiagnostics(source, parser.validate(source));
}

export function completeKmdText(source: string, position: Position): CompletionItem[] {
  return provideKmdCompletions(source, position);
}
