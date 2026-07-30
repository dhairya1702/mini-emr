from __future__ import annotations

import asyncio
from datetime import UTC, datetime

from test_app import client  # noqa: F401

from app.services.request_metrics import RequestMetricsBuffer


def test_api_requests_are_buffered_without_a_database_metric_write(client):
    test_client, repository = client

    assert test_client.get("/health/live").status_code == 200
    assert test_client.get("/auth/registration-config").status_code == 200

    assert repository.api_request_metrics == []
    assert test_client.app.state.request_metrics.pending_request_count == 1


class RecordingRepository:
    def __init__(self) -> None:
        self.batches: list[list[dict[str, str | int]]] = []

    async def record_api_request_batch(self, rows: list[dict[str, str | int]]) -> None:
        self.batches.append(rows)


def test_request_metrics_buffer_aggregates_by_date_and_organization():
    repository = RecordingRepository()
    now = datetime(2026, 7, 30, 23, 59, tzinfo=UTC)
    buffer = RequestMetricsBuffer(lambda: repository, clock=lambda: now)

    buffer.record(org_id="org-1", status_code=200)
    buffer.record(org_id="org-1", status_code=503)
    buffer.record(org_id=None, status_code=404)

    assert buffer.pending_request_count == 3
    assert asyncio.run(buffer.flush()) is True
    assert buffer.pending_request_count == 0
    assert repository.batches == [
        [
            {
                "metric_date": "2026-07-30",
                "org_id": "org-1",
                "request_count": 2,
                "error_response_count": 1,
            },
            {
                "metric_date": "2026-07-30",
                "org_id": "",
                "request_count": 1,
                "error_response_count": 0,
            },
        ]
    ]


def test_request_metrics_buffer_requeues_a_failed_flush():
    class FailingOnceRepository(RecordingRepository):
        def __init__(self) -> None:
            super().__init__()
            self.attempts = 0

        async def record_api_request_batch(self, rows: list[dict[str, str | int]]) -> None:
            self.attempts += 1
            if self.attempts == 1:
                raise RuntimeError("database unavailable")
            await super().record_api_request_batch(rows)

    repository = FailingOnceRepository()
    buffer = RequestMetricsBuffer(lambda: repository)
    buffer.record(org_id="org-1", status_code=500)

    assert asyncio.run(buffer.flush()) is False
    assert buffer.pending_request_count == 1
    assert asyncio.run(buffer.flush()) is True
    assert repository.batches[0][0]["request_count"] == 1
    assert repository.batches[0][0]["error_response_count"] == 1


def test_requests_recorded_during_flush_remain_for_the_next_batch():
    async def scenario() -> tuple[list[list[dict[str, str | int]]], int]:
        class BlockingRepository(RecordingRepository):
            def __init__(self) -> None:
                super().__init__()
                self.started = asyncio.Event()
                self.release = asyncio.Event()

            async def record_api_request_batch(self, rows: list[dict[str, str | int]]) -> None:
                self.started.set()
                await self.release.wait()
                await super().record_api_request_batch(rows)

        repository = BlockingRepository()
        buffer = RequestMetricsBuffer(lambda: repository)
        buffer.record(org_id="org-1", status_code=200)
        flush_task = asyncio.create_task(buffer.flush())
        await repository.started.wait()
        buffer.record(org_id="org-1", status_code=201)
        repository.release.set()
        await flush_task
        pending_after_first_flush = buffer.pending_request_count
        await buffer.flush()
        return repository.batches, pending_after_first_flush

    batches, pending_after_first_flush = asyncio.run(scenario())

    assert pending_after_first_flush == 1
    assert len(batches) == 2
    assert batches[0][0]["request_count"] == 1
    assert batches[1][0]["request_count"] == 1


def test_metrics_loop_stops_without_waiting_for_the_interval():
    async def scenario() -> bool:
        repository = RecordingRepository()
        buffer = RequestMetricsBuffer(
            lambda: repository,
            flush_interval_seconds=300,
            startup_jitter_seconds=0,
        )
        stop_event = asyncio.Event()
        task = asyncio.create_task(buffer.run(stop_event))
        await asyncio.sleep(0)
        stop_event.set()
        await asyncio.wait_for(task, timeout=0.5)
        return task.done()

    assert asyncio.run(scenario()) is True
