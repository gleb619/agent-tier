import { describe, it, expect } from 'vitest'
import { renderTemplate, buildTaskPrompt, TemplateEngine } from '../../../src/compose/infrastructure/template'
import { createAgent, createTask } from '../../../src/compose/domain'

describe('renderTemplate', () => {
  it('replaces single variable', () => {
    const result = renderTemplate('Hello {{name}}', { name: 'World' })
    expect(result).toBe('Hello World')
  })

  it('replaces multiple variables', () => {
    const result = renderTemplate('{{greeting}} {{name}}!', { greeting: 'Hi', name: 'Alice' })
    expect(result).toBe('Hi Alice!')
  })

  it('handles undefined variable — replaces with empty string', () => {
    const result = renderTemplate('Hello {{name}}', {})
    expect(result).toBe('Hello ')
  })

  it('trims whitespace in placeholder', () => {
    const result = renderTemplate('Hello {{ name }}', { name: 'World' })
    expect(result).toBe('Hello World')
  })
})

describe('buildTaskPrompt', () => {
  it('includes task title', () => {
    const task = createTask({ title: 'Fix bug' })
    const agent = createAgent({ name: 'Dev', adapter: 'mock' })
    const prompt = buildTaskPrompt(task, agent)
    expect(prompt).toContain(task.title)
  })

  it('includes description when present', () => {
    const task = createTask({ title: 'Fix bug', description: 'The bug is in parser' })
    const agent = createAgent({ name: 'Dev', adapter: 'mock' })
    const prompt = buildTaskPrompt(task, agent)
    expect(prompt).toContain(task.description!)
  })
})

describe('TemplateEngine', () => {
  it('render delegates to renderTemplate', () => {
    const engine = new TemplateEngine()
    const result = engine.render('Hello {{name}}', { name: 'World' })
    expect(result).toBe('Hello World')
  })

  it('loadTemplate task returns template string', () => {
    const engine = new TemplateEngine()
    const template = engine.loadTemplate('task')
    expect(template).toBe('Task: {{title}}\n{{description}}\nScope: {{scope}}')
  })

  it('loadTemplate unknown throws', () => {
    const engine = new TemplateEngine()
    expect(() => engine.loadTemplate('unknown')).toThrow('Template not found: unknown')
  })
})
