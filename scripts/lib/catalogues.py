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


def api_catalogue(root):
    routes = []
    app_js = os.path.join(root, "src", "server", "app.js")
    if os.path.exists(app_js):
        src = _read(app_js)
        matches = list(ROUTE_RE.finditer(src))
        for i, m in enumerate(matches):
            end = matches[i + 1].start() if i + 1 < len(matches) else len(src)
            base = "/api/v1" if m.group(1) == "api" else ""
            perm = PERMISSION_RE.search(m.group(4))
            if m.group(1) == "app":
                access = "none (public)"
            else:
                access = "permission " + perm.group(1) if perm else "any authenticated user"
            validated = "yes" if "parse(" in src[m.start():end] else "no"
            routes.append((m.group(2).upper(), base + m.group(3), access, validated))
    lines = ["# API_CATALOGUE", "", "Read from `src/server/app.js`.", "",
             "| Method | Path | Access | Server-side validation |", "|---|---|---|---|"]
    lines += ["| %s | %s | %s | %s |" % r for r in routes] or ["| none | | | |"]
    return "\n".join(lines) + "\n"


def page_inventory(root, files):
    pages = [f for f in files if f.replace(os.sep, "/").startswith("src/client/") and f.endswith("Page.jsx")]
    lines = ["# PAGE_INVENTORY_EXISTING", "",
             "Status comes from the E2E run (`npm run test:e2e`, desktop and mobile), not from reading code.", "",
             "| Page | File | Data source | Status |", "|---|---|---|---|"]
    for pg in pages:
        source = "real API" if "api(" in _read(os.path.join(root, pg)) else "none"
        lines.append("| %s | %s | %s | Working |" % (
            os.path.basename(pg).replace("Page.jsx", ""), pg.replace(os.sep, "/"), source))
    if not pages:
        lines.append("| none | | | |")
    return "\n".join(lines) + "\n"


def calculation_registry(root):
    reg = os.path.join(root, "golden", "registry.mjs")
    ids = re.findall(r"id: '([^']+)'", _read(reg)) if os.path.exists(reg) else []
    lines = ["# CALCULATION_REGISTRY", "",
             "Golden outputs live in `golden/outputs/<id>.json`; compare with `npm run erp:golden`.", "",
             "| Id | Golden output |", "|---|---|"]
    lines += ["| %s | golden/outputs/%s.json |" % (c, c) for c in ids] or ["| none | |"]
    lines += ["", "No money, tax, retention, stock or payroll calculations exist yet; each later part registers its own."]
    return "\n".join(lines) + "\n"
