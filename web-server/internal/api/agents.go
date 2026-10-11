package api

// builtinAgents mirrors the 14 built-ins from src/agents/registry.ts. The Go
// core cannot execute the TS registry (generic plugins land via T17), so the
// list is pinned here and asserted against the registry by the contract
// tests (docs/plans/webui-14-go-backend-mutations.md).
var builtinAgents = []string{
	// Tier 1 — architect / review
	"glm-code", "codex", "kimi",
	// Tier 2 — dev / QA
	"mm-code", "opencode", "qwen", "pi", "cline",
	// Tier 3 — experimental / boilerplate
	"kilo", "agy", "kiro", "devin",
	// Tier 4 — dry-run / test agents
	"mock", "mock-long",
}
