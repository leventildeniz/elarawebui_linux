import re

with open('local-server/worker.py', 'r') as f:
    lines = f.readlines()

new_lines = []
skip = False
for line in lines:
    if line.startswith("def graceful_suicide"):
        skip = True
    elif line.startswith("def _rss_watchdog_loop"):
        skip = True
    elif line.startswith("def _try_soft_relief"):
        skip = True
        
    if skip and line.strip() == "" and len(new_lines) > 0 and new_lines[-1].strip() == "":
        # We might have reached the end of the block. But to be safe:
        pass
        
    # Better approach: Just use string replacement for the exact lines
