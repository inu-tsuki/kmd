import type {
  ReaderRuntimeCommandEnvelope,
  ReaderRuntimeCommandType,
  ReaderRuntimeEventEnvelope,
  ReaderRuntimeEventPayloadMap,
  ReaderRuntimeEventType,
  ReaderRuntimeProtocolVersion,
} from "./ReaderRuntimeContract";

export const READER_RUNTIME_PROTOCOL_VERSION: ReaderRuntimeProtocolVersion = 1;

const COMMAND_TYPES: ReadonlySet<string> = new Set<ReaderRuntimeCommandType>([
  "loadScript",
  "play",
  "pause",
  "seek",
  "setInspectionEnabled",
  "updateSettings",
  "dispose",
]);

export interface ReaderRuntimeCommandParseError {
  code: string;
  message: string;
  commandId?: string;
}

export interface ReaderRuntimeCommandParseResult {
  command: ReaderRuntimeCommandEnvelope | null;
  error: ReaderRuntimeCommandParseError | null;
}

export function parseReaderRuntimeCommandEnvelope(
  message: string | ReaderRuntimeCommandEnvelope,
): ReaderRuntimeCommandParseResult {
  if (typeof message !== "string") {
    return validateCommandEnvelope(message);
  }

  const raw = parseCommandJson(message);
  if (raw.error) {
    return {
      command: null,
      error: raw.error,
    };
  }

  return validateCommandEnvelope(raw.value);
}

function validateCommandEnvelope(
  envelope: Partial<ReaderRuntimeCommandEnvelope>,
): ReaderRuntimeCommandParseResult {
  const commandId = typeof envelope.id === "string" ? envelope.id : undefined;

  if (envelope.version !== READER_RUNTIME_PROTOCOL_VERSION) {
    return {
      command: null,
      error: {
        commandId,
        code: "UNSUPPORTED_PROTOCOL_VERSION",
        message: `Unsupported runtime protocol version: ${String(envelope.version)}`,
      },
    };
  }

  if (!commandId) {
    return {
      command: null,
      error: {
        code: "COMMAND_ID_MISSING",
        message: "Runtime command envelope requires a string id.",
      },
    };
  }

  if (typeof envelope.type !== "string") {
    return {
      command: null,
      error: {
        commandId,
        code: "COMMAND_TYPE_MISSING",
        message: "Runtime command envelope requires a string type.",
      },
    };
  }

  if (!COMMAND_TYPES.has(envelope.type)) {
    return {
      command: null,
      error: {
        commandId,
        code: "UNKNOWN_COMMAND",
        message: `Unknown runtime command: ${envelope.type}`,
      },
    };
  }

  return {
    command: envelope as ReaderRuntimeCommandEnvelope,
    error: null,
  };
}

export function createReaderRuntimeEventEnvelope<TType extends ReaderRuntimeEventType>(
  type: TType,
  payload: ReaderRuntimeEventPayloadMap[TType],
  options: {
    id?: string;
    sessionId?: string;
  } = {},
): ReaderRuntimeEventEnvelope<TType> {
  return {
    version: READER_RUNTIME_PROTOCOL_VERSION,
    id: options.id,
    sessionId: options.sessionId,
    type,
    payload,
  };
}

function parseCommandJson(message: string): {
  value: Partial<ReaderRuntimeCommandEnvelope>;
  error: null;
} | {
  value: null;
  error: ReaderRuntimeCommandParseError;
} {
  try {
    const parsed = JSON.parse(message) as unknown;
    if (!isRecord(parsed)) {
      return {
        value: null,
        error: {
          code: "COMMAND_ENVELOPE_INVALID",
          message: "Runtime command must be a JSON object.",
        },
      };
    }
    return {
      value: parsed,
      error: null,
    };
  } catch (error) {
    return {
      value: null,
      error: {
        code: "COMMAND_JSON_INVALID",
        message: error instanceof Error ? error.message : "Runtime command is not valid JSON.",
      },
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
