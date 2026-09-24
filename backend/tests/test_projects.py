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
