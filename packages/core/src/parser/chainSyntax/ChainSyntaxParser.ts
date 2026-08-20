import { parseLiteral } from "./LiteralParser";
import { ParserCursor } from "./ParserCursor";
import type {
  ArgAst,
  BeatAst,
  BezierEasingAst,
  ChainDiagnostic,
  ChainExpressionAst,
  ChainSyntaxParseResult,
  ClauseMemberAst,
  CommandMemberAst,
  ConnectorAst,
  DotSubjectAst,
  EasingAst,
  ErrorNodeAst,
  ExpressionSliceAst,
  GranularityAst,
  GranularityUnit,
  IdentifierAst,
  IdentifierSubjectAst,
  InvalidValueAst,
  MemberAst,
  NameRefAst,
  NamedEasingAst,
  NumberLiteralAst,
  ReferenceMemberAst,
  SelectorSubjectAst,
  SentenceAst,
  SentenceSeparatorAst,
  SubjectAst,
  SyntaxNodeBase,
  TimeQuantityAst,
  ValueAst,
} from "./types";

interface Segment {
  start: number;
  end: number;
}

const GRANULARITY_UNITS: readonly GranularityUnit[] = ["char", "group", "block"];
const QUANTITY_KEYWORDS = new Set(["s", "ms", "char", "line", "self", "px", "deg"]);

export class ChainSyntaxParser {
  private readonly source: string;
  private readonly baseOffset: number;
  private readonly diagnostics: ChainDiagnostic[];
  private readonly cursor: ParserCursor;

  constructor(
    source: string,
    baseOffset = 0,
    diagnostics: ChainDiagnostic[] = [],
  ) {
    this.source = source;
    this.baseOffset = baseOffset;
    this.diagnostics = diagnostics;
    this.cursor = new ParserCursor(source, baseOffset, diagnostics);
  }

  parse(): ChainSyntaxParseResult {
    this.cursor.skipInlineWhitespace();
    const expressionStart = this.cursor.mark();
    const expressionEnd = trimEnd(this.source, expressionStart, this.source.length);

    const classified = this.parseDefinitionOrAssignment(expressionStart, expressionEnd);
    const expression = classified ?? this.parsePredicateExpression(expressionStart, expressionEnd);
    return { expression, diagnostics: this.diagnostics };
  }

  private parseDefinitionOrAssignment(
    expressionStart: number,
    expressionEnd: number,
  ): ChainExpressionAst | null {
    const equals = findTopLevelCharacter(
      this.source,
      "=",
      expressionStart,
      expressionEnd,
    );
    if (equals < 0) {
      return null;
    }

    const left = trimSegment(this.source, expressionStart, equals);
    const path = parseIdentifierPath(
      this.source.slice(left.start, left.end),
      this.baseOffset + left.start,
    );
    if (path === null) {
      return null;
    }

    const right = trimSegment(this.source, equals + 1, expressionEnd);
    const slice = this.expressionSlice(right.start, right.end);
    if (right.start === right.end) {
      this.addDiagnostic(
        "chain-unexpected-token",
        "Definition or assignment is missing its right-hand expression.",
        right.start,
        right.end,
      );
    }

    const kind = path.length === 1 ? "definition" : "assignment";
    const sentence: SentenceAst = {
      ...this.nodeBase(expressionStart, expressionEnd),
      type: "sentence",
      kind,
      subject: null,
      beats: [],
      payload: kind === "definition"
        ? { name: path[0], slice }
        : { path, slice },
    };

    this.cursor.advanceTo(expressionEnd);
    this.cursor.skipInlineWhitespace();
    return {
      ...this.nodeBase(expressionStart, expressionEnd),
      type: "chain-expression",
      sentences: [sentence],
      separators: [],
    };
  }

