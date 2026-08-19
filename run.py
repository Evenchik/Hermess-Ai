#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Hermess Ai — универсальный лаунчер
==================================
Проверяет всё что нужно для запуска Next.js + PostgreSQL проекта,
доустанавливает недостающее и запускает приложение.

Что делает по шагам:
  [1] Проверяет Python, Node.js, npm
  [2] Проверяет .env / DATABASE_URL
  [3] Ставит npm-зависимости (если нет node_modules)
  [4] Проверяет доступность БД (PostgreSQL)
  [5] Запускает `npm run dev` (или `build + start` в --prod)

Запуск:
  python run.py              # dev режим (next dev)
  python run.py --prod       # prod режим (next build + next start)
  python run.py --port 4000  # кастомный порт
  python run.py --skip-install  # не ставить зависимости
  python run.py --no-launch     # только проверка и установка

Требования:
  Python 3.8+, Node.js 18+, npm 8+, PostgreSQL (или dummy URL для старта без БД)
"""

import argparse
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

# ───── настройки ─────
ROOT = Path(__file__).parent.resolve()
REQUIRED_NODE_MAJOR = 18
REQUIRED_NPM_MAJOR = 8
DEFAULT_PORT = 3000
DEFAULT_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/app_db"

# цвета для терминала
def supports_color() -> bool:
    return sys.stdout.isatty() and os.name != "nt"

if supports_color():
    GREEN = "\033[92m"; YELLOW = "\033[93m"; RED = "\033[91m"; CYAN = "\033[96m"
    DIM = "\033[2m"; BOLD = "\033[1m"; RESET = "\033[0m"
else:
    GREEN = YELLOW = RED = CYAN = DIM = BOLD = RESET = ""

def c(text, color): return f"{color}{text}{RESET}"

def log(msg, level="info"):
    prefix = {
        "info": c("ℹ", CYAN),
        "ok": c("✔", GREEN),
        "warn": c("⚠", YELLOW),
        "err": c("✘", RED),
        "step": c("▶", CYAN),
    }.get(level, " ")
    print(f"{prefix} {msg}")

def run(cmd, cwd=ROOT, check=False, shell=False, env=None, capture=False):
    """Запуск команды, возвращает (returncode, stdout, stderr)"""
    if isinstance(cmd, str) and not shell:
        cmd = cmd.split()
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd),
            shell=shell,
            env=env or os.environ.copy(),
            capture_output=capture,
            text=True,
        )
        return result.returncode, result.stdout if capture else "", result.stderr if capture else ""
    except FileNotFoundError as e:
        return 127, "", str(e)

def which(cmd):
    return shutil.which(cmd)

def get_version(cmd_base):
    """Пробует `cmd --version` и возвращает строку версии"""
    for flag in ["--version", "-v", "version"]:
        code, out, err = run([cmd_base, flag], capture=True)
        if code == 0 and (out or err):
            txt = (out or err).strip()
            # вытаскиваем x.y.z
            m = re.search(r"(\d+\.\d+\.\d+)", txt)
            if m: return m.group(1)
            # fallback
            return txt.splitlines()[0].strip()
    return None

def parse_major(version_str):
    try:
        return int(version_str.strip().lstrip("v").split(".")[0])
    except: return 0

# ───── проверки ─────

def check_python():
    log(f"Python {platform.python_version()} [{platform.system()} {platform.machine()}]", "info")
    if sys.version_info < (3, 8):
        log(f"Python {sys.version} слишком старый, нужен 3.8+", "err")
        return False
    log("Python OK", "ok")
    return True

def check_node(install_if_missing=True):
    log("Проверка Node.js ...", "step")
    node = which("node")
    if not node:
        log("Node.js не найден в PATH", "err")
        if install_if_missing:
            try_install_node()
        return False
    ver = get_version("node")
    if not ver:
        log(f"Node найден ({node}), но не смог определить версию", "warn")
        return False
    major = parse_major(ver)
    log(f"Node.js {ver} ({node})", "info")
    if major < REQUIRED_NODE_MAJOR:
        log(f"Node.js {major} < требуемого {REQUIRED_NODE_MAJOR}. Обнови Node.js: https://nodejs.org", "err")
        if install_if_missing:
            try_install_node()
        return False
    log(f"Node.js {ver} OK", "ok")
    return True

def check_npm(install_if_missing=True):
    log("Проверка npm ...", "step")
    npm = which("npm")
    # Windows: npm.cmd
    if not npm:
        npm = which("npm.cmd")
    if not npm:
        log("npm не найден", "err")
        if install_if_missing:
            log("npm идёт вместе с Node.js — установи Node.js", "warn")
            try_install_node()
        return False
    ver = get_version("npm")
    if ver:
        major = parse_major(ver)
        log(f"npm {ver}", "info")
        if major < REQUIRED_NPM_MAJOR:
            log(f"npm {ver} староват, рекомендуется {REQUIRED_NPM_MAJOR}+ (npm i -g npm)", "warn")
        else:
            log(f"npm {ver} OK", "ok")
    else:
        log(f"npm найден ({npm})", "ok")
    return True

def try_install_node():
    system = platform.system()
    log(f"Попытка автоустановки Node.js на {system} ...", "warn")
    if system == "Windows":
        # пробуем winget, затем choco, затем scoop
        for mgr, cmd in [
            ("winget", ["winget", "install", "OpenJS.NodeJS.LTS", "--accept-package-agreements", "--accept-source-agreements"]),
            ("choco", ["choco", "install", "nodejs-lts", "-y"]),
            ("scoop", ["scoop", "install", "nodejs-lts"]),
        ]:
            if which(mgr):
                log(f"Найден {mgr}, запускаю установку ...", "step")
                code, _, _ = run(cmd)
                if code == 0:
                    log(f"Node.js установлен через {mgr}. Перезапусти терминал и снова запусти скрипт.", "ok")
                    return True
                else:
                    log(f"{mgr} не смог установить (код {code})", "warn")
        log("Автоустановка на Windows не удалась. Скачай вручную: https://nodejs.org/en/download", "err")
        log("Или: winget install OpenJS.NodeJS.LTS", "info")
    elif system == "Darwin":
        if which("brew"):
            log("brew найден, ставлю node ...", "step")
            code, _, _ = run(["brew", "install", "node@20"])
            if code == 0:
                log("Node.js установлен через brew", "ok")
                return True
            run(["brew", "install", "node"])
        else:
            log("Установи Homebrew https://brew.sh затем: brew install node@20", "err")
    elif system == "Linux":
        # определяем дистрибутив
        if which("apt"):
            log("apt найден — для установки нужен sudo:", "warn")
            log("  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs", "info")
        elif which("dnf"):
            log("  sudo dnf install nodejs npm", "info")
        elif which("pacman"):
            log("  sudo pacman -S nodejs npm", "info")
        else:
            log("Скачай Node.js: https://nodejs.org", "info")
    else:
        log(f"Неизвестная ОС {system}, скачай Node.js вручную: https://nodejs.org", "err")
    return False

def check_env():
    log("Проверка окружения (.env / DATABASE_URL) ...", "step")
    env_path = ROOT / ".env"
    env_local = ROOT / ".env.local"
    database_url = os.environ.get("DATABASE_URL")

    # читаем .env если есть
    env_vars = {}
    for p in [env_path, env_local]:
        if p.exists():
            log(f"Найден {p.name}", "info")
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    line=line.strip()
                    if not line or line.startswith("#") or "=" not in line: continue
                    k,v=line.split("=",1)
                    env_vars[k.strip()]=v.strip().strip('"').strip("'")
            except Exception as e:
                log(f"Не смог прочитать {p}: {e}", "warn")

    if not database_url:
        database_url = env_vars.get("DATABASE_URL")

    if database_url:
        # маскируем пароль
        masked = re.sub(r"://[^@]+@", "://***:***@", database_url)
        log(f"DATABASE_URL = {masked}", "info")
        # проверяем формат
        if not database_url.startswith("postgresql://") and not database_url.startswith("postgres://"):
            log("DATABASE_URL должен начинаться с postgresql://", "warn")
        log("DATABASE_URL задан — OK", "ok")
        return True
    else:
        log("DATABASE_URL не задан", "warn")
        # создаём .env с dummy
        if not env_path.exists():
            log(f"Создаю {env_path} с dummy URL (для сборки и локального старта без БД) ...", "step")
            content = f"""# сгенерировано run.py {time.strftime('%Y-%m-%d %H:%M')}
