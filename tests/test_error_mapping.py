from __future__ import annotations

from test_app import auth_headers_for_token, client, register_test_clinic


def test_unexpected_route_errors_return_generic_500(client):
    test_client, repo = client
    session = register_test_clinic(test_client, identifier="errors@clinic.com", clinic_name="Errors Clinic")

    async def broken_list_patients(_org_id: str):
        raise RuntimeError("supabase credentials exploded")

    repo.list_patients = broken_list_patients

    response = test_client.get("/patients", headers=auth_headers_for_token(session["token"]))

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error."}
