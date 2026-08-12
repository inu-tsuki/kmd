import type { AuditEvent } from "../types";

export type AuditListener = (event: AuditEvent) => void;

const MAX_AUDIT_EVENTS = 500;

export class AuditBus {
  private events: AuditEvent[] = [];
  private listeners: Set<AuditListener> = new Set();

  public emit(event: AuditEvent) {
    this.pushBounded(event);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public emitMany(events: Iterable<AuditEvent>) {
    for (const event of events) {
      this.emit(event);
    }
  }

  public getEvents() {
    return [...this.events];
  }

  public clear() {
    this.events = [];
  }

  public subscribe(listener: AuditListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private pushBounded(event: AuditEvent) {
    this.events.push(event);
    const overflow = this.events.length - MAX_AUDIT_EVENTS;
    if (overflow > 0) {
      this.events.splice(0, overflow);
    }
  }
}

export const auditBus = new AuditBus();
