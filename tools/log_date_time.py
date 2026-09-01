#!/usr/bin/env python3
import datetime
import json

now = datetime.datetime.now()
result = {
    "date": now.isoformat(),
    "local_time": now.strftime("%d.%m.%Y %H:%M:%S"),
    "timezone": str(now.astimezone().tzinfo)
}
print(json.dumps(result))