  private parsePredicateExpression(
    expressionStart: number,
    expressionEnd: number,
  ): ChainExpressionAst {
    const sentences: SentenceAst[] = [];
    const separators: SentenceSeparatorAst[] = [];

    if (expressionStart === expressionEnd) {
      const sentence = this.emptySentence(expressionStart);
      sentences.push(sentence);
      this.addDiagnostic(
        "chain-unexpected-token",
        "Expected a chain sentence.",
        expressionStart,
        expressionStart,
      );
    } else {
      while (this.cursor.position < expressionEnd) {
        const sentenceStart = this.cursor.position;
        sentences.push(this.parseSentence(expressionEnd));

        if (this.cursor.position <= sentenceStart) {
          this.cursor.consume();
        }

        let foundSeparator = false;
        while (this.cursor.position < expressionEnd) {
          const separatorStart = this.cursor.mark();
          const hadWhitespace = this.consumeInlineWhitespace(expressionEnd);
          if (this.cursor.position >= expressionEnd) {
            break;
          }

          let kind: SentenceSeparatorAst["kind"] | null = null;
          if (this.cursor.peek() === "+") {
            this.cursor.consume();
            this.consumeInlineWhitespace(expressionEnd);
            kind = "parallel";
          } else if (hadWhitespace) {
            kind = "slot";
          }

          if (kind !== null) {
            const separatorEnd = this.cursor.position;
            const separator: SentenceSeparatorAst = {
              ...this.nodeBase(separatorStart, separatorEnd),
              type: "sentence-separator",
              kind,
            };
            separators.push(separator);
            if (kind === "parallel") {
              this.addDiagnostic(
                "chain-parallel-not-enabled",
                "Parallel sentence execution is reserved but not enabled.",
                separatorStart,
                separatorEnd,
                "warning",
              );
            }
            if (this.cursor.position >= expressionEnd) {
              sentences.push(this.emptySentence(expressionEnd));
              this.addDiagnostic(
                "chain-unexpected-token",
                "Sentence separator is missing its following sentence.",
                expressionEnd,
                expressionEnd,
              );
              foundSeparator = false;
              break;
            }
            foundSeparator = true;
            break;
          }

          this.cursor.restore(separatorStart);
          const unexpectedStart = this.cursor.position;
          this.recoverUnexpectedTail(expressionEnd);
          this.addDiagnostic(
            "chain-unexpected-token",
            "Unexpected input after a complete sentence.",
            unexpectedStart,
            this.cursor.position,
          );
        }

        if (!foundSeparator) {
          break;
        }
      }
    }

    this.cursor.restore(expressionEnd);
    this.cursor.skipInlineWhitespace();
    return {
      ...this.nodeBase(expressionStart, expressionEnd),
      type: "chain-expression",
      sentences,
      separators,
    };
  }

  private parseSentence(limit: number): SentenceAst {
    const start = this.cursor.mark();
    let subject = this.parseSubject();

    // Preserve the explicit dot as syntax data. B0.2 consumes this node for
    // line selection and D18 diagnostics without rescanning SentenceAst.raw.
    if (subject === null && this.cursor.peek() === "." && this.cursor.peek(1) !== "(") {
      const dotStart = this.cursor.mark();
      this.cursor.consume();
      const dotSubject: DotSubjectAst = {
        ...this.nodeBase(dotStart, this.cursor.position),
        type: "dot-subject",
      };
      subject = dotSubject;
    }

    const beats: BeatAst[] = [];
    beats.push(this.parseBeat(null, this.cursor.position, limit));

    while (this.cursor.position < limit) {
      const triviaStart = this.cursor.mark();
      this.consumeInlineWhitespace(limit);
      const connector = this.parseConnector(limit);
      if (connector === null) {
        this.cursor.restore(triviaStart);
        break;
      }

      this.consumeInlineWhitespace(limit);
      const beatStart = connector.range.start - this.baseOffset;
      if (!this.canStartMember()) {
        const error = this.zeroWidthErrorMember("beat");
        this.addDiagnostic(
          "chain-missing-beat",
          "Connector is not followed by a beat.",
          this.cursor.position,
          this.cursor.position,
        );
        beats.push({
          ...this.nodeBase(beatStart, this.cursor.position),
          type: "beat",
          connectorBefore: connector,
          members: [error],
        });
        break;
      }
      beats.push(this.parseBeat(connector, beatStart, limit));
    }

    const firstMember = beats[0]?.members[0];
    const kind = firstMember?.type === "command-member" && firstMember.op !== null
      ? "member-op"
      : "predicate";

    return {
      ...this.nodeBase(start, this.cursor.position),
      type: "sentence",
      kind,
      subject,
      beats,
    };
  }

