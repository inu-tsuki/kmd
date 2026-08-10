import { resolveControlledSourceUrl } from "../runtime/RuntimeAssetPolicy";

export interface ResolvedScriptSource {
  source: string;
  sourcePath?: string;
}

export interface ScriptSourceLoaderPolicy {
  allowPathFetch?: boolean;
  assetBaseUrl?: string;
}

export class ScriptSourceLoader {
  private static policy: ScriptSourceLoaderPolicy = {
    allowPathFetch: false,
  };

  public static configure(policy: ScriptSourceLoaderPolicy) {
    this.policy = {
      ...this.policy,
      ...policy,
    };
  }

  public static looksLikeFilePath(input: string) {
    return !input.includes("\n") && (
      input.endsWith(".kmd") || input.startsWith("/")
    );
  }

  public static async resolve(
    input: string,
    policy: ScriptSourceLoaderPolicy = this.policy,
  ): Promise<ResolvedScriptSource> {
    if (!this.looksLikeFilePath(input)) {
      return { source: input };
    }

    if (!policy.allowPathFetch) {
      throw new Error(
        "Path-like script input is disabled. Pass host-provided source or a controlled sourceUrl through reader runtime.",
      );
    }

    const sourceUrl = resolveControlledSourceUrl(input, {
      assetBaseUrl: policy.assetBaseUrl,
    });
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      throw new Error(`Failed to load script source: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    return {
      source: await blob.text(),
      sourcePath: sourceUrl,
    };
  }
}
