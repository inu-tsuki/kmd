// Reader runtime 协议纯函数套件（主题一：织网 S1）。
//
// 钉死 ReaderRuntimeProtocol.ts 的纯函数层：命令信封解析（parseReaderRuntimeCommandEnvelope）
// 与事件信封工厂（createReaderRuntimeEventEnvelope）。零单例——Protocol.ts 仅以 import type
// 引用 Contract，运行时无任何依赖，本套件不与 parser/layout/stage/player 单例发生接触。
//
// 锚定口径（钉实现现状，不钉文档现状）：android-webview-runtime-protocol.md 在个别字段上
// 落后于实现（如 seek.timeMs 已被 ReaderRuntimeSession 支持、progress.line 不在文档任何表中）。
// 本套件只断言 Protocol.ts 的真实行为；实现超前文档处由 S3/S16 统一回注协议文档。
//
// 两条承重不变量（Phase B 重写期间尤其承重，宿主协议兼容性押在它们上面）：
//   (1) 解析通过时信封**同引用透传**，无拷贝、无字段规范化——宿主 payload 对象原样抵达 handler。
//   (2) 事件工厂未提供 id/sessionId 时键存在但为 undefined，JSON.stringify 后线上信封无此二键
//       （main.ts 正是 stringify 后发往 KmdAndroid/CustomEvent；宿主看到的形状以 stringify 输出为准）。

import { describe, it, expect } from 'vitest';
import {
  parseReaderRuntimeCommandEnvelope,
  createReaderRuntimeEventEnvelope,
  READER_RUNTIME_PROTOCOL_VERSION,
} from '@kmd/core/runtime/ReaderRuntimeProtocol';
import type {
  ReaderRuntimeCommandType,
  ReaderRuntimeEventType,
} from '@kmd/core/runtime/ReaderRuntimeContract';

const COMMAND_TYPES: ReaderRuntimeCommandType[] = [
  'loadScript',
  'play',
  'pause',
  'seek',
  'setInspectionEnabled',
  'updateSettings',
  'dispose',
];

const EVENT_TYPES: ReaderRuntimeEventType[] = [
  'runtimeReady',
  'ready',
  'progressChanged',
  'playbackStateChanged',
  'inspectionReported',
  'error',
];

describe('reader runtime protocol version constant', () => {
  it('is the literal 1 (host compat hinge; bumping = protocol negotiation work)', () => {
    expect(READER_RUNTIME_PROTOCOL_VERSION).toBe(1);
  });
});

