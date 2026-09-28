from app.models import Resource


def create_root(client, **overrides):
    payload = {
        "name": "Alpha Project",
        "description": "Main effort",
        "group_name": "Platform",
    }
    payload.update(overrides)
    return client.post("/api/projects", json=payload)


def test_create_root_requires_group(client):
    resp = client.post(
        "/api/projects",
        json={"name": "Ungrouped", "description": "No group"},
    )
    assert resp.status_code == 422
    blank = client.post(
        "/api/projects",
        json={"name": "Ungrouped", "group_name": "   "},
    )
    assert blank.status_code == 422
    assert client.get("/api/groups").json() == []


def test_create_root_and_group(client):
    resp = create_root(client)
    assert resp.status_code == 201
    body = resp.json()
    assert body["is_root"] is True
    assert body["group_name"] == "Platform"

    groups = client.get("/api/groups").json()
    assert len(groups) == 1
    assert groups[0]["project_count"] == 1


def test_group_reuse_case_insensitive(client):
    create_root(client, group_name="Platform")
    resp = create_root(client, name="Beta", group_name="platform")
    assert resp.status_code == 201
    groups = client.get("/api/groups").json()
    assert len(groups) == 1


def test_search_by_group_name(client):
    create_root(client, name="Find Me", group_name="UniqueGroup")
    resp = client.get("/api/projects", params={"q": "uniquegroup"})
    assert resp.status_code == 200
    assert resp.json()["total"] >= 1


def test_sub_project_cannot_have_sub_project(client):
    root = create_root(client).json()
    sub = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Sub A"},
    ).json()
    nested = client.post(
        f"/api/projects/{sub['id']}/sub-projects",
        json={"name": "Nested"},
    )
    assert nested.status_code == 422


def test_move_sub_project_to_another_root(client):
    source = create_root(client, name="Source", group_name="Platform").json()
    dest = create_root(client, name="Dest", group_name="Other").json()
    sub = client.post(
        f"/api/projects/{source['id']}/sub-projects",
        json={"name": "Piece"},
    ).json()

    moved = client.post(
        f"/api/projects/{sub['id']}/move",
        json={"parent_id": dest["id"]},
    )
    assert moved.status_code == 200
    body = moved.json()
    assert body["parent_id"] == dest["id"]
    assert body["parent_name"] == "Dest"
    assert body["root_project_id"] == dest["id"]
    assert body["group_name"] == "Other"

    assert client.get(f"/api/projects/{source['id']}").json()["sub_projects"] == []
    dest_subs = client.get(f"/api/projects/{dest['id']}").json()["sub_projects"]
    assert [item["id"] for item in dest_subs] == [sub["id"]]

    same = client.post(
        f"/api/projects/{sub['id']}/move",
        json={"parent_id": dest["id"]},
    )
    assert same.status_code == 422

    root_move = client.post(
        f"/api/projects/{source['id']}/move",
        json={"parent_id": dest["id"]},
    )
    assert root_move.status_code == 422

    holder = client.post(
        f"/api/projects/{dest['id']}/sub-projects",
        json={"name": "Holder"},
    ).json()
    onto_sub = client.post(
        f"/api/projects/{sub['id']}/move",
        json={"parent_id": holder["id"]},
    )
    assert onto_sub.status_code == 422


def test_sub_project_inherits_group(client):
    root = create_root(client).json()
    sub = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Sub A", "description": "child"},
    )
    assert sub.status_code == 201
    sub_body = sub.json()
    assert sub_body["is_root"] is False
    assert sub_body["group_name"] == "Platform"

    bad = client.patch(
        f"/api/projects/{sub_body['id']}",
        json={"group_name": "Other"},
    )
    assert bad.status_code == 422


def test_change_group_deletes_empty(client):
    root = create_root(client, group_name="OldGroup").json()
    client.patch(
        f"/api/projects/{root['id']}",
        json={"group_name": "NewGroup"},
    )
    groups = {g["name"] for g in client.get("/api/groups").json()}
    assert "OldGroup" not in groups
    assert "NewGroup" in groups


def test_delete_root_removes_group_and_subtree(client):
    root = create_root(client, group_name="TempGroup").json()
    sub = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Sub"},
    ).json()
    assert client.delete(f"/api/projects/{root['id']}").status_code == 204
    assert client.get(f"/api/projects/{sub['id']}").status_code == 404
    assert client.get("/api/groups").json() == []