DATABASE_URL="{DEFAULT_DATABASE_URL}"
# Опционально — вставь свои ключи:
# OPENAI_API_KEY=""
# GROQ_API_KEY=""
# ANTHROPIC_API_KEY=""
"""
            try:
                env_path.write_text(content, encoding="utf-8")
                log(f"{env_path} создан", "ok")
                log(f"Если есть реальный Postgres — поменяй DATABASE_URL в {env_path}", "info")
                # экспортируем для текущего процесса
                os.environ["DATABASE_URL"] = DEFAULT_DATABASE_URL
                return True
            except Exception as e:
                log(f"Не смог создать .env: {e}", "err")
                return False
        else:
            log(f"{env_path} существует но без DATABASE_URL — добавь строку:", "err")
            log(f'  DATABASE_URL="{DEFAULT_DATABASE_URL}"', "info")
            return False

def check_dependencies(skip_install=False):
    log("Проверка зависимостей (node_modules) ...", "step")
    pkg = ROOT / "package.json"
    if not pkg.exists():
        log("package.json не найден — ты в корне проекта?", "err")
        return False
    node_modules = ROOT / "node_modules"
    next_bin = ROOT / "node_modules" / ".bin" / ("next" + (".cmd" if platform.system()=="Windows" else ""))
    package_lock = ROOT / "package-lock.json"

    need_install = False
    if not node_modules.exists():
        log("node_modules не найден — нужна установка", "warn")
        need_install = True
    elif not next_bin.exists():
        log("node_modules есть, но next не найден — битая установка", "warn")
        need_install = True
    else:
        # проверяем свежесть: если package.json новее чем node_modules
        try:
            pkg_mtime = pkg.stat().st_mtime
            nm_mtime = node_modules.stat().st_mtime
            if pkg_mtime > nm_mtime:
                log("package.json новее node_modules — рекомендуется переустановка", "warn")
                need_install = True
            else:
                log("node_modules OK", "ok")
        except: pass
        # ещё проверяем что количество пакетов похоже
        if not need_install:
            try:
                # быстрый check: должен быть next, react, pg
                for dep in ["next", "pg", "drizzle-orm"]:
                    if not (node_modules / dep).exists():
                        log(f"Пакет {dep} не найден в node_modules", "warn")
                        need_install = True
                        break
            except: pass

    if need_install:
        if skip_install:
            log("Пропускаю установку (--skip-install)", "warn")
            return False
        return install_dependencies()
    return True

def install_dependencies():
    log("Устанавливаю зависимости ...", "step")
    npm = which("npm") or which("npm.cmd") or "npm"
    # предпочитаем npm ci если есть lock
    has_lock = (ROOT / "package-lock.json").exists()
    cmd = [npm, "ci"] if has_lock else [npm, "install"]
    log(f"Запускаю: {' '.join(cmd)} (может занять 1-2 мин) ...", "info")
    # npm ci/install может быть долгим — стримим вывод
    try:
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
        )
        assert proc.stdout is not None
        for line in proc.stdout:
            print(DIM + line.rstrip() + RESET)
        proc.wait()
        if proc.returncode == 0:
            log("Зависимости установлены", "ok")
            return True
        else:
            log(f"npm завершился с кодом {proc.returncode}", "err")
            # fallback: пробуем install если ci упал
            if cmd[1] == "ci":
                log("Пробую npm install вместо ci ...", "warn")
                code, _, _ = run([npm, "install"])
                if code == 0:
                    log("Зависимости установлены (install)", "ok")
                    return True
            return False
    except Exception as e:
        log(f"Ошибка установки: {e}", "err")
        return False

def check_db_connection():
    log("Проверка подключения к БД ...", "step")
    db_url = os.environ.get("DATABASE_URL")
    # также пробуем прочитать из .env если не в окружении
    if not db_url:
        for p in [ROOT / ".env", ROOT / ".env.local"]:
            if p.exists():
                txt = p.read_text(encoding="utf-8")
                m = re.search(r'DATABASE_URL\s*=\s*["\']?([^"\'\n]+)', txt)
                if m:
                    db_url = m.group(1)
                    break
    if not db_url:
        db_url = DEFAULT_DATABASE_URL

    # пробуем node pg quick check
    check_js = """
