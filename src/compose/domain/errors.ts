// Domain error base class
export class DomainError extends Error {
  readonly kind: string = 'DomainError'
  constructor(message: string) {
    super(message)
    this.name = 'DomainError'
  }
}

// Thrown when a state transition is not allowed
export class InvalidTransitionError extends DomainError {
  declare readonly kind: 'InvalidTransitionError'
  constructor(
    public readonly from: string,
    public readonly to: string,
    entity: string
  ) {
    super(`Invalid transition: ${entity} cannot go from ${from} to ${to}`)
    this.name = 'InvalidTransitionError'
    this.kind = 'InvalidTransitionError'
  }
}

// Thrown when input fails validation
export class ValidationError extends DomainError {
  declare readonly kind: 'ValidationError'
  constructor(
    public readonly field: string,
    message: string
  ) {
    super(`Validation error on ${field}: ${message}`)
    this.name = 'ValidationError'
    this.kind = 'ValidationError'
  }
}

// Thrown when a concurrent write conflict is detected
export class ConcurrencyError extends DomainError {
  declare readonly kind: 'ConcurrencyError'
  constructor(resource: string) {
    super(`Concurrency conflict on ${resource}`)
    this.name = 'ConcurrencyError'
    this.kind = 'ConcurrencyError'
  }
}

// Thrown when an agent adapter fails
export class AdapterError extends DomainError {
  declare readonly kind: 'AdapterError'
  constructor(
    adapter: string,
    message: string
  ) {
    super(`Adapter error (${adapter}): ${message}`)
    this.name = 'AdapterError'
    this.kind = 'AdapterError'
  }
}

// Type guard for DomainError and its subclasses
export function isDomainError(e: unknown): e is DomainError {
  return e instanceof DomainError
}