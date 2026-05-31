import type { DomainEvent } from '../domain/events'

type EventHandler<T extends DomainEvent = DomainEvent> = (event: T) => void

interface IEventBus {
  emit(event: DomainEvent): void
  on<T extends DomainEvent>(type: T['type'], handler: EventHandler<T>): () => void
  onAny(handler: EventHandler): () => void
  off(type: DomainEvent['type'], handler: EventHandler): void
  clear(): void
  listenerCount(type?: DomainEvent['type']): number
}

class EventBus implements IEventBus {
  private handlers = new Map<string, Set<EventHandler>>()
  private anyHandlers = new Set<EventHandler>()

  emit(event: DomainEvent): void {
    const errors: Error[] = []

    const typeHandlers = this.handlers.get(event.type)
    if (typeHandlers) {
      for (const handler of typeHandlers) {
        try {
          handler(event)
        } catch (err) {
          errors.push(err instanceof Error ? err : new Error(String(err)))
        }
      }
    }

    for (const handler of this.anyHandlers) {
      try {
        handler(event)
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)))
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} handler(s) threw during emit`)
    }
  }

  on<T extends DomainEvent>(type: T['type'], handler: EventHandler<T>): () => void {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set())
    }
    this.handlers.get(type)!.add(handler as EventHandler)

    return () => {
      this.off(type, handler as EventHandler)
    }
  }

  onAny(handler: EventHandler): () => void {
    this.anyHandlers.add(handler)
    return () => {
      this.anyHandlers.delete(handler)
    }
  }

  off(type: DomainEvent['type'], handler: EventHandler): void {
    const typeHandlers = this.handlers.get(type)
    if (typeHandlers) {
      typeHandlers.delete(handler)
      if (typeHandlers.size === 0) {
        this.handlers.delete(type)
      }
    }
  }

  clear(): void {
    this.handlers.clear()
    this.anyHandlers.clear()
  }

  listenerCount(type?: DomainEvent['type']): number {
    if (type !== undefined) {
      return this.handlers.get(type)?.size ?? 0
    }
    let total = this.anyHandlers.size
    for (const set of this.handlers.values()) {
      total += set.size
    }
    return total
  }
}

export type { IEventBus, EventHandler }
export { EventBus }
