from __future__ import annotations

import asyncio
import json

import test_app  # noqa: F401
from test_app import client  # noqa: F401
from app.services.realtime import DashboardRealtimeHub, DashboardRevisionEvent


def test_dashboard_revision_event_parses_valid_payload():
    event = DashboardRevisionEvent.from_payload(json.dumps({
        "org_id": "org-1",
        "changed": ["queue", "check_ins"],
        "queue_revision": "12",
        "check_in_revision": "8",
        "billing_patients_revision": "4",
        "billing_invoices_revision": "2",
    }))

    assert event is not None
    assert event.org_id == "org-1"
    assert event.changed == ("queue", "check_ins")
    assert event.to_sse_payload() == {
        "org_id": "org-1",
        "changed": ["queue", "check_ins"],
        "queue_revision": "12",
        "check_in_revision": "8",
        "billing_patients_revision": "4",
        "billing_invoices_revision": "2",
    }


def test_dashboard_revision_event_ignores_invalid_payloads():
    assert DashboardRevisionEvent.from_payload("not-json") is None
    assert DashboardRevisionEvent.from_payload(json.dumps({"org_id": "org-1"})) is None
    assert DashboardRevisionEvent.from_payload(json.dumps({"org_id": "org-1", "changed": []})) is None


def test_dashboard_realtime_hub_filters_by_org():
    async def run() -> None:
        hub = DashboardRealtimeHub()
        org_1 = await hub.subscribe("org-1")
        org_2 = await hub.subscribe("org-2")
        event = DashboardRevisionEvent(
            org_id="org-1",
            changed=("queue",),
            queue_revision="2",
            check_in_revision="0",
            billing_patients_revision="0",
            billing_invoices_revision="0",
        )

        await hub.publish(event)

        assert await asyncio.wait_for(org_1.queue.get(), timeout=0.1) == event
        assert org_2.queue.empty()
        await hub.unsubscribe(org_1)
        await hub.unsubscribe(org_2)
        assert hub.active_connections == 0

    asyncio.run(run())


def test_dashboard_events_requires_authentication(client):
    test_client, _repo = client
    response = test_client.get("/dashboard/events")
    assert response.status_code == 401
