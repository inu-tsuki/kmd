import {
  createConnection,
  ProposedFeatures,
  TextDocuments,
  TextDocumentSyncKind,
  type InitializeResult,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { validateKmdText } from './languageService';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

connection.onInitialize((): InitializeResult => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Incremental,
  },
  serverInfo: {
    name: 'kmd-language-server',
    version: '0.1.0',
  },
}));

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
