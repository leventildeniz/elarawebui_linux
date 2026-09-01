import json
import os

with open("audit_results2.json", "r", encoding="utf-8") as f:
    data = json.load(f)

filtered_data = []
for d in data:
    f_path = d["file"]
    if "AUDIT" in f_path or "RUNBOOK" in f_path or f_path.endswith(".md"):
        continue
    filtered_data.append(d)

symbols = {}

def extract_tokens(line):
    clean = ""
    for c in line:
        if c.isalnum() or c in ['_', '-', '.', '/']:
            clean += c
        else:
            clean += " "
    return clean.split()

def get_proposed_name(sym, ttype):
    low = sym.lower()
    if ttype == "Vendor":
        if "mlx" in low: return sym.replace("mlx", "local").replace("Mlx", "Local").replace("MLX", "LOCAL")
        if "gemini" in low: return sym.replace("gemini", "remote").replace("Gemini", "Remote")
        if "ollama" in low: return sym.replace("ollama", "local").replace("Ollama", "Local")
        if "openai" in low: return sym.replace("openai", "remote").replace("Openai", "Remote").replace("OpenAI", "Remote")
        if "lovable" in low: return sym.replace("lovable", "system").replace("Lovable", "System")
    elif ttype == "Network":
        return "CONFIG_PORT" if sym.isdigit() else "CONFIG_HOST"
    elif ttype == "Path":
        return "CONFIG_PATH"
    return "generic_name"

for d in filtered_data:
    target = d["target"]
    ttype = d["type"]
    match_line = d["match"]
    tokens = extract_tokens(match_line)
    found_tokens = [tok for tok in tokens if target in tok.lower()]
    
    if not found_tokens and ttype == "Network":
        if target in match_line:
            found_tokens = [target]

    for tok in found_tokens:
        tok = tok.strip(".-/")
        if len(tok) < 3: continue
        
        if tok not in symbols:
            symbols[tok] = {
                "type": ttype,
                "proposed": get_proposed_name(tok, ttype),
                "def": None,
                "calls": set(),
            }
        
        is_def = False
        if f"const {tok}" in match_line or f"let {tok}" in match_line or f"function {tok}" in match_line or f"def {tok}" in match_line or f"class {tok}" in match_line or f"{tok} =" in match_line or f"{tok}=" in match_line:
            is_def = True
            
        loc = f"`{d['file']}:{d['line']}`"
        if is_def and not symbols[tok]["def"]:
            symbols[tok]["def"] = loc
        else:
            symbols[tok]["calls"].add(loc)

audit_lines = ["| Dosya Yolu | Satır | Sızıntı | Tür | Not |", "|---|---|---|---|---|"]
for d in filtered_data:
    fpath = d['file']
    line = d['line']
    target = d['target']
    ttype = d['type']
    match_short = d['match'].strip()
    if len(match_short) > 50:
        match_short = match_short[:47] + "..."
    match_short = match_short.replace("|", "\\|")
    audit_lines.append(f"| `{fpath}` | {line} | `{target}` | {ttype} | `{match_short}` |")

os.makedirs(".forge/knowledge", exist_ok=True)
with open(".forge/knowledge/sam_audit_log.md", "w", encoding="utf-8") as f:
    f.write("\n".join(audit_lines))

impact_map = []
for sym, info in symbols.items():
    defs = info["def"] or "N/A"
    calls = list(info["calls"])
    
    risk = "Düşük"
    if len(calls) > 5: risk = "Yüksek"
    elif len(calls) > 2: risk = "Orta"
    
    impact_map.append({
        "symbol": sym,
        "proposed": info["proposed"],
        "def": defs,
        "calls": calls,
        "risk": risk
    })

impact_map.sort(key=lambda x: (len(x["calls"])), reverse=True)

with open("impact_map.json", "w", encoding="utf-8") as f:
    json.dump(impact_map, f, indent=2)

print(f"Done. {len(audit_lines)} audit lines. {len(impact_map)} symbols.")
