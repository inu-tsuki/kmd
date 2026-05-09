export interface ResolvedScriptSource {
  source: string;
  sourcePath?: string;
}

export class ScriptSourceLoader {
  public static looksLikeFilePath(input: string) {
    return !input.includes("\n") && (
      input.endsWith(".kmd") || input.startsWith("/")
    );
  }

  public static async resolve(input: string): Promise<ResolvedScriptSource> {
    if (!this.looksLikeFilePath(input)) {
      return { source: input };
    }

    const response = await fetch(input);
    const blob = await response.blob();
    return {
      source: await blob.text(),
      sourcePath: input,
    };
  }
}