  private parseSubject(): SubjectAst | null {
    if (this.cursor.peek() === "{") {
      const start = this.cursor.mark();
      const balanced = this.cursor.readBalanced("{", "}");
      if (balanced === null) {
        return null;
      }
      if (!balanced.closed) {
        this.addDiagnostic(
          "chain-unexpected-token",
          "Selector subject is missing its closing brace.",
          start,
          this.cursor.position,
        );
      }
      const subject: SelectorSubjectAst = {
        ...this.nodeBase(start, this.cursor.position),
        type: "selector-subject",
        content: balanced.inner,
      };
      this.cursor.expect(
        ".",
        "chain-unexpected-token",
        "Selector subject must be followed by a dot.",
      );
      return subject;
    }

    const start = this.cursor.mark();
    const identifierEnd = scanIdentifierEnd(this.source, start);
    if (identifierEnd === start || this.source[identifierEnd] !== ".") {
      return null;
    }

    this.cursor.advanceTo(identifierEnd);
    const name = this.identifierFrom(start, identifierEnd);
    this.cursor.consume();
    const subject: IdentifierSubjectAst = {
      ...this.nodeBase(start, identifierEnd),
      type: "identifier-subject",
      name,
    };
    return subject;
  }

  private parseBeat(
    connectorBefore: ConnectorAst | null,
    beatStart: number,
    limit: number,
  ): BeatAst {
    const members: MemberAst[] = [this.parseMember(limit)];

    while (this.cursor.position < limit && this.cursor.peek() === ".") {
      if (this.cursor.peek(1) === "(") {
        members.push(this.parseClause(limit));
        continue;
      }

      this.cursor.consume();
      if (this.cursor.peek() === ".") {
        const emptyStart = this.cursor.position;
        this.cursor.consume();
        this.addDiagnostic(
          "chain-empty-member",
          "Consecutive dots contain an empty member.",
          emptyStart,
          this.cursor.position,
        );
      }

      if (!this.canStartMember()) {
        const error = this.zeroWidthErrorMember("member");
        members.push(error);
        this.addDiagnostic(
          "chain-empty-member",
          "Member separator is not followed by a member.",
          this.cursor.position,
          this.cursor.position,
        );
        break;
      }
      members.push(this.parseMember(limit));
    }

    return {
      ...this.nodeBase(beatStart, this.cursor.position),
      type: "beat",
      connectorBefore,
      members,
    };
  }

  private parseMember(limit: number): MemberAst {
    if (this.cursor.peek() === "." && this.cursor.peek(1) === "(") {
      return this.parseClause(limit);
    }
    if (this.cursor.peek() === "$") {
      return this.parseReference();
    }
    return this.parseCommandMember(limit);
  }

  private parseCommandMember(limit: number): CommandMemberAst | ErrorNodeAst {
    const start = this.cursor.mark();
    let op: CommandMemberAst["op"] = null;
    if (this.cursor.peek() === "+" || this.cursor.peek() === "-") {
      op = this.cursor.consume() as "+" | "-";
    }

    const nameStart = this.cursor.mark();
    const nameEnd = scanCommandIdentifierEnd(this.source, nameStart);
    const name = nameEnd === nameStart
      ? null
      : this.identifierAtCursor(nameStart, nameEnd);
    if (name === null) {
      this.recoverInvalidMember(limit);
      const end = Math.max(this.cursor.position, nameStart);
      this.addDiagnostic(
        "chain-unexpected-token",
        "Expected a command member name.",
        start,
        end,
      );
      return {
        ...this.nodeBase(start, end),
        type: "error-node",
        context: "member",
      };
    }

    const granularity = this.parseGranularity(limit);
    const args = this.cursor.peek() === "(" ? this.parseArguments() : [];
    const blocking = this.cursor.consumeIf("!");

    return {
      ...this.nodeBase(start, this.cursor.position),
      type: "command-member",
      op,
      name,
      granularity,
      args,
      blocking,
    };
  }

  private parseGranularity(limit: number): GranularityAst | null {
    if (!this.cursor.consumeIf(":")) {
      return null;
    }

    const start = this.cursor.position - 1;
    const unitStart = this.cursor.position;
    const unitEnd = scanIdentifierEnd(this.source, unitStart);
    if (unitEnd > unitStart) {
      this.cursor.advanceTo(unitEnd);
    } else {
      while (
        this.cursor.position < limit
        && !isGranularityRecoveryBoundary(this.cursor.peek())
      ) {
        this.cursor.consume();
      }
    }

    const unit = this.source.slice(unitStart, this.cursor.position);
    if (!GRANULARITY_UNITS.includes(unit as GranularityUnit)) {
      this.addDiagnostic(
        "chain-invalid-granularity",
        `Unknown granularity ${JSON.stringify(unit || this.source.slice(start, this.cursor.position))}.`,
        start,
        this.cursor.position,
      );
      return null;
    }

    return {
      ...this.nodeBase(start, this.cursor.position),
      type: "granularity",
      unit: unit as GranularityUnit,
    };
  }