const { Pool } = require('pg');
const url = process.env.DATABASE_URL || "%s";
const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
pool.query('SELECT 1').then(()=>{ console.log('DB_OK'); process.exit(0)}).catch(e=>{ console.error('DB_FAIL:'+e.message); process.exit(1)});
""" % db_url.replace('"','\\"')

    # запишем временный файл
    tmp = ROOT / ".tmp_db_check.js"
    try:
        tmp.write_text(check_js, encoding="utf-8")
        code, out, err = run(["node", str(tmp)], capture=True)
        tmp.unlink(missing_ok=True)
        combined = (out or "") + (err or "")
        if "DB_OK" in combined:
            log("БД доступна — SELECT 1 OK", "ok")
            return True
        else:
            msg = combined.strip().splitlines()[-1] if combined.strip() else "неизвестная ошибка"
            log(f"БД недоступна: {msg}", "warn")
            # подсказки
            if "127.0.0.1" in db_url or "localhost" in db_url:
                log("Похоже используешь локальный Postgres, но он не запущен.", "info")
                if which("docker"):
                    log("Есть docker — можешь быстро поднять Postgres:", "info")
                    log("  docker run --name hermess-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=app_db -p 5432:5432 -d postgres:16", "info")
                else:
                    log("Поставь Postgres или поменяй DATABASE_URL на внешний (Neon, Supabase и т.д.)", "info")
                log("Проект всё равно запустится с dummy URL, но чаты не сохранятся до появления БД.", "warn")
            else:
                log("Проверь DATABASE_URL и доступность сети", "warn")
            return False
    except Exception as e:
        log(f"Не смог проверить БД: {e}", "warn")
        return False
    finally:
        try: tmp.unlink(missing_ok=True)
        except: pass

def find_free_port(start=3000):
    import socket
    port = start
    for _ in range(20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                port += 1
    return start

def launch_app(prod=False, port=DEFAULT_PORT, extra_env=None):
    log(f"Запуск приложения ({'prod' if prod else 'dev'}) на порту {port} ...", "step")
    npm = which("npm") or which("npm.cmd") or "npm"
    env = os.environ.copy()
    env["PORT"] = str(port)
    # для Next: HOSTNAME 0.0.0.0 чтобы работал preview в Arena
    env["HOSTNAME"] = "0.0.0.0"
    # DATABASE_URL уже в env или .env
    if extra_env:
        env.update(extra_env)

    # проверяем порт
    actual_port = find_free_port(port)
    if actual_port != port:
        log(f"Порт {port} занят, использую {actual_port}", "warn")
        env["PORT"] = str(actual_port)
        port = actual_port

    if prod:
        # build
        log("Собираю production build: npm run build ...", "step")
        code, _, _ = run([npm, "run", "build"], env=env)
        if code != 0:
            log("build упал, пробую dev вместо prod", "warn")
            prod = False

    cmd = [npm, "run", "start"] if prod else [npm, "run", "dev"]
    # на Windows npm это bat, нужен shell=True
    use_shell = platform.system() == "Windows"
    log(f"Запускаю: {' '.join(cmd)}", "info")
    log(f"Открой http://localhost:{port}  (или http://0.0.0.0:{port})", "ok")
    log("Нажми Ctrl+C чтобы остановить", "info")
    print()
    try:
        # стримим вывод
        proc = subprocess.Popen(
            cmd,
            cwd=str(ROOT),
            env=env,
            shell=use_shell,
        )
        proc.wait()
        return proc.returncode
    except KeyboardInterrupt:
        log("Остановлено пользователем (Ctrl+C)", "warn")
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except: 
            try: proc.kill()
            except: pass
        return 0
    except Exception as e:
        log(f"Не смог запустить: {e}", "err")
        return 1

def main():
    parser = argparse.ArgumentParser(description="Hermess Ai — проверка, установка и запуск")
    parser.add_argument("--prod", action="store_true", help="prod режим (build + start) вместо dev")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"порт (по умолчанию {DEFAULT_PORT})")
    parser.add_argument("--skip-install", action="store_true", help="не ставить npm зависимости")
    parser.add_argument("--no-launch", action="store_true", help="только проверка и установка, не запускать")
    parser.add_argument("--skip-db-check", action="store_true", help="не проверять БД")
    parser.add_argument("--yes", "-y", action="store_true", help="не спрашивать подтверждения")
    args = parser.parse_args()

    print()
    print(c(BOLD + "═" * 60 + RESET, CYAN))
    print(c(BOLD + "  Hermess Ai  —  проверка и запуск  " + RESET, CYAN))
    print(c("═" * 60 + RESET, CYAN))
    print(f"  {DIM}Корень: {ROOT}{RESET}")
    print(f"  {DIM}ОС: {platform.system()} {platform.release()}  Python {platform.python_version()}{RESET}")
    print(c("═" * 60 + RESET, CYAN))
    print()

    total_steps = 5
    step = 1

    # 1 — Python
    print(c(f"[{step}/{total_steps}] Проверка Python", BOLD))
    ok_py = check_python()
    step+=1
    print()

    # 2 — Node / npm
    print(c(f"[{step}/{total_steps}] Проверка Node.js и npm", BOLD))
    ok_node = check_node(install_if_missing=not args.skip_install)
    ok_npm = check_npm() if ok_node else False
    # если node не ок и мы не смогли поставить — стопаем
    if not ok_node or not ok_npm:
        log("Без Node.js/npm дальше нельзя. Поставь Node.js 18+ и запусти снова: python run.py", "err")
        if not args.yes:
            input("Нажми Enter для выхода...")
        sys.exit(1)
    step+=1
    print()

    # 3 — Env
    print(c(f"[{step}/{total_steps}] Проверка окружения", BOLD))
    ok_env = check_env()
    step+=1
    print()

    # 4 — Dependencies
    print(c(f"[{step}/{total_steps}] Проверка зависимостей", BOLD))
    ok_deps = check_dependencies(skip_install=args.skip_install)
    if not ok_deps and not args.skip_install:
        log("Зависимости не установлены — попробуй вручную: npm install", "err")
        sys.exit(1)
    step+=1
    print()

    # 5 — DB
    print(c(f"[{step}/{total_steps}] Проверка БД", BOLD))
    if args.skip_db_check:
        log("Пропущено (--skip-db-check)", "warn")
        ok_db = True
    else:
        ok_db = check_db_connection()
        if not ok_db:
            log("БД недоступна — это не критично для старта (используется dummy), но чаты не сохранятся", "warn")
            if not args.yes:
                try:
                    ans = input("Продолжить запуск без БД? [Y/n]: ").strip().lower()
                    if ans in ("n","no","нет"):
                        sys.exit(0)
                except EOFError:
                    pass
    step+=1
    print()

    # итог
    print(c("─" * 60, DIM))
    all_ok = ok_py and ok_node and ok_npm and ok_env and ok_deps
    # db не блокирует
    if all_ok:
        log("Все проверки пройдены ✓", "ok")
    else:
        log("Есть предупреждения, но можно пробовать запуск", "warn")
    print(c("─" * 60, DIM))
    print()

    if args.no_launch:
        log("Флаг --no-launch — не запускаю, только проверка.", "info")
        sys.exit(0 if all_ok else 1)

    # запуск
    try:
        code = launch_app(prod=args.prod, port=args.port)
        sys.exit(code)
    except KeyboardInterrupt:
        log("Выход", "info")
        sys.exit(0)

if __name__ == "__main__":
    main()