def test_resources_on_project(client, db_session):
    root = create_root(client).json()
    db_session.add(
        Resource(
            name="Dev",
            role="software_engineer",
            email="dev@example.com",
        )
    )
    db_session.commit()

    attach = client.post(
        f"/api/projects/{root['id']}/resources",
        json={"resource_id": 1, "utilization_percent": 60},
    )
    assert attach.status_code == 201
    dup = client.post(
        f"/api/projects/{root['id']}/resources",
        json={"resource_id": 1, "utilization_percent": 80},
    )
    assert dup.status_code == 200

    detail = client.get(f"/api/projects/{root['id']}").json()
    assert len(detail["resources"]) == 1
    assert detail["resources"][0]["utilization_percent"] == 80
    assert detail["resources"][0]["project_role"] == "member"
    assert detail["resources"][0]["onboarded"] is False

    patch = client.patch(
        f"/api/projects/{root['id']}/resources/1",
        json={"utilization_percent": 50, "project_role": "rtl_engineer"},
    )
    assert patch.status_code == 200
    assert patch.json()["utilization_percent"] == 50
    assert patch.json()["project_role"] == "rtl_engineer"

    role_only = client.patch(
        f"/api/projects/{root['id']}/resources/1",
        json={"project_role": "firmware_engineer"},
    )
    assert role_only.status_code == 200
    assert role_only.json()["utilization_percent"] == 50
    assert role_only.json()["project_role"] == "firmware_engineer"
    assert role_only.json()["onboarded"] is False

    onboarded = client.patch(
        f"/api/projects/{root['id']}/resources/1",
        json={"onboarded": True},
    )
    assert onboarded.status_code == 200
    assert onboarded.json()["onboarded"] is True
    assert onboarded.json()["utilization_percent"] == 50

    cleared = client.post(
        f"/api/projects/{root['id']}/resources",
        json={"resource_id": 1, "onboarded": False},
    )
    assert cleared.status_code == 200
    assert client.get(f"/api/projects/{root['id']}").json()["resources"][0]["onboarded"] is False

    bad = client.patch(
        f"/api/projects/{root['id']}/resources/1",
        json={"utilization_percent": 101},
    )
    assert bad.status_code == 422

    unknown_role = client.post(
        f"/api/projects/{root['id']}/resources",
        json={"resource_id": 1, "project_role": "manager"},
    )
    assert unknown_role.status_code == 422

    assert client.delete(f"/api/projects/{root['id']}/resources/1").status_code == 204


def test_root_people_count_includes_sub_projects(client, db_session):
    root = create_root(client).json()
    sub = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Child"},
    ).json()
    db_session.add_all(
        [
            Resource(name="Dev", role="software_engineer", email="dev@example.com"),
            Resource(name="Lead", role="lead", email="lead@example.com"),
        ]
    )
    db_session.commit()
    assert (
        client.post(
            f"/api/projects/{root['id']}/resources",
            json={"resource_id": 1, "utilization_percent": 50},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{sub['id']}/resources",
            json={"resource_id": 2, "utilization_percent": 25},
        ).status_code
        == 201
    )

    listed = client.get("/api/projects", params={"roots_only": True}).json()
    match = next(item for item in listed["items"] if item["id"] == root["id"])
    assert match["resource_count"] == 2
    assert match["sub_projects"][0]["resource_count"] == 1

    detail = client.get(f"/api/projects/{root['id']}").json()
    assert detail["sub_projects"][0]["resource_count"] == 1


def test_duplicate_resources_across_project_and_subprojects(client, db_session):
    root = create_root(client).json()
    design = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Design"},
    ).json()
    qa = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "QA"},
    ).json()
    db_session.add_all(
        [
            Resource(name="Ada", role="software_engineer", email="ada@example.com"),
            Resource(name="Bea", role="lead", email="bea@example.com"),
        ]
    )
    db_session.commit()
    assert (
        client.post(
            f"/api/projects/{root['id']}/resources",
            json={"resource_id": 1, "utilization_percent": 40},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{design['id']}/resources",
            json={"resource_id": 1, "utilization_percent": 20},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{qa['id']}/resources",
            json={"resource_id": 2, "utilization_percent": 30},
        ).status_code
        == 201
    )

    listed = client.get("/api/projects", params={"roots_only": True}).json()
    match = next(item for item in listed["items"] if item["id"] == root["id"])
    assert match["duplicate_resources"] == [{"id": 1, "name": "Ada"}]
    assert match["resource_count"] == 2

    shared_only_on_subs = client.post("/api/projects", json={
        "name": "Beta",
        "group_name": "Platform",
    }).json()
    left = client.post(
        f"/api/projects/{shared_only_on_subs['id']}/sub-projects",
        json={"name": "Left"},
    ).json()
    right = client.post(
        f"/api/projects/{shared_only_on_subs['id']}/sub-projects",
        json={"name": "Right"},
    ).json()
    assert (
        client.post(
            f"/api/projects/{left['id']}/resources",
            json={"resource_id": 2},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{right['id']}/resources",
            json={"resource_id": 2},
        ).status_code
        == 201
    )
    listed = client.get("/api/projects", params={"roots_only": True}).json()
    beta = next(item for item in listed["items"] if item["id"] == shared_only_on_subs["id"])
    assert beta["duplicate_resources"] == [{"id": 2, "name": "Bea"}]
    assert beta["resource_count"] == 1


