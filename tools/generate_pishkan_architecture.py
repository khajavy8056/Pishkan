#!/usr/bin/env python3
"""Generate the offline Pishkan architecture map from the checked-out source.

Only Python's standard library is required. The JSON model is the single source
used to create the standalone HTML and the Markdown audit report.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / "Pishkan-Architecture-Data.json"
OUT_HTML = ROOT / "Pishkan-Architecture-Map.html"
OUT_REPORT = ROOT / "Pishkan-Architecture-Report.md"
COMMIT = "ab145955a23fe547f700803b7432eb26fa356ad4"
BRANCH = "arena/3ec9e234-pishkan"
REPO = "khajavy8056/Pishkan"
EXCLUDE = {
    "Pishkan-Architecture-Data.json",
    "Pishkan-Architecture-Map.html",
    "Pishkan-Architecture-Report.md",
    "tools/generate_pishkan_architecture.py",
}

MODULE_LABELS = {
    "accounting": "حسابداری و پرداخت", "assistant": "دستیار و جست‌وجو",
    "audit": "ثبت رویدادهای ممیزی", "auth": "هویت، نشست و احراز هویت",
    "automation": "ارجاع و تصمیم‌گیری پرونده", "catalog": "کاتالوگ، خدمات و فرم پویا",
    "notifications": "اعلان‌های درون‌برنامه‌ای و رویدادی",
    "payroll": "قرارداد، کارکرد و تسویه کارکنان", "profiles": "پروفایل مشتری",
    "requests": "پرونده، درخواست و گردش کار", "settings": "تنظیمات و اسرار",
    "sms": "درگاه پیامک و الگوها", "system": "پشتیبان، بازیابی و عملیات",
}
ROUTE_LABELS = {
    "accounting": "مالی، فاکتور، پرداخت و گزارش", "assistant": "دستیار", "auth": "ورود و هویت",
    "automation": "ارجاع مدیریتی/مالی", "catalog": "کاتالوگ و پیشنهاد خدمت",
    "customers": "مشتریان و اعلان‌ها", "dashboard": "داشبورد", "files": "فایل خصوصی/عمومی",
    "health": "سلامت سرویس", "messages": "گفت‌وگو", "payroll": "حقوق",
    "public": "API عمومی", "requests": "درخواست و صف", "settings": "تنظیمات",
    "shifts": "شیفت و حضور", "staff": "کارکنان و نقش‌ها", "system": "سیستم و پشتیبان",
}
DIR_DESCRIPTIONS = {
    "apps": "برنامه‌های مستقل در monorepo.",
    "apps/api": "Express 5 + TypeScript REST API؛ PostgreSQL در تولید و SQLite برای توسعه/آزمون.",
    "apps/api/src": "نقطه ورود، HTTP، DB، CLI، کتابخانه مشترک، دامنه و routeها.",
    "apps/api/src/routes": "تعریف endpointهای HTTP، parse/validation و اعمال مجوز/دامنه دسترسی.",
    "apps/api/src/modules": "منطق کسب‌وکار؛ سرویس‌های ماژولار و تراکنش‌ها.",
    "apps/api/src/db": "رابط DB مشترک PostgreSQL/SQLite و اجرای migrationهای ترتیبی.",
    "apps/api/src/http": "ساخت Express، middleware، خطا، پاسخ و مسیر‌دهی.",
    "apps/api/src/lib": "توابع رمزنگاری، مجوز، دامنه دسترسی، زمان تهران و متن فارسی.",
    "apps/api/src/cli": "دستورهای مهاجرت، seed، ایجاد مدیر و بازنشانی رمز.",
    "apps/api/migrations": "۱۵ migration افزایشی و قابل checksum؛ schema واقعی از SQL همین پوشه ساخته شد.",
    "apps/api/tests": "تست‌های API با Supertest/Vitest و SQLite موقت.",
    "apps/api/audit": "تست‌های پذیرش نیازمندی‌های انتشار (config جداگانه).",
    "apps/web": "React 19/Vite 7 SPA؛ RTL، PWA و پیکربندی Capacitor.",
    "apps/web/src": "ورود React، routing، providers، کتابخانه API، صفحات و پوسته‌ها.",
    "apps/web/src/pages": "صفحات public/customer/staff/admin/shared.",
    "apps/web/src/components": "عناصر UI، پوسته، mobile verification و layout عمومی.",
    "apps/web/src/lib": "API client، auth/site providers و formatting.",
    "apps/web/tests": "تست‌های UI با Vitest, Testing Library, jsdom.",
    "apps/web/scripts": "Smoke check مرورگر Playwright.",
    "apps/web/public": "آیکون‌ها و تصاویر محلی؛ بدون CDN برای اجرای اصلی.",
    "deploy": "تعریف‌های Nginx, systemd و آماده‌سازی PostgreSQL.",
    "scripts": "نصب Ubuntu/Windows و چرخه عمر pishkan.",
    "docs": "راهنمای فنی/عملیاتی و گزارش‌های ممیزی.",
}
FILE_DESCRIPTIONS = {
    "apps/api/src/index.ts": "Bootstrap API: fail-fast تنظیمات production، ساخت مسیرهای داده، اتصال DB، migration، defaults، نقش/کاتالوگ و listen/shutdown.",
    "apps/api/src/http/app.ts": "ساخت middlewareهای Helmet/CSP/CORS/origin/rate limit/session، اتصال ۱۷ router و سرو static SPA.",
    "apps/api/src/db/index.ts": "رابط DB؛ SQLite با BEGIN IMMEDIATE و PostgreSQL با pool/transaction؛ جایگاه AsyncLocalStorage برای queryهای تراکنشی.",
    "apps/api/src/db/migrate.ts": "خواندن migrationها، checksum registry و اجرای migrationهای اعمال‌نشده.",
    "apps/api/src/lib/permissions.ts": "کاتالوگ resource/action، شش نقش پیش‌فرض و ارزیابی مجوز رشته‌ای.",
    "apps/api/src/modules/requests/service.ts": "منطق فرم/quote/ثبت پرونده، snapshot، invoice، صف، ارجاع، status، مدارک و idempotency.",
    "apps/api/src/modules/accounting/service.ts": "فاکتور، پرداخت، دفتر کل، گزارش مالی و عملیات accounting.",
    "apps/api/src/modules/accounting/zarinpal.ts": "آداپتور زرین‌پال: ایجاد درخواست و verify سمت سرور؛ ۱۵ ثانیه timeout و حالت sandbox.",
    "apps/api/src/modules/sms/provider.ts": "انتزاع provider ملی پیامک/console، الگو، OTP، log، idempotency و timeout.",
    "apps/api/src/modules/notifications/service.ts": "ذخیره اعلان قبل از SMS؛ dedupe اعلان و مسیر ارسال رویداد.",
    "apps/api/src/modules/assistant/service.ts": "Intentهای builtin مبتنی بر جست‌وجوی کاتالوگ و آداپتور اختیاری OpenAI-compatible با fallback.",
    "apps/api/src/modules/automation/service.ts": "تحویل پرونده، ارجاع مدیریت/حسابداری و تصمیم‌های بررسی.",
    "apps/web/src/main.tsx": "نقطه ورود UI، providers و BrowserRouter برای صفحات عمومی/مشتری/کارمند/مدیر.",
    "apps/web/src/lib/api.ts": "HTTP client سمت مرورگر با URL نسبی، credentials و تبدیل خطاهای API.",
    "apps/web/src/lib/auth.tsx": "AuthProvider، احراز نشست و انتخاب صفحه خانه متناسب با نقش.",
    "apps/web/src/lib/site.tsx": "داده bootstrap عمومی، دسته/خدمت و تنظیمات سایت برای UI.",
    "apps/web/src/pages/public/Services.tsx": "کاتالوگ عمومی و فرم پویا؛ quote و ثبت درخواست با کلید idempotency.",
    "apps/web/src/pages/staff/Queue.tsx": "صف eligibility و claim؛ پس از پذیرش، refresh محلی صف.",
    "apps/web/vite.config.ts": "پلاگین React/Tailwind/PWA؛ dev proxy برای /api و /uploads به API server-side.",
    "apps/web/capacitor.config.ts": "پیکربندی پوسته Android Capacitor؛ URL سرور اختیاری در زمان build.",
    "apps/api/migrations/015_request_submission_idempotency.sql": "ثبت کلید retry مشتری‌محور و اتصال یکتا به درخواست (بدون ذخیره payload فرم).",
}


def run(*args: str) -> str:
    return subprocess.check_output(args, cwd=ROOT, text=True, stderr=subprocess.DEVNULL).strip()


def rel(path: Path | str) -> str:
    if isinstance(path, Path):
        return path.relative_to(ROOT).as_posix()
    return Path(path).as_posix()


def line_of(text: str, pos: int) -> int:
    return text.count("\n", 0, pos) + 1


def safe_text(path: Path) -> str:
    try:
        raw = path.read_bytes()
        if b"\0" in raw[:4096]:
            return ""
        return raw.decode("utf-8", "replace")
    except Exception:
        return ""


def layer_for(path: str) -> str:
    if path.startswith("apps/web/src/"):
        if "/pages/" in path: return "frontend-pages"
        if "/components/" in path: return "frontend-components"
        if "/lib/" in path: return "frontend-client"
        return "frontend"
    if path.startswith("apps/web/public/"): return "assets"
    if path.startswith("apps/web/tests/"): return "tests"
    if path.startswith("apps/api/migrations/"): return "database"
    if path.startswith("apps/api/tests/") or path.startswith("apps/api/audit/"): return "tests"
    if path.startswith("apps/api/src/routes/"): return "api-routes"
    if path.startswith("apps/api/src/modules/"): return "backend-domain"
    if path.startswith("apps/api/src/db/"): return "database"
    if path.startswith("apps/api/src/http/"): return "backend-http"
    if path.startswith("apps/api/src/cli/"): return "operations"
    if path.startswith("apps/api/src/lib/"): return "shared-security"
    if path.startswith("deploy/") or path.startswith("scripts/"): return "infrastructure"
    if path.startswith("docs/") or path.endswith(".md") or path.endswith(".pdf"): return "documentation"
    if path.startswith(".env"): return "configuration-security"
    if path.endswith(".json") or path.endswith(".yml") or path.endswith(".conf") or path.endswith(".service") or path.endswith(".cmd") or path.endswith(".ps1"): return "configuration"
    return "root"


def describe_file(path: str, text: str) -> str:
    if path in FILE_DESCRIPTIONS: return FILE_DESCRIPTIONS[path]
    if path.endswith(".sql"):
        tables = re.findall(r"(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE)\s+([\w]+)", text, re.I)
        return "Migration SQL افزایشی؛ جدول/تغییرهای قابل اثبات: " + (", ".join(dict.fromkeys(tables)) or "داده پایه/ایندکس") + "."
    if "/routes/" in path:
        key = Path(path).stem
        return f"Express route group «{ROUTE_LABELS.get(key, key)}»؛ endpointهای واقعی از رجیستری route استخراج شده‌اند."
    if "/modules/" in path:
        parts = path.split("/")
        mod = parts[4] if len(parts) > 4 else ""
        return f"پیاده‌سازی دامنه «{MODULE_LABELS.get(mod, mod)}»؛ importها، SQL و exportها در همین نقشه ثبت شده‌اند."
    if "/pages/" in path:
        return f"صفحه/دامنه رابط کاربری؛ route و API calls از سورس UI استخراج شده‌اند: {Path(path).stem}."
    if "/components/" in path:
        return "کامپوننت رابط کاربری مشترک؛ مصرف‌کنندگان مستقیم در import graph دیده می‌شوند."
    if path.endswith(".test.ts") or path.endswith(".test.tsx"):
        return "منبع آزمون خودکار؛ assertions و importهای مستقیم در کد فایل قابل ردیابی‌اند."
    if path.startswith("docs/"):
        return "راهنمای/گزارش پروژه؛ متن سند مرجع قرارداد یا عملیات است، نه اثبات اجرای سرویس زنده."
    if path.startswith("deploy/"):
        return "پیکربندی نمونه استقرار؛ وجود فایل به معنی اجرای واقعی روی میزبان نیست."
    if path.startswith("scripts/"):
        return "اسکریپت عملیاتی/نصب؛ فقط کد مخزن است و در این نقشه اجرا نشده مگر جداگانه ثبت شده باشد."
    if path.endswith(".json") and "package" in path:
        return "مانیفست وابستگی و فرمان‌های npm برای workspace/پروژه."
    if path.endswith(".ts") or path.endswith(".tsx"):
        return "ماژول TypeScript؛ exportها و importهای نسبی در گراف مستقیم نمایان‌اند."
    return "فایل ردیابی‌شده در snapshot مخزن؛ نوع و ارتباط از مسیر و محتوای قابل خواندن مشخص می‌شود."


def exported_symbols(text: str) -> list[str]:
    patterns = [
        r"\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)",
        r"\bexport\s+class\s+([A-Za-z_$][\w$]*)",
        r"\bexport\s+interface\s+([A-Za-z_$][\w$]*)",
        r"\bexport\s+type\s+([A-Za-z_$][\w$]*)",
        r"\bexport\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)",
    ]
    found: list[tuple[int,str]] = []
    for pat in patterns:
        for m in re.finditer(pat, text): found.append((m.start(), m.group(1)))
    return list(dict.fromkeys(name for _, name in sorted(found)))


def module_for_path(path: str) -> str:
    p = Path(path)
    parts = p.parts
    if len(parts) >= 5 and parts[:3] == ("apps", "api", "src"):
        if parts[3] in ("modules", "routes") and len(parts) > 4:
            return f"api:{parts[3]}:{parts[4]}"
        return f"api:{parts[3]}"
    if len(parts) >= 5 and parts[:3] == ("apps", "web", "src"):
        if parts[3] == "pages" and len(parts) > 4: return f"web:pages:{parts[4]}"
        return f"web:{parts[3]}"
    if path.startswith("apps/web/"): return "web:root"
    if path.startswith("apps/api/"): return "api:root"
    if path.startswith("deploy/"): return "infra:deploy"
    if path.startswith("scripts/"): return "infra:scripts"
    if path.startswith("docs/"): return "docs"
    return "root"


def module_title(mid: str) -> str:
    bits = mid.split(":")
    if bits[:2] == ["api", "modules"]: return "API · " + MODULE_LABELS.get(bits[2], bits[2])
    if bits[:2] == ["api", "routes"]: return "API route · " + ROUTE_LABELS.get(bits[2], bits[2])
    if bits[:2] == ["web", "pages"]: return "وب · " + {"public":"عمومی", "customer":"مشتری", "staff":"کارمند", "admin":"مدیر", "shared":"مشترک"}.get(bits[2], bits[2])
    names = {"api:db":"API · دسترسی داده", "api:http":"API · HTTP و middleware", "api:lib":"API · کتابخانه مشترک", "api:cli":"API · CLI", "web:components":"وب · کامپوننت‌ها", "web:lib":"وب · client/providers", "web:root":"وب · bootstrap/config", "api:root":"API · bootstrap/config", "infra:deploy":"استقرار", "infra:scripts":"نصب/عملیات", "docs":"مستندات", "root":"ریشه مخزن"}
    return names.get(mid, mid)


def create_sqlite_schema() -> tuple[list[dict[str,Any]], list[dict[str,Any]]]:
    con = sqlite3.connect(":memory:")
    con.execute("PRAGMA foreign_keys=ON")
    migrations = sorted((ROOT / "apps/api/migrations").glob("*.sql"))
    for migration in migrations:
        con.executescript(migration.read_text(encoding="utf-8"))
    tables: list[dict[str,Any]] = []
    for (name,) in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"):
        cols = con.execute(f'PRAGMA table_info("{name}")').fetchall()
        fks = con.execute(f'PRAGMA foreign_key_list("{name}")').fetchall()
        tables.append({
            "name": name,
            "columns": [{"name": c[1], "type": c[2] or "", "notNull": bool(c[3]), "default": c[4], "primaryKeyOrder": c[5]} for c in cols],
            "primaryKey": [c[1] for c in cols if c[5]],
            "foreignKeys": [{"column": f[3], "targetTable": f[2], "targetColumn": f[4], "onDelete": f[6], "onUpdate": f[5]} for f in fks],
        })
    migrations_data = []
    for p in migrations:
        body = p.read_text(encoding="utf-8")
        targets = list(dict.fromkeys(re.findall(r"(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE)\s+([\w]+)", body, re.I)))
        migrations_data.append({"name": p.name, "path": rel(p), "tables": targets, "sha256": __import__("hashlib").sha256(body.encode()).hexdigest()})
    con.close()
    return tables, migrations_data


def make_html(data: dict[str,Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")
    return HTML_TEMPLATE.replace("__ARCH_DATA__", payload)


def generate() -> dict[str,Any]:
    tracked = run("git", "ls-files", "-z")
    paths = [p for p in tracked.split("\0") if p and p not in EXCLUDE]
    paths = sorted(paths)
    texts = {p: safe_text(ROOT / p) for p in paths}

    nodes: list[dict[str,Any]] = []
    edges: list[dict[str,Any]] = []
    by_id: dict[str,dict[str,Any]] = {}
    edge_no = 0

    def add_node(nid: str, typ: str, layer: str, title: str, description: str = "", **kw: Any) -> dict[str,Any]:
        if nid in by_id: return by_id[nid]
        item = {"id":nid,"type":typ,"layer":layer,"title":title,"description":description,"confidence":"high","status":"source-verified",**kw}
        nodes.append(item); by_id[nid]=item; return item

    def add_edge(source: str, target: str, typ: str, label: str, evidence: list[dict[str,Any]] | None = None, confidence: str = "high", **kw: Any) -> None:
        nonlocal edge_no
        if source not in by_id or target not in by_id: return
        edge_no += 1
        edges.append({"id":f"edge:{edge_no}","source":source,"target":target,"type":typ,"label":label,"confidence":confidence,"certainty":"direct" if confidence=="high" else "inferred","evidence":evidence or [],**kw})

    add_node("repo", "repository", "root", "Pishkan · سامانه پیشخوان", "Monorepo; snapshot بررسی‌شده از branch راه‌دور مشخص‌شده.", path=".", metadata={"repo":REPO,"branch":BRANCH,"commit":COMMIT})

    # Directories and every Git-tracked file form a complete, expandable tree.
    dirs: set[str] = set()
    for p in paths:
        q = Path(p).parent
        while str(q) not in (".", ""):
            dirs.add(q.as_posix()); q = q.parent
    for d in sorted(dirs, key=lambda x:(x.count("/"),x)):
        title = Path(d).name or d
        add_node("dir:"+d,"directory",layer_for(d),title,DIR_DESCRIPTIONS.get(d,"پوشه پروژه؛ زیرشاخه‌ها از فهرست Git در commit بررسی‌شده استخراج شدند."),path=d)
        parent = Path(d).parent.as_posix()
        add_edge("repo" if parent=="." else "dir:"+parent,"dir:"+d,"contains","زیرپوشه",[{"path":d}])
    for p in paths:
        text = texts[p]
        symbols = exported_symbols(text) if p.endswith((".ts",".tsx",".js",".mjs")) else []
        file_node = add_node("file:"+p,"file",layer_for(p),Path(p).name,describe_file(p,text),path=p,moduleId=module_for_path(p),extension=Path(p).suffix or "[بدون پسوند]",sizeBytes=(ROOT/p).stat().st_size,symbols=symbols)
        parent = Path(p).parent.as_posix()
        add_edge("repo" if parent=="." else "dir:"+parent,file_node["id"],"contains","فایل",[{"path":p}])

    # Component/module nodes group file nodes without replacing the full tree.
    module_ids = sorted({module_for_path(p) for p in paths})
    for mid in module_ids:
        member = [p for p in paths if module_for_path(p)==mid]
        layer = "backend-domain" if mid.startswith("api:modules:") else "api-routes" if mid.startswith("api:routes:") else "frontend-pages" if mid.startswith("web:pages:") else "architecture"
        mnode = add_node("module:"+mid,"module",layer,module_title(mid),f"{len(member)} فایل Git در این زیرگروه؛ جزئیات و call/importها در گره‌های فایل.",path=member[0].rsplit("/",1)[0] if member else "",fileCount=len(member),files=member)
        for p in member: add_edge(mnode["id"],"file:"+p,"groups","فایل عضو",[{"path":p}])

    # Import graph: only local import/export/dynamic import specifiers resolved to actual files.
    source_map = {p:texts[p] for p in paths}
    import_re = re.compile(r"(?:\bfrom\s*|\bimport\s*\(|\bimport\s*)['\"]([^'\"]+)['\"]")
    external_specs: dict[str,list[tuple[str,int]]] = defaultdict(list)
    builtin_specs: dict[str,list[tuple[str,int]]] = defaultdict(list)
    local_import_pairs: list[tuple[str,str,int,str]] = []
    for p,text in source_map.items():
        if not text or not p.endswith((".ts",".tsx",".js",".jsx",".mjs",".css")): continue
        for m in import_re.finditer(text):
            spec=m.group(1); ln=line_of(text,m.start())
            if spec.startswith("."):
                base=(ROOT/p).parent / spec
                candidates=[base,Path(str(base)+".ts"),Path(str(base)+".tsx"),Path(str(base)+".js"),Path(str(base)+".jsx"),Path(str(base)+".mjs"),base/"index.ts",base/"index.tsx",base/"index.js"]
                # TypeScript NodeNext source convention imports emitted .js specifiers.
                if spec.endswith(".js"):
                    stem=Path(str(base)[:-3])
                    candidates.extend([Path(str(stem)+".ts"),Path(str(stem)+".tsx")])
                elif spec.endswith(".jsx"):
                    stem=Path(str(base)[:-4])
                    candidates.extend([Path(str(stem)+".tsx"),Path(str(stem)+".ts")])
                resolved=None
                for c in candidates:
                    try: rp=c.resolve().relative_to(ROOT.resolve()).as_posix()
                    except Exception: continue
                    if rp in source_map: resolved=rp; break
                if resolved: local_import_pairs.append((p,resolved,ln,spec))
            elif spec.startswith("node:"):
                builtin_specs[spec].append((p,ln))
            elif not spec.startswith(("/","http:","https:")):
                pkg=spec.split("/")[0]
                pkg="/".join(spec.split("/")[:2]) if spec.startswith("@") else pkg
                external_specs[pkg].append((p,ln))

    dep_packages: dict[str,dict[str,str]] = {}
    for manifest in ("package.json","apps/api/package.json","apps/web/package.json"):
        if manifest not in texts: continue
        try: obj=json.loads(texts[manifest])
        except Exception: continue
        for group in ("dependencies","devDependencies"):
            for pkg,version in obj.get(group,{}).items(): dep_packages.setdefault(pkg,{})[manifest+":"+group]=version
    # Include every direct manifest dependency, even if a static import is not found (plugins/config).
    for pkg,meta in dep_packages.items():
        add_node("package:"+pkg,"dependency","external",pkg,"بسته npm مستقیم از package.json؛ نسخه‌ها range manifest هستند، نه نسخه resolveشده lockfile.",package=pkg,versions=meta,imported=bool(external_specs.get(pkg)),importSites=[{"path":p,"line":ln} for p,ln in external_specs.get(pkg,[])])
        for source in sorted({key.split(":",1)[0] for key in meta}):
            if "file:"+source in by_id: add_edge("file:"+source,"package:"+pkg,"declares-dependency","dependency manifest",[{"path":source,"snippet":pkg+" "+meta[next(k for k in meta if k.startswith(source+":"))]}],confidence="high")
    if builtin_specs:
        add_node("runtime:node-builtins","runtime","infrastructure","Node.js built-ins","Moduleهای استاندارد Node با `node:` scheme؛ وابستگی npm یا سرویس بیرونی نیستند.",modules=sorted(builtin_specs))
        for spec,imports in builtin_specs.items():
            for p,ln in imports: add_edge("file:"+p,"runtime:node-builtins","uses-runtime","Node built-in "+spec,[{"path":p,"line":ln,"snippet":spec}])
    for p,dest,ln,spec in local_import_pairs:
        add_edge("file:"+p,"file:"+dest,"imports","import محلی",[{"path":p,"line":ln,"snippet":spec}],kind="direct-import",moduleSource=module_for_path(p),moduleTarget=module_for_path(dest))
    for pkg,imports in external_specs.items():
        if "package:"+pkg not in by_id: add_node("package:"+pkg,"dependency","external",pkg,"Import از dependency بیرونی.",package=pkg,versions=dep_packages.get(pkg,{}))
        for p,ln in imports:
            add_edge("file:"+p,"package:"+pkg,"depends-on","npm import",[{"path":p,"line":ln}],kind="direct-dependency")

    # API router mounts and concrete endpoint registry.
    app_text=texts.get("apps/api/src/http/app.ts","")
    router_mounts: dict[str,list[str]]=defaultdict(list)
    for m in re.finditer(r"app\.use\(\[([^\]]+)\],\s*(\w+Router)\s*\)",app_text,re.S):
        prefixes=re.findall(r"['\"]([^'\"]+)['\"]",m.group(1)); router=m.group(2)
        route_name=router.removesuffix("Router")
        for prefix in prefixes: router_mounts[router].append(prefix)
        for prefix in prefixes:
            # explicit mount is evidence of the versioned/public API boundary.
            module_id="module:api:routes:"+route_name
            if module_id not in by_id:
                add_node(module_id,"module","api-routes","API route · "+ROUTE_LABELS.get(route_name,route_name),"Router واقعی mount شده در Express.",path=f"apps/api/src/routes/{route_name}.ts",files=[f"apps/api/src/routes/{route_name}.ts"])
            add_edge("file:apps/api/src/http/app.ts",module_id,"mounts","mount router",[{"path":"apps/api/src/http/app.ts","line":line_of(app_text,m.start()),"snippet":prefix}],prefix=prefix)

    endpoint_nodes=[]
    for p,text in source_map.items():
        if not p.startswith("apps/api/src/routes/"): continue
        router_name=Path(p).stem+"Router"
        prefixes=router_mounts.get(router_name,["/api/"+Path(p).stem])
        global_auth=bool(re.search(rf"{re.escape(router_name)}\.use\(requireAuth\)",text))
        route_re=re.compile(rf"{re.escape(router_name)}\s*\.\s*(get|post|put|patch|delete)\s*\(\s*(['\"`])([^'\"`]+)\2",re.I)
        for m in route_re.finditer(text):
            verb=m.group(1).upper(); local=m.group(3); ln=line_of(text,m.start())
            # Route middleware appears immediately after the route path; look up to async handler start.
            head=text[m.end():m.end()+700]
            permission_matches=re.findall(r"requirePermission\(\s*['\"]([^'\"]+)['\"](?:\s*,\s*['\"]([^'\"]+)['\"])?",head)
            perms=[]
            for x in permission_matches:
                perms.extend([v for v in x if v])
            explicit_auth="requireAuth" in head[:180]
            auth="permission" if perms else "authenticated" if global_auth or explicit_auth else "conditional/object-scope/public-callback"
            path_prefix=prefixes[0].replace("/v1","")
            full=(path_prefix.rstrip("/")+("" if local=="/" else "/"+local.lstrip("/")))
            aliases=[pre.rstrip("/")+ ("" if local=="/" else "/"+local.lstrip("/")) for pre in prefixes]
            eid=f"api:{verb}:{full}"
            if eid in by_id: eid+=f":{ln}"
            ep=add_node(eid,"endpoint","api-routes",f"{verb} {full}",f"Express endpoint. Auth classification: {auth}.",method=verb,path=full,aliases=aliases,auth=auth,permissions=list(dict.fromkeys(perms)),sourcePath=p,line=ln,router=Path(p).stem)
            endpoint_nodes.append(ep)
            add_edge("file:"+p,eid,"defines-route","Express route",[{"path":p,"line":ln,"snippet":f"{verb} {local}"}],auth=auth,permission=perms)
            # Source path+route prefix is a traceable code evidence, not inferred from naming.

    # Browser routes: tie JSX Route path to imported component module/file and wrapper role.
    main_text=texts.get("apps/web/src/main.tsx","")
    component_imports: dict[str,str]={}
    for m in re.finditer(r"import\s*\{([^}]+)\}\s*from\s*['\"]([^'\"]+)['\"]",main_text):
        spec=m.group(2); base=(ROOT/"apps/web/src/main.tsx").parent/spec
        rp=None
        for c in [Path(str(base)+".ts"),Path(str(base)+".tsx"),Path(str(base)+".js"),Path(str(base)+".jsx")]:
            try: q=c.resolve().relative_to(ROOT.resolve()).as_posix()
            except Exception: continue
            if q in source_map: rp=q;break
        if rp:
            for raw in m.group(1).split(","):
                symbol=raw.strip().split(" as ")[-1].strip()
                if symbol: component_imports[symbol]=rp
    ui_route_re=re.compile(r"<Route\s+path=\"([^\"]+)\"\s+element=\{([^}]+)\}",re.S)
    for m in ui_route_re.finditer(main_text):
        path=m.group(1); jsx=m.group(2); names=re.findall(r"\b([A-Z][A-Za-z0-9_]*)\b",jsx)
        comp=next((n for n in names if n in component_imports),None)
        wrapper="adminOnly" if "adminOnly(" in jsx else "financial" if "financial(" in jsx else "staffOnly" if "staffOnly(" in jsx else "customer" if "customer(" in jsx else "public/redirect"
        rid="ui-route:"+path
        required=re.search(r"permission=\"([^\"]+)\"",jsx)
        node=add_node(rid,"ui-route","frontend-pages",path,"React Router path in apps/web/src/main.tsx.",path=path,component=comp,sourcePath="apps/web/src/main.tsx",line=line_of(main_text,m.start()),wrapper=wrapper,permission=required.group(1) if required else None)
        add_edge("file:apps/web/src/main.tsx",rid,"declares-ui-route","React Router",[{"path":"apps/web/src/main.tsx","line":node["line"]}],wrapper=wrapper)
        if comp and component_imports.get(comp):
            add_edge(rid,"file:"+component_imports[comp],"renders","React element",[{"path":"apps/web/src/main.tsx","line":node["line"],"snippet":comp}],wrapper=wrapper)

    # Browser API calls: direct path literals/templates are mapped to matching endpoint patterns.
    web_call_re=re.compile(r"\bapi\.(get|post|put|patch|delete)\s*(?:<[^;()]*?>)?\s*\(\s*(['\"`])([^'\"`]+)\2",re.I)
    api_calls=[]
    endpoints_by_method=defaultdict(list)
    for ep in endpoint_nodes: endpoints_by_method[ep["method"]].append(ep)
    def route_matches(template: str, route: str) -> bool:
        t=template.split("?")[0]
        t=re.sub(r"\$\{[^}]+\}","__PARAM__",t)
        t=re.sub(r"\$\{[^}]+\}","__PARAM__",t)
        if not t.startswith("/api"): return False
        pattern="^"+re.escape(t).replace("__PARAM__",r"[^/]+")+"$"
        return bool(re.match(pattern,route))
    for p,text in source_map.items():
        if not p.startswith("apps/web/src/"): continue
        for m in web_call_re.finditer(text):
            verb=m.group(1).upper(); raw=m.group(3); ln=line_of(text,m.start())
            candidates=[e for e in endpoints_by_method[verb] if any(route_matches(raw,a) for a in e.get("aliases",[]))]
            target=candidates[0] if candidates else None
            call_id=f"webcall:{p}:{ln}:{verb}"
            cn=add_node(call_id,"client-call","frontend-client",f"{verb} {raw}","API client call literal/template extracted from UI source.",path=raw,sourcePath=p,line=ln,method=verb,matchedEndpoint=target["id"] if target else None,matchStatus="matched" if target else "unmatched")
            api_calls.append(cn)
            add_edge("file:"+p,call_id,"calls-client","api client",[{"path":p,"line":ln,"snippet":f"api.{verb.lower()}({raw})"}])
            if target: add_edge(call_id,target["id"],"calls-api","HTTP request/response",[{"path":p,"line":ln,"snippet":raw}],certainty="direct-client-contract")

    # Derived end-to-end dependency: React route -> rendered component -> literal API call -> registered endpoint.
    # This is intentionally marked medium/inferred because it composes direct source edges across layers.
    rendered_by: dict[str,list[dict[str,Any]]] = defaultdict(list)
    for edge in edges:
        if edge["type"]=="renders": rendered_by[edge["target"]].append(edge)
    for call in api_calls:
        target_id=call.get("matchedEndpoint")
        target=by_id.get(target_id or "")
        if not target: continue
        component_file="file:"+call.get("sourcePath","")
        for render_edge in rendered_by.get(component_file,[]):
            ui_route=by_id.get(render_edge["source"])
            source_module="module:"+module_for_path(call.get("sourcePath",""))
            target_module="module:"+module_for_path(target.get("sourcePath",""))
            if ui_route and source_module in by_id and target_module in by_id:
                add_edge(source_module,target_module,"module-api-contract","UI → API contract (via component/client)",[
                    {"path":ui_route.get("sourcePath","apps/web/src/main.tsx"),"line":ui_route.get("line"),"snippet":ui_route.get("path")},
                    {"path":call.get("sourcePath"),"line":call.get("line"),"snippet":call.get("path")},
                    {"path":target.get("sourcePath"),"line":target.get("line"),"snippet":target.get("path")},
                ],confidence="medium",certainty="derived-static-path-match",via=[ui_route["id"],call["id"],target["id"]])

    # SQL schema is executed from all committed migrations in a throwaway in-memory SQLite DB.
    tables,migrations=create_sqlite_schema()
    migration_by_name={m["name"]:m for m in migrations}
    table_map={t["name"]:t for t in tables}
    migration_table_sources=defaultdict(list)
    for m in migrations:
        for table in m["tables"]: migration_table_sources[table].append(m["path"])
    sql_ref_re={}
    for t in tables:
        name=t["name"]
        tn=add_node("table:"+name,"table","database",name,table_description(name),path=name,columns=t["columns"],primaryKey=t["primaryKey"],foreignKeys=t["foreignKeys"],migrationPaths=migration_table_sources.get(name,[]))
        for mp in migration_table_sources.get(name,[]): add_edge("file:"+mp,tn["id"],"defines-schema","DDL/migration",[{"path":mp,"snippet":name}])
    # Explicit FK relations only; the schema is not inferred from *_id conventions.
    for t in tables:
        for fk in t["foreignKeys"]:
            if "table:"+fk["targetTable"] in by_id:
                add_edge("table:"+t["name"],"table:"+fk["targetTable"],"foreign-key",f"{fk['column']} → {fk['targetTable']}.{fk['targetColumn']}",[{"path":migration_by_name.get(next((Path(mp).name for mp in migration_table_sources.get(t['name'],[])),""),{}).get("path","")}],relationship="many-to-one",onDelete=fk["onDelete"],column=fk["column"],targetColumn=fk["targetColumn"])
    # SQL caller-to-table links require SQL clauses, not arbitrary mentions in UI copy.
    sql_clause=re.compile(r"\b(?:FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+[\"`]?([A-Za-z_][A-Za-z0-9_]*)",re.I)
    for p,text in source_map.items():
        if not p.startswith("apps/api/src/"): continue
        for m in sql_clause.finditer(text):
            table=m.group(1)
            if table in table_map:
                prefix=text[max(0,m.start()-24):m.start()].upper()
                op="writes" if "INSERT" in prefix or "UPDATE" in prefix or "DELETE" in prefix or m.group(0).upper().startswith(("INTO","UPDATE")) else "reads"
                context=text[max(0,m.start()-120):m.end()+120].upper()
                if not any(token in context for token in ("SELECT ","INSERT INTO ","UPDATE ","DELETE FROM ")): continue
                add_edge("file:"+p,"table:"+table,"sql-usage",op+" table",[{"path":p,"line":line_of(text,m.start()),"snippet":m.group(0)}],confidence="high",operation=op)

    # Tests and migration nodes are searchable as first-class components.
    for p in paths:
        if p.endswith(".sql") and p.startswith("apps/api/migrations/"):
            m=next((x for x in migrations if x["path"]==p),None)
            add_node("migration:"+Path(p).stem,"migration","database",Path(p).name,"Migration compiled in throwaway SQLite schema; SHA-256 shown for this exact file.",path=p,tables=m["tables"] if m else [],sha256=m["sha256"] if m else "")
            add_edge("migration:"+Path(p).stem,"file:"+p,"source-file","migration source",[{"path":p}])
        if (p.startswith("apps/api/tests/") or p.startswith("apps/api/audit/") or p.startswith("apps/web/tests/")) and (p.endswith(".test.ts") or p.endswith(".test.tsx")):
            add_node("test:"+p,"test","tests",Path(p).name,"تست خودکار موجود در snapshot؛ تعداد تست اجراشده در این کار از شمارش فایل تست استنتاج نمی‌شود.",path=p,moduleId=module_for_path(p),symbols=exported_symbols(texts[p]))
            add_edge("file:"+p,"test:"+p,"tested-by","test-source",[{"path":p}])

    # Business modules (readable architecture taxonomy); all member files remain separately searchable.
    for mod,label in MODULE_LABELS.items():
        mpath=f"apps/api/src/modules/{mod}"
        member=[p for p in paths if p.startswith(mpath+"/")]
        if not member: continue
        did="domain:"+mod
        add_node(did,"domain","backend-domain",label,f"Backend module folder with {len(member)} files; see implementation files and exact SQL/import edges.",path=mpath,files=member)
        for p in member: add_edge(did,"file:"+p,"contains-implementation","implementation file",[{"path":p}])
    for group in ["public","customer","staff","admin","shared"]:
        dpath=f"apps/web/src/pages/{group}"; member=[p for p in paths if p.startswith(dpath+"/")]
        if member:
            did="ui-domain:"+group
            add_node(did,"domain","frontend-pages",f"UI · {group}",f"React page group; {len(member)} tracked source files.",path=dpath,files=member)
            for p in member: add_edge(did,"file:"+p,"contains-implementation","page file",[{"path":p}])

    # Runtime surfaces and external integrations, only where code/config exists.
    external_defs=[
        {"id":"postgres","title":"PostgreSQL","purpose":"Production relational DB via pg Pool; env DB_DRIVER=postgres and DATABASE_URL.","path":"apps/api/src/db/index.ts","timeout":"connectionTimeoutMillis 10,000ms; pool max DB_POOL_MAX or 15","test":"No live PostgreSQL was connected in this architecture extraction.","status":"implemented-in-code; not environment-verified","layer":"external"},
        {"id":"sqlite","title":"Node node:sqlite","purpose":"Development/test DB; `BEGIN IMMEDIATE`, SQLite file or in-memory tests.","path":"apps/api/src/db/index.ts","timeout":"busy_timeout 5,000ms","test":"Migration SQL executed in a throwaway in-memory SQLite DB for this map.","status":"code/schema-verified; not production DB","layer":"database"},
        {"id":"melipayamak","title":"MeliPayamak SMS","purpose":"OTP and event-pattern/simple SMS. Panel REST or console token API; encrypted credentials in settings.","path":"apps/api/src/modules/sms/provider.ts","timeout":"12,000ms per HTTP call; AbortController; redirect:error","test":"Mock response contract tests exist; no live credentials/message in this session.","status":"implemented-in-code; mock-tested; live-unverified","layer":"external","operations":["POST /SendSMS/BaseServiceNumber","POST /SendSMS/SendSMS","POST /SendSMS/GetCredit","console POST /api/send/shared/{token}"],"auth":"Panel username/password or API key; console token; values omitted."},
        {"id":"zarinpal","title":"Zarinpal payment gateway","purpose":"Create payment authority and verify payment server-side.","path":"apps/api/src/modules/accounting/zarinpal.ts","timeout":"15,000ms; redirect:error","test":"Account/payment tests include simulation; no real Zarinpal transaction verified.","status":"implemented-in-code; test/sandbox/real status not confirmed","layer":"external","operations":["POST /pg/v4/payment/request.json","POST /pg/v4/payment/verify.json","redirect /pg/StartPay/{authority}"],"auth":"Merchant ID from encrypted setting; secrets omitted."},
        {"id":"openai-compatible","title":"Optional OpenAI-compatible LLM","purpose":"Optional assistant provider; gets search-matched catalog context and short client history; fallback to builtin on failure.","path":"apps/api/src/modules/assistant/service.ts","timeout":"15,000ms abort controller","test":"No external LLM call executed; no live/provider-specific grounding validation.","status":"implemented-optionally; external-unverified","layer":"external","operations":["POST {assistant.llm_base_url}/chat/completions"],"auth":"Bearer API key stored via secret setting; secret value omitted."},
    ]
    for x in external_defs:
        eid="external:"+x["id"]
        en=add_node(eid,"integration",x["layer"],x["title"],x["purpose"],path=x["path"],timeout=x.get("timeout"),test=x["test"],integrationStatus=x["status"],operations=x.get("operations",[]),auth=x.get("auth",""))
        if "file:"+x["path"] in by_id: add_edge("file:"+x["path"],eid,"integrates","external adapter",[{"path":x["path"]}],status=x["status"])
    # Explicit no-adapter references are recorded as findings, not integration nodes.
    add_node("external:email","integration","external","Email transport · یافت نشد","فیلد email در NotifyInput وجود دارد، اما در مسیر جست‌وجوشده ارسال/adapter ایمیل مشاهده نشد.",integrationStatus="not-implemented-in-observed-source",evidence=[{"path":"apps/api/src/modules/notifications/service.ts","snippet":"NotifyInput.email is declared but notifyUser does not send email"}])

    # Environment names are names only—never read values from .env or process environment.
    env_names=set(re.findall(r"\b(?:str|num)\('([A-Z][A-Z0-9_]*)'",texts.get("apps/api/src/env.ts","")))
    env_names.update(re.findall(r"process\.env\.([A-Z][A-Z0-9_]*)", "\n".join(texts.values())))
    env_template=set()
    for p in (".env.example",".env.development.example"):
        if p in texts: env_template.update(re.findall(r"^\s*([A-Z][A-Z0-9_]*)\s*=",texts[p],re.M))
    for name in sorted(env_names|env_template):
        use_paths=[p for p,t in source_map.items() if re.search(rf"\b{re.escape(name)}\b",t) and (p.startswith("apps/") or p.startswith("scripts/") or p.startswith("deploy/"))]
        add_node("env:"+name,"environment-variable","configuration-security",name,"نام متغیر محیطی؛ هیچ مقدار یا secret در خروجی قرار نگرفته است.",name=name,declaredInTemplate=name in env_template,usedIn=use_paths)
        for p in use_paths: add_edge("file:"+p,"env:"+name,"reads-config","environment variable name",[{"path":p,"snippet":name}])

    setting_keys=sorted(set(re.findall(r"key:\s*'([^']+)'",texts.get("apps/api/src/modules/settings/definitions.ts",""))))
    for key in setting_keys:
        add_node("setting:"+key,"setting","configuration",key,"کلید تعریف تنظیمات سرور؛ مقدار جاری/secret نمایش داده نمی‌شود.",key=key)
        add_edge("file:apps/api/src/modules/settings/definitions.ts","setting:"+key,"defines-setting","setting definition",[{"path":"apps/api/src/modules/settings/definitions.ts","snippet":key}])

    # Roles and their exact shipped permission strings.
    perm_text=texts.get("apps/api/src/lib/permissions.ts","")
    role_specs=[]
    for m in re.finditer(r"\{\s*code:\s*'([^']+)'(?P<body>.*?)(?=\n\s*\},)",perm_text,re.S):
        code=m.group(1); body=m.group("body")
        name=re.search(r"name:\s*'([^']+)'",body)
        desc=re.search(r"description:\s*'([^']+)'",body)
        star="permissions:\s*'\*'" in body
        perms=list(dict.fromkeys(re.findall(r"'([a-z][a-z0-9_.]+)'",body)))
        role_specs.append({"code":code,"name":name.group(1) if name else code,"description":desc.group(1) if desc else "","wildcard":star,"permissions":[] if star else perms,"sourcePath":"apps/api/src/lib/permissions.ts","line":line_of(perm_text,m.start())})
        add_node("role:"+code,"role","security",name.group(1) if name else code,desc.group(1) if desc else "پیش‌فرض از DEFAULT_ROLES.",code=code,permissions=[] if star else perms,wildcard=star,sourcePath="apps/api/src/lib/permissions.ts",line=line_of(perm_text,m.start()))
    add_node("persona:customer","persona","security","مشتری (kind, نه role پیش‌فرض)","مجوز فهرست نقش ندارد؛ مسیرهای مالک‌محور با user.id و object-level checks محافظت می‌شوند.",kind="customer",permissions=[])

    # Permission-to-role edges for concrete endpoint permissions.
    role_permission_map={r["code"]:(set(r["permissions"]) if not r["wildcard"] else {"*"}) for r in role_specs}
    for ep in endpoint_nodes:
        for perm in ep.get("permissions",[]):
            for code,pms in role_permission_map.items():
                if "*" in pms or perm in pms or perm.split(".")[0]+".*" in pms:
                    add_edge("role:"+code,ep["id"],"permits","permission grant",[{"path":"apps/api/src/lib/permissions.ts","snippet":perm}],permission=perm)

    # API client call matching is direct; unmatched templates stay visibly unmatched.
    # Add structural API layer nodes/hubs and concrete groups.
    for name,label in ROUTE_LABELS.items():
        p=f"apps/api/src/routes/{name}.ts"
        if p in source_map:
            add_node("api-group:"+name,"api-group","api-routes",label,"Express router mounted under /api and /api/v1.",path=p)
            if "file:"+p in by_id: add_edge("api-group:"+name,"file:"+p,"implemented-in","route file",[{"path":p}])

    # Request-service domain subflows and operational sequence evidence, reviewed against source.
    flows=[
      {"id":"request-submit","title":"ثبت درخواست خدمت و retry","summary":"مسیر واقعی از فرم وب تا transaction، پرونده، فاکتور، ارجاع و اعلان.","steps":[
        ("browser","مشتری در صفحه خدمت فرم/مدارک را تکمیل می‌کند؛ quote جدا از submit است.","frontend","apps/web/src/pages/public/Services.tsx","handleSubmit; api.post('/api/requests')"),
        ("api","POST /api/requests؛ requireAuth سراسری، Zod و Idempotency-Key اختیاری.","api","apps/api/src/routes/requests.ts","requestsRouter.use(requireAuth); POST /"),
        ("dedupe","در transaction: HMAC ورودی مؤثر؛ همان key+payload بازپخش می‌شود، payload متفاوت 409.","security","apps/api/src/modules/requests/service.ts","createRequest; request_submission_keys"),
        ("validate","وضعیت پذیرش، خدمت، مشتری/پروفایل، پوشش شهر، فوریت، quote سمت سرور، formData و فایل مالکیت‌دار.","backend","apps/api/src/modules/requests/service.ts","createRequest; requireCompleteProfile; requireCoverage; validateFormData"),
        ("persist","در transaction پرونده + snapshot + events + invoice؛ پیوست‌ها ثبت می‌شوند.","database","apps/api/src/modules/requests/service.ts","INSERT requests/invoices/request_events/request_documents"),
        ("assign","autoAssign بر اساس rule/ظرفیت/شیفت؛ اگر صف یا ظرفیت نامناسب باشد ممکن است بدون assignee بماند.","backend","apps/api/src/modules/requests/service.ts","autoAssign; conditional UPDATE assigned_to IS NULL"),
        ("notify","پس از createRequest: اعلان درون‌برنامه‌ای با dedupe؛ SMS فقط با تنظیم و template فعال.","integration","apps/api/src/routes/requests.ts","notifyUser idempotencyKey request:<id>:created"),
        ("reply","created(res, request) به مرورگر؛ مسیر موفق 201، سپس navigate به پرونده.","frontend","apps/api/src/routes/requests.ts","created(res, request); ServiceDetailPage navigate"),
      ],"branches":["اعتبارسنجی ناموفق → HTTP error؛ transaction لغو می‌شود.","کلید تکراری و payload یکسان → همان پرونده برمی‌گردد (route پاسخ created/201 می‌دهد).","کلید یکسان با payload متفاوت → 409؛ UI کلید قبلی را پاک می‌کند.","Auto-assign queue/no candidate → پرونده در وضعیت بدون مسئول می‌ماند.","ارسال SMS شکست بخورد → اعلان پایدار می‌ماند؛ callback notification آن را swallow می‌کند."]},
      {"id":"employee-claim","title":"پذیرش پرونده صف توسط کارمند","summary":"دو کارمند همزمان claim کنند، فقط update شرطی برنده می‌شود؛ به‌روزرسانی سایر مرورگرها realtime نیست.","steps":[
        ("queue","صف GET eligibility؛ داده مشتری/فایل/مالی عمداً در کارت صف نیست.","frontend","apps/web/src/pages/staff/Queue.tsx","EligibleQueue; GET /api/requests/queue/eligible"),
        ("claim","POST /api/requests/:id/claim با requireAuth و requests.edit.","api","apps/api/src/routes/requests.ts","POST /:id/claim"),
        ("lock","claimRequest در tx؛ ابتدا قفل/نوشتن ردیف request و سپس status/assignment را می‌خواند.","database","apps/api/src/modules/requests/service.ts","claimRequest; tx"),
        ("eligibility","بررسی new/unassigned، skill, shift/capacity از candidatesForService.","backend","apps/api/src/modules/requests/service.ts","eligibleQueue; candidatesForService; claimRequest"),
        ("atomic-update","UPDATE شرطی assigned_to IS NULL AND status='new'; فقط changed.changes=1 موفق است.","security","apps/api/src/modules/requests/service.ts","claimRequest conditional UPDATE"),
        ("result","برنده event assigned می‌سازد؛ بازنده 409 می‌گیرد؛ همان مرورگر پس از پاسخ load() می‌کند.","frontend","apps/api/src/modules/requests/service.ts","addEvent; Queue.tsx load()"),
      ],"branches":["عدم مجوز/eligibility → 403.","پرونده قبلاً پذیرفته یا بسته شده → 409.","درخواست موازی: برنده یک update، بازنده 409؛ در تست‌های موجود SQLite اجرا شده، PostgreSQL multi-process آزموده نشده.","برای کاربران دیگر websocket/SSE/broadcast مشاهده نشد؛ آنها تا refresh/درخواست بعدی وضعیت جدید را نمی‌بینند."]},
      {"id":"payment","title":"پرداخت فاکتور زرین‌پال","summary":"مبلغ و شناسه authority از رکوردهای سرور می‌آیند؛ callback عمومی اما با verify بیرونیِ سمت سرور.","steps":[
        ("invoice","مشتری فاکتور خود را انتخاب می‌کند؛ POST /api/accounting/my/invoices/:id/pay.","frontend","apps/web/src/pages/customer/CustomerPages.tsx","invoice pay api call"),
        ("guard","requireAuth, kind=customer, ownership, remaining amount, min amount, provider/sandbox.","api","apps/api/src/routes/accounting.ts","/my/invoices/:id/pay"),
        ("pending","startZarinpal transaction؛ reuse authority pending، createPayment بر اساس invoice.remaining.","backend","apps/api/src/modules/accounting/zarinpal.ts","startZarinpal"),
        ("request","HTTPS POST به Zarinpal v4 request (timeout 15s, redirect:error)؛ ذخیره authority و sandbox.","external","apps/api/src/modules/accounting/zarinpal.ts","call('request'); gateway_authority"),
        ("redirect","کاربر به StartPay هدایت می‌شود؛ callback GET به API.","external","apps/api/src/modules/accounting/zarinpal.ts","paymentUrl; callback_url"),
        ("verify","callback /api/accounting/gateway/zarinpal پیش از requireAuth؛ تطبیق payment/authority/status، سپس POST verify با مبلغ ثبت‌شده.","security","apps/api/src/modules/accounting/zarinpal.ts","verifyZarinpal; data.code 100/101"),
        ("ledger","confirmPayment در DB + اطلاع‌رسانی وضعیت پرداخت بر اساس ردیف authoritative.","database","apps/api/src/modules/accounting/service.ts","confirmPayment; notifyPaymentStatus"),
      ],"branches":["callback NOK یا رکورد/authority نامنطبق → تأیید نمی‌شود.","درگاه نرسد/پاسخ نامعتبر → خطا (۱۵s timeout).","code 100 یا 101 و ref_id → confirm؛ code 101 تکرار verify را idempotent می‌کند.","gateway=test در production رد می‌شود؛ هیچ live transaction در این پروژه اجرا نشده."]},
      {"id":"sms","title":"اعلان رویدادی و ارسال پیامک","summary":"اعلان داخل DB قبل از تلاش پیامک ذخیره می‌شود؛ خطای provider اعلان را حذف نمی‌کند.","steps":[
        ("event","route/domain از notifyUser/notifyPaymentStatus با event code و key یکتا استفاده می‌کند.","backend","apps/api/src/modules/notifications/events.ts","notifyPaymentStatus"),
        ("persist","INSERT notifications + unique dedupe_key؛ conflict مانع اعلان تکراری است.","database","apps/api/src/modules/notifications/service.ts","notifyUser"),
        ("policy","sms.enabled, sms.notify_enabled, template valid/enabled, variables match, daily limit.","backend","apps/api/src/modules/sms/provider.ts","sendEventNotificationSms"),
        ("claim","INSERT sms_logs pending با idempotency_key unique؛ conflict→duplicate و ارسال مجدد همان key انجام نمی‌شود.","database","apps/api/src/modules/sms/provider.ts","sendEventNotificationSms claim"),
        ("provider","Panel form/console JSON provider؛ timeout 12s، redirect:error؛ parser RecId/error.","external","apps/api/src/modules/sms/provider.ts","getProvider; sendPattern; parsePanelSendResult"),
        ("log","به‌روزرسانی sms_logs با provider/status/id/error؛ secretهای شناخته‌شده scrub می‌شوند.","backend","apps/api/src/modules/sms/provider.ts","UPDATE sms_logs; scrubSmsError"),
      ],"branches":["تنظیم خاموش/template نامعتبر/سقف روزانه → skipped/خطا.","ارسال شکست بخورد → SMS failed می‌ماند؛ idempotency-key ثبت‌شده retry خودکار همان رویداد را می‌بندد.","SMS واقعی تأیید نشده؛ mock tests فقط قرارداد را ثابت می‌کنند."]},
      {"id":"assistant","title":"دستیار خدمات","summary":"Builtin grounded در کاتالوگ؛ LLM اختیاری context کاتالوگ می‌گیرد و در خطا fallback می‌کند.","steps":[
        ("chat-ui","پیام از صفحه public assistant به POST /api/assistant/chat می‌رود.","frontend","apps/web/src/pages/public/Auth.tsx","AssistantPage"),
        ("limit-validate","chatLimiter 20/min؛ Zod پیام/history؛ route به customerId نشست اختیاری نگاه می‌کند.","api","apps/api/src/routes/assistant.ts","POST /chat; chatLimiter"),
        ("switch","assistant.enabled؟ سپس llmReply، اگر provider/key غایب یا شکست باشد builtinReply.","backend","apps/api/src/modules/assistant/service.ts","assistantRespond"),
        ("retrieve","searchServices/listCategories روی کاتالوگ و فیلتر مشتری/خدمت.","database","apps/api/src/modules/assistant/service.ts","searchServices; listCategories"),
        ("optional-llm","جست‌وجوی مرتبط + عنوان/summary/sample fee/docs/required fields به OpenAI-compatible chat completions.","external","apps/api/src/modules/assistant/service.ts","llmReply systemPrompt/context"),
        ("reply","intent, suggestions, sources-as-service-titles, disclaimer, handoffSuggested برمی‌گردند.","frontend","apps/api/src/modules/assistant/service.ts","AssistantReply"),
      ],"branches":["مدل خاموش یا کلید/provider ناموجود → builtin.","LLM failure/timeout 15s/HTTP ناموفق → builtin.","جست‌وجوی ناموفق → unknown/handoff؛ builtin می‌گوید اطلاعات رسمی را حدس نمی‌زند.","Grounding و عدم نشت در برابر مدل واقعی تست زنده نشده؛ sources نام خدمت‌اند نه سند سازمان رسمی."]},
      {"id":"catalog","title":"مدیریت خدمت تا ثبت عمومی","summary":"مدیر service schema را ذخیره می‌کند؛ bootstrap/public API آن را در کاتالوگ ارائه می‌کند و فرم ثبت استفاده می‌شود.","steps":[
        ("editor","پنل AdminServices/AdminServiceEditor با permission wrapper.","frontend","apps/web/src/pages/admin/CatalogAdmin.tsx","AdminServiceEditor"),
        ("api","POST/PATCH /api/catalog/services؛ requirePermission services.create/edit و Zod.","api","apps/api/src/routes/catalog.ts","catalogRouter services"),
        ("store","createService/updateService به services; form_schema/documents/workflow_steps, fee, visibility/accepting.","database","apps/api/src/modules/catalog/service.ts","createService; updateService"),
        ("public-read","GET /api/public/services/categories/bootstrap; server filters published/active/custom ownership.","api","apps/api/src/routes/public.ts","publicRouter"),
        ("consumer","SiteProvider populates catalog; ServicesPage/ServiceDetail render dynamic form and submit.","frontend","apps/web/src/lib/site.tsx","SiteProvider; API calls"),
      ],"branches":["is_published و accepting_requests جدا هستند.","needs_review marks sample tariffs; official tariff validity is not verified.","CMS مدیریت بنر/FAQ زمان‌بندی‌شده مشاهده نشد."]},
    ]
    for flow in flows:
        step_refs=[]
        for index,(sid,label,kind,source,proof) in enumerate(flow["steps"]):
            nid=f"flow:{flow['id']}:{sid}"
            add_node(nid,"flow-step","flow",label,label,flowId=flow["id"],step=index+1,actor=kind,sourcePath=source,evidenceSnippet=proof)
            step_refs.append(nid)
        for a,b in zip(step_refs,step_refs[1:]): add_edge(a,b,"sequence","گام بعدی",confidence="high",flow=flow["id"])
        flow["stepNodeIds"]=step_refs

    # Static resolved-import cycle check (Tarjan SCC) and import-degree hotspots.
    file_ids=[n["id"] for n in nodes if n["type"]=="file"]
    import_adj={fid:[] for fid in file_ids}
    for e in edges:
        if e["type"]=="imports" and e["source"] in import_adj and e["target"] in import_adj: import_adj[e["source"]].append(e["target"])
    tarjan_stack=[]; tarjan_on=set(); tarjan_ids={}; tarjan_low={}; import_scc=[]
    def tarjan_visit(v: str) -> None:
        # index is mutable in a one-item list to avoid module-global state.
        idx=tarjan_state[0];tarjan_state[0]+=1;tarjan_ids[v]=idx;tarjan_low[v]=idx;tarjan_stack.append(v);tarjan_on.add(v)
        for w in import_adj[v]:
            if w not in tarjan_ids: tarjan_visit(w);tarjan_low[v]=min(tarjan_low[v],tarjan_low[w])
            elif w in tarjan_on: tarjan_low[v]=min(tarjan_low[v],tarjan_ids[w])
        if tarjan_low[v]==tarjan_ids[v]:
            comp=[]
            while True:
                w=tarjan_stack.pop();tarjan_on.remove(w);comp.append(w)
                if w==v: break
            if len(comp)>1 or v in import_adj[v]: import_scc.append(sorted(comp))
    tarjan_state=[0]
    for fid in file_ids:
        if fid not in tarjan_ids: tarjan_visit(fid)
    import_out=Counter(e["source"] for e in edges if e["type"]=="imports")
    import_in=Counter(e["target"] for e in edges if e["type"]=="imports")
    import_hotspots={"mostImportsOut":[{"path":k.removeprefix("file:"),"count":v} for k,v in import_out.most_common(12)],"mostImported":[{"path":k.removeprefix("file:"),"count":v} for k,v in import_in.most_common(12)],"cycleComponents":import_scc}

    # Build relation counts and tree links are already in edges.
    edge_counts=Counter(e["type"] for e in edges)
    node_counts=Counter(n["type"] for n in nodes)
    confidence_counts=Counter(e["confidence"] for e in edges)
    role_specs.sort(key=lambda x:x["code"])
    file_stats=Counter(Path(p).suffix or "[بدون پسوند]" for p in paths)
    data={
      "meta":{"title":"نقشه معماری پشکان","generatedDate":"2026-10-29","repo":REPO,"branch":BRANCH,"commit":COMMIT,"mainHeadAtReview":"205eb8504a3ecaadfcf475d443d992ca816a679c","remoteBranchAtReview":COMMIT,"sourceMethod":"Static source/import/route/SQL extraction; migration DDL executed in throwaway Python SQLite memory DB; no production database or secrets read.","fileCount":len(paths),"directoryCount":len(dirs)+1,"nodeCount":len(nodes),"edgeCount":len(edges),"tableCount":len(tables),"foreignKeyCount":sum(len(t["foreignKeys"]) for t in tables),"endpointCount":len(endpoint_nodes),"uiRouteCount":sum(1 for n in nodes if n["type"]=="ui-route"),"integrationCount":len(external_defs),"flowCount":len(flows),"testSourceCount":sum(1 for p in paths if (p.startswith("apps/api/tests/") or p.startswith("apps/api/audit/") or p.startswith("apps/web/tests/")) and p.endswith((".test.ts",".test.tsx"))),"nodeCounts":dict(node_counts),"edgeCounts":dict(edge_counts),"edgeConfidenceCounts":dict(confidence_counts),"importHotspots":import_hotspots,"fileExtensions":dict(file_stats),"pr":{"number":2,"url":"https://github.com/khajavy8056/Pishkan/pull/2","state":"open","base":"arena/82749fce-pishkan"}},
      "nodes":nodes,"edges":edges,"tables":tables,"migrations":migrations,"roles":role_specs,"flows":flows,"externalIntegrations":external_defs,"moduleLabels":MODULE_LABELS,"routeLabels":ROUTE_LABELS,
      "findings":[
        {"id":"F-001","severity":"high","certainty":"confirmed","title":"No tenant isolation","evidence":["docs/ARCHITECTURE.md","core schema has no tenant_id/RLS and app queries are office-global"],"impact":"Multi-office shared DB/storage is not safe/implemented; isolate each office in a separate installation/database/key set."},
        {"id":"F-002","severity":"medium","certainty":"confirmed","title":"Rate limiting is process-local","evidence":["apps/api/src/http/app.ts: bounded process-local throttle comment","apps/api/src/http/middleware.ts: in-memory counters"],"impact":"Multiple API processes do not share rate-limit state; deployment documentation assumes one API process or requires an external limiter."},
        {"id":"F-003","severity":"medium","certainty":"confirmed","title":"No live update channel for other queue users","evidence":["apps/web/src/pages/staff/Queue.tsx: load() after own claim; no socket/SSE dependency or server route found"],"impact":"A different employee's page can show stale queue until refresh/next fetch; HTTP atomic claim remains authoritative."},
        {"id":"F-004","severity":"medium","certainty":"confirmed","title":"Only table-declared FKs are drawn as schema relationships","evidence":["44-table schema compiled from apps/api/migrations/*.sql"],"impact":"Fields such as audit actor identifiers and file owner IDs may be application-level references without declared FK; graph marks only declared relationships."},
        {"id":"F-005","severity":"medium","certainty":"confirmed","title":"External production connections are not proven by this snapshot","evidence":["provider adapters exist; no production credentials/network call are part of this map"],"impact":"MeliPayamak, Zarinpal, OpenAI-compatible and PostgreSQL live operation require explicit sandbox/production tests by operator."},
        {"id":"F-006","severity":"low","certainty":"confirmed","title":"Large page modules concentrate UI responsibilities","evidence":["apps/web/src/pages/admin/CatalogAdmin.tsx; PeopleAdmin.tsx; FinanceAdmin.tsx; Operations.tsx; apps/web/src/pages/staff/StaffPages.tsx; apps/web/src/pages/customer/CustomerPages.tsx"],"impact":"Changes can affect multiple views in each large module; consider extracting components/hooks only after targeted regression tests."},
        {"id":"F-007","severity":"medium","certainty":"confirmed","title":"No active CI workflow file in .github/workflows was tracked","evidence":["git ls-files has no .github/workflows; docs/CI-WORKFLOW.example.yml is an example only"],"impact":"Local build/test success is not an automatically enforced GitHub check in this snapshot."},
        {"id":"F-008","severity":"medium","certainty":"confirmed","title":"Static CMS/promo-code features were not present in observed code","evidence":["main.tsx/Home.tsx; routes and settings definitions; no banner/FAQ management route/entity or coupon-code module found"],"impact":"The public Home page is code-composed and catalog service discount fields exist; scheduled banner CMS/preview, FAQ CMS and coupon campaign are not evidenced."},
        {"id":"F-009","severity":"low","certainty":"static-analysis","title":"No cycle in resolved static import graph" if not import_scc else "Resolved static import cycles detected","evidence":[f"{sum(1 for e in edges if e['type']=='imports')} resolved local import edges across {len(file_ids)} tracked files"],"impact":f"Tarjan SCC detected {len(import_scc)} cyclic component(s). Dynamic imports, computed module names and unresolved aliases are outside this result."},
      ]
    }
    OUT_JSON.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    OUT_HTML.write_text(make_html(data),encoding="utf-8")
    OUT_REPORT.write_text(make_report(data),encoding="utf-8")
    return data


def table_description(name: str) -> str:
    groups={
      "identity/access":"users roles sessions otp_codes login_events", "catalog":"service_categories services service_staff service_cities custom_service_offers assignment_rules cities", "requests":"requests request_events request_documents request_handoffs request_submission_keys", "finance":"invoices payments invoice_sequences financial_operations ledger_entries payment_gateway_logs expenses expense_categories", "workforce/payroll":"staff_profiles shifts shift_templates attendance shift_change_requests compensation_contracts compensation_entries", "communication":"threads messages notifications sms_logs sms_templates", "platform/ops":"schema_migrations settings audit_logs files backups customer_profiles customer_records"}
    for group,items in groups.items():
        if name in items.split(): return f"لایه {group}؛ ستون‌ها و FKهای صریح از اجرای تمام migrationها استخراج شده‌اند."
    return "جدول پایگاه داده؛ ستون‌ها و FKهای صریح از اجرای تمام migrationها استخراج شده‌اند."


def make_report(data: dict[str,Any]) -> str:
    m=data["meta"]
    return f'''# گزارش نقشه معماری پشکان

- تاریخ snapshot: **{m['generatedDate']}**
- مخزن: `{m['repo']}`
- شاخه: `{m['branch']}`
- Commit بررسی‌شده: [`{m['commit']}`](https://github.com/{m['repo']}/tree/{m['commit']})
- GitHub branch ref هنگام استخراج: `{m['remoteBranchAtReview']}`؛ PR #2 باز است و به `{m['pr']['base']}` هدف‌گذاری شده است.
- شواهد پایه‌شده روی فایل پیوست نیست؛ پیوست مستقلی در workspace موجود نبود.

## پوشش ماشینی و حجم استخراج

| سنجه | مقدار |
|---|---:|
| فایل‌های Git-tracked در snapshot (به‌جز خود سه خروجی/generator) | {m['fileCount']} |
| پوشه‌ها با ریشه repository | {m['directoryCount']} |
| گره‌های ساختاریافته | {m['nodeCount']} |
| ماژول‌های کد (گروه‌بندی بر اساس مسیر) | {m['nodeCounts'].get('module',0)} |
| ارتباطات ساختاریافته | {m['edgeCount']} |
| importهای محلی resolveشده | {m['edgeCounts'].get('imports',0)} |
| UI → API زنجیره‌ای (استنباط medium) | {m['edgeCounts'].get('module-api-contract',0)} |
| endpointهای Express استخراج‌شده | {m['endpointCount']} |
| Routeهای React استخراج‌شده | {m['uiRouteCount']} |
| جدول‌های واقعی پس از اجرای migration SQL در SQLite حافظه‌ای | {m['tableCount']} |
| FKهای صریح از PRAGMA foreign_key_list | {m['foreignKeyCount']} |
| migrationها | {len(data['migrations'])} |
| فایل‌های آزمون (`.test.*`) | {m['testSourceCount']} |
| سناریوهای جریان | {m['flowCount']} |

منبع واحد داده برای HTML و JSON، `Pishkan-Architecture-Data.json` است؛ فایل generator: `tools/generate_pishkan_architecture.py` (Python standard library). HTML JSON را inline دارد و برای render، فونت، CDN یا server dependency ندارد.

## روش استخراج و سطح اطمینان

1. `git ls-files` برای فهرست commit بررسی‌شده استفاده شد؛ مسیر نام فایل به‌تنهایی مسئولیت را تعیین نکرد: متون TypeScript/TSX، imports، route registration، component router، package manifests، configها و SQL خوانده شدند. فایل‌های binary به‌عنوان فایل/asset فهرست شدند، نه اینکه محتوای آنها تحلیل شود.
2. تمام ۱۵ فایل migration در SQLite in-memory اجرا شد. ۴۴ جدول، ستون‌ها، PKها و فقط FKهایی که واقعاً در schema تعریف شده‌اند از `PRAGMA` استخراج شدند. هیچ پایگاه‌داده تولیدی باز نشد.
3. Importهای محلی به فایل‌های واقعی resolve شدند؛ import packageها با package.json تطبیق داده شدند. `app.use` mountها، Express verbs و React `<Route>`ها با مسیر فایل/خط ثبت شدند.
4. SQL links فقط از clauseهای `FROM/JOIN/INSERT/UPDATE/DELETE` واقعی استخراج شدند. گره FK فقط با migration-backed constraint ساخته شد؛ conventionهای `*_id` به‌تنهایی رابطه رسمی محسوب نشدند.
5. Flowها به‌صورت گام‌های دستیِ مبتنی بر سورس کد علامت‌گذاری شدند؛ edgeهای flow با `sourcePath` و snippet code قابل ردیابی‌اند. وضعیت سرویس‌های خارجی از وجود adapter/test تعیین شد، نه از اتصال به حساب زنده.
6. گراف import روی specifierهای resolveشده با Tarjan از نظر چرخه بررسی شد؛ در صورت نبود cycle، نتیجه فقط برای importهای استاتیک resolveشده معتبر است. پکیج‌های مستقیم از سه package manifest استخراج می‌شوند.

**تعریف:** `direct/high` یعنی فراخوانی، import، route، SQL یا constraint در فایل ثبت‌شده مشاهده شده؛ `inferred/medium` یعنی رابطه از mapping/contract چند فایل نتیجه شده است. مقدار secret، token، credential، داده مشتری یا مقدار `.env` استخراج/نمایش داده نشده است.

## معماری واقعی در یک نگاه

- **وب:** React 19 + React Router 7 + Vite 7 + Tailwind 4، SPA فارسی/RTL. `apps/web/src/main.tsx` ریشه routing/provider است؛ `apps/web/src/lib/api.ts` از درخواست‌های HTTP و URLهای نسبی استفاده می‌کند. Vite proxy در `apps/web/vite.config.ts` سرور-side برای `/api` و `/uploads` تعریف شده است.
- **API:** Express 5 + TypeScript، bootstrap از `apps/api/src/index.ts`; middleware/route mount از `apps/api/src/http/app.ts`; ۱۷ گروه route، زیر `/api` و `/api/v1`.
- **دامنه:** auth, catalog, requests, accounting, workforce/shifts, payroll, profiles, messages, notifications, automation, assistant, settings, sms, audit, backup/system.
- **داده:** `apps/api/src/db/index.ts` façade مشترک PostgreSQL `pg` و Node `node:sqlite`; تولید طبق `env.ts` PostgreSQL-only؛ SQLite برای توسعه/آزمون.
- **حفظ schema:** ۱۵ migration SQL ترتیبی، checksum registry. نقشه ERD تنها FKهای اعلام‌شده در DDL را قطعی نشان می‌دهد.
- **گراف وابستگی:** importهای نسبی با مسیرهای NodeNext `.js` که به `.ts/.tsx` موجود resolve می‌شوند نیز پوشش داده شده‌اند. {sum(1 for e in data['edges'] if e['type']=='imports')} import محلی resolve شد؛ {len(data['meta']['importHotspots']['cycleComponents'])} چرخه استاتیک ثبت شد. JSON top importers و فایل‌های پرتکرار را نگه می‌دارد.
- **استقرار:** `deploy/nginx`, `deploy/systemd`, `deploy/postgres`, scripts نصب Linux/Windows و راهنمای عملیات. وجود پیکربندی، نصب موفق/زنده را اثبات نمی‌کند.
- **اجرای React:** `apps/web/src/main.tsx`. **اجرای API:** `apps/api/src/index.ts`. فرمان‌های npm در root/package workspace نشان داده شده‌اند.

## مسیرهای مهم عملیات

نمودارهای گام‌به‌گام، شرط‌های خطا، timeout، replay/409، نقاط transaction و مرز آزمون در نمای «جریان‌ها»ی HTML قرار دارند: ثبت درخواست، claim هم‌زمان کارکنان، پرداخت زرین‌پال، ارسال SMS رویدادی، assistant، مدیریت خدمت.

یافته مهم claim: endpoint واقعی `POST /api/requests/:id/claim` دارای `requirePermission('requests.edit')` و `claimRequest` تراکنشی است؛ `UPDATE ... WHERE assigned_to IS NULL AND status='new'` به تعداد تغییرات نگاه می‌کند و بازنده conflict می‌گیرد. بازآزمایی دو کارمند در workspace SQLite بوده؛ PostgreSQL multi-process load test هنوز انجام نشده است. در UI بعد از claim فقط queue همان client دوباره load می‌شود؛ channelی مانند WebSocket/SSE برای refresh سایر کاربران در سورس دیده نشد.

## نقش، دسترسی و داده

شش نقش system از `apps/api/src/lib/permissions.ts` استخراج شده‌اند: `super_admin` wildcard، `manager`, `service_expert`, `operator`, `document_reviewer`, `accountant`. مشتری یک `kind='customer'` است، نه یک role پیش‌فرض؛ permission list او خالی است و routeها به مالکیت object مقید می‌شوند. React route guard برای تجربه کاربری است؛ API نیز route-level `requirePermission`, `requireAuth`, office-scope و مالکیت را اعمال می‌کند. جدول HTML ماتریس مجوز دقیق نقش‌های پیش‌فرض را نشان می‌دهد؛ نقش سفارشی می‌تواند در پنل ساخته/ویرایش شود.

بخش‌های قابل توجه: request detail محدود به مشتری صاحب پرونده یا کارمند مسئول، مگر نقش دفتر؛ فایل‌ها با مالکیت/پرونده مربوطه کنترل می‌شوند؛ حسابداری دفتر علاوه بر permission role، office-scope جدا دارد. ارتباط‌های بین entityهایی که FK صریح ندارند در ERD به‌صورت constraint جا زده نشده‌اند.

## سرویس‌های بیرونی

| اتصال | کد/رفتار مشاهده‌شده | تست/وضعیت |
|---|---|---|
| PostgreSQL | `pg.Pool`; `DATABASE_URL`, `DB_POOL_MAX`; connect timeout 10s. | کد/driver موجود؛ DB واقعی در این extraction وصل نشد. |
| SQLite | `node:sqlite`; migrationها در حافظه برای تولید ERD اجرا شدند. | schema قابل اجرا در محیط محلی؛ DB تولیدی نیست. |
| MeliPayamak | panel/console REST؛ timeout 12s; normalized phone; error mapping/log/dedupe. | mock provider tests در مخزن؛ اتصال/تحویل واقعی نامعلوم. |
| Zarinpal | v4 request/verify, authority check, server amount, 15s timeout, sandbox gate. | آزمون شبیه‌سازی موجود؛ live/sandbox owner account در این دور استفاده نشد. |
| OpenAI-compatible | optional model, catalog context, secret API key, 15s timeout, builtin fallback. | کد وجود دارد؛ سرویس live، grounding سازمانی و حفظ حریم خصوصی نزد provider تست نشده. |
| Email | adapter/send call مشاهده نشد؛ فیلد `NotifyInput.email` به‌تنهایی integration نیست. | در کد مشهود پیاده نشده. |

## نقاط حساس و یافته‌ها

{chr(10).join(f"- **{f['severity'].upper()} / {f['certainty']} — {f['title']}:** {f['impact']} (شواهد: {', '.join(f['evidence'])})." for f in data['findings'])}

## محدودیت‌های بررسی

- پوشش درخت فایل برای تمام {m['fileCount']} فایل Git-tracked ثبت شده، اما همه خطوط همه فایل‌ها را line-by-line manual review نکردم؛ برای جزئیات هر فایل، گره inventory و import/SQL evidence را باز کنید.
- migration SQL در SQLite اجرا شد، نه PostgreSQL server؛ SQLite موفقیت syntax/semantics تمام dialectهای PostgreSQL را تضمین نمی‌کند.
- static import parser، aliasهای پیچیده، computed paths و reflection را نمی‌بیند؛ unmatched browser-callها جداگانه برچسب دارند.
- route permission analysis بر اساس literal middleware و static code است؛ تست نفوذ exhaustively تمام شاخه‌های auth و custom roles انجام نشد.
- branch history در تاریخ snapshot: `{COMMIT}`. فایل‌های جدید خروجی در فهرست ۱۷۹ فایل مبنا شمرده نشده‌اند.
- اتصال واقعی PostgreSQL، پیامک، درگاه، LLM، ارسال email، دامنه/TLS، systemd/Nginx، APK و backup خارج سرور از این فایل/کد به‌تنهایی اثبات نمی‌شوند.

## مشاهده و بازتولید

- فایل اصلی: `Pishkan-Architecture-Map.html` — مستقل، آفلاین، RTL.
- داده: `Pishkan-Architecture-Data.json` — همه node/edgeها، schemas، routeها، flows و evidence.
- گزارش: `Pishkan-Architecture-Report.md` — همین گزارش.
- ساخت مجدد در ریشه repository: `python3 tools/generate_pishkan_architecture.py` (Python 3 استاندارد؛ برای اجرای generator هیچ dependency خارجی لازم نیست).
'''


HTML_TEMPLATE = r'''<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#101827"><title>نقشه معماری پشکان</title>
<style>
:root{--bg:#f3f6fb;--panel:#fff;--ink:#182437;--muted:#68778d;--line:#dfe6ef;--accent:#3f6fe5;--accent2:#16a394;--shadow:0 12px 34px #18304b12;--mono:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;--fe:#4985ea;--be:#15a085;--db:#9a70dd;--sec:#e7a434;--ext:#e47771;--test:#68788e;--ops:#21aeb3;--doc:#9a778e}
[data-theme="dark"]{--bg:#0e1622;--panel:#172232;--ink:#e8eef8;--muted:#9baac0;--line:#2a3a50;--accent:#80a5ff;--accent2:#56cdbb;--shadow:0 12px 34px #0004}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.65 "Vazirmatn",Tahoma,Arial,sans-serif}button,input,select{font:inherit;color:inherit}button{cursor:pointer}a{color:var(--accent)}.mono{font:12px/1.6 var(--mono);direction:ltr;text-align:left;overflow-wrap:anywhere}.app{min-height:100vh}.top{position:sticky;top:0;z-index:20;background:color-mix(in srgb,var(--panel) 92%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line);padding:12px clamp(12px,3vw,36px);display:flex;gap:12px;align-items:center;flex-wrap:wrap}.brand{font-size:17px;font-weight:900;white-space:nowrap}.tag{font-size:11px;color:var(--muted);border:1px solid var(--line);padding:2px 8px;border-radius:99px}.tools{display:flex;gap:8px;flex:1;min-width:260px}.tools input{flex:1;min-width:150px}.control,.btn,.tools input,.tools select{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 11px;outline:none}.tools input:focus,.control:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 15%,transparent)}.btn{transition:.15s}.btn:hover{border-color:var(--accent);transform:translateY(-1px)}.btn.primary{background:var(--accent);color:white;border-color:var(--accent)}main{max-width:1680px;margin:auto;padding:22px clamp(12px,2.7vw,38px) 56px}.hero{border-radius:22px;padding:24px;background:linear-gradient(130deg,#18365d,#245484 55%,#317d82);color:#fff;box-shadow:var(--shadow);display:grid;grid-template-columns:1.3fr .7fr;gap:24px}.hero h1{margin:0 0 8px;font-size:clamp(22px,3vw,34px)}.hero p{margin:5px 0;color:#e0ebf6}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;align-content:center}.stat{border:1px solid #ffffff38;background:#ffffff13;border-radius:13px;padding:12px;text-align:center}.stat b{display:block;font-size:22px}.stat small{opacity:.8}.tabs{display:flex;gap:7px;overflow:auto;padding:15px 0 12px;position:sticky;top:62px;z-index:10;background:var(--bg)}.tab{white-space:nowrap;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:7px 13px;color:var(--muted)}.tab.active{background:var(--ink);color:var(--panel);border-color:var(--ink)}.grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:16px;align-items:start}.panel,.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}.panel{padding:16px;min-width:0}.card{padding:14px}.section-head{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:0 0 12px}.section-head h2{margin:0;font-size:19px}.muted{color:var(--muted)}.detail{position:sticky;top:126px;max-height:calc(100vh - 145px);overflow:auto}.detail h3{margin:0 0 4px;font-size:17px}.chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);border-radius:99px;padding:2px 8px;margin:2px;font-size:11px;color:var(--muted)}.pill{display:inline-flex;border-radius:7px;padding:2px 7px;font-size:11px;background:#4884eb1b;color:var(--fe)}.pill.db{background:#9a70dd20;color:var(--db)}.pill.sec{background:#e7a43420;color:#a16c0e}.pill.ext{background:#e4777120;color:var(--ext)}.pill.test{background:#68788e20;color:var(--test)}.evidence{border-top:1px solid var(--line);margin-top:10px;padding-top:9px}.linkrow{display:flex;gap:6px;align-items:center;margin:5px 0;padding:6px 8px;border-radius:8px;background:color-mix(in srgb,var(--bg) 75%,var(--panel));cursor:pointer}.linkrow:hover{outline:1px solid var(--accent)}.small{font-size:12px}.tree{max-height:70vh;overflow:auto}.tree details{margin:2px 0}.tree summary{list-style:none;display:flex;align-items:center;gap:7px;cursor:pointer;padding:5px 7px;border-radius:8px}.tree summary::-webkit-details-marker{display:none}.tree summary:hover,.tree .leaf:hover{background:color-mix(in srgb,var(--accent) 9%,var(--panel))}.tree .children{margin-right:16px;border-right:1px solid var(--line);padding-right:8px}.tree .leaf{display:flex;width:100%;text-align:right;gap:8px;align-items:center;border:0;background:none;padding:5px 8px;border-radius:7px}.tree [data-node].selected,.inventory-row.selected{outline:2px solid var(--accent);background:color-mix(in srgb,var(--accent) 10%,var(--panel))}.tree-icon{width:19px;text-align:center;color:var(--accent)}.count{margin-right:auto;color:var(--muted);font-size:11px}.type-icon{width:7px;height:7px;border-radius:50%;background:var(--test);display:inline-block}.layer-frontend,.layer-frontend-pages,.layer-frontend-client,.layer-frontend-components{background:var(--fe)}.layer-backend-domain,.layer-api-routes,.layer-backend-http{background:var(--be)}.layer-database{background:var(--db)}.layer-security,.layer-configuration-security{background:var(--sec)}.layer-external{background:var(--ext)}.layer-tests{background:var(--test)}.layer-infrastructure,.layer-operations{background:var(--ops)}.layer-documentation{background:var(--doc)}.svg-wrap{position:relative;overflow:hidden;border:1px solid var(--line);border-radius:13px;background:linear-gradient(0deg,color-mix(in srgb,var(--bg) 70%,var(--panel)),var(--panel));height:min(68vh,720px);min-height:390px;touch-action:none}.svg-wrap svg{width:100%;height:100%;cursor:grab}.svg-wrap svg.dragging{cursor:grabbing}.graph-controls{position:absolute;top:10px;left:10px;display:flex;gap:6px;z-index:2}.graph-controls button{background:var(--panel);border:1px solid var(--line);border-radius:8px;width:34px;height:34px}.nodebox{cursor:pointer}.nodebox rect{stroke-width:1.5;filter:drop-shadow(0 4px 5px #0002)}.nodebox text{font-family:Tahoma,Arial,sans-serif;fill:var(--ink);pointer-events:none}.edge-direct{stroke:#6b8197;stroke-width:2;opacity:.7}.edge-api{stroke:var(--accent);stroke-width:2;stroke-dasharray:7 5}.edge-inferred{stroke:#e0a133;stroke-width:2;stroke-dasharray:2 6}.edge-fk{stroke:var(--db);stroke-width:2}.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--muted);margin-top:8px}.legend span:before{content:"";width:17px;border-top:2px solid currentColor;display:inline-block;vertical-align:middle;margin-left:6px}.legend .dash:before{border-top-style:dashed}.legend .dot:before{border-top-style:dotted}.flow{display:grid;grid-template-columns:repeat(auto-fit,minmax(205px,1fr));gap:10px;align-items:stretch}.step{position:relative;padding:13px;border:1px solid var(--line);border-radius:12px;background:var(--panel);min-height:146px;cursor:pointer}.step:hover{border-color:var(--accent)}.step .number{display:inline-grid;place-items:center;width:23px;height:23px;border-radius:50%;background:var(--accent);color:white;font-weight:bold;margin-left:6px}.step h4{margin:7px 0 5px;font-size:13px}.branches{margin-top:12px;border-right:3px solid var(--sec);padding:7px 12px;background:#e7a43412;border-radius:8px}.table-scroll{overflow:auto;max-height:68vh;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:780px}th,td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;vertical-align:top}th{position:sticky;top:0;background:var(--panel);z-index:1}tbody tr:hover{background:color-mix(in srgb,var(--accent) 5%,var(--panel))}.key{color:var(--db);font:11px var(--mono);direction:ltr}.findings{display:grid;gap:10px}.finding{border-right:4px solid var(--sec);padding:12px 14px;background:var(--panel);border-radius:10px}.finding.high{border-color:#d85c4d}.finding.low{border-color:#31a78d}.hidden{display:none!important}.list{display:grid;gap:4px;max-height:72vh;overflow:auto}.inventory-row{display:grid;grid-template-columns:minmax(180px,1fr) auto auto;gap:12px;align-items:center;padding:7px 9px;border-bottom:1px solid var(--line);cursor:pointer}.inventory-row:hover{background:color-mix(in srgb,var(--accent) 7%,var(--panel))}.search-results{position:absolute;top:56px;right:30%;width:min(560px,66vw);max-height:60vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);z-index:30}.result{width:100%;display:flex;gap:8px;text-align:right;background:none;border:0;border-bottom:1px solid var(--line);padding:9px}.result:hover{background:var(--bg)}.search-host{position:relative;display:flex;flex:1;min-width:180px}.search-host input{width:100%}.no-results{padding:20px;text-align:center;color:var(--muted)}.footer{padding:18px;text-align:center;color:var(--muted);font-size:12px}.kbd{font:11px var(--mono);border:1px solid var(--line);border-radius:5px;padding:1px 4px;direction:ltr}.source{direction:ltr;text-align:left;font:11px/1.6 var(--mono);color:var(--accent);overflow-wrap:anywhere}.status-badge{display:inline-block;border-radius:8px;padding:3px 8px;background:#20a3851b;color:#13856f;font-size:11px}.note{background:#e7a43414;border:1px solid #e7a43440;padding:10px;border-radius:10px}.empty{padding:35px;text-align:center;color:var(--muted)}@media(max-width:950px){.grid{grid-template-columns:1fr}.detail{position:relative;top:0;max-height:none}.hero{grid-template-columns:1fr}.stats{grid-template-columns:repeat(3,1fr)}.tabs{top:100px}}@media(max-width:620px){.top{position:relative}.tools{order:3;flex-basis:100%}.hero{padding:18px}.stats{grid-template-columns:repeat(2,1fr)}main{padding-top:12px}.tabs{top:0}.search-results{right:5%;width:90%}.inventory-row{grid-template-columns:1fr auto}.inventory-row .muted{display:none}}
</style></head><body><div class="app" id="app">
<header class="top"><div class="brand">🧭 پشکان <span class="tag">نقشه معماری</span></div><div class="tools"><div class="search-host"><input id="search" type="search" placeholder="جست‌وجوی فایل، تابع، endpoint، جدول، نقش… ( / )" aria-label="جست‌وجو"><div class="search-results hidden" id="searchResults"></div></div><select id="layerFilter" class="control" aria-label="فیلتر لایه"><option value="">همه لایه‌ها</option></select><button class="btn" id="exportBtn" title="دریافت JSON">خروجی JSON</button><button class="btn" id="themeBtn" title="تغییر تم">◐</button></div></header>
<main><section class="hero"><div><h1>معماری واقعی سامانه پشکان</h1><p id="heroDesc"></p><p class="small">نقشه از importها، routeهای Express/React، SQL/migration و configهای همین snapshot استخراج شده است؛ اتصال بیرونی زنده از وجود adapter نتیجه‌گیری نمی‌شود.</p></div><div class="stats" id="stats"></div></section>
<nav class="tabs" id="tabs"></nav><section id="content"></section><div class="footer">snapshot <span class="mono" id="commitLabel"></span> · فایل مستقل و آفلاین · منبع داده مشترک: Pishkan-Architecture-Data.json</div></main></div>
<script>
'use strict';
const ARCH=__ARCH_DATA__;
const labels={overview:'نمای کلی',tree:'درخت پروژه',modules:'ارتباط ماژول‌ها',flows:'جریان عملیات',database:'پایگاه داده / ERD',access:'نقش‌ها و مجوزها',integrations:'سرویس‌ها و تنظیمات',findings:'تحلیل و ریسک‌ها',inventory:'همه فایل‌ها و اجزا'};
const layerNames={'frontend':'فرانت‌اند','frontend-pages':'صفحات UI','frontend-components':'کامپوننت UI','frontend-client':'API client/provider','backend-domain':'دامنه بک‌اند','backend-http':'HTTP/middleware','api-routes':'API route','database':'پایگاه داده','security':'امنیت','shared-security':'مشترک/امنیت','configuration-security':'تنظیم امن','configuration':'پیکربندی','external':'سرویس بیرونی','tests':'تست','infrastructure':'زیرساخت','operations':'عملیات','documentation':'مستندات','assets':'دارایی','root':'ریشه','flow':'جریان','architecture':'معماری'};
const typeNames={file:'فایل',directory:'پوشه',module:'ماژول',domain:'دامنه',endpoint:'API endpoint', 'ui-route':'صفحه Route','client-call':'فراخوانی UI API',table:'جدول',migration:'migration',role:'نقش',persona:'پرسونا',integration:'یکپارچه‌سازی',dependency:'بسته',setting:'تنظیم', 'environment-variable':'متغیر محیطی','flow-step':'گام عملیات',test:'تست','api-group':'گروه API',repository:'مخزن'};
const byId=new Map(ARCH.nodes.map(n=>[n.id,n]));
const outgoing=new Map(),incoming=new Map(); for(const e of ARCH.edges){(outgoing.get(e.source)||outgoing.set(e.source,[]).get(e.source)).push(e);(incoming.get(e.target)||incoming.set(e.target,[]).get(e.target)).push(e)}
const layerSet=[...new Set(ARCH.nodes.map(n=>n.layer))].sort();
const tabsEl=document.getElementById('tabs'),content=document.getElementById('content'),search=document.getElementById('search'),searchResults=document.getElementById('searchResults'),layerFilter=document.getElementById('layerFilter');
let current='overview',selected='repo',searchQuery='',filterLayer='',graphScale=1,graphPan={x:0,y:0};
for(const l of layerSet){const o=document.createElement('option');o.value=l;o.textContent=layerNames[l]||l;layerFilter.append(o)}
const tabNames=Object.keys(labels); for(const id of tabNames){const b=document.createElement('button');b.className='tab';b.dataset.tab=id;b.textContent=labels[id];b.onclick=()=>go(id);tabsEl.append(b)}
document.getElementById('heroDesc').textContent=`${ARCH.meta.repo} · شاخه ${ARCH.meta.branch} · ${ARCH.meta.fileCount} فایل، ${ARCH.meta.directoryCount} پوشه، ${ARCH.meta.endpointCount} endpoint و ${ARCH.meta.tableCount} جدول مستند.`;
document.getElementById('commitLabel').textContent=ARCH.meta.commit;
const stats=[['فایل‌ها',ARCH.meta.fileCount],['گره‌ها',ARCH.meta.nodeCount],['ارتباط‌ها',ARCH.meta.edgeCount],['API',ARCH.meta.endpointCount],['جداول',ARCH.meta.tableCount],['جریان‌ها',ARCH.meta.flowCount]];
document.getElementById('stats').innerHTML=stats.map(([l,n])=>`<div class="stat"><b>${n}</b><small>${l}</small></div>`).join('');
function esc(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function go(tab){current=tab;document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab));graphScale=1;graphPan={x:0,y:0};render()}
function select(id){if(!byId.has(id))return;selected=id;renderDetail();document.querySelectorAll('[data-node]').forEach(x=>x.classList.toggle('selected',x.dataset.node===id))}
function pill(n){return `<span class="pill ${esc(n.layer||'')}">${esc(typeNames[n.type]||n.type)}</span> <span class="chip">${esc(layerNames[n.layer]||n.layer)}</span>`}
function sourceLink(ev){const p=ev.path||ev.sourcePath;if(!p)return '';const line=ev.line?`:${ev.line}`:'';const url=`https://github.com/${ARCH.meta.repo}/blob/${ARCH.meta.commit}/${p}${ev.line?'#L'+ev.line:''}`;return `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(p+line)}</a>${ev.snippet?` <span class="muted">· ${esc(ev.snippet)}</span>`:''}`}
function renderDetail(){const n=byId.get(selected)||byId.get('repo');const panel=document.getElementById('detailPanel');if(!panel)return;const ins=incoming.get(n.id)||[],outs=outgoing.get(n.id)||[];let extra='';
 if(n.type==='table'){extra=`<div class="evidence"><b>ستون‌ها (${n.columns?.length||0})</b><div class="small">${(n.columns||[]).map(c=>`<div class="linkrow" data-copy="${esc(c.name)}"><span class="key">${esc(c.name)}</span><span class="muted">${esc(c.type)} ${c.primaryKeyOrder?' · PK':''} ${c.notNull?' · NOT NULL':''}</span></div>`).join('')}</div><b>FKهای تعریف‌شده</b>${(n.foreignKeys||[]).map(f=>`<div class="small">${esc(f.column)} → <button class="linkrow" data-node="table:${esc(f.targetTable)}">${esc(f.targetTable)}.${esc(f.targetColumn)}</button> (${esc(f.onDelete)})</div>`).join('')||'<p class="muted">FK صریح ندارد؛ پیوند احتمالی در کد را constraint فرض نکن.</p>'}<b>Migrationها</b><div class="mono">${(n.migrationPaths||[]).map(esc).join('<br>')}</div></div>`}
 if(n.type==='role'){extra=`<div class="evidence"><b>مجوزهای پیش‌فرض (${n.wildcard?'* wildcard':(n.permissions||[]).length})</b><div>${(n.permissions||[]).map(p=>`<span class="chip">${esc(p)}</span>`).join('')||'<span class="muted">* دسترسی کامل</span>'}</div></div>`}
 if(n.type==='endpoint'){extra=`<div class="evidence"><b>HTTP / access</b><div class="mono">${esc(n.method)} ${esc(n.path)}</div><p>Auth: <b>${esc(n.auth)}</b></p><p>Aliases: ${(n.aliases||[]).map(x=>`<span class="mono">${esc(x)}</span>`).join(' · ')}</p><p>Permissions: ${(n.permissions||[]).map(x=>`<span class="chip">${esc(x)}</span>`).join('')||'در همین route literal requirePermission استخراج نشد؛ router/global/object check را در منبع ببینید.'}</p></div>`}
 if(n.type==='integration'){extra=`<div class="evidence"><b>وضعیت</b><p><span class="status-badge">${esc(n.integrationStatus)}</span></p><p><b>Timeout:</b> ${esc(n.timeout||'نامشخص')}</p><p><b>احراز:</b> ${esc(n.auth||'—')}</p><b>عملیات</b><div class="mono">${(n.operations||[]).map(esc).join('<br>')||'—'}</div><p>${esc(n.test||'')}</p></div>`}
 if(n.type==='environment-variable'){extra=`<div class="evidence"><b>دامنه استفاده</b><p>${n.declaredInTemplate?'در template ثبت شده':'در template بررسی‌شده نبود'}</p>${(n.usedIn||[]).map(p=>`<button class="linkrow" data-node="file:${esc(p)}">${esc(p)}</button>`).join('')}</div>`}
 if(n.type==='flow-step'){extra=`<div class="evidence"><b>Flow</b><p>${esc(n.flowId)} · گام ${n.step}</p><p class="source">${esc(n.sourcePath)}<br>${esc(n.evidenceSnippet||'')}</p><button class="btn" data-tab="flows">رفتن به جریان عملیات</button></div>`}
 if(n.symbols?.length)extra+=`<div class="evidence"><b>Exportها/نمادهای عمومی</b><div>${n.symbols.map(s=>`<span class="chip mono">${esc(s)}</span>`).join('')}</div></div>`;
 if(n.type==='file'||n.type==='migration'||n.path){extra+=`<div class="evidence"><b>مسیر</b><div class="source">${esc(n.path||n.sourcePath||'')}</div><button class="btn" data-copy="${esc(n.path||n.sourcePath||'')}">کپی مسیر</button> ${n.line?`<span class="muted">خط ${n.line}</span>`:''}</div>`}
 if(n.evidence?.length)extra+=`<div class="evidence"><b>شواهد</b>${n.evidence.map(e=>`<div class="small">${sourceLink(e)}</div>`).join('')}</div>`;
 const edgeList=(arr,dir)=>arr.slice(0,24).map(e=>{const other=byId.get(dir==='in'?e.source:e.target);return `<button class="linkrow" data-node="${esc(other?.id)}"><span class="pill">${esc(e.label||e.type)}</span><span>${esc(other?.title||other?.id)}</span><span class="count">${esc(e.confidence==='high'?'مستقیم':'استنباطی')}</span></button>`}).join('')||'<span class="muted small">—</span>';
 panel.innerHTML=`<div class="section-head"><div>${pill(n)}<h3>${esc(n.title)}</h3></div><button class="btn" id="closeDetail">×</button></div><p>${esc(n.description||'')}</p>${n.integrationStatus?`<p class="status-badge">${esc(n.integrationStatus)}</p>`:''}${n.files?`<p class="muted small">${n.files.length} فایل عضو</p>`:''}${extra}<div class="evidence"><b>ورودی (${ins.length})</b>${edgeList(ins,'in')}</div><div class="evidence"><b>خروجی (${outs.length})</b>${edgeList(outs,'out')}</div>`;
 bindActions(panel);document.getElementById('closeDetail').onclick=()=>{selected='repo';renderDetail()};}
function bindActions(scope=document){scope.querySelectorAll('[data-node]').forEach(el=>el.onclick=ev=>{ev.stopPropagation();select(el.dataset.node)});scope.querySelectorAll('[data-tab]').forEach(el=>el.onclick=ev=>{ev.stopPropagation();go(el.dataset.tab)});scope.querySelectorAll('[data-copy]').forEach(el=>el.onclick=async ev=>{ev.stopPropagation();try{await navigator.clipboard.writeText(el.dataset.copy);el.textContent='کپی شد ✓';setTimeout(()=>el.textContent='کپی مسیر',900)}catch{prompt('کپی مسیر:',el.dataset.copy)}})}
function panelLayout(left){return `<div class="grid"><section class="panel">${left}</section><aside class="panel detail" id="detailPanel"></aside></div>`}
function folderTree(){const children=new Map();for(const e of ARCH.edges.filter(e=>e.type==='contains')){(children.get(e.source)||children.set(e.source,[]).get(e.source)).push(byId.get(e.target))}for(const a of children.values())a.sort((x,y)=>((x.type==='directory'?0:1)-(y.type==='directory'?0:1))||x.title.localeCompare(y.title,'fa'));
 function recurse(id,depth=0){const n=byId.get(id);if(!n)return '';const kids=children.get(id)||[];if(n.type==='directory'||n.type==='repository'){const isOpen=depth<2;return `<details ${isOpen?'open':''}><summary data-node="${esc(n.id)}"><span class="tree-icon">${n.type==='repository'?'◈':'📁'}</span><b>${esc(n.title)}</b><span class="count">${kids.length}</span></summary><div class="children">${kids.map(k=>recurse(k.id,depth+1)).join('')}</div></details>`}return `<button class="leaf" data-node="${esc(n.id)}"><i class="type-icon layer-${esc(n.layer)}"></i><span>${esc(n.title)}</span><span class="count">${esc(n.extension||typeNames[n.type]||'')}</span></button>`}
 return `<div class="section-head"><h2>درخت Git-tracked · ${ARCH.meta.fileCount} فایل</h2><div><button class="btn" id="expandAll">بازکردن شاخه‌ها</button> <button class="btn" id="collapseAll">بستن شاخه‌ها</button></div></div><p class="muted small">درخت بر اساس ۱۷۹ فایلِ commit مرجع ساخته شده است. انتخاب فایل، نمادها و ارتباط‌هایش را در پنل کناری نشان می‌دهد.</p><div class="tree">${recurse('repo')}</div>`}
function nodeRect(n,x,y,w=184,h=64,sub=''){const color=layerColor(n.layer);return `<g class="nodebox" data-node="${esc(n.id)}" transform="translate(${x},${y})"><rect width="${w}" height="${h}" rx="12" fill="${color}18" stroke="${color}"/><text x="${w-12}" y="25" text-anchor="end" font-size="13" font-weight="700">${esc(n.title.slice(0,25))}</text><text x="${w-12}" y="47" text-anchor="end" font-size="10" fill="var(--muted)">${esc(sub||typeNames[n.type]||n.type)}</text></g>`}
function layerColor(l){return ({'frontend':'#4985ea','frontend-pages':'#4985ea','frontend-components':'#4985ea','frontend-client':'#4985ea','backend-domain':'#15a085','api-routes':'#15a085','backend-http':'#15a085','database':'#9a70dd','security':'#e7a434','configuration-security':'#e7a434','external':'#e47771','tests':'#68788e','infrastructure':'#21aeb3','operations':'#21aeb3','documentation':'#9a778e'})[l]||'#74859a'}
function graphShell(title,svg){return `<div class="section-head"><h2>${esc(title)}</h2><span class="muted small">Drag برای pan · چرخ ماوس برای zoom · انتخاب گره برای جزئیات</span></div><div class="svg-wrap" id="graphWrap"><div class="graph-controls"><button id="zoomIn">+</button><button id="zoomOut">−</button><button id="zoomReset">↺</button></div>${svg}</div><div class="legend"><span>ارتباط مستقیم</span><span class="dash">API/runtime</span><span class="dot">استنباط/غیرمستقیم</span><span>FK/DB</span></div>`}
function architectureSvg(){const items=[['persona:customer',75,200,190,72],['ui-domain:public',360,105,200,72],['ui-domain:customer',360,218,200,72],['module:api:routes:requests',690,180,220,72],['domain:requests',1015,180,220,72],['table:requests',1345,110,195,72],['table:invoices',1345,235,195,72],['domain:notifications',1015,365,220,72],['external:melipayamak',1345,365,210,72],['external:zarinpal',1345,485,210,72],['domain:catalog',690,430,220,72],['table:services',1015,510,220,72],['external:postgres',1015,625,220,72]];let g='';for(const [a,b] of [['persona:customer','ui-domain:public'],['persona:customer','ui-domain:customer'],['ui-domain:public','module:api:routes:requests'],['ui-domain:customer','module:api:routes:requests'],['module:api:routes:requests','domain:requests'],['domain:requests','table:requests'],['domain:requests','table:invoices'],['domain:requests','domain:notifications'],['domain:notifications','external:melipayamak'],['ui-domain:customer','external:zarinpal'],['domain:requests','domain:catalog'],['domain:catalog','table:services'],['table:requests','external:postgres'],['table:invoices','external:postgres'],['table:services','external:postgres']]){const A=items.find(x=>x[0]===a),B=items.find(x=>x[0]===b);g+=`<path d="M${A[1]+A[3]},${A[2]+A[4]/2} C${A[1]+A[3]+60},${A[2]+A[4]/2} ${B[1]-60},${B[2]+B[4]/2} ${B[1]},${B[2]+B[4]/2}" fill="none" class="${b.startsWith('external:')?'edge-api':b.startsWith('table:')?'edge-fk':'edge-direct'}"/>`}
 for(const [id,x,y,w,h] of items){const n=byId.get(id);if(n)g+=nodeRect(n,x,y,w,h,n.path||typeNames[n.type])}return `<svg viewBox="0 0 1640 760" role="img" aria-label="معماری کلان">${g}</svg>`}
function moduleGraphSvg(){const mods=ARCH.nodes.filter(n=>n.type==='module'&&n.id.startsWith('module:api:modules:')||n.type==='module'&&n.id.startsWith('module:web:pages:')||n.type==='module'&&n.id.startsWith('module:web:lib')||n.type==='module'&&n.id.startsWith('module:api:routes:'));const counts=new Map();const bump=(a,b,k)=>{if(a===b||!byId.has(a)||!byId.has(b))return;const key=a+'>'+b+'>'+k;counts.set(key,(counts.get(key)||0)+1)};for(const e of ARCH.edges){if(e.type==='imports'){const s=byId.get(e.source),t=byId.get(e.target);if(s&&t)bump('module:'+s.moduleId,'module:'+t.moduleId,'direct')}else if(e.type==='module-api-contract')bump(e.source,e.target,'api')}
 const w=1680,rowH=106,cols=4,h=Math.max(840,Math.ceil(mods.length/cols)*rowH+100);const pos=new Map();mods.forEach((n,i)=>{const col=i%cols,row=Math.floor(i/cols);const x=30+col*405,y=35+row*rowH;pos.set(n.id,{x,y});});let svg=`<svg viewBox="0 0 ${w} ${h}">`;for(const [key,count] of counts){const [a,b,kind]=key.split('>'),A=pos.get(a),B=pos.get(b);if(A&&B){const x1=A.x+180,y1=A.y+38,x2=B.x,y2=B.y+38;const cls=kind==='api'?'edge-api':'edge-direct';svg+=`<path d="M${x1},${y1} C${x1+45},${y1} ${x2-45},${y2} ${x2},${y2}" fill="none" class="${cls}"><title>${kind==='api'?'UI/API via component/client (medium)':'resolved static imports (high)'}</title></path><text x="${(x1+x2)/2}" y="${(y1+y2)/2-3}" font-size="9" fill="var(--muted)">${count}</text>`}}
 for(const n of mods){const p=pos.get(n.id);svg+=nodeRect(n,p.x,p.y,180,76,`${n.fileCount||0} فایل`)}return svg+'</svg>'}
function erdSvg(){const tables=ARCH.tables;const groups={identity:['users','roles','sessions','otp_codes','login_events','customer_profiles','staff_profiles','customer_records'],catalog:['service_categories','services','service_staff','service_cities','cities','custom_service_offers','assignment_rules'],requests:['requests','request_events','request_documents','request_handoffs','request_submission_keys'],finance:['invoices','payments','invoice_sequences','financial_operations','ledger_entries','payment_gateway_logs','expenses','expense_categories','compensation_contracts','compensation_entries'],operations:['shift_templates','shifts','attendance','shift_change_requests'],communication:['threads','messages','notifications','sms_logs','sms_templates'],platform:['files','settings','audit_logs','backups','schema_migrations']};const place=new Map();let x=25,y=35,maxY=0;const cw=245,ch=96,gapX=30,gapY=34;const colKeys=Object.keys(groups);let rowMax=0;colKeys.forEach((g,c)=>{groups[g].forEach((name,r)=>{const n=byId.get('table:'+name);if(!n)return;const px=25+c*(cw+gapX),py=35+r*(ch+gapY);place.set(name,{x:px,y:py});maxY=Math.max(maxY,py+ch);rowMax=Math.max(rowMax,r);})});const width=25+colKeys.length*(cw+gapX),height=maxY+50;let svg=`<svg viewBox="0 0 ${width} ${height}">`;
 for(const t of tables)for(const fk of t.foreignKeys||[]){const A=place.get(t.name),B=place.get(fk.targetTable);if(A&&B){svg+=`<path d="M${A.x},${A.y+40} C${A.x-32},${A.y+40} ${B.x+cw+32},${B.y+40} ${B.x+cw},${B.y+40}" fill="none" class="edge-fk"><title>${esc(t.name+'.'+fk.column+' → '+fk.targetTable+'.'+fk.targetColumn)}</title></path>`}}
 for(const t of tables){const p=place.get(t.name);if(!p)continue;const keyCols=(t.columns||[]).filter(c=>c.primaryKeyOrder||['customer_id','request_id','service_id','user_id','status','created_at'].includes(c.name)).slice(0,5);let n=byId.get('table:'+t.name);svg+=nodeRect(n,p.x,p.y,cw,ch,(keyCols.map(c=>c.name).join(' · ')||`${t.columns.length} columns`).slice(0,42));}return {svg:svg+'</svg>',height,width}}
function renderOverview(){const unmatch=ARCH.nodes.filter(n=>n.type==='client-call'&&n.matchStatus==='unmatched').length;return `${panelLayout(`<div class="section-head"><h2>System Context · نمای کلان</h2><span class="tag">snapshot ${esc(ARCH.meta.generatedDate)}</span></div>${graphShell('جریان کلی',architectureSvg())}<div class="note small">این overview مسیرهای منتخب است؛ درخت کامل، همه importها، endpointها، tables و جریان‌های دیگر در تب‌های جدا هستند. ${unmatch} فراخوانی UI به route literal تطبیق داده نشده و در inventory برچسب دارد.</div><div class="legend"><span>فرانت‌اند</span><span>بک‌اند</span><span>DB</span><span>امنیت</span><span>سرویس خارجی</span></div>`)}`}
function renderConnections(){const svg=moduleGraphSvg();return panelLayout(graphShell('وابستگی مستقیم و زنجیرهٔ غیرمستقیم UI → API',svg)+`<p class="muted small">خط پیوسته = import محلی مستقیم که به فایل موجود resolve شده؛ خط‌چین = UI route → rendered component/client call → endpoint، یک پیوند چندمرحله‌ای با confidence=medium. شمار روی خط تعداد شواهد/اتصال‌های منطبق است. پیوندهای خام در JSON با evidence قابل بازبینی‌اند.</p>`)}
function renderTree(){return panelLayout(folderTree())}
function renderFlows(){return panelLayout(`<div class="section-head"><h2>Sequence / جریان واقعی</h2><span class="muted small">گام‌ها با evidence path/snippet به source وصل‌اند</span></div><div class="findings">${ARCH.flows.map(f=>`<article class="card"><div class="section-head"><div><h3>${esc(f.title)}</h3><p class="muted">${esc(f.summary)}</p></div><span class="tag">${f.steps.length} گام</span></div><div class="flow">${f.steps.map((s,i)=>`<div class="step" data-node="${esc(f.stepNodeIds[i])}"><span class="number">${i+1}</span><h4>${esc(s[1])}</h4><p class="small muted">${esc(s[3])}<br>${esc(s[4])}</p><span class="pill">${esc(s[2])}</span></div>`).join('')}</div><div class="branches"><b>شرط‌ها / خطاها:</b><ul>${f.branches.map(b=>`<li>${esc(b)}</li>`).join('')}</ul></div></article>`).join('')}</div>`)}
function renderDatabase(){const erd=erdSvg();return panelLayout(`<div class="section-head"><h2>ERD · ${ARCH.tables.length} جدول، ${ARCH.meta.foreignKeyCount} قید FK</h2><span class="tag">FK صریح فقط</span></div><div class="svg-wrap" id="graphWrap" style="height:66vh"><div class="graph-controls"><button id="zoomIn">+</button><button id="zoomOut">−</button><button id="zoomReset">↺</button></div>${erd.svg}</div><div class="legend"><span style="color:var(--db)">Foreign key constraint در migration</span><span>انتخاب جدول → همه ستون‌ها، PK، FK و migration</span></div><div class="table-scroll" style="margin-top:14px"><table><thead><tr><th>جدول</th><th>ستون‌ها</th><th>FK صریح</th><th>مهاجرت</th></tr></thead><tbody>${ARCH.tables.map(t=>`<tr><td><button class="linkrow" data-node="table:${esc(t.name)}">${esc(t.name)}</button></td><td class="small">${t.columns.map(c=>`<span class="key">${esc(c.name)}</span>${c.primaryKeyOrder?' 🔑':''}`).join(' · ')}</td><td>${t.foreignKeys.map(f=>`<button class="chip" data-node="table:${esc(f.targetTable)}">${esc(f.column)} → ${esc(f.targetTable)}</button>`).join('')||'—'}</td><td class="mono">${t.migrationPaths?.join('<br>')||'—'}</td></tr>`).join('')}</tbody></table></div><p class="note small">Schema با اجرای SQL همه migrationهای snapshot در SQLite in-memory استخراج شد؛ به PostgreSQL سرور وصل نشد. شناسه‌های بدون FK در schema constraint فرض نشده‌اند.</p>`)}
function renderAccess(){const resources=[...new Set(ARCH.roles.flatMap(r=>r.permissions.map(p=>p.split('.')[0])))].sort();const ops=['view','create','edit','approve','cancel','delete','export','contracts.edit','accrue','settle','reports.view'];return panelLayout(`<div class="section-head"><h2>ماتریس مجوزهای پیش‌فرض</h2><span class="tag">Server permissions catalog</span></div><p class="muted small">نقش‌ها و مجوزها از DEFAULT_ROLES در permissions.ts parse شده‌اند؛ route-specific object/office scope کنار مجوز نقش اجرا می‌شود. Customers `+'`kind`'+` مستقل‌اند.</p><div class="table-scroll"><table><thead><tr><th>نقش</th>${resources.map(r=>`<th>${esc(r)}</th>`).join('')}</tr></thead><tbody>${ARCH.roles.map(role=>`<tr><th><button class="linkrow" data-node="role:${esc(role.code)}">${esc(role.name)}<br><span class="mono">${esc(role.code)}</span></button></th>${resources.map(resource=>{const p=role.permissions.filter(x=>x.split('.')[0]===resource);const cell=role.wildcard?'*':p.map(x=>x.split('.')[1]).join(', ');return `<td class="small ${cell?'':'muted'}">${esc(cell||'—')}</td>`}).join('')}</tr>`).join('')}</tbody></table></div><div class="note"><b>دسترسی داده (مشاهده‌شده):</b><ul><li>مشتری: فقط objectهای خودش (route و service checks).</li><li>کارمند غیر-office: پرونده‌های assigned_to او؛ claim در محدوده مهارت/شیفت/ظرفیت است.</li><li>super_admin/manager/accountant: officeScope در چند route؛ حسابداری علاوه بر آن role/permission checks دارد.</li><li>فایل: requireAuth + مالکیت/ارتباط به پرونده؛ منطق endpoint در files.ts را بررسی کن.</li><li>RequireRole در UI به‌تنهایی محافظ نیست؛ API middleware و ownership checks نیز موجودند.</li></ul></div>`)}
function renderIntegrations(){return panelLayout(`<div class="section-head"><h2>سرویس‌ها، وابستگی‌ها، تنظیمات</h2><span class="tag">secret values حذف شده</span></div><div class="findings">${ARCH.externalIntegrations.map(x=>`<article class="card"><div class="section-head"><h3>${esc(x.title)}</h3><span class="status-badge">${esc(x.status)}</span></div><p>${esc(x.purpose)}</p><div class="mono">${esc(x.path)}</div><p><b>مهلت:</b> ${esc(x.timeout||'—')} · <b>تست:</b> ${esc(x.test)}</p><div class="mono">${(x.operations||[]).map(esc).join('<br>')}</div><button class="btn" data-node="external:${esc(x.id)}">جزئیات / کد</button></article>`).join('')}<article class="card"><h3>وابستگی‌های npm مستقیم</h3><p>در graph nodes با type dependency هستند؛ نسخه‌ها range از package manifests هستند، نه lockfile resolution version.</p><div class="chip-grid">${ARCH.nodes.filter(n=>n.type==='dependency').map(n=>`<button class="chip" data-node="${esc(n.id)}">${esc(n.title)}</button>`).join('')}</div></article><article class="card"><h3>Environment names · فقط نام</h3><p>هیچ مقدار از env template یا process env درج نشده است.</p><div class="chip-grid">${ARCH.nodes.filter(n=>n.type==='environment-variable').map(n=>`<button class="chip mono" data-node="${esc(n.id)}">${esc(n.title)}</button>`).join('')}</div></article><article class="card"><h3>Settings definitions</h3><p>${ARCH.nodes.filter(n=>n.type==='setting').length} کلید سروری؛ جزئیات در گره‌ها.</p>${ARCH.nodes.filter(n=>n.type==='setting').map(n=>`<button class="chip" data-node="${esc(n.id)}">${esc(n.title)}</button>`).join('')}</article></div>`)}
function renderFindings(){return panelLayout(`<div class="section-head"><h2>یافته‌ها / نقاط حساس</h2><span class="tag">شواهد و سطح قطعیت</span></div><div class="findings">${ARCH.findings.map(f=>`<article class="finding ${esc(f.severity)}"><div class="section-head"><h3>${esc(f.title)}</h3><span class="pill">${esc(f.severity)} · ${esc(f.certainty)}</span></div><p>${esc(f.impact)}</p><div class="small muted">شواهد:</div>${f.evidence.map(e=>`<div class="mono">${esc(e)}</div>`).join('')}</article>`).join('')}<article class="card"><h3>خواندن گراف</h3><p><span class="pill">direct/high</span> import, route, SQL, FK یا call مشهود در سورس.</p><p><span class="pill sec">inferred/medium</span> رابطه ترکیبی از پیکربندی/قرارداد و نه فراخوانی مستقیم. در خروجی هر edge certainty و evidence دارد.</p><p>کمبود اتصال live از روی وجود adapter به‌عنوان موفقیت نمایش داده نمی‌شود.</p></article></div>`)}
function renderInventory(){const base=ARCH.nodes.filter(n=>['file','endpoint','ui-route','table','integration','role','migration','environment-variable','setting','dependency','test'].includes(n.type));let list=base;if(searchQuery)list=list.filter(matchesSearch);if(filterLayer)list=list.filter(n=>n.layer===filterLayer);if(window.typeFilter)list=list.filter(n=>n.type===window.typeFilter);list.sort((a,b)=>a.type.localeCompare(b.type)||String(a.path||a.title).localeCompare(String(b.path||b.title)));return panelLayout(`<div class="section-head"><h2>فهرست اجزا <span class="tag">${list.length} نتیجه</span></h2><select id="typeFilter" class="control"><option value="">همه انواع</option>${[...new Set(base.map(n=>n.type))].sort().map(t=>`<option value="${esc(t)}">${esc(typeNames[t]||t)}</option>`).join('')}</select></div><div class="list" id="inventory">${list.map(n=>`<div class="inventory-row" data-node="${esc(n.id)}"><span class="mono">${esc(n.path||(n.method?n.method+' '+(n.route||''):n.title))}</span><span>${esc(n.title)}</span><span class="pill">${esc(typeNames[n.type]||n.type)}</span></div>`).join('')||'<div class="empty">موردی با این جست‌وجو پیدا نشد.</div>'}</div>`)}
function render(){const fn={overview:renderOverview,tree:renderTree,modules:renderConnections,flows:renderFlows,database:renderDatabase,access:renderAccess,integrations:renderIntegrations,findings:renderFindings,inventory:renderInventory}[current];content.innerHTML=fn();renderDetail();bindActions(content);if(current==='tree'){document.getElementById('expandAll').onclick=()=>content.querySelectorAll('details').forEach(d=>d.open=true);document.getElementById('collapseAll').onclick=()=>content.querySelectorAll('details').forEach(d=>d.open=false)}if(current==='inventory'){const tf=document.getElementById('typeFilter');tf.value=window.typeFilter||'';tf.onchange=()=>{window.typeFilter=tf.value;render()};if(window.typeFilter){content.querySelectorAll('.inventory-row').forEach(r=>{const n=byId.get(r.dataset.node);r.classList.toggle('hidden',n?.type!==window.typeFilter)})}}if(current==='overview'||current==='modules'||current==='database')bindGraph();}
function bindGraph(){const wrap=document.getElementById('graphWrap');const svg=wrap?.querySelector('svg');if(!wrap||!svg)return;let view=svg.viewBox.baseVal,drag=null;svg.addEventListener('wheel',e=>{e.preventDefault();graphScale=Math.min(3,Math.max(.45,graphScale*(e.deltaY<0?1.12:.89)));apply()}, {passive:false});svg.addEventListener('pointerdown',e=>{if(e.target.closest('[data-node]'))return;drag={x:e.clientX-graphPan.x,y:e.clientY-graphPan.y};svg.classList.add('dragging');svg.setPointerCapture(e.pointerId)});svg.addEventListener('pointermove',e=>{if(!drag)return;graphPan={x:e.clientX-drag.x,y:e.clientY-drag.y};apply()});svg.addEventListener('pointerup',()=>{drag=null;svg.classList.remove('dragging')});function apply(){svg.style.transformOrigin='center center';svg.style.transform=`translate(${graphPan.x}px,${graphPan.y}px) scale(${graphScale})`}document.getElementById('zoomIn').onclick=()=>{graphScale=Math.min(3,graphScale*1.15);apply()};document.getElementById('zoomOut').onclick=()=>{graphScale=Math.max(.45,graphScale/1.15);apply()};document.getElementById('zoomReset').onclick=()=>{graphScale=1;graphPan={x:0,y:0};apply()}}
function matchesSearch(n){const q=searchQuery.toLowerCase();if(!q)return true;const blob=[n.title,n.path,n.description,n.id,n.method,n.code,n.key,n.name,n.component,n.flowId,...(n.symbols||[]),...(n.permissions||[]),...(n.files||[])].filter(Boolean).join(' ').toLowerCase();return blob.includes(q)}
function searchUpdate(){searchQuery=search.value.trim();if(!searchQuery){searchResults.classList.add('hidden');if(current==='inventory')render();return}const found=ARCH.nodes.filter(matchesSearch).filter(n=>(!filterLayer||n.layer===filterLayer)&&(!window.typeFilter||n.type===window.typeFilter)).slice(0,60);searchResults.innerHTML=found.map(n=>`<button class="result" data-node="${esc(n.id)}"><i class="type-icon layer-${esc(n.layer)}"></i><span><b>${esc(n.title)}</b><br><small class="muted">${esc(n.path||typeNames[n.type]||n.type)}</small></span><span class="count">${esc(typeNames[n.type]||n.type)}</span></button>`).join('')||'<div class="no-results">چیزی پیدا نشد</div>';searchResults.classList.remove('hidden');bindActions(searchResults);if(current==='inventory')render()}
search.addEventListener('input',searchUpdate);search.addEventListener('focus',()=>{if(searchQuery)searchUpdate()});document.addEventListener('click',e=>{if(!e.target.closest('.search-host'))searchResults.classList.add('hidden')});layerFilter.onchange=()=>{filterLayer=layerFilter.value;if(current==='inventory')render()};document.getElementById('exportBtn').onclick=()=>{const blob=new Blob([JSON.stringify(ARCH,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='Pishkan-Architecture-Data.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};document.getElementById('themeBtn').onclick=()=>{const d=document.documentElement.dataset.theme==='dark';document.documentElement.dataset.theme=d?'light':'dark';localStorage.setItem('pishkan-arch-theme',d?'light':'dark')};document.documentElement.dataset.theme=localStorage.getItem('pishkan-arch-theme')||'light';document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();search.focus()}if(e.key==='Escape'){search.value='';searchQuery='';searchResults.classList.add('hidden');if(current==='inventory')render()}});go('overview');
</script></body></html>'''

if __name__ == "__main__":
    generated=generate()
    print(json.dumps(generated["meta"],ensure_ascii=False,indent=2))
