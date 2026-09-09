#!/usr/bin/env python3
# @tool: dependency-checker
# @description: Checks for existence of a python module and provides installation commands.
# @args: {"module_name": "string", "package_name": "string"}
import sys, json, importlib.util

def check_dependency(module_name, package_name):
    spec = importlib.util.find_spec(module_name)
    if spec is None:
        return {
            "status": "missing",
            "module": module_name,
            "package": package_name,
            "fix_command": f"{sys.executable} -m pip install {package_name}",
            "action_required": True
        }
    return {
        "status": "installed",
        "module": module_name,
        "action_required": False
    }

if __name__ == "__main__":
    try:
        import sys
        input_data = json.loads(sys.argv[1] if len(sys.argv) > 1 else sys.stdin.read())
        result = check_dependency(input_data.get('module_name'), input_data.get('package_name'))
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))