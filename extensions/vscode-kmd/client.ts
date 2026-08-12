import type { ExtensionContext } from 'vscode';
import { join } from 'node:path';
import {
  LanguageClient,
  TransportKind,
  type LanguageClientOptions,
  type ServerOptions,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;

export function activate(context: ExtensionContext): void {
  const serverModule = join(context.extensionPath, 'dist', 'server.js');
  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'kmd' },
      { scheme: 'untitled', language: 'kmd' },
    ],
  };

  client = new LanguageClient(
    'kmdLanguageServer',
    'KMD Language Server',
    serverOptions,
    clientOptions,
  );
  context.subscriptions.push(client);
  void client.start();
}

export async function deactivate(): Promise<void> {
  const activeClient = client;
  client = undefined;
  if (activeClient) await activeClient.stop();
}