  private parseArguments(): ArgAst[] {
    const open = this.cursor.mark();
    const balanced = this.cursor.readBalanced("(", ")");
    if (balanced === null) {
      return [];
    }
    if (!balanced.closed) {
      this.addDiagnostic(
        "chain-unclosed-argument-list",
        "Argument list is missing its closing parenthesis.",
        open,
        this.cursor.position,
      );
    }

    const innerStart = open + 1;
    if (balanced.inner.trim().length === 0) {
      return [];
    }

    const segments = splitTopLevelSegments(balanced.inner, ",");
    return segments.map((segment) => this.parseArgumentSegment(
      balanced.inner,
      segment,
      innerStart,
    ));
  }

  private parseArgumentSegment(
    inner: string,
    segment: Segment,
    innerStart: number,
  ): ArgAst {
    const trimmed = trimSegment(inner, segment.start, segment.end);
    const argStart = innerStart + trimmed.start;
    const argEnd = innerStart + trimmed.end;
    const raw = inner.slice(trimmed.start, trimmed.end);

    if (trimmed.start === trimmed.end) {
      const value = this.externalInvalidValue(
        "unexpected-token",
        "",
        this.baseOffset + argStart,
      );
      this.addDiagnostic(
        "chain-invalid-argument",
        "Argument is empty or follows a trailing comma.",
        argStart,
        argEnd,
      );
      return {
        ...this.nodeBase(argStart, argEnd),
        type: "arg",
        name: null,
        value,
      };
    }

    const equals = findTopLevelCharacter(raw, "=", 0, raw.length);
    let name: IdentifierAst | null = null;
    let valueSegment = { start: 0, end: raw.length };
    if (equals >= 0) {
      const nameSegment = trimSegment(raw, 0, equals);
      const nameRaw = raw.slice(nameSegment.start, nameSegment.end);
      if (isIdentifier(nameRaw)) {
        name = externalIdentifier(
          nameRaw,
          this.baseOffset + argStart + nameSegment.start,
        );
        valueSegment = trimSegment(raw, equals + 1, raw.length);
      } else if (!looksLikeLiteral(raw)) {
        this.addDiagnostic(
          "chain-invalid-argument",
          "Named argument has an invalid or missing name.",
          argStart + nameSegment.start,
          argStart + Math.max(nameSegment.end, equals + 1),
        );
      }
    }

    const valueRaw = raw.slice(valueSegment.start, valueSegment.end);
    const valueOffset = this.baseOffset + argStart + valueSegment.start;
    let value: ValueAst;
    if (valueRaw.length === 0) {
      value = this.externalInvalidValue("unexpected-token", "", valueOffset);
      this.addDiagnostic(
        "chain-invalid-argument",
        "Argument is missing its value.",
        argStart + valueSegment.start,
        argStart + valueSegment.end,
      );
    } else {
      value = this.parseValue(valueRaw, valueOffset);
    }

    return {
      ...this.nodeBase(argStart, argEnd),
      type: "arg",
      name,
      value,
    };
  }

  private parseValue(raw: string, absoluteOffset: number): ValueAst {
    if (looksLikeLiteral(raw)) {
      const result = parseLiteral(raw, absoluteOffset);
      this.diagnostics.push(...result.diagnostics);
      return result.value;
    }

    const nameRef = parseNameRef(raw, absoluteOffset);
    if (nameRef !== null) {
      return nameRef;
    }

    return {
      raw,
      range: { start: absoluteOffset, end: absoluteOffset + raw.length },
      type: "expression-slice",
      delimited: raw,
    };
  }

