import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus } from '../../../src/compose/application/event-bus'
import type { DomainEvent } from '../../../src/compose/domain/events'

// Concrete event type for testing
interface TestEvent extends DomainEvent {
  type: 'test:foo'
  payload: { value: number }
}

function makeTestEvent(value = 1): TestEvent {
  return {
    id: 'test-id',
    type: 'test:foo',
    timestamp: new Date().toISOString(),
    payload: { value },
  }
}

describe('EventBus', () => {
  let bus: EventBus

  beforeEach(() => {
    bus = new EventBus()
  })

  // ── emit + on ──────────────────────────────────────────────────────────────

  it('calls handler on emit', () => {
    const received: TestEvent[] = []
    bus.on('test:foo', (e) => received.push(e))
    bus.emit(makeTestEvent(42))
    expect(received).toHaveLength(1)
    expect(received[0].payload.value).toBe(42)
  })

  it('calls handlers in registration order', () => {
    const order: number[] = []
    bus.on('test:foo', () => order.push(1))
    bus.on('test:foo', () => order.push(2))
    bus.on('test:foo', () => order.push(3))
    bus.emit(makeTestEvent())
    expect(order).toEqual([1, 2, 3])
  })

  it('calls type handlers before onAny handlers', () => {
    const order: string[] = []
    bus.onAny(() => order.push('any'))
    bus.on('test:foo', () => order.push('type'))
    bus.emit(makeTestEvent())
    expect(order).toEqual(['type', 'any'])
  })

  // ── onAny ─────────────────────────────────────────────────────────────────

  it('onAny receives all events', () => {
    const events: DomainEvent[] = []
    bus.onAny((e) => events.push(e))
    bus.emit(makeTestEvent(1))
    bus.emit({ id: 'x', type: 'test:foo', timestamp: '', payload: { value: 2 } })
    expect(events).toHaveLength(2)
  })

  it('multiple onAny handlers called in registration order', () => {
    const order: string[] = []
    bus.onAny(() => order.push('any1'))
    bus.onAny(() => order.push('any2'))
    bus.emit(makeTestEvent())
    expect(order).toEqual(['any1', 'any2'])
  })

  // ── unsubscribe returned by on ─────────────────────────────────────────────

  it('on() returns unsubscribe function', () => {
    const received: TestEvent[] = []
    const unsub = bus.on('test:foo', (e) => received.push(e))
    unsub()
    bus.emit(makeTestEvent())
    expect(received).toHaveLength(0)
  })

  it('onAny() returns unsubscribe function', () => {
    const received: DomainEvent[] = []
    const unsub = bus.onAny((e) => received.push(e))
    unsub()
    bus.emit(makeTestEvent())
    expect(received).toHaveLength(0)
  })

  // ── off ───────────────────────────────────────────────────────────────────

  it('off removes specific handler', () => {
    const h1 = () => {}
    const h2 = () => {}
    bus.on('test:foo', h1)
    bus.on('test:foo', h2)
    bus.off('test:foo', h1)
    const remaining = bus.listenerCount('test:foo')
    expect(remaining).toBe(1)
  })

  it('off does nothing if handler not registered', () => {
    bus.on('test:foo', () => {})
    bus.off('test:foo', () => {})
    expect(bus.listenerCount('test:foo')).toBe(1)
  })

  // ── clear ──────────────────────────────────────────────────────────────────

  it('clear removes all handlers including onAny', () => {
    bus.on('test:foo', () => {})
    bus.onAny(() => {})
    bus.clear()
    expect(bus.listenerCount()).toBe(0)
  })

  // ── listenerCount ──────────────────────────────────────────────────────────

  it('listenerCount returns 0 for unregistered type', () => {
    expect(bus.listenerCount('test:foo')).toBe(0)
  })

  it('listenerCount returns correct count for type', () => {
    bus.on('test:foo', () => {})
    bus.on('test:foo', () => {})
    bus.on('test:bar' as any, () => {})
    expect(bus.listenerCount('test:foo')).toBe(2)
  })

  it('listenerCount returns total when no type given', () => {
    bus.on('test:foo', () => {})
    bus.on('test:bar' as any, () => {})
    bus.onAny(() => {})
    expect(bus.listenerCount()).toBe(3)
  })

  // ── error collection ────────────────────────────────────────────────────────

  it('throws AggregateError if type handler throws', () => {
    bus.on('test:foo', () => { throw new Error('handler error') })
    expect(() => bus.emit(makeTestEvent())).toThrow(AggregateError)
  })

  it('throws AggregateError if onAny handler throws', () => {
    bus.onAny(() => { throw new Error('any error') })
    expect(() => bus.emit(makeTestEvent())).toThrow(AggregateError)
  })

  it('collects errors from all handlers and throws AggregateError', () => {
    bus.on('test:foo', () => { throw new Error('e1') })
    bus.on('test:foo', () => { throw new Error('e2') })
    bus.onAny(() => { throw new Error('e3') })
    try {
      bus.emit(makeTestEvent())
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AggregateError)
      const agg = err as AggregateError
      expect(agg.errors).toHaveLength(3)
      expect((agg.errors[0] as Error).message).toBe('e1')
      expect((agg.errors[1] as Error).message).toBe('e2')
      expect((agg.errors[2] as Error).message).toBe('e3')
    }
  })

  it('continues calling handlers after one throws', () => {
    const called: string[] = []
    bus.on('test:foo', () => { called.push('a'); throw new Error('oops') })
    bus.on('test:foo', () => { called.push('b') })
    bus.onAny(() => { called.push('c'); throw new Error('oops2') })
    bus.onAny(() => { called.push('d') })
    try {
      bus.emit(makeTestEvent())
    } catch {
      // expected
    }
    expect(called).toEqual(['a', 'b', 'c', 'd'])
  })

  it('throws AggregateError even when only onAny throws', () => {
    bus.onAny(() => { throw new Error('only any') })
    try {
      bus.emit(makeTestEvent())
      expect.fail('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(AggregateError)
      expect((err as AggregateError).errors).toHaveLength(1)
    }
  })

  // ── edge: same handler registered for different types ─────────────────────

  it('handler registered on multiple types can be off()d from one', () => {
    const h = () => {}
    bus.on('test:foo', h)
    bus.on('test:bar' as any, h)
    bus.off('test:foo', h)
    expect(bus.listenerCount('test:foo')).toBe(0)
    expect(bus.listenerCount('test:bar' as any)).toBe(1)
  })

  it('off cleans up empty Set from handlers map', () => {
    const h = () => {}
    bus.on('test:foo', h)
    bus.off('test:foo', h)
    expect(bus.handlers.has('test:foo')).toBe(false)
  })
})
