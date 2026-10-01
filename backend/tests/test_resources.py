import io

from app.models import Resource


def create_resource(client, **overrides):
    payload = {
        "name": "Ada Lovelace",
        "role": "software_engineer",
        "email": "ada@example.com",
        "notes": "First programmer",
    }
    payload.update(overrides)
    return client.post("/api/resources", json=payload)


def test_create_and_get(client):
    response = create_resource(client)
    assert response.status_code == 201
    body = response.json()
    assert body["email"] == "ada@example.com"
    assert response.headers.get("location") == f"/api/resources/{body['id']}"

    get_resp = client.get(f"/api/resources/{body['id']}")
    assert get_resp.status_code == 200
    assert get_resp.json()["name"] == "Ada Lovelace"


def test_list_with_filters_and_pagination(client, db_session):
    for i, role in enumerate(["software_engineer", "hardware_engineer", "lead"]):
        db_session.add(
            Resource(
                name=f"Person {i}",
                role=role,
                email=f"person{i}@example.com",
            )
        )
    db_session.commit()

    all_resp = client.get("/api/resources")
    assert all_resp.status_code == 200
    assert all_resp.json()["total"] == 3
    assert all_resp.json()["role_counts"] == {
        "software_engineer": 1,
        "hardware_engineer": 1,
        "lead": 1,
    }

    role_resp = client.get("/api/resources", params={"role": "lead"})
    assert role_resp.status_code == 200
    assert role_resp.json()["total"] == 1
    assert role_resp.json()["role_counts"] == {"lead": 1}

    search_resp = client.get("/api/resources", params={"q": "person1"})
    assert search_resp.status_code == 200
    assert search_resp.json()["total"] == 1

    page_resp = client.get("/api/resources", params={"limit": 1, "offset": 1})
    assert page_resp.status_code == 200
    assert len(page_resp.json()["items"]) == 1
    assert page_resp.json()["role_counts"]["lead"] == 1


def test_list_resources_sorted_by_name(client):
    create_resource(client, name="zeta", email="zeta@example.com")
    create_resource(client, name="Alpha", email="alpha@example.com")
    create_resource(client, name="beta", email="beta@example.com")

    named = client.get("/api/resources", params={"sort": "name"}).json()
    assert [item["name"] for item in named["items"]] == ["Alpha", "beta", "zeta"]

    newest = client.get("/api/resources").json()
    assert newest["items"][0]["name"] == "beta"


def test_update_and_patch(client):
    created = create_resource(client).json()

    put_resp = client.put(
        f"/api/resources/{created['id']}",
        json={
            "name": "Ada L.",
            "role": "lead",
            "email": "ada.lead@example.com",
            "notes": None,
        },
    )
    assert put_resp.status_code == 200
    assert put_resp.json()["role"] == "lead"

    patch_resp = client.patch(
        f"/api/resources/{created['id']}",
        json={"notes": "Updated note"},
    )
    assert patch_resp.status_code == 200
    assert patch_resp.json()["notes"] == "Updated note"


def test_delete(client):
    created = create_resource(client).json()
    del_resp = client.delete(f"/api/resources/{created['id']}")
    assert del_resp.status_code == 204
    assert client.get(f"/api/resources/{created['id']}").status_code == 404


def test_delete_rejected_when_assigned(client):
    created = create_resource(client).json()
    root = client.post(
        "/api/projects",
        json={"name": "Alpha", "description": "Main", "group_name": "Platform"},
    ).json()
    sub = client.post(
        f"/api/projects/{root['id']}/sub-projects",
        json={"name": "Design"},
    ).json()
    for project_id in (root["id"], sub["id"]):
        attach = client.post(
            f"/api/projects/{project_id}/resources",
            json={"resource_id": created["id"]},
        )
        assert attach.status_code == 201

    del_resp = client.delete(f"/api/resources/{created['id']}")
    assert del_resp.status_code == 409
    assert del_resp.json()["detail"] == "Cannot delete Ada Lovelace. Assigned to: Alpha, Design (Alpha)"
    assert client.get(f"/api/resources/{created['id']}").status_code == 200


