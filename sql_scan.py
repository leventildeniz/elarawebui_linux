import re
import os

targets_vendor = ["mlx", "gemini", "ollama", "openai", "lovable"]
db_keywords = ["INSERT", "UPDATE", "VALUES", "ALTER TABLE", "DEFAULT", "pool.query", "client.query"]

def scan_sql_hardcodes(base_dir):
    results = []
    for root, dirs, files in os.walk(base_dir):
        if any(ex in root for ex in ["node_modules", "venv", ".git"]):
            continue
        for file in files:
            if not file.endswith((".mjs", ".js", ".sql", ".py")):
                continue
            path = os.path.join(root, file)
            with open(path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
                for i, line in enumerate(lines):
                    upper_line = line.upper()
                    is_db = any(k in upper_line for k in db_keywords)
                    if is_db:
                        for v in targets_vendor:
                            matches = re.findall(r"['\"]([^'\"]*" + v + r"[^'\"]*)['\"]", line, re.IGNORECASE)
                            for m in set(matches):
                                results.append({
                                    "symbol": f"'{m}'",
                                    "proposed": f"'{m.lower().replace('mlx', 'local').replace('openai', 'remote').replace('gemini', 'remote').replace('ollama', 'local').replace('lovable', 'system')}'",
                                    "loc": f"`{path}:{i+1}`"
                                })
    return results

res = scan_sql_hardcodes("local-server")
for r in res:
    print(r)

# Restore the original sam_audit_impact.md logic by rerunning generate_final_impact.py first, then append DB rows
os.system("python3 generate_final_impact.py")

with open("sam_audit_impact.md", "r", encoding="utf-8") as f:
    content = f.read()

lines = content.strip().split("\n")
new_entries = []

for r in res:
    sym = r["symbol"]
    prop = r["proposed"]
    loc = r["loc"]
    row = f"| {sym} (DB/SQL Hardcode) | {prop} | {loc} | {loc} |"
    if row not in content:
        lines.insert(2, row) # Insert right after the header

with open("sam_audit_impact.md", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"Added {len(res)} DB hardcodes to sam_audit_impact.md")
