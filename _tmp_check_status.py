import json
import urllib.request
from datetime import datetime, timezone

now = datetime.now(timezone.utc)
reports = json.load(urllib.request.urlopen("http://localhost:8000/api/projects/1/status-reports?limit=50"))
items = reports["items"] if isinstance(reports, dict) else reports
print("count", reports.get("total") if isinstance(reports, dict) else len(items))
for r in items:
    print("---")
    print("id", r.get("id"))
    print("created", r.get("created_at"))
    print("updated", r.get("updated_at"))
    print("body", (r.get("body") or "")[:800])

data = json.load(urllib.request.urlopen("http://localhost:8000/api/projects/report"))
print("\n=== ALL PROJECT STATUS AGES ===")


def age(at):
    if not at:
        return None
    s = at.replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return round((now - dt).total_seconds() / 86400, 2)


for g in data.get("groups", []):
    for p in g.get("projects", []):
        print(
            g["name"],
            "|",
            p["name"],
            "|",
            p.get("latest_status_at"),
            "| age=",
            age(p.get("latest_status_at")),
        )
        for s in p.get("sub_projects") or []:
            print(
                "  sub",
                s["name"],
                "|",
                s.get("latest_status_at"),
                "| age=",
                age(s.get("latest_status_at")),
            )
