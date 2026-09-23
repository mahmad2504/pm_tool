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

    role_resp = client.get("/api/resources", params={"role": "lead"})
    assert role_resp.status_code == 200
    assert role_resp.json()["total"] == 1

    search_resp = client.get("/api/resources", params={"q": "person1"})
    assert search_resp.status_code == 200
    assert search_resp.json()["total"] == 1

    page_resp = client.get("/api/resources", params={"limit": 1, "offset": 1})
    assert page_resp.status_code == 200
    assert len(page_resp.json()["items"]) == 1


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


def test_not_found(client):
    assert client.get("/api/resources/9999").status_code == 404
    assert client.put("/api/resources/9999", json={}).status_code == 422
    assert client.delete("/api/resources/9999").status_code == 404


def test_duplicate_email_conflict(client):
    create_resource(client)
    dup = create_resource(client, email="ADA@example.com")
    assert dup.status_code == 409


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
    assert response.text.startswith("name,role,email,notes")


def test_roles_endpoint(client):
    response = client.get("/api/roles")
    assert response.status_code == 200
    codes = {item["code"] for item in response.json()}
    assert codes == {"software_engineer", "hardware_engineer", "lead"}