  private parseClause(limit: number): ClauseMemberAst {
    const start = this.cursor.mark();
    this.cursor.consumeIf(".");
    const open = this.cursor.mark();
    const balanced = this.cursor.readBalanced("(", ")");
    if (balanced === null) {
      const sentence = this.emptySentence(this.cursor.position);
      this.addDiagnostic(
        "chain-unclosed-subclause",
        "Subclause is missing its opening parenthesis.",
        start,
        this.cursor.position,
      );
      return {
        ...this.nodeBase(start, this.cursor.position),
        type: "clause-member",
        sentence,
        granularity: null,
        blocking: false,
      };
    }

    if (!balanced.closed) {
      this.addDiagnostic(
        "chain-unclosed-subclause",
        "Subclause is missing its closing parenthesis.",
        start,
        this.cursor.position,
      );
    }

    const nested = parseChainSyntax(balanced.inner, this.baseOffset + open + 1);
    this.diagnostics.push(...nested.diagnostics);
    if (nested.expression.sentences.length > 1) {
      const second = nested.expression.sentences[1]!;
      this.diagnostics.push({
        code: "chain-unexpected-token",
        severity: "error",
        message: "A subclause must contain exactly one sentence.",
        range: second.range,
      });
    }
    const sentence = nested.expression.sentences[0] ?? this.emptySentence(open + 1);
    const granularity = balanced.closed ? this.parseGranularity(limit) : null;
    const blocking = balanced.closed && this.cursor.consumeIf("!");

    return {
      ...this.nodeBase(start, this.cursor.position),
      type: "clause-member",
      sentence,
      granularity,
      blocking,
    };
  }

  private parseReference(): ReferenceMemberAst {
    const start = this.cursor.mark();
    this.cursor.consume();

    if (this.cursor.peek() === "(") {
      const balanced = this.cursor.readBalanced("(", ")");
      if (balanced === null) {
        throw new Error("Reference parser lost its opening parenthesis.");
      }
      if (!balanced.closed) {
        this.addDiagnostic(
          "chain-unclosed-reference",
          "Expression reference is missing its closing parenthesis.",
          start,
          this.cursor.position,
        );
      }
      return {
        ...this.nodeBase(start, this.cursor.position),
        type: "reference-member",
        form: "expr",
        delimited: balanced.inner,
      };
    }

    const name = this.parseIdentifier();
    if (name === null) {
      this.addDiagnostic(
        "chain-unexpected-token",
        "Reference is missing its name or expression.",
        start,
        this.cursor.position,
      );
      return {
        ...this.nodeBase(start, this.cursor.position),
        type: "reference-member",
        form: "name",
        delimited: "",
      };
    }

    return {
      ...this.nodeBase(start, this.cursor.position),
      type: "reference-member",
      form: "name",
      delimited: name.name,
    };
  }

  private parseConnector(limit: number): ConnectorAst | null {
    const start = this.cursor.mark();
    const marker = this.cursor.peek();
    if (marker !== "-" && marker !== "~") {
      return null;
    }

    const terminator = marker === "-" ? "->" : "~>";
    const terminatorAt = findBeforeInlineWhitespace(
      this.source,
      terminator,
      start + 1,
      limit,
    );
    if (terminatorAt < 0) {
      return null;
    }

    const bodyStart = start + 1;
    const bodyEnd = terminatorAt;
    this.cursor.advanceTo(terminatorAt + terminator.length);
    const durationAndCurve = this.source.slice(bodyStart, bodyEnd);

    if (marker === "-") {
      const durationSegment = trimSegment(durationAndCurve, 0, durationAndCurve.length);
      const duration = this.parseTimeQuantity(
        durationAndCurve.slice(durationSegment.start, durationSegment.end),
        this.baseOffset + bodyStart + durationSegment.start,
      );
      return {
        ...this.nodeBase(start, this.cursor.position),
        type: "connector",
        kind: "hold",
        duration,
        easing: null,
      };
    }

    const pieces = splitTopLevelSegments(durationAndCurve, ",")
      .map((segment) => trimSegment(durationAndCurve, segment.start, segment.end));
    const durationSegment = pieces[0] ?? { start: 0, end: 0 };
    const duration = this.parseTimeQuantity(
      durationAndCurve.slice(durationSegment.start, durationSegment.end),
      this.baseOffset + bodyStart + durationSegment.start,
    );
    const easing = this.parseEasing(durationAndCurve, pieces.slice(1), bodyStart);
    return {
      ...this.nodeBase(start, this.cursor.position),
      type: "connector",
      kind: "ease",
      duration,
      easing,
    };
  }

  private parseTimeQuantity(raw: string, absoluteOffset: number): TimeQuantityAst | InvalidValueAst {
    const result = parseLiteral(raw, absoluteOffset);
    this.diagnostics.push(...result.diagnostics);
    if (result.value.type === "time-quantity" || result.value.type === "invalid-value") {
      return result.value;
    }

    const invalid = this.externalInvalidValue("invalid-quantity", raw, absoluteOffset);
    this.diagnostics.push({
      code: "chain-invalid-quantity",
      severity: "error",
      message: "Connector duration must be a time quantity.",
      range: invalid.range,
    });
    return invalid;
  }

