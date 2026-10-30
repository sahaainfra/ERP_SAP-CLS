"""Catalogue builders for scripts/erp_discover.py. Pure functions: ROOT in, markdown text out."""
import os
import re

TABLE_RE = re.compile(r"CREATE TABLE IF NOT EXISTS (\w+) \((.*?)\n\);", re.S)
INDEX_RE = re.compile(r"CREATE (UNIQUE )?INDEX IF NOT EXISTS (\w+)\s+ON (\w+)")
COLUMN_RE = re.compile(r"^([a-z_]+)\s")
ROUTE_RE = re.compile(r"\b(app|api)\.(get|post|patch|put|delete)\(\s*'([^']+)'(.{0,120})", re.S)
PERMISSION_RE = re.compile(r"requirePermission\('([^']+)'\)")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def db_catalogue(root):
    mig_dir = os.path.join(root, "migrations")
    tables, indexes = [], []
    names = sorted(os.listdir(mig_dir)) if os.path.isdir(mig_dir) else []
    for f in names:
        if not f.endswith(".up.sql"):
            continue
        sql = _read(os.path.join(mig_dir, f))
        for m in TABLE_RE.finditer(sql):
            cols = []
            for line in m.group(2).splitlines():
                cm = COLUMN_RE.match(line.strip())
                if cm and not line.strip().startswith(("--", "CHECK")):
                    cols.append(cm.group(1))
            tables.append((m.group(1), f, cols))
        for m in INDEX_RE.finditer(sql):
            indexes.append((m.group(2), m.group(3), bool(m.group(1)), f))
    lines = ["# DB_CATALOGUE", "",
             "Database: SQLite (node:sqlite). Source of truth: `migrations/*.up.sql`.",
             "Row counts are not recorded: the catalogue is generated from migrations, not from a live database.", "",
             "## Tables", "", "| Table | Migration | Columns |", "|---|---|---|"]
    lines += ["| %s | %s | %s |" % (t, f, ", ".join(c)) for t, f, c in tables] or ["| none | | |"]
    lines += ["", "## Indexes", "", "| Index | Table | Unique | Migration |", "|---|---|---|---|"]
    lines += ["| %s | %s | %s | %s |" % (n, t, "yes" if u else "no", f) for n, t, u, f in indexes] or ["| none | | | |"]
    lines += ["", "Views, triggers and functions: none.", "", "## ER diagram", "", "```mermaid", "erDiagram"]
    lines += ["  %s" % t for t, _, _ in tables]
    lines += ["```", "",
              "No foreign keys exist yet; tables are independent until the organisation tables (02.02) are built.", ""]
    return "\n".join(lines)


def calculation_registry(root):
    out = os.path.join(root, "golden", "outputs")
    ids = sorted(f[:-5] for f in os.listdir(out) if f.endswith(".json")) if os.path.isdir(out) else []
    lines = ["# CALCULATION_REGISTRY", "",
             "Golden outputs live in `golden/outputs/<id>.json`; compare with `npm run erp:golden`.", "",
             "| Id | Golden output |", "|---|---|"]
    lines += ["| %s | golden/outputs/%s.json |" % (c, c) for c in ids] or ["| none | |"]
    builtins = os.path.join(root, "src", "server", "platform", "calc", "builtins.js")
    codes = re.findall(r"code: '([^']+)'", _read(builtins)) if os.path.exists(builtins) else []
    lines += ["", "Business calculations are formulas in the registry (Administration > Calculations, `src/server/platform/calc/builtins.js`), evaluated by the one engine (part 01.06).", "",
              "| Formula | Version in code |", "|---|---|"]
    lines += ["| %s | 1 |" % c for c in codes] or ["| none | |"]
    lines += ["", "Each later part registers its own formulas and golden outputs."]
    return "\n".join(lines) + "\n"