describe('parseReaderRuntimeCommandEnvelope — object path', () => {
  it('accepts a minimal valid envelope and passes it through by reference', () => {
    const envelope = { version: 1 as const, id: 'c-1', type: 'play', payload: {} };
    const result = parseReaderRuntimeCommandEnvelope(envelope);
    expect(result.error).toBeNull();
    // 同引用透传（不变量 1）：handler 拿到的就是宿主传入的对象本身。
    expect(result.command).toBe(envelope);
  });

  it('preserves unknown extra fields without normalization', () => {
    const envelope = {
      version: 1 as const,
      id: 'c-2',
      type: 'pause',
      payload: {},
      futureField: 42,
      nested: { a: [1, 2] },
    };
    const result = parseReaderRuntimeCommandEnvelope(envelope);
    expect(result.error).toBeNull();
    expect((result.command as unknown as Record<string, unknown>).futureField).toBe(42);
    expect((result.command as unknown as Record<string, unknown>).nested).toEqual({ a: [1, 2] });
  });

  it.each(COMMAND_TYPES)('accepts known command type %s', (type) => {
    const result = parseReaderRuntimeCommandEnvelope({
      version: 1,
      id: `c-${type}`,
      type,
      payload: {},
    } as never);
    expect(result.error).toBeNull();
    expect(result.command?.type).toBe(type);
  });

  // 校验顺序是承重语义：宿主依赖错误码的确定性（如 version 不符时不应抱怨 id）。
  describe('validation precedence', () => {
    it('rejects unsupported version before checking id (version 2 with valid id)', () => {
      const result = parseReaderRuntimeCommandEnvelope({
        version: 2 as never,
        id: 'c-9',
        type: 'play',
      } as never);
      expect(result.command).toBeNull();
      expect(result.error?.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
      // version 错误在 id 存在时回显 commandId（供宿主关联失败命令）。
      expect(result.error?.commandId).toBe('c-9');
    });

    it('rejects missing version even when id is also missing (version check wins)', () => {
      const result = parseReaderRuntimeCommandEnvelope({ type: 'play' } as never);
      expect(result.error?.code).toBe('UNSUPPORTED_PROTOCOL_VERSION');
    });

    it('rejects missing id with COMMAND_ID_MISSING and no commandId echo', () => {
      const result = parseReaderRuntimeCommandEnvelope({ version: 1, type: 'play' } as never);
      expect(result.error?.code).toBe('COMMAND_ID_MISSING');
      expect(result.error?.commandId).toBeUndefined();
    });

    it('rejects non-string id (numeric) as COMMAND_ID_MISSING', () => {
      const result = parseReaderRuntimeCommandEnvelope({ version: 1, id: 42, type: 'play' } as never);
      expect(result.error?.code).toBe('COMMAND_ID_MISSING');
      expect(result.error?.commandId).toBeUndefined();
    });

    it('rejects missing type with COMMAND_TYPE_MISSING and echoes commandId', () => {
      const result = parseReaderRuntimeCommandEnvelope({ version: 1, id: 'c-3' } as never);
      expect(result.error?.code).toBe('COMMAND_TYPE_MISSING');
      expect(result.error?.commandId).toBe('c-3');
    });

    it('rejects non-string type as COMMAND_TYPE_MISSING', () => {
      const result = parseReaderRuntimeCommandEnvelope({ version: 1, id: 'c-4', type: 7 } as never);
      expect(result.error?.code).toBe('COMMAND_TYPE_MISSING');
      expect(result.error?.commandId).toBe('c-4');
    });

    it('rejects unknown command type with UNKNOWN_COMMAND and echoes commandId', () => {
      const result = parseReaderRuntimeCommandEnvelope({
        version: 1,
        id: 'c-5',
        type: 'rewind',
      } as never);
      expect(result.error?.code).toBe('UNKNOWN_COMMAND');
      expect(result.error?.commandId).toBe('c-5');
      expect(result.error?.message).toContain('rewind');
    });
  });
});

describe('parseReaderRuntimeCommandEnvelope — string path', () => {
  it('parses a valid JSON string identically to the object path', () => {
    const object = { version: 1 as const, id: 's-1', type: 'seek', payload: { progress: 0.5 } };
    const viaObject = parseReaderRuntimeCommandEnvelope(object);
    const viaString = parseReaderRuntimeCommandEnvelope(JSON.stringify(object));
    expect(viaString.error).toBeNull();
    expect(viaString.command).toEqual(viaObject.command);
    // payload 深透传：嵌套对象原样保留。
    expect(viaString.command?.payload).toEqual({ progress: 0.5 });
  });

  it('routes malformed JSON to COMMAND_JSON_INVALID with a non-empty message', () => {
    const result = parseReaderRuntimeCommandEnvelope('{not json');
    expect(result.command).toBeNull();
    expect(result.error?.code).toBe('COMMAND_JSON_INVALID');
    // message 透传底层 JSON.parse 错误文本（V8 版本相关，不钉具体措辞，只钉非空）。
    expect(typeof result.error?.message).toBe('string');
    expect((result.error?.message ?? '').length).toBeGreaterThan(0);
    expect(result.error?.commandId).toBeUndefined();
  });

  it('routes the empty string to COMMAND_JSON_INVALID', () => {
    expect(parseReaderRuntimeCommandEnvelope('').error?.code).toBe('COMMAND_JSON_INVALID');
  });

  it.each([
    ['array', '[1, 2, 3]'],
    ['string literal', '"play"'],
    ['number', '42'],
    ['null', 'null'],
    ['boolean', 'true'],
  ])('routes valid JSON non-object (%s) to COMMAND_ENVELOPE_INVALID', (_label, json) => {
    const result = parseReaderRuntimeCommandEnvelope(json);
    expect(result.command).toBeNull();
    expect(result.error?.code).toBe('COMMAND_ENVELOPE_INVALID');
    expect(result.error?.commandId).toBeUndefined();
  });

  it('still applies full validation after JSON parse (string path reaches the same error codes)', () => {
    expect(
      parseReaderRuntimeCommandEnvelope(JSON.stringify({ version: 3, id: 's-2', type: 'play' })).error
        ?.code,
    ).toBe('UNSUPPORTED_PROTOCOL_VERSION');
    expect(
      parseReaderRuntimeCommandEnvelope(JSON.stringify({ version: 1, type: 'play' })).error?.code,
    ).toBe('COMMAND_ID_MISSING');
    expect(
      parseReaderRuntimeCommandEnvelope(JSON.stringify({ version: 1, id: 's-3' })).error?.code,
    ).toBe('COMMAND_TYPE_MISSING');
    expect(
      parseReaderRuntimeCommandEnvelope(JSON.stringify({ version: 1, id: 's-4', type: 'fly' })).error
        ?.code,
    ).toBe('UNKNOWN_COMMAND');
  });
});

describe('createReaderRuntimeEventEnvelope', () => {
  it('stamps protocol version and passes payload through by reference', () => {
    const payload = { workId: 'w-1', progress: 0.25 };
    const envelope = createReaderRuntimeEventEnvelope('progressChanged', payload);
    expect(envelope.version).toBe(READER_RUNTIME_PROTOCOL_VERSION);
    expect(envelope.type).toBe('progressChanged');
    expect(envelope.payload).toBe(payload);
  });

  it('keeps id/sessionId keys present-but-undefined when options omitted (wire shape: absent after stringify)', () => {
    const envelope = createReaderRuntimeEventEnvelope('ready', { workId: 'w-2' });
    // 键存在但 undefined（实现现状：工厂总是展开两个键）。
    expect('id' in envelope).toBe(true);
    expect('sessionId' in envelope).toBe(true);
    expect(envelope.id).toBeUndefined();
    expect(envelope.sessionId).toBeUndefined();
    // 不变量 2：宿主经 JSON.stringify 看到的线上信封不含此二键。
    const wire = JSON.parse(JSON.stringify(envelope));
    expect('id' in wire).toBe(false);
    expect('sessionId' in wire).toBe(false);
    expect(wire).toEqual({ version: 1, type: 'ready', payload: { workId: 'w-2' } });
  });

  it('carries id/sessionId onto the wire when provided', () => {
    const envelope = createReaderRuntimeEventEnvelope(
      'error',
      { message: 'boom', code: 'COMMAND_FAILED' },
      { id: 'evt-1', sessionId: 'sess-1' },
    );
    expect(envelope.id).toBe('evt-1');
    expect(envelope.sessionId).toBe('sess-1');
    const wire = JSON.parse(JSON.stringify(envelope));
    expect(wire.id).toBe('evt-1');
    expect(wire.sessionId).toBe('sess-1');
  });

  // 六个事件类型的 payload 映射编译期覆盖（EventPayloadMap 类型回归的持久层）。
  it.each(EVENT_TYPES)('produces a well-formed envelope for event type %s', (type) => {
    const payloads = {
      runtimeReady: { runtime: 'reader-runtime-web', version: 1 },
      ready: { workId: 'w' },
      progressChanged: { workId: 'w', progress: 0 },
      playbackStateChanged: { isPlaying: false, state: 'idle' as const },
      inspectionReported: { issues: [] },
      error: { message: 'm' },
    } as const;
    const envelope = createReaderRuntimeEventEnvelope(type, payloads[type] as never);
    expect(envelope.version).toBe(1);
    expect(envelope.type).toBe(type);
    expect(envelope.payload).toEqual(payloads[type]);
  });
});