def test_not_found(client):
    assert client.get("/api/resources/9999").status_code == 404
    assert client.put("/api/resources/9999", json={}).status_code == 422
    assert client.delete("/api/resources/9999").status_code == 404


def test_duplicate_email_conflict(client):
    create_resource(client)
    dup = create_resource(client, email="ADA@example.com")
    assert dup.status_code == 409


def test_export_resources_name_and_email(client, db_session):
    import csv

    from app.models import Project, ProjectResource

    create_resource(client, name="Ada Lovelace", email="ada@example.com")
    create_resource(client, name='Grace "G" Hopper', email="grace@example.com", role="lead")
    project = Project(name="FilterProj", parent_id=None, group_id=None, root_project_id=1)
    db_session.add(project)
    db_session.flush()
    project.root_project_id = project.id
    db_session.add(
        ProjectResource(project_id=project.id, resource_id=1, utilization_percent=25)
    )
    db_session.commit()

    exported = client.get("/api/resources/export")
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("text/csv")
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert [row["name"] for row in rows] == ['Grace "G" Hopper', "Ada Lovelace"]
    assert [row["email"] for row in rows] == ["grace@example.com", "ada@example.com"]
    assert set(rows[0]) == {"name", "email"}

    searched = client.get("/api/resources/export", params={"q": "ada"})
    searched_rows = list(csv.DictReader(io.StringIO(searched.text)))
    assert [row["email"] for row in searched_rows] == ["ada@example.com"]

    leads = client.get("/api/resources/export", params={"role": "lead"})
    lead_rows = list(csv.DictReader(io.StringIO(leads.text)))
    assert [row["email"] for row in lead_rows] == ["grace@example.com"]

    on_project = client.get("/api/resources/export", params={"project_id": project.id})
    project_rows = list(csv.DictReader(io.StringIO(on_project.text)))
    assert [row["email"] for row in project_rows] == ["ada@example.com"]


def test_list_resources_by_project(client, db_session):
    from app.models import Project, ProjectResource

    create_resource(client, email="onproject@example.com")
    create_resource(client, name="Other", email="other@example.com")
    project = Project(name="FilterProj", parent_id=None, group_id=None, root_project_id=1)
    db_session.add(project)
    db_session.flush()
    project.root_project_id = project.id
    db_session.add(
        ProjectResource(project_id=project.id, resource_id=1, utilization_percent=25)
    )
    db_session.commit()

    filtered = client.get("/api/resources", params={"project_id": project.id}).json()
    assert filtered["total"] == 1
    assert filtered["items"][0]["email"] == "onproject@example.com"


def test_resource_project_utilization(client, db_session):
    from app.models import Group, Project, ProjectResource

    create_resource(client, email="util@example.com")
    group = Group(name="Eng")
    db_session.add(group)
    db_session.flush()
    project = Project(
        name="Apollo",
        parent_id=None,
        group_id=group.id,
        root_project_id=1,
    )
    db_session.add(project)
    db_session.flush()
    project.root_project_id = project.id
    db_session.add(
        ProjectResource(project_id=project.id, resource_id=1, utilization_percent=40)
    )
    db_session.commit()

    detail = client.get("/api/resources/1").json()
    assert detail["total_utilization_percent"] == 40
    assert len(detail["project_assignments"]) == 1
    assert detail["project_assignments"][0]["project_name"] == "Apollo"
    assert detail["project_assignments"][0]["utilization_percent"] == 40
    assert detail["project_assignments"][0]["project_role"] == "member"
    assert detail["project_assignments"][0]["onboarded"] is False


