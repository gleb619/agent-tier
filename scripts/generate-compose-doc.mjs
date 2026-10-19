import { readFileSync, writeFileSync } from "node:fs";

const doc = readFileSync("docs/kanban-compose.md", "utf8");
const ts = `/** Verbatim copy of docs/kanban-compose.md (a test keeps them in sync); scaffolded next to a board when missing. */\nexport const KANBAN_COMPOSE_DOC = ${JSON.stringify(doc)};\n`;
writeFileSync("src/kanban/compose-doc.ts", ts, "utf8");
console.log("src/kanban/compose-doc.ts regenerated");