  private parseEasing(
    body: string,
    pieces: Segment[],
    bodyStart: number,
  ): EasingAst | null {
    if (pieces.length === 0) {
      return null;
    }

    if (pieces.length === 1) {
      const piece = pieces[0]!;
      const raw = body.slice(piece.start, piece.end);
      if (isIdentifier(raw)) {
        const name = externalIdentifier(raw, this.baseOffset + bodyStart + piece.start);
        const easing: NamedEasingAst = {
          raw,
          range: name.range,
          type: "named-easing",
          name,
        };
        return easing;
      }
    }

    if (pieces.length === 4) {
      const numbers = pieces.map((piece) => this.parseNumberLiteral(
        body.slice(piece.start, piece.end),
        this.baseOffset + bodyStart + piece.start,
      ));
      if (numbers.every((number): number is NumberLiteralAst => number !== null)) {
        const [x1, y1, x2, y2] = numbers as [
          NumberLiteralAst,
          NumberLiteralAst,
          NumberLiteralAst,
          NumberLiteralAst,
        ];
        this.validateBezierX(x1);
        this.validateBezierX(x2);
        const range = {
          start: x1.range.start,
          end: y2.range.end,
        };
        const easing: BezierEasingAst = {
          raw: this.source.slice(range.start - this.baseOffset, range.end - this.baseOffset),
          range,
          type: "bezier-easing",
          x1,
          y1,
          x2,
          y2,
        };
        return easing;
      }
    }

    const start = pieces[0]?.start ?? 0;
    const end = pieces.at(-1)?.end ?? body.length;
    this.addDiagnostic(
      "chain-unexpected-token",
      "Ease connector curve must be a preset name or four numbers.",
      bodyStart + start,
      bodyStart + end,
    );
    return null;
  }

  private parseNumberLiteral(raw: string, absoluteOffset: number): NumberLiteralAst | null {
    const result = parseLiteral(raw, absoluteOffset);
    return result.value.type === "number-literal" ? result.value : null;
  }

  private validateBezierX(node: NumberLiteralAst): void {
    if (node.value >= 0 && node.value <= 1) {
      return;
    }
    this.diagnostics.push({
      code: "chain-easing-out-of-range",
      severity: "error",
      message: "Bezier x coordinates must be within [0, 1].",
      range: node.range,
    });
  }

  private parseIdentifier(): IdentifierAst | null {
    const start = this.cursor.mark();
    const end = scanIdentifierEnd(this.source, start);
    if (end === start) {
      return null;
    }
    return this.identifierAtCursor(start, end);
  }

  private identifierAtCursor(start: number, end: number): IdentifierAst {
    this.cursor.advanceTo(end);
    return this.identifierFrom(start, end);
  }

  private identifierFrom(start: number, end: number): IdentifierAst {
    return {
      ...this.nodeBase(start, end),
      type: "identifier",
      name: this.source.slice(start, end),
    };
  }

  private expressionSlice(start: number, end: number): ExpressionSliceAst {
    return {
      ...this.nodeBase(start, end),
      type: "expression-slice",
      delimited: this.source.slice(start, end),
    };
  }

  private emptySentence(position: number): SentenceAst {
    const error = this.zeroWidthErrorMember("beat", position);
    const beat: BeatAst = {
      ...this.nodeBase(position, position),
      type: "beat",
      connectorBefore: null,
      members: [error],
    };
    return {
      ...this.nodeBase(position, position),
      type: "sentence",
      kind: "predicate",
      subject: null,
      beats: [beat],
    };
  }

  private zeroWidthErrorMember(
    context: ErrorNodeAst["context"],
    position = this.cursor.position,
  ): ErrorNodeAst {
    return {
      ...this.nodeBase(position, position),
      type: "error-node",
      context,
    };
  }

  private externalInvalidValue(
    reason: InvalidValueAst["reason"],
    raw: string,
    absoluteOffset: number,
  ): InvalidValueAst {
    return {
      raw,
      range: { start: absoluteOffset, end: absoluteOffset + raw.length },
      type: "invalid-value",
      reason,
    };
  }