def test_project_status_defaults_and_updates(client):
    created = create_root(client).json()
    assert created["status"] == "assessment"
    patched = client.patch(
        f"/api/projects/{created['id']}",
        json={"status": "closing"},
    )
    assert patched.status_code == 200
    assert patched.json()["status"] == "closing"
    invalid = client.patch(
        f"/api/projects/{created['id']}",
        json={"status": "paused"},
    )
    assert invalid.status_code == 422


def test_status_report_custom_created_at(client):
    root = create_root(client).json()
    created = client.post(
        f"/api/projects/{root['id']}/status-reports",
        json={"body": "Backdated", "created_at": "2026-01-15T08:30:00Z"},
    )
    assert created.status_code == 201
    assert created.json()["created_at"].startswith("2026-01-15T08:30:00")


def test_update_status_report_body_and_created_at(client):
    root = create_root(client).json()
    created = client.post(
        f"/api/projects/{root['id']}/status-reports",
        json={"body": "Original", "created_at": "2026-01-15T08:30:00Z"},
    )
    assert created.status_code == 201
    report_id = created.json()["id"]

    updated = client.patch(
        f"/api/projects/{root['id']}/status-reports/{report_id}",
        json={"body": "  Corrected note  ", "created_at": "2026-02-01T09:00:00Z"},
    )
    assert updated.status_code == 200
    assert updated.json()["body"] == "Corrected note"
    assert updated.json()["created_at"].startswith("2026-02-01T09:00:00")

    body_only = client.patch(
        f"/api/projects/{root['id']}/status-reports/{report_id}",
        json={"body": "Text only"},
    )
    assert body_only.status_code == 200
    assert body_only.json()["body"] == "Text only"
    assert body_only.json()["created_at"].startswith("2026-02-01T09:00:00")

    blank = client.patch(
        f"/api/projects/{root['id']}/status-reports/{report_id}",
        json={"body": "   "},
    )
    assert blank.status_code == 422


def test_status_reports_limit(client):
    root = create_root(client).json()
    for i in range(3):
        client.post(
            f"/api/projects/{root['id']}/status-reports",
            json={"body": f"Report {i}"},
        )
    listed = client.get(
        f"/api/projects/{root['id']}/status-reports",
        params={"limit": 2},
    ).json()
    assert listed["total"] == 3
    assert len(listed["items"]) == 2

    detail = client.get(
        f"/api/projects/{root['id']}",
        params={"recent_status_count": 2},
    ).json()
    assert len(detail["recent_status_reports"]) == 2


def test_group_icon_on_project_tile(client):
    from app.services.group_icons import ICON_DIR

    root = create_root(client, group_name="Altera").json()
    group = client.get("/api/groups").json()[0]
    assert group["icon_url"] is None

    png = (
        b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01"
        b"\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
        b"\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4"
        b"\x00\x00\x00\x00IEND\xaeB`\x82"
    )
    uploaded = client.post(
        f"/api/groups/{group['id']}/icon",
        files={"file": ("altera.png", png, "image/png")},
    )
    assert uploaded.status_code == 200
    filename = uploaded.json()["icon_url"].split("v=", 1)[1]
    icon_path = ICON_DIR / filename

    icon = client.get(f"/api/groups/{group['id']}/icon")
    assert icon.status_code == 200
    assert icon.content == png

    listed = client.get("/api/projects", params={"roots_only": True}).json()
    match = next(item for item in listed["items"] if item["id"] == root["id"])
    assert match["group_name"] == "Altera"
    assert match["group_icon_url"]

    rejected = client.post(
        f"/api/groups/{group['id']}/icon",
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )
    assert rejected.status_code == 400

    assert client.delete(f"/api/projects/{root['id']}").status_code == 204
    assert not icon_path.exists()


