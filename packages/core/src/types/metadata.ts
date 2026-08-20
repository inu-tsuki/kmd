/** Metadata exposed by ScriptPlayer after the production document is compiled. */
export interface KmdRuntimeMetadata {
  title?: string;
  author?: string;
  mode?: 'stage' | 'scroll' | 'page';
  designWidth?: number;
  designHeight?: number;
  fontSize?: number;
  lineHeight?: number;
  maxWidth?: number;
  speed?: number;
  variables?: Record<string, unknown>;
}
