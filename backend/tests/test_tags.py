def test_tags_are_created_deduped_and_listed(client):
    root = client.post(
        "/api/projects",
        json={"name": "Alpha", "group_name": "Platform", "tags": ["FPGA", " fpga ", "Demo"]},
    )
    assert root.status_code == 201
    assert [tag["name"] for tag in root.json()["tags"]] == ["Demo", "FPGA"]

    tags = client.get("/api/tags").json()
    assert [tag["name"] for tag in tags] == ["Demo", "FPGA"]
    assert all(tag["project_count"] == 1 for tag in tags)


def test_filter_root_by_its_tag_and_by_subproject_tag(client):
    alpha = client.post(
        "/api/projects",
        json={"name": "Alpha", "group_name": "Platform", "tags": ["silicon"]},
    ).json()
    beta = client.post(
        "/api/projects",
        json={"name": "Beta", "group_name": "Platform"},
    ).json()
    child = client.post(
        f"/api/projects/{beta['id']}/sub-projects",
        json={"name": "Child", "tags": ["rtl"]},
    )
    assert child.status_code == 201
    assert child.json()["tags"][0]["name"] == "rtl"

    tags = {tag["name"]: tag for tag in client.get("/api/tags").json()}
    silicon = client.get(
        "/api/projects", params={"roots_only": True, "tag_id": tags["silicon"]["id"]}
    ).json()
    assert [item["name"] for item in silicon["items"]] == ["Alpha"]

    rtl = client.get(
        "/api/projects", params={"roots_only": True, "tag_id": tags["rtl"]["id"]}
    ).json()
    assert [item["name"] for item in rtl["items"]] == ["Beta"]
    assert rtl["items"][0]["sub_projects"][0]["tags"][0]["name"] == "rtl"
    assert rtl["items"][0]["id"] == beta["id"]
    assert alpha["id"] != beta["id"]


def test_tag_filter_combines_with_group_and_search(client):
    client.post(
        "/api/projects",
        json={"name": "Alpha", "group_name": "Platform", "tags": ["shared"]},
    )
    client.post(
        "/api/projects",
        json={"name": "Beta", "group_name": "Other", "tags": ["shared"]},
    )
    tags = {tag["name"]: tag for tag in client.get("/api/tags").json()}
    groups = {group["name"]: group for group in client.get("/api/groups").json()}

    listed = client.get(
        "/api/projects",
        params={
            "roots_only": True,
            "tag_id": tags["shared"]["id"],
            "group_id": groups["Platform"]["id"],
        },
    ).json()
    assert [item["name"] for item in listed["items"]] == ["Alpha"]

    found = client.get("/api/projects", params={"q": "shared", "roots_only": True}).json()
    assert {item["name"] for item in found["items"]} == {"Alpha", "Beta"}


def test_status_patch_keeps_tags_and_clearing_removes_unused(client):
    root = client.post(
        "/api/projects",
        json={"name": "Alpha", "group_name": "Platform", "tags": ["keep-me"]},
    ).json()
    patched = client.patch(f"/api/projects/{root['id']}", json={"status": "in_progress"})
    assert patched.status_code == 200
    assert patched.json()["tags"][0]["name"] == "keep-me"
    assert patched.json()["status"] == "in_progress"

    other = client.post(
        "/api/projects",
        json={"name": "Beta", "group_name": "Platform", "tags": ["keep-me", "only-beta"]},
    ).json()
    cleared = client.patch(f"/api/projects/{other['id']}", json={"tags": []})
    assert cleared.json()["tags"] == []
    names = {tag["name"] for tag in client.get("/api/tags").json()}
    assert names == {"keep-me"}
    assert client.get("/api/tags").json()[0]["project_count"] == 1


def test_reuses_tag_ignoring_case_and_rejects_long_names(client):
    first = client.post(
        "/api/projects",
        json={"name": "Alpha", "group_name": "Platform", "tags": ["FPGA"]},
    ).json()
    second = client.patch(
        f"/api/projects/{client.post('/api/projects', json={'name': 'Beta', 'group_name': 'Other'}).json()['id']}",
        json={"tags": ["fpga"]},
    ).json()
    assert second["tags"][0]["id"] == first["tags"][0]["id"]
    assert len(client.get("/api/tags").json()) == 1

    too_long = client.patch(
        f"/api/projects/{first['id']}",
        json={"tags": ["x" * 65]},
    )
    assert too_long.status_code == 422


def test_delete_project_removes_unused_tag(client):
    root = client.post(
        "/api/projects",
        json={"name": "Alpha", "group_name": "Platform"},
    ).json()
    client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Child", "tags": ["temporary"]},
    )
    assert client.get("/api/tags").json()[0]["name"] == "temporary"
    deleted = client.delete(f"/api/projects/{root['id']}")
    assert deleted.status_code == 204
    assert client.get("/api/tags").json() == []


def test_report_and_export_include_tag_filter(client):
    root = client.post(
        "/api/projects",
        json={"name": "Alpha", "group_name": "Platform", "tags": ["export-me"]},
    ).json()
    client.post("/api/projects", json={"name": "Beta", "group_name": "Platform"})
    tag_id = client.get("/api/tags").json()[0]["id"]

    report = client.get("/api/projects/report", params={"tag_id": tag_id}).json()
    assert [group["projects"][0]["name"] for group in report["groups"]] == ["Alpha"]
    assert report["groups"][0]["projects"][0]["tags"] == ["export-me"]

    exported = client.get("/api/projects/export", params={"tag_id": tag_id, "reports": 0})
    assert exported.status_code == 200
    line = exported.text.strip()
    assert '"name":"Alpha"' in line or '"name": "Alpha"' in line
    assert "export-me" in line
    assert "Beta" not in line
    assert root["id"]
