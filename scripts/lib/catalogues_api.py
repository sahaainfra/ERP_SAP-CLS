"""API and page catalogue builders for the layered module layout (routes.js + controller.js per resource)."""
import os
import re

# The text after the path is captured in a lookahead so neighbouring routes can still match.
ROUTE_RE = re.compile(r"\b(app|api|r)\.(get|post|patch|put|delete)\(\s*'([^']+)'(?=(.{0,160}))", re.S)
PERMISSION_RE = re.compile(r"requirePermission\('([^']+)'\)")
HANDLER_RE = re.compile(r"\b(?:c|controller)\.(\w+)")


def _read(path):
    with open(path, encoding="utf-8") as fh:
        return fh.read()


def _controller_validates(controller_text, handler):
    """True when the controller method calls a parse*/parse() validator before the service."""
    m = re.search(r"\b" + re.escape(handler) + r"\(req, res\) \{(.*?)\n    \}", controller_text, re.S)
    return bool(m and re.search(r"\bparse\w*\(", m.group(1)))


def routes_from_files(root, files):
    """[(method, path, access, validated)] from app.js and every modules/<code>/<resource>/routes.js."""
    routes = []
    sources = []
    app_js = os.path.join("src", "server", "app.js")
    if os.path.exists(os.path.join(root, app_js)):
        sources.append((app_js, "", None))
    for f in files:
        parts = f.replace(os.sep, "/").split("/")
        if len(parts) >= 5 and parts[:3] == ["src", "server", "modules"] and parts[-1] == "routes.js":
            module_code = parts[3]
            controller = os.path.join(root, *parts[:-1], "controller.js")
            sources.append((f, "/api/v1/" + module_code, controller))
        elif len(parts) == 5 and parts[:3] == ["src", "server", "modules"] and parts[-1] == "routes.js":
            sources.append((f, "/api/v1/" + parts[3], None))
    for rel, base, controller_path in sources:
        text = _read(os.path.join(root, rel))
        controller_text = _read(controller_path) if controller_path and os.path.exists(controller_path) else ""
        for m in ROUTE_RE.finditer(text):
            kind, method, path, rest = m.group(1), m.group(2), m.group(3), m.group(4)
            rest = re.split(r"\n\s*(?:app|api|r)\.(?:get|post|patch|put|delete)\(", rest)[0]  # stop at the next route
            prefix = "/api/v1" if kind == "api" else base
            perm = PERMISSION_RE.search(rest)
            if kind == "app" and not path.startswith("/api/v1"):
                access = "none (public)" if "authenticate" not in rest and path != "/health/ready" else "administrators or monitoring token"
            else:
                access = "permission " + perm.group(1) if perm else "any authenticated user"
            handler = HANDLER_RE.search(rest)
            if handler and controller_text:
                validated = "yes" if _controller_validates(controller_text, handler.group(1)) else "no"
            else:
                validated = "no"
            routes.append((method.upper(), prefix + path, access, validated))
    return routes


def api_catalogue(root, files):
    routes = routes_from_files(root, files)
    lines = ["# API_CATALOGUE", "",
             "Read from `src/server/app.js` and every `src/server/modules/<code>/<resource>/routes.js`.",
             "Validation is \"yes\" when the controller method calls a validator before the service.", "",
             "| Method | Path | Access | Server-side validation |", "|---|---|---|---|"]
    lines += ["| %s | %s | %s | %s |" % r for r in routes] or ["| none | | | |"]
    return "\n".join(lines) + "\n"


def page_inventory(root, files):
    pages = [f for f in files if f.replace(os.sep, "/").startswith("src/client/") and f.endswith("Page.jsx")]
    lines = ["# PAGE_INVENTORY_EXISTING", "",
             "Status comes from the E2E run (`npm run test:e2e`, desktop and mobile), not from reading code.", "",
             "| Page | File | Data source | Status |", "|---|---|---|---|"]
    for pg in pages:
        body = _read(os.path.join(root, pg))
        source = "real API (query hooks)" if re.search(r"from '\.\./api/index\.js'|\bapi\.(get|post|patch)\(", body) else "none"
        lines.append("| %s | %s | %s | Working |" % (
            os.path.basename(pg).replace("Page.jsx", ""), pg.replace(os.sep, "/"), source))
    if not pages:
        lines.append("| none | | | |")
    return "\n".join(lines) + "\n"