def test_over_utilized_resources(client, db_session):
    from app.models import Project, ProjectResource

    create_resource(client, email="over@example.com")
    create_resource(client, name="At Cap", email="cap@example.com")
    first = Project(name="Alpha", parent_id=None, group_id=None, root_project_id=1)
    second = Project(name="Beta", parent_id=None, group_id=None, root_project_id=1)
    db_session.add_all([first, second])
    db_session.flush()
    first.root_project_id = first.id
    second.root_project_id = second.id
    db_session.add_all(
        [
            ProjectResource(project_id=first.id, resource_id=1, utilization_percent=60),
            ProjectResource(project_id=second.id, resource_id=1, utilization_percent=50),
            ProjectResource(project_id=first.id, resource_id=2, utilization_percent=100),
        ]
    )
    db_session.commit()

    over = client.get("/api/resources", params={"over_utilized": True}).json()
    assert over["total"] == 1
    assert over["items"][0]["email"] == "over@example.com"
    assert over["items"][0]["total_utilization_percent"] == 110

    from sqlalchemy import select

    link = db_session.scalars(
        select(ProjectResource).where(
            ProjectResource.resource_id == 1,
            ProjectResource.project_id == second.id,
        )
    ).one()
    link.utilization_percent = 40
    db_session.commit()

    cleared = client.get("/api/resources", params={"over_utilized": True}).json()
    assert cleared["total"] == 0


def test_resource_report(client):
    ada = create_resource(
        client, name="Ada", email="ada@example.com", role="software_engineer"
    ).json()
    grace = create_resource(client, name="Grace", email="grace@example.com", role="lead").json()
    create_resource(client, name="Zoe", email="zoe@example.com", role="hardware_engineer")

    alpha = client.post(
        "/api/projects",
        json={"name": "Alpha", "description": "Main", "group_name": "Platform"},
    ).json()
    design = client.post(
        f"/api/projects/{alpha['id']}/sub-projects",
        json={"name": "Design"},
    ).json()
    beta = client.post(
        "/api/projects",
        json={"name": "Beta", "description": "Other", "group_name": "Tools"},
    ).json()
    assert (
        client.patch(f"/api/projects/{beta['id']}", json={"status": "completed"}).status_code
        == 200
    )

    assert (
        client.post(
            f"/api/projects/{alpha['id']}/resources",
            json={
                "resource_id": ada["id"],
                "utilization_percent": 60,
                "project_role": "lead",
                "onboarded": True,
            },
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{design['id']}/resources",
            json={
                "resource_id": ada["id"],
                "utilization_percent": 50,
                "project_role": "rtl_engineer",
            },
        ).status_code
        == 201
    )
    assert (
        client.post(
            f"/api/projects/{beta['id']}/resources",
            json={"resource_id": grace["id"], "utilization_percent": 100},
        ).status_code
        == 201
    )

    report = client.get("/api/resources/report")
    assert report.status_code == 200
    body = report.json()
    assert body["total"] == 3
    assert [item["name"] for item in body["items"]] == ["Ada", "Grace", "Zoe"]

    ada_row = body["items"][0]
    assert ada_row["total_utilization_percent"] == 110
    assert [assignment["project_name"] for assignment in ada_row["project_assignments"]] == [
        "Alpha",
        "Design",
    ]
    alpha_assignment = ada_row["project_assignments"][0]
    assert alpha_assignment["parent_name"] is None
    assert alpha_assignment["group_name"] == "Platform"
    assert alpha_assignment["utilization_percent"] == 60
    assert alpha_assignment["project_role"] == "lead"
    assert alpha_assignment["onboarded"] is True
    design_assignment = ada_row["project_assignments"][1]
    assert design_assignment["parent_name"] == "Alpha"
    assert design_assignment["group_name"] == "Platform"
    assert design_assignment["utilization_percent"] == 50
    assert design_assignment["project_role"] == "rtl_engineer"
    assert design_assignment["onboarded"] is False

    grace_row = body["items"][1]
    assert grace_row["total_utilization_percent"] == 100
    assert grace_row["project_assignments"][0]["project_name"] == "Beta"

    zoe_row = body["items"][2]
    assert zoe_row["total_utilization_percent"] == 0
    assert zoe_row["project_assignments"] == []

    by_role = client.get("/api/resources/report", params={"role": "lead"})
    assert [item["name"] for item in by_role.json()["items"]] == ["Grace"]

    by_search = client.get("/api/resources/report", params={"q": "ada@"})
    assert [item["name"] for item in by_search.json()["items"]] == ["Ada"]

    by_project = client.get("/api/resources/report", params={"project_id": design["id"]})
    assert by_project.json()["total"] == 1
    assert by_project.json()["items"][0]["name"] == "Ada"
    assert by_project.json()["items"][0]["total_utilization_percent"] == 110


