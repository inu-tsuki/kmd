import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeResult,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { completeKmdText, validateKmdText } from './languageService';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    completionProvider: {
      triggerCharacters: ['.', ' ', '@', '(', ':'],
    },
  },
  serverInfo: {
    name: 'kmd-language-server',
    version: '0.1.0',
  },
}));

connection.onCompletion(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  if (!document) return [];
  return completeKmdText(document.getText(), position);
});

documents.onDidChangeContent(({ document }) => {
  connection.sendDiagnostics({
    uri: document.uri,
    diagnostics: validateKmdText(document.getText()),
  });
});

documents.onDidClose(({ document }) => {
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();
