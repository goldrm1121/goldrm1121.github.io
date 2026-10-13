#!/usr/bin/env python3
"""Fail if English (index.html data-i18n) and Chinese (assets/i18n.js) keys are out of sync.

Checks: every data-i18n key has a zh translation; no unused zh keys (except loader.* used from JS);
no empty translations; zh text is not just a copy of the English.
"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
html = (root / "index.html").read_text(encoding="utf-8")
js = (root / "assets/i18n.js").read_text(encoding="utf-8")
main = (root / "assets/main.js").read_text(encoding="utf-8")

en = {}
for key, text in re.findall(r'data-i18n="([^"]+)"[^>]*>(.*?)</', html, flags=re.S):
    en.setdefault(key, text.strip())
zh = dict(re.findall(r'^\s*"([^"]+)":\s*"(.*)",?\s*$', js, flags=re.M))
js_only = set(re.findall(r'"(loader\.[a-z]+)"', main))  # keys used from JS, not in HTML

errors = []
for k in sorted(en):
    if k not in zh:
        errors.append(f"missing zh: {k}  (EN: {en[k][:60]})")
    elif not zh[k].strip():
        errors.append(f"empty zh: {k}")
    elif zh[k].strip() == en[k] and not re.search(r"[一-鿿]", en[k]):
        errors.append(f"zh identical to EN (untranslated?): {k}")
for k in sorted(zh):
    if k not in en and k not in js_only:
        errors.append(f"unused zh key (removed from HTML?): {k}")
for k in sorted(js_only):
    if k not in zh:
        errors.append(f"missing zh for JS key: {k}")

for e in errors:
    print("✗", e)
print(f"{'✓' if not errors else '✗'} i18n: {len(en)} EN keys, {len(zh)} ZH keys, {len(errors)} problem(s)")
sys.exit(1 if errors else 0)
