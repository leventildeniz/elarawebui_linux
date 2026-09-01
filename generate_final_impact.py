import json
import re

with open('audit_results2.json', 'r', encoding='utf-8') as f:
    audit_data = json.load(f)

symbols = {}

targets_vendor = ["mlx", "gemini", "ollama", "openai", "lovable"]
targets_network = ["8001", "11434", "3005", "3007", "8082", "10443", "3001", "127.0.0.1", "localhost"]
targets_path = ["/Users/", "/home/"]

def get_proposed(sym, ttype):
    low = sym.lower()
    prop = sym
    if ttype == "Vendor":
        if "mlx" in low: prop = prop.replace("mlx", "local").replace("Mlx", "Local").replace("MLX", "LOCAL")
        if "gemini" in low: prop = prop.replace("gemini", "remote").replace("Gemini", "Remote").replace("GEMINI", "REMOTE")
        if "ollama" in low: prop = prop.replace("ollama", "local").replace("Ollama", "Local").replace("OLLAMA", "LOCAL")
        if "openai" in low: prop = prop.replace("openai", "remote").replace("Openai", "Remote").replace("OpenAI", "Remote").replace("OPENAI", "REMOTE")
        if "lovable" in low: prop = prop.replace("lovable", "system").replace("Lovable", "System").replace("LOVABLE", "SYSTEM")
        return prop
    elif ttype == "Network":
        if re.match(r'^\d+$', sym): return "CONFIG_PORT"
        if sym == "127.0.0.1" or low == "localhost": return "CONFIG_HOST"
        return "CONFIG_NETWORK"
    elif ttype == "Path":
        return "CONFIG_PATH"
    return prop

for d in audit_data:
    match_line = d['match']
    fpath = d['file']
    line = d['line']
    ttype = d['type']
    target = d['target']
    
    if 'AUDIT' in fpath or 'RUNBOOK' in fpath or fpath.endswith('.md'):
        continue
        
    extracted_tokens = set(re.findall(r'[a-zA-Z_$][a-zA-Z0-9_$.]*|[Xx]-[a-zA-Z0-9-]+', match_line))
    if ttype in ["Network", "Path"]:
        extracted_tokens.add(target)
        
    for tok in extracted_tokens:
        tok_clean = tok.strip('.')
        low_tok = tok_clean.lower()
        
        is_match = False
        if ttype == "Vendor" and any(t in low_tok for t in targets_vendor):
            is_match = True
        elif ttype == "Network" and target in tok_clean:
            is_match = True
        elif ttype == "Path" and target in tok_clean:
            is_match = True
            
        if is_match:
            if tok_clean not in symbols:
                symbols[tok_clean] = {'proposed': get_proposed(tok_clean, ttype), 'def': None, 'calls': set()}
            
            loc = f"`{fpath}:{line}`"
            
            is_def = bool(re.search(r'\b(const|let|var|function|def|class)\s+' + re.escape(tok_clean) + r'\b', match_line))
            is_assign = bool(re.search(re.escape(tok_clean) + r'\s*=[^=]', match_line))
            
            if (is_def or is_assign) and not symbols[tok_clean]['def']:
                symbols[tok_clean]['def'] = loc
            else:
                if loc != symbols[tok_clean]['def']:
                    symbols[tok_clean]['calls'].add(loc)

md_lines = [
    "| Mevcut Sembol/String | Önerilen Generic İsim | Tanımlandığı Yer (Dosya:Satır) | Kullanıldığı Yerler (Dosya:Satır) |",
    "|---|---|---|---|"
]

sorted_syms = sorted(symbols.items(), key=lambda x: len(x[1]['calls']), reverse=True)

for sym, info in sorted_syms:
    definition = info['def'] or "N/A"
    calls = sorted(list(info['calls']))
    if not calls and definition == "N/A":
        continue
        
    if calls:
        for call in calls:
            md_lines.append(f"| `{sym}` | `{info['proposed']}` | {definition} | {call} |")
    else:
         md_lines.append(f"| `{sym}` | `{info['proposed']}` | {definition} | Yok |")

    
with open('sam_audit_impact.md', 'w', encoding='utf-8') as f:
    f.write("\n".join(md_lines))
print("sam_audit_impact.md recreated.")
