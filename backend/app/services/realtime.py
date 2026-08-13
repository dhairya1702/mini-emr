from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from dataclasses import dataclass
from typing import Any

import psycopg


logger = logging.getLogger(__name__)

DASHBOARD_REVISIONS_CHANNEL = "clinic_dashboard_revisions"
HEARTBEAT_SECONDS = 20.0
SUBSCRIBER_QUEUE_SIZE = 8


@dataclass(frozen=True)
class DashboardRevisionEvent:
    org_id: str
    changed: tuple[str, ...]
    queue_revision: str
    check_in_revision: str
    billing_patients_revision: str
    billing_invoices_revision: str

    @classmethod
    def from_payload(cls, payload: str) -> "DashboardRevisionEvent | None":
        try:
            raw = json.loads(payload)
        except json.JSONDecodeError:
            logger.warning("Ignoring malformed realtime payload.")
            return None

        org_id = str(raw.get("org_id") or "").strip()
        changed_raw = raw.get("changed")
        if not org_id or not isinstance(changed_raw, list):
            logger.warning("Ignoring incomplete realtime payload.")
            return None

        changed = tuple(
            str(item).strip()
            for item in changed_raw
            if str(item or "").strip()
        )
        if not changed:
            return None

        return cls(
            org_id=org_id,
            changed=changed,
            queue_revision=str(raw.get("queue_revision") or "0"),
            check_in_revision=str(raw.get("check_in_revision") or "0"),
            billing_patients_revision=str(raw.get("billing_patients_revision") or "0"),
            billing_invoices_revision=str(raw.get("billing_invoices_revision") or "0"),
        )

    def to_sse_payload(self) -> dict[str, Any]:
        return {
            "org_id": self.org_id,
            "changed": list(self.changed),
            "queue_revision": self.queue_revision,
            "check_in_revision": self.check_in_revision,
            "billing_patients_revision": self.billing_patients_revision,
            "billing_invoices_revision": self.billing_invoices_revision,
        }


@dataclass(frozen=True, eq=False)
class RealtimeSubscriber:
    org_id: str
    queue: asyncio.Queue[DashboardRevisionEvent]


class DashboardRealtimeHub:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[RealtimeSubscriber]] = {}
        self._lock = asyncio.Lock()
        self.active_connections = 0
        self.dropped_events = 0

    async def subscribe(self, org_id: str) -> RealtimeSubscriber:
        subscriber = RealtimeSubscriber(
            org_id=org_id,
            queue=asyncio.Queue(maxsize=SUBSCRIBER_QUEUE_SIZE),
        )
        async with self._lock:
            self._subscribers.setdefault(org_id, set()).add(subscriber)
            self.active_connections += 1
            active = self.active_connections
        logger.info("SSE client connected for org %s; active=%s", org_id, active)
        return subscriber

    async def unsubscribe(self, subscriber: RealtimeSubscriber) -> None:
        async with self._lock:
            subscribers = self._subscribers.get(subscriber.org_id)
            if subscribers is not None:
                subscribers.discard(subscriber)
                if not subscribers:
                    self._subscribers.pop(subscriber.org_id, None)
            self.active_connections = max(0, self.active_connections - 1)
            active = self.active_connections
        logger.info("SSE client disconnected for org %s; active=%s", subscriber.org_id, active)

    async def publish(self, event: DashboardRevisionEvent) -> None:
        async with self._lock:
            subscribers = tuple(self._subscribers.get(event.org_id, ()))

        for subscriber in subscribers:
            if subscriber.queue.full():
                with suppress(asyncio.QueueEmpty):
                    subscriber.queue.get_nowait()
                self.dropped_events += 1
                logger.warning(
                    "Dropped stale SSE event for org %s; dropped=%s",
                    event.org_id,
                    self.dropped_events,
                )
            with suppress(asyncio.QueueFull):
                subscriber.queue.put_nowait(event)


def _wait_for_notification(connection: psycopg.Connection) -> Any | None:
    for notify in connection.notifies(timeout=5.0, stop_after=1):
        return notify
    return None


class PostgresDashboardNotificationListener:
    def __init__(self, database_url: str, hub: DashboardRealtimeHub) -> None:
        self.database_url = str(database_url or "").strip()
        self.hub = hub

    async def run(self, stop_event: asyncio.Event) -> None:
        backoff_seconds = 1.0
        while not stop_event.is_set():
            try:
                await self._listen_until_error(stop_event)
                backoff_seconds = 1.0
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Dashboard notification listener failed.")
                await asyncio.sleep(backoff_seconds)
                backoff_seconds = min(backoff_seconds * 2, 30.0)

    async def _listen_until_error(self, stop_event: asyncio.Event) -> None:
        if not self.database_url:
            logger.warning("Realtime listener disabled because DATABASE_URL is not configured.")
            await stop_event.wait()
            return

        connection = await asyncio.to_thread(
            psycopg.connect,
            self.database_url,
            autocommit=True,
        )
        try:
            await asyncio.to_thread(connection.execute, f"listen {DASHBOARD_REVISIONS_CHANNEL}")
            logger.info("Listening for dashboard notifications on %s.", DASHBOARD_REVISIONS_CHANNEL)
            while not stop_event.is_set():
                notify = await asyncio.to_thread(_wait_for_notification, connection)
                if notify is None:
                    continue
                event = DashboardRevisionEvent.from_payload(str(notify.payload or ""))
                if event is not None:
                    await self.hub.publish(event)
        finally:
            await asyncio.to_thread(connection.close)