def test_rename_group(client):
    create_root(client, name="One", group_name="Altera")
    create_root(client, name="Two", group_name="Arm")
    groups = {group["name"]: group for group in client.get("/api/groups").json()}

    renamed = client.patch(f"/api/groups/{groups['Altera']['id']}", json={"name": "Intel"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Intel"

    listed = client.get("/api/projects", params={"roots_only": True}).json()
    names = {item["name"]: item["group_name"] for item in listed["items"]}
    assert names["One"] == "Intel"
    assert names["Two"] == "Arm"

    conflict = client.patch(f"/api/groups/{groups['Altera']['id']}", json={"name": "arm"})
    assert conflict.status_code == 409
    blank = client.patch(f"/api/groups/{groups['Altera']['id']}", json={"name": "  "})
    assert blank.status_code == 422


def test_export_projects_jsonl(client, db_session):
    import json

    alpha = create_root(client, name="Alpha", group_name="Platform").json()
    beta = create_root(client, name="Beta", group_name="Other").json()
    sub = client.post(
        f"/api/projects/{alpha['id']}/sub-projects",
        json={"name": "Child", "description": "nested"},
    ).json()
    db_session.add(Resource(name="Dev", role="software_engineer", email="dev@example.com"))
    db_session.commit()
    assert (
        client.post(
            f"/api/projects/{alpha['id']}/resources",
            json={"resource_id": 1, "utilization_percent": 40, "project_role": "lead"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{sub['id']}/resources",
            json={"resource_id": 1, "utilization_percent": 20, "project_role": "dv_engineer"},
        ).status_code
        == 201
    )
    for index in range(4):
        assert (
            client.post(
                f"/api/projects/{alpha['id']}/status-reports",
                json={"body": f"Alpha report {index}"},
            ).status_code
            == 201
        )
    assert (
        client.post(
            f"/api/projects/{sub['id']}/status-reports",
            json={"body": "Child report"},
        ).status_code
        == 201
    )

    exported = client.get(
        "/api/projects/export",
        params={"group_id": alpha["group_id"], "reports": 2},
    )
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/jsonl")
    lines = [json.loads(line) for line in exported.text.splitlines() if line.strip()]
    assert [item["name"] for item in lines] == ["Alpha"]
    alpha_row = lines[0]
    assert alpha_row["group_name"] == "Platform"
    assert alpha_row["status_report_count"] == 4
    assert [report["body"] for report in alpha_row["status_reports"]] == [
        "Alpha report 3",
        "Alpha report 2",
    ]
    assert alpha_row["resources"][0]["project_role"] == "lead"
    assert alpha_row["resources"][0]["resource"]["email"] == "dev@example.com"
    assert alpha_row["resources"][0]["utilization_percent"] == 40
    assert alpha_row["sub_projects"][0]["name"] == "Child"
    assert alpha_row["sub_projects"][0]["description"] == "nested"
    assert alpha_row["sub_projects"][0]["resources"][0]["project_role"] == "dv_engineer"
    assert alpha_row["sub_projects"][0]["status_reports"][0]["body"] == "Child report"

    defaults = client.get("/api/projects/export", params={"q": "Alpha"})
    default_row = json.loads(defaults.text.strip())
    assert len(default_row["status_reports"]) == 3
    assert default_row["status_reports"][0]["body"] == "Alpha report 3"

    none = client.get("/api/projects/export", params={"q": "Alpha", "reports": 0})
    none_row = json.loads(none.text.strip())
    assert none_row["status_reports"] == []
    assert none_row["status_report_count"] == 4
    assert none_row["sub_projects"][0]["status_reports"] == []

    both = client.get("/api/projects/export")
    names = [json.loads(line)["name"] for line in both.text.splitlines() if line.strip()]
    assert names == ["Alpha", "Beta"]
    assert beta["id"]


def test_roots_are_ordered_by_last_activity(client):
    older = create_root(client, name="Older", group_name="Platform").json()
    newer = create_root(client, name="Newer", group_name="Platform").json()

    report = client.post(
        f"/api/projects/{older['id']}/status-reports",
        json={"body": "Shipped the latest build"},
    )
    assert report.status_code == 201

    listed = client.get("/api/projects", params={"roots_only": True}).json()
    names = [item["name"] for item in listed["items"]]
    assert names.index("Older") < names.index("Newer")
    older_item = next(item for item in listed["items"] if item["id"] == older["id"])
    newer_item = next(item for item in listed["items"] if item["id"] == newer["id"])
    assert older_item["updated_at"] >= newer_item["updated_at"]


def test_project_report_includes_description_and_latest_status(client):
    root = create_root(
        client, name="Agilex demo", description="Sensor bridge", group_name="Physical AI"
    ).json()
    sub = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Driver", "description": "Unassigned software"},
    ).json()
    assert (
        client.post(
            f"/api/projects/{root['id']}/status-reports",
            json={"body": "Earlier note"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{root['id']}/status-reports",
            json={"body": "Goal achieved — cleanup in progress."},
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{sub['id']}/status-reports",
            json={"body": "Software resource still unassigned."},
        ).status_code
        == 201
    )

    report = client.get("/api/projects/report")
    assert report.status_code == 200
    groups = report.json()["groups"]
    assert [group["name"] for group in groups] == ["Physical AI"]
    project = groups[0]["projects"][0]
    assert project["description"] == "Sensor bridge"
    assert project["latest_status"] == "Goal achieved — cleanup in progress."
    assert project["latest_status_at"]
    assert project["sub_projects"][0]["description"] == "Unassigned software"
    assert project["sub_projects"][0]["latest_status"] == "Software resource still unassigned."
    assert project["sub_projects"][0]["latest_status_at"]


def test_project_report_includes_latest_status_time(client):
    root = create_root(client, name="Stale status", group_name="Platform").json()
    created = client.post(
        f"/api/projects/{root['id']}/status-reports",
        json={"body": "Old update", "created_at": "2026-01-01T12:00:00Z"},
    )
    assert created.status_code == 201

    report = client.get("/api/projects/report")
    assert report.status_code == 200
    project = report.json()["groups"][0]["projects"][0]
    assert project["latest_status"] == "Old update"
    assert project["latest_status_at"].startswith("2026-01-01T12:00:00")


def test_sub_project_summary_includes_latest_report_at(client):
    root = create_root(client, name="Parent", group_name="Platform").json()
    reported = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Reported"},
    ).json()
    client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Silent"},
    )
    created = client.post(
        f"/api/projects/{reported['id']}/status-reports",
        json={"body": "Filed on the first", "created_at": "2026-09-01T22:30:00Z"},
    )
    assert created.status_code == 201

    listed = client.get("/api/projects", params={"roots_only": True}).json()
    subs = {item["name"]: item for item in listed["items"][0]["sub_projects"]}
    assert subs["Reported"]["latest_report_at"].startswith("2026-09-01T22:30:00")
    assert subs["Silent"]["latest_report_at"] is None


def test_reports_with_pmo_is_independent_per_row(client):
    import json

    root = create_root(client, name="Outside PMO", group_name="Platform").json()
    sub = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Tracked elsewhere"},
    ).json()

    root_detail = client.get(f"/api/projects/{root['id']}")
    assert root_detail.status_code == 200
    assert root_detail.json()["reports_with_pmo"] is True

    root_off = client.patch(
        f"/api/projects/{root['id']}",
        json={"reports_with_pmo": False},
    )
    sub_off = client.patch(
        f"/api/projects/{sub['id']}",
        json={"reports_with_pmo": False},
    )
    assert root_off.status_code == 200
    assert sub_off.status_code == 200
    assert client.get(f"/api/projects/{root['id']}").json()["reports_with_pmo"] is False
    assert client.get(f"/api/projects/{sub['id']}").json()["reports_with_pmo"] is False

    listed = client.get("/api/projects", params={"roots_only": True, "q": "Outside PMO"}).json()
    tile = next(item for item in listed["items"] if item["id"] == root["id"])
    assert tile["sub_projects"][0]["reports_with_pmo"] is False

    report = client.get("/api/projects/report")
    assert report.status_code == 200
    project = report.json()["groups"][0]["projects"][0]
    assert project["id"] == root["id"]
    assert project["reports_with_pmo"] is False
    assert project["sub_projects"][0]["id"] == sub["id"]
    assert project["sub_projects"][0]["reports_with_pmo"] is False

    exported = client.get("/api/projects/export", params={"q": "Outside PMO", "reports": 0})
    assert exported.status_code == 200
    row = next(json.loads(line) for line in exported.text.splitlines() if line.strip())
    assert row["reports_with_pmo"] is False
    assert row["sub_projects"][0]["reports_with_pmo"] is False