  private canStartMember(): boolean {
    const char = this.cursor.peek();
    if (char === "$" || (char === "." && this.cursor.peek(1) === "(")) {
      return true;
    }
    if (char === "+" || char === "-") {
      return isIdentifierStart(this.cursor.peek(1));
    }
    return isIdentifierStart(char);
  }

  private recoverInvalidMember(limit: number): void {
    if (this.cursor.peek() === "(") {
      this.cursor.readBalanced("(", ")");
      return;
    }
    if (this.cursor.position < limit) {
      this.cursor.consume();
    }
    while (
      this.cursor.position < limit
      && !isMemberRecoveryBoundary(this.cursor.peek())
    ) {
      this.cursor.consume();
    }
  }

  private recoverUnexpectedTail(limit: number): void {
    if (this.cursor.position < limit) {
      this.cursor.consume();
    }
    while (
      this.cursor.position < limit
      && !isInlineWhitespace(this.cursor.peek())
      && this.cursor.peek() !== "+"
    ) {
      this.cursor.consume();
    }
  }

  private consumeInlineWhitespace(limit = this.source.length): boolean {
    const start = this.cursor.position;
    while (this.cursor.position < limit && isInlineWhitespace(this.cursor.peek())) {
      this.cursor.consume();
    }
    return this.cursor.position > start;
  }

  private addDiagnostic(
    code: ChainDiagnostic["code"],
    message: string,
    start: number,
    end: number,
    severity: ChainDiagnostic["severity"] = "error",
  ): void {
    this.diagnostics.push({
      code,
      severity,
      message,
      range: {
        start: this.baseOffset + start,
        end: this.baseOffset + end,
      },
    });
  }

  private nodeBase(start: number, end: number): SyntaxNodeBase {
    return {
      raw: this.source.slice(start, end),
      range: {
        start: this.baseOffset + start,
        end: this.baseOffset + end,
      },
    };
  }
}

export function parseChainSyntax(source: string, baseOffset = 0): ChainSyntaxParseResult {
  return new ChainSyntaxParser(source, baseOffset).parse();
}

function parseIdentifierPath(raw: string, absoluteOffset: number): IdentifierAst[] | null {
  const path: IdentifierAst[] = [];
  let start = 0;
  for (let index = 0; index <= raw.length; index += 1) {
    if (index !== raw.length && raw[index] !== ".") {
      continue;
    }
    const name = raw.slice(start, index);
    if (!isIdentifier(name)) {
      return null;
    }
    path.push(externalIdentifier(name, absoluteOffset + start));
    start = index + 1;
  }
  return path.length === 0 ? null : path;
}

function parseNameRef(raw: string, absoluteOffset: number): NameRefAst | null {
  const path = parseIdentifierPath(raw, absoluteOffset);
  return path === null
    ? null
    : {
        raw,
        range: { start: absoluteOffset, end: absoluteOffset + raw.length },
        type: "name-ref",
        path,
      };
}

function externalIdentifier(raw: string, absoluteOffset: number): IdentifierAst {
  return {
    raw,
    range: { start: absoluteOffset, end: absoluteOffset + raw.length },
    type: "identifier",
    name: raw,
  };
}

function looksLikeLiteral(raw: string): boolean {
  const first = raw[0];
  return first === "\""
    || first === "'"
    || first === "+"
    || first === "-"
    || first === "."
    || isDigit(first)
    || raw === "true"
    || raw === "false"
    || raw === "click"
    || raw.startsWith("signal:")
    || QUANTITY_KEYWORDS.has(raw)
    || raw.includes("~")
    || raw.includes("/");
}

function splitTopLevelSegments(source: string, delimiter: string): Segment[] {
  const segments: Segment[] = [];
  let start = 0;
  scanStructure(source, 0, source.length, (index, char, depth) => {
    if (char === delimiter && depth === 0) {
      segments.push({ start, end: index });
      start = index + delimiter.length;
    }
  });
  segments.push({ start, end: source.length });
  return segments;
}

function findTopLevelCharacter(
  source: string,
  character: string,
  start: number,
  end: number,
): number {
  let found = -1;
  scanStructure(source, start, end, (index, char, depth) => {
    if (found < 0 && char === character && depth === 0) {
      found = index;
    }
  });
  return found;
}

