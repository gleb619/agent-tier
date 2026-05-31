import { describe, it, expect } from 'vitest'
import {
  DomainError,
  InvalidTransitionError,
  ValidationError,
  ConcurrencyError,
  AdapterError,
  isDomainError,
} from '../../../src/compose/domain/errors'

describe('Domain error class hierarchy', () => {
  describe('DomainError', () => {
    it('is instance of Error', () => {
      const error = new DomainError('test message')
      expect(error).toBeInstanceOf(Error)
    })

    it('has correct kind', () => {
      const error = new DomainError('test message')
      expect(error.kind).toBe('DomainError')
    })

    it('sets name and message correctly', () => {
      const error = new DomainError('test message')
      expect(error.name).toBe('DomainError')
      expect(error.message).toBe('test message')
    })
  })

  describe('InvalidTransitionError', () => {
    it('is instance of DomainError and Error', () => {
      const error = new InvalidTransitionError('pending', 'done', 'task')
      expect(error).toBeInstanceOf(DomainError)
      expect(error).toBeInstanceOf(Error)
    })

    it('sets from, to, name, kind, and message correctly', () => {
      const error = new InvalidTransitionError('pending', 'done', 'task')
      expect(error.from).toBe('pending')
      expect(error.to).toBe('done')
      expect(error.name).toBe('InvalidTransitionError')
      expect(error.kind).toBe('InvalidTransitionError')
      expect(error.message).toBe('Invalid transition: task cannot go from pending to done')
    })
  })

  describe('ValidationError', () => {
    it('is instance of DomainError and Error', () => {
      const error = new ValidationError('email', 'invalid format')
      expect(error).toBeInstanceOf(DomainError)
      expect(error).toBeInstanceOf(Error)
    })

    it('sets field, name, kind, and message correctly', () => {
      const error = new ValidationError('email', 'invalid format')
      expect(error.field).toBe('email')
      expect(error.name).toBe('ValidationError')
      expect(error.kind).toBe('ValidationError')
      expect(error.message).toBe('Validation error on email: invalid format')
    })
  })

  describe('ConcurrencyError', () => {
    it('is instance of DomainError and Error', () => {
      const error = new ConcurrencyError('/tmp/state.json')
      expect(error).toBeInstanceOf(DomainError)
      expect(error).toBeInstanceOf(Error)
    })

    it('sets name, kind, and message correctly', () => {
      const error = new ConcurrencyError('/tmp/state.json')
      expect(error.name).toBe('ConcurrencyError')
      expect(error.kind).toBe('ConcurrencyError')
      expect(error.message).toBe('Concurrency conflict on /tmp/state.json')
    })
  })

  describe('AdapterError', () => {
    it('is instance of DomainError and Error', () => {
      const error = new AdapterError('openai', 'rate limit exceeded')
      expect(error).toBeInstanceOf(DomainError)
      expect(error).toBeInstanceOf(Error)
    })

    it('sets name, kind, and message correctly', () => {
      const error = new AdapterError('openai', 'rate limit exceeded')
      expect(error.name).toBe('AdapterError')
      expect(error.kind).toBe('AdapterError')
      expect(error.message).toBe('Adapter error (openai): rate limit exceeded')
    })
  })

  describe('isDomainError type guard', () => {
    it('returns true for DomainError', () => {
      expect(isDomainError(new DomainError('test'))).toBe(true)
    })

    it('returns true for InvalidTransitionError', () => {
      expect(isDomainError(new InvalidTransitionError('a', 'b', 'task'))).toBe(true)
    })

    it('returns true for ValidationError', () => {
      expect(isDomainError(new ValidationError('field', 'msg'))).toBe(true)
    })

    it('returns true for ConcurrencyError', () => {
      expect(isDomainError(new ConcurrencyError('resource'))).toBe(true)
    })

    it('returns true for AdapterError', () => {
      expect(isDomainError(new AdapterError('adapter', 'msg'))).toBe(true)
    })

    it('returns false for plain Error', () => {
      expect(isDomainError(new Error('plain error'))).toBe(false)
    })

    it('returns false for null', () => {
      expect(isDomainError(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isDomainError(undefined)).toBe(false)
    })

    it('returns false for string', () => {
      expect(isDomainError('error string')).toBe(false)
    })

    it('returns false for plain object', () => {
      expect(isDomainError({ message: 'test' })).toBe(false)
    })
  })

  describe('each subclass has distinct kind value', () => {
    it('has unique kind values', () => {
      const kinds = [
        new DomainError('test').kind,
        new InvalidTransitionError('a', 'b', 'task').kind,
        new ValidationError('field', 'msg').kind,
        new ConcurrencyError('resource').kind,
        new AdapterError('adapter', 'msg').kind,
      ]
      const uniqueKinds = new Set(kinds)
      expect(uniqueKinds.size).toBe(kinds.length)
    })
  })
})