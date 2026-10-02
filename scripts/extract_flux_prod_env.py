"""Extrai credenciais Flux do PDF Robert → .secrets/flux-delivery-prod.env (stdout só status)."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from pypdf import PdfReader

repo = Path(__file__).resolve().parents[1]
pdf = next(repo.glob("*Relat*rios*Robert*.pdf"), None) or next(repo.glob("*Robert*.pdf"), None)
if not pdf:
    print("PDF não encontrado", file=sys.stderr)
    sys.exit(1)

text = ""
for page in PdfReader(str(pdf)).pages:
    text += (page.extract_text() or "") + "\n"

# debug local (gitignored)
(repo / ".secrets" / ".tmp-flux-pdf-text.txt").write_text(text, encoding="utf-8")

secret = user = pwd = None

# client_id / client_secret em tabelas ou linhas
for pat in [
    r"client[_\s-]?secret\s*[:=]\s*([^\s\n\r]+)",
    r"Client\s*Secret\s*[:=]?\s*([^\s\n\r]+)",
    r"secret\s+do\s+cliente\s*[:=]?\s*([^\s\n\r]+)",
    r"OAuth.*?secret\s*[:=]?\s*([A-Za-z0-9_\-]{6,})",
]:
    m = re.search(pat, text, re.I | re.S)
    if m:
        secret = m.group(1).strip()
        break

for line in text.splitlines():
    l = line.strip()
    if not secret and re.search(r"client.?secret", l, re.I):
        m = re.search(r"[:=]\s*(\S+)", l)
        if m:
            secret = m.group(1)
    if re.search(r"^user(name)?\b|usu[aá]rio", l, re.I) and not user:
        m = re.search(r"[:=]\s*(\S+)", l)
        if m:
            user = m.group(1)
    if re.search(r"password|senha", l, re.I) and not pwd:
        m = re.search(r"[:=]\s*(\S+)", l)
        if m:
            pwd = m.group(1)

# Produção: linha "username robert..." no PDF (evitar exemplo homolog sd@)
if not user:
    m = re.search(r"username\s+(robert\.[A-Za-z0-9@._\-]+)", text, re.I)
    if m:
        user = m.group(1)
if not secret:
    m = re.search(r"client_secret\s+(\S+)", text, re.I)
    if m:
        secret = m.group(1)
if not user:
    m = re.search(r"(?:user(?:name)?|usu[aá]rio)\s*[:=]?\s*([A-Za-z0-9@._\-]+)", text, re.I)
    if m:
        user = m.group(1)

if not pwd:
    m = re.search(r"(?:password|senha)\s*[:=]?\s*(\S+)", text, re.I)
    if m:
        pwd = m.group(1)

# SD client secret is often a standalone token near "SD"
if not secret:
    idx = text.find("SD")
    if idx >= 0:
        window = text[max(0, idx - 200) : idx + 400]
        for tok in re.findall(r"[A-Za-z0-9_\-]{12,}", window):
            if tok not in ("delivery", "flux", "homolog", "Produção") and tok != user:
                secret = tok
                break

if not (secret and user and pwd):
    # list label lines for debugging in stderr without secrets
    labels = [l.strip() for l in text.splitlines() if re.search(r"secret|senha|password|user|SD|client", l, re.I)][:25]
    print(
        json.dumps(
            {
                "error": "incomplete",
                "hasSecret": bool(secret),
                "hasUser": bool(user),
                "hasPassword": bool(pwd),
                "label_lines": labels,
            }
        ),
        file=sys.stderr,
    )
    sys.exit(1)

out = repo / ".secrets" / "flux-delivery-prod.env"
out.write_text(
    "\n".join(
        [
            "FLUX_DELIVERY_BASE_URL=https://delivery-flux-it.com.br",
            "FLUX_DELIVERY_OAUTH_CLIENT_ID=SD",
            f"FLUX_DELIVERY_OAUTH_CLIENT_SECRET={secret}",
            f"FLUX_DELIVERY_USERNAME={user}",
            f"FLUX_DELIVERY_PASSWORD={pwd}",
            "",
        ]
    ),
    encoding="utf-8",
)
print(json.dumps({"ok": True, "path": str(out), "user": user}))
