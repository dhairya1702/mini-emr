from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Callable
from datetime import UTC, date, datetime
from typing import Any


logger = logging.getLogger(__name__)

RequestMetricBatchRow = dict[str, str | int]


class RequestMetricsBuffer:
    def __init__(
        self,
        repository_factory: Callable[[], Any],
        *,
        flush_interval_seconds: float = 30.0,
        startup_jitter_seconds: float = 5.0,
        clock: Callable[[], datetime] | None = None,
        jitter: Callable[[float, float], float] | None = None,
    ) -> None:
        self._repository_factory = repository_factory
        self._flush_interval_seconds = max(float(flush_interval_seconds), 1.0)
        self._startup_jitter_seconds = max(float(startup_jitter_seconds), 0.0)
        self._clock = clock or (lambda: datetime.now(UTC))
        self._jitter = jitter or random.uniform
        self._pending: dict[tuple[date, str | None], list[int]] = {}
        self._flush_lock = asyncio.Lock()

    def record(self, *, org_id: str | None, status_code: int) -> None:
        metric_date = self._clock().astimezone(UTC).date()
        key = (metric_date, org_id)
        counts = self._pending.setdefault(key, [0, 0])
        counts[0] += 1
        counts[1] += int(status_code >= 500)

    def clear(self) -> None:
        self._pending = {}

    @property
    def pending_request_count(self) -> int:
        return sum(counts[0] for counts in self._pending.values())

    async def flush(self) -> bool:
        async with self._flush_lock:
            if not self._pending:
                return True

            pending, self._pending = self._pending, {}
            rows: list[RequestMetricBatchRow] = [
                {
                    "metric_date": metric_date.isoformat(),
                    "org_id": org_id or "",
                    "request_count": counts[0],
                    "error_response_count": counts[1],
                }
                for (metric_date, org_id), counts in pending.items()
            ]
            request_count = sum(int(row["request_count"]) for row in rows)
            error_count = sum(int(row["error_response_count"]) for row in rows)

            try:
                repository = self._repository_factory()
                await repository.record_api_request_batch(rows)
            except asyncio.CancelledError:
                self._restore(pending)
                raise
            except Exception:
                self._restore(pending)
                logger.exception(
                    "Failed to persist request metrics batch rows=%s requests=%s errors=%s",
                    len(rows),
                    request_count,
                    error_count,
                )
                return False

            logger.info(
                "Persisted request metrics batch rows=%s requests=%s errors=%s",
                len(rows),
                request_count,
                error_count,
            )
            return True

    async def run(self, stop_event: asyncio.Event) -> None:
        initial_delay = self._flush_interval_seconds + self._jitter(
            0.0,
            self._startup_jitter_seconds,
        )
        delay = initial_delay
        while not stop_event.is_set():
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=delay)
            except TimeoutError:
                await self.flush()
                delay = self._flush_interval_seconds

    def _restore(self, pending: dict[tuple[date, str | None], list[int]]) -> None:
        for key, counts in pending.items():
            current = self._pending.setdefault(key, [0, 0])
            current[0] += counts[0]
            current[1] += counts[1]
