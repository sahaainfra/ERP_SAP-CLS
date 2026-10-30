# DEFECTS (scan output)

Placeholder/dummy markers found by scan (FR-06): 5

The curated defect register is `docs/erp/DEFECTS.md`.

| ID | File | Line | Text |
|---|---|---|---|
| S-001 | src/server/platform/calc/uom.js | 63 | const todo = [from]; |
| S-002 | src/server/platform/calc/uom.js | 64 | while (todo.length) { |
| S-003 | src/server/platform/calc/uom.js | 65 | todo.sort((a, b) => best.get(a).cost - best.get(b).cost); |
| S-004 | src/server/platform/calc/uom.js | 66 | const here = todo.shift(); |
| S-005 | src/server/platform/calc/uom.js | 73 | if (!todo.includes(e.to)) todo.push(e.to); |
