from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class WhatsAppClientError(RuntimeError):
    pass


@dataclass(frozen=True)
class WhatsAppSendResult:
    message_id: str
    raw: dict[str, Any]


class WhatsAppClient:
    def __init__(
        self,
        *,
        access_token: str,
        phone_number_id: str,
        graph_api_version: str = "v23.0",
        timeout_seconds: int = 15,
    ) -> None:
        self.access_token = access_token
        self.phone_number_id = phone_number_id
        self.graph_api_version = graph_api_version
        self.timeout_seconds = timeout_seconds

    def send_text(self, *, to: str, body: str, reply_to_message_id: str | None = None) -> WhatsAppSendResult:
        if not self.access_token or not self.phone_number_id:
            raise WhatsAppClientError("WhatsApp credentials are not configured.")
        payload: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": {"preview_url": False, "body": body},
        }
        if reply_to_message_id:
            payload["context"] = {"message_id": reply_to_message_id}
        url = f"https://graph.facebook.com/{self.graph_api_version}/{self.phone_number_id}/messages"
        request = Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = json.loads(response.read().decode("utf-8") or "{}")
        except HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="ignore")
            raise WhatsAppClientError(f"WhatsApp send failed: HTTP {exc.code} {body_text[:500]}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise WhatsAppClientError(f"WhatsApp send failed: {exc}") from exc
        messages = raw.get("messages") if isinstance(raw, dict) else None
        message_id = ""
        if isinstance(messages, list) and messages:
            message_id = str((messages[0] or {}).get("id") or "")
        return WhatsAppSendResult(message_id=message_id, raw=raw)