def test_validation_errors(client):
    bad = client.post(
        "/api/resources",
        json={
            "name": " ",
            "role": "software_engineer",
            "email": "not-an-email",
        },
    )
    assert bad.status_code == 422


def test_import_csv(client):
    create_resource(client, email="existing@example.com")
    csv_content = (
        "name,role,email,notes\n"
        "New Person,Software engineer,new@example.com,note\n"
        "Dup,lead,existing@example.com,\n"
        "Bad Role,manager,bad@example.com,\n"
    )
    response = client.post(
        "/api/resources/import",
        files={"file": ("resources.csv", io.BytesIO(csv_content.encode()), "text/csv")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["created"] == 1
    assert body["skipped"] == 1
    assert len(body["errors"]) == 1


def test_import_template(client):
    response = client.get("/api/resources/import/template")
    assert response.status_code == 200
    assert response.text.startswith("name,role,email,notes,location")


def test_location_create_filter_and_import(client):
    created = create_resource(client, email="khi@example.com", location="khi")
    assert created.status_code == 201
    assert created.json()["location"] == "KHI"

    create_resource(client, email="lhr@example.com", location="LHR")
    assert client.get("/api/resources", params={"location": "KHI"}).json()["total"] == 1

    rejected = create_resource(client, email="dxb@example.com", location="DXB")
    assert rejected.status_code == 422

    csv_content = (
        "name,role,email,notes,location\n"
        "Islamabad,Software engineer,isb@example.com,,ISB\n"
        "Bad,Software engineer,badloc@example.com,,DXB\n"
    )
    imported = client.post(
        "/api/resources/import",
        files={"file": ("resources.csv", io.BytesIO(csv_content.encode()), "text/csv")},
    )
    assert imported.status_code == 200
    body = imported.json()
    assert body["created"] == 1
    assert len(body["errors"]) == 1
    listed = client.get("/api/resources", params={"location": "ISB"}).json()
    assert listed["total"] == 1
    assert listed["items"][0]["name"] == "Islamabad"


def test_roles_endpoint(client):
    response = client.get("/api/roles")
    assert response.status_code == 200
    codes = {item["code"] for item in response.json()}
    assert codes == {
        "software_engineer",
        "it_engineer",
        "hardware_engineer",
        "analog_design_engineer",
        "pd_engineer",
        "lead",
    }


def test_create_it_engineer(client):
    created = create_resource(
        client, name="Isha", email="isha@example.com", role="it_engineer"
    )
    assert created.status_code == 201
    assert created.json()["role"] == "it_engineer"

    imported = client.post(
        "/api/resources/import",
        files={
            "file": (
                "resources.csv",
                io.BytesIO(b"name,role,email,notes\nNia,IT engineer,nia@example.com,\n"),
                "text/csv",
            )
        },
    )
    assert imported.status_code == 200
    assert imported.json()["created"] == 1
    listed = client.get("/api/resources", params={"role": "it_engineer"}).json()
    assert {item["name"] for item in listed["items"]} == {"Isha", "Nia"}


def test_project_roles_endpoint(client):
    response = client.get("/api/project-roles")
    assert response.status_code == 200
    codes = [item["code"] for item in response.json()]
    assert codes == [
        "member",
        "lead",
        "director",
        "dv_engineer",
        "rtl_engineer",
        "software_engineer",
        "firmware_engineer",
    ]
