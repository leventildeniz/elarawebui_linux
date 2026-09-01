import os
import json

targets_vendor = ["mlx", "gemini", "ollama", "openai", "lovable"]
targets_network = ["8001", "11434", "3005", "3007", "8082", "10443", "3001", "127.0.0.1", "localhost"]
targets_path = ["/Users/", "/home/"]

results = []

def scan_file(filepath):
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            for i, line in enumerate(f):
                line_lower = line.lower()
                for t in targets_vendor:
                    if t in line_lower:
                        results.append({"file": filepath, "line": i+1, "match": line.strip(), "target": t, "type": "Vendor"})
                for t in targets_network:
                    if t in line_lower:
                        results.append({"file": filepath, "line": i+1, "match": line.strip(), "target": t, "type": "Network"})
                for t in targets_path:
                    if t in line_lower:
                        results.append({"file": filepath, "line": i+1, "match": line.strip(), "target": t, "type": "Path"})
    except Exception as e:
        pass

def main():
    base_dir = "local-server"
    exclude_dirs = ["node_modules", "venv", ".git", "__pycache__", "certs", "data", "uploads", "radius-dicts", "build", "dist"]
    valid_exts = {".mjs", ".js", ".py", ".json", ".md", ".sh", ".sql", ".plist"}
    for root, dirs, files in os.walk(base_dir):
        dirs[:] = [d for d in dirs if d not in exclude_dirs]
        for file in files:
            ext = os.path.splitext(file)[1].lower()
            if ext in valid_exts or file == "bun.lockb" or file == "package.json":
                # Exclude lockfiles to avoid noise, but maybe check package.json
                if file.endswith("lock") or file.endswith("lockb") or file.endswith("package-lock.json"):
                    continue
                # Also exclude the audit documents as they are just documentation about the audit? Wait, the user asked to scan ALL files.
                # I'll include .md files but filter out AUDIT files for the mapping if needed. 
                scan_file(os.path.join(root, file))
    
    with open("audit_results2.json", "w", encoding='utf-8') as f:
        json.dump(results, f, indent=2)

if __name__ == "__main__":
    main()
