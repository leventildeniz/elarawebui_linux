import json

with open("impact_map.json", "r", encoding="utf-8") as f:
    data = json.load(f)

data.sort(key=lambda x: len(x["calls"]), reverse=True)

md = ["| Mevcut Sembol/String | Önerilen Generic İsim | Tanımlama Noktası (Definition) | Risk Seviyesi | Kullanım Noktaları (Call Sites) |",
      "|---|---|---|---|---|"]

for d in data[:105]:
    sym = d["symbol"]
    prop = d["proposed"]
    definition = d["def"]
    risk = d["risk"]
    calls = d["calls"]
    
    if len(calls) > 5:
        call_str = f"<details><summary>{len(calls)} Referans</summary>" + "<br>".join(calls) + "</details>"
    else:
        call_str = "<br>".join(calls)
        
    md.append(f"| `{sym}` | `{prop}` | {definition} | {risk} | {call_str} |")

with open("table.md", "w", encoding="utf-8") as f:
    f.write("\n".join(md))
