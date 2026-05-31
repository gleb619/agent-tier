import type { Task } from '../domain'
import type { Agent } from '../domain'

export function renderTemplate(
  template: string,
  variables: Record<string, string | undefined>,
): string {
  return template.replace(/\{\{\s*([^}\s]+)\s*\}\}/g, (_, key: string) => {
    const value = variables[key]
    return value !== undefined ? value : ''
  })
}

export function buildTaskPrompt(task: Task, agent: Agent, context?: string): string {
  const parts: string[] = [`Task: ${task.title}`]
  if (task.description) {
    parts.push(task.description)
  }
  if (task.scope.length > 0) {
    parts.push(`Scope: ${task.scope.join(', ')}`)
  }
  if (context) {
    parts.push(context)
  }
  return parts.join('\n')
}

const BUILT_IN_TEMPLATES: Record<string, string> = {
  task: 'Task: {{title}}\n{{description}}\nScope: {{scope}}',
  agent: 'Agent: {{name}} ({{role}})',
}

export class TemplateEngine {
  constructor() {}

  render(template: string, vars: Record<string, string | undefined>): string {
    return renderTemplate(template, vars)
  }

  loadTemplate(name: string): string {
    const template = BUILT_IN_TEMPLATES[name]
    if (template === undefined) {
      throw new Error(`Template not found: ${name}`)
    }
    return template
  }
}