function scanStructure(
  source: string,
  start: number,
  end: number,
  visit: (index: number, char: string, depth: number) => void,
): void {
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let index = start; index < end; index += 1) {
    const char = source[index]!;
    if (quote !== null) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    const depth = parenDepth + bracketDepth + braceDepth;
    visit(index, char, depth);
    if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (char === "{") {
      braceDepth += 1;
    } else if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
    }
  }
}

function scanIdentifierEnd(source: string, start: number): number {
  if (!isIdentifierStart(source[start])) {
    return start;
  }
  let end = start + 1;
  while (isIdentifierContinue(source[end])) {
    end += 1;
  }
  return end;
}

function scanCommandIdentifierEnd(source: string, start: number): number {
  if (!isIdentifierStart(source[start])) {
    return start;
  }
  let end = start + 1;
  while (isIdentifierContinue(source[end])) {
    if (source[end] === "-" && looksLikeHoldConnectorAt(source, end)) {
      break;
    }
    end += 1;
  }
  if (source[end] === ">" && source[end - 1] === "-") {
    for (let index = start + 1; index < end - 1; index += 1) {
      if (source[index] === "-" && isPotentialNumberStart(source[index + 1])) {
        return index;
      }
    }
    const malformedConnectorStart = source.lastIndexOf("-", end - 2);
    if (malformedConnectorStart >= start + 1) {
      return malformedConnectorStart;
    }
  }
  return end;
}

function isPotentialNumberStart(char: string | undefined): boolean {
  return char === "+" || char === "-" || char === "." || isDigit(char);
}

function looksLikeHoldConnectorAt(source: string, start: number): boolean {
  const quantityEnd = scanTimeQuantityEnd(source, start + 1);
  return quantityEnd >= 0 && source.startsWith("->", quantityEnd);
}

function findBeforeInlineWhitespace(
  source: string,
  needle: string,
  start: number,
  limit: number,
): number {
  for (let index = start; index < limit; index += 1) {
    if (isInlineWhitespace(source[index])) {
      return -1;
    }
    if (source.startsWith(needle, index)) {
      return index;
    }
  }
  return -1;
}

function scanTimeQuantityEnd(source: string, start: number): number {
  let end = start;
  if (source[end] === "+" || source[end] === "-") {
    end += 1;
  }

  let integerDigits = 0;
  while (isDigit(source[end])) {
    integerDigits += 1;
    end += 1;
  }

  let fractionDigits = 0;
  if (source[end] === ".") {
    end += 1;
    while (isDigit(source[end])) {
      fractionDigits += 1;
      end += 1;
    }
    if (fractionDigits === 0) {
      return -1;
    }
  }

  if (integerDigits === 0 && fractionDigits === 0) {
    return -1;
  }

  if (source[end] === "e" || source[end] === "E") {
    end += 1;
    if (source[end] === "+" || source[end] === "-") {
      end += 1;
    }
    let exponentDigits = 0;
    while (isDigit(source[end])) {
      exponentDigits += 1;
      end += 1;
    }
    if (exponentDigits === 0) {
      return -1;
    }
  }

  if (source.startsWith("ms", end)) {
    return end + 2;
  }
  return source[end] === "s" ? end + 1 : -1;
}

function isIdentifier(raw: string): boolean {
  return raw.length > 0 && scanIdentifierEnd(raw, 0) === raw.length;
}

function isIdentifierStart(char: string | undefined): boolean {
  return char !== undefined && (char === "_" || /[A-Za-z\p{L}]/u.test(char));
}

function isIdentifierContinue(char: string | undefined): boolean {
  return isIdentifierStart(char) || isDigit(char) || char === "-";
}

function isDigit(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isInlineWhitespace(char: string | undefined): boolean {
  return char === " " || char === "\t";
}

function isMemberRecoveryBoundary(char: string | undefined): boolean {
  return char === undefined
    || char === "."
    || char === "~"
    || isInlineWhitespace(char);
}

function isGranularityRecoveryBoundary(char: string | undefined): boolean {
  return char === undefined
    || char === "("
    || char === "!"
    || char === "."
    || char === "~"
    || char === "-"
    || isInlineWhitespace(char);
}

function trimSegment(source: string, start: number, end: number): Segment {
  while (start < end && isInlineWhitespace(source[start])) {
    start += 1;
  }
  return { start, end: trimEnd(source, start, end) };
}

function trimEnd(source: string, start: number, end: number): number {
  while (end > start && isInlineWhitespace(source[end - 1])) {
    end -= 1;
  }
  return end;
}
