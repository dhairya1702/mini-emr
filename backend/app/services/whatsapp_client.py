from __future__ import annotations

import json
import uuid
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

    def upload_media(self, *, content: bytes, filename: str, content_type: str) -> str:
        if not self.access_token or not self.phone_number_id:
            raise WhatsAppClientError("WhatsApp credentials are not configured.")
        boundary = f"----clinicos-{uuid.uuid4().hex}"
        body = b"".join(
            [
                f"--{boundary}\r\n".encode("utf-8"),
                b'Content-Disposition: form-data; name="messaging_product"\r\n\r\n',
                b"whatsapp\r\n",
                f"--{boundary}\r\n".encode("utf-8"),
                (
                    f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
                    f"Content-Type: {content_type}\r\n\r\n"
                ).encode("utf-8"),
                content,
                b"\r\n",
                f"--{boundary}--\r\n".encode("utf-8"),
            ]
        )
        url = f"https://graph.facebook.com/{self.graph_api_version}/{self.phone_number_id}/media"
        request = Request(
            url,
            data=body,
            headers={
                "Authorization": f"Bearer {self.access_token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                raw = json.loads(response.read().decode("utf-8") or "{}")
        except HTTPError as exc:
            body_text = exc.read().decode("utf-8", errors="ignore")
            raise WhatsAppClientError(f"WhatsApp media upload failed: HTTP {exc.code} {body_text[:500]}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise WhatsAppClientError(f"WhatsApp media upload failed: {exc}") from exc
        media_id = str(raw.get("id") or "").strip()
        if not media_id:
            raise WhatsAppClientError("WhatsApp media upload did not return a media id.")
        return media_id

    def send_document(
        self,
        *,
        to: str,
        media_id: str,
        filename: str,
        caption: str = "",
    ) -> WhatsAppSendResult:
        if not self.access_token or not self.phone_number_id:
            raise WhatsAppClientError("WhatsApp credentials are not configured.")
        document: dict[str, Any] = {
            "id": media_id,
            "filename": filename,
        }
        if caption.strip():
            document["caption"] = caption.strip()
        payload: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "document",
            "document": document,
        }
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
            raise WhatsAppClientError(f"WhatsApp document send failed: HTTP {exc.code} {body_text[:500]}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise WhatsAppClientError(f"WhatsApp document send failed: {exc}") from exc
        messages = raw.get("messages") if isinstance(raw, dict) else None
        message_id = ""
        if isinstance(messages, list) and messages:
            message_id = str((messages[0] or {}).get("id") or "")
        return WhatsAppSendResult(message_id=message_id, raw=raw)

    def send_document_template(
        self,
        *,
        to: str,
        media_id: str,
        filename: str,
        template_name: str,
        language_code: str,
    ) -> WhatsAppSendResult:
        if not self.access_token or not self.phone_number_id:
            raise WhatsAppClientError("WhatsApp credentials are not configured.")
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code},
                "components": [
                    {
                        "type": "header",
                        "parameters": [
                            {
                                "type": "document",
                                "document": {"id": media_id, "filename": filename},
                            }
                        ],
                    }
                ],
            },
        }
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
            raise WhatsAppClientError(f"WhatsApp template send failed: HTTP {exc.code} {body_text[:500]}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise WhatsAppClientError(f"WhatsApp template send failed: {exc}") from exc
        messages = raw.get("messages") if isinstance(raw, dict) else None
        message_id = str((messages[0] or {}).get("id") or "") if isinstance(messages, list) and messages else ""
        return WhatsAppSendResult(message_id=message_id, raw=raw)

    def send_follow_up_booking_template(
        self,
        *,
        to: str,
        template_name: str,
        language_code: str,
        patient_first_name: str,
        clinic_name: str,
        follow_up_reason: str,
        booking_token: str,
    ) -> WhatsAppSendResult:
        if not self.access_token or not self.phone_number_id:
            raise WhatsAppClientError("WhatsApp credentials are not configured.")
        payload = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "template",
            "template": {
                "name": template_name,
                "language": {"code": language_code},
                "components": [
                    {
                        "type": "body",
                        "parameters": [
                            {"type": "text", "text": patient_first_name},
                            {"type": "text", "text": clinic_name},
                            {"type": "text", "text": follow_up_reason},
                        ],
                    },
                    {
                        "type": "button",
                        "sub_type": "url",
                        "index": "0",
                        "parameters": [{"type": "text", "text": booking_token}],
                    },
                ],
            },
        }
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
            raise WhatsAppClientError(f"WhatsApp template send failed: HTTP {exc.code} {body_text[:500]}") from exc
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise WhatsAppClientError(f"WhatsApp template send failed: {exc}") from exc
        messages = raw.get("messages") if isinstance(raw, dict) else None
        message_id = str((messages[0] or {}).get("id") or "") if isinstance(messages, list) and messages else ""
        return WhatsAppSendResult(message_id=message_id, raw=raw)
