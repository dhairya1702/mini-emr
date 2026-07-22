# WhatsApp Invoice And Letter Sending Plan

## Scope

Implement patient-facing WhatsApp sends for:

- invoices
- clinic letters

Consultation notes are intentionally out of scope for this branch.

## Product Behavior

Existing email flows remain unchanged:

- `POST /send-invoice`
- `POST /send-letter`

New WhatsApp-specific endpoints are added:

- `POST /send-invoice-whatsapp`
- `POST /send-letter-whatsapp`

These endpoints generate the same PDF artifacts already used for email/PDF preview, upload the PDF to WhatsApp Cloud API as media, and send the media as a WhatsApp document message.

WhatsApp captions use patient-facing clinic copy:

```text
Hi {patient_first_name},

Thank you for visiting {clinic_name}.

Here is your {invoice_or_receipt/document_subject}.
{amount_line_if_invoice}

Attached for your records.
```

## Why Separate Endpoints

Separate endpoints are the most backward-compatible option:

- existing request/response contracts do not change
- existing UI/email behavior does not change
- WhatsApp can be added to the UI one button at a time
- failures in WhatsApp delivery do not affect email delivery

## MVP Delivery Strategy

Use WhatsApp Cloud API media document messages:

1. generate PDF bytes
2. `POST /{phone_number_id}/media`
3. `POST /{phone_number_id}/messages` with `type=document`
4. log the outbound event in `whatsapp_message_events`

For production patient-initiated sends outside the 24-hour service window, approved Meta templates may still be required. This MVP keeps template work separate so backend artifact delivery can be tested first.

## Phone Handling

Input accepts either:

- explicit `recipient_phone`
- invoice patient phone fallback for invoice sends

Letter WhatsApp sends also require `recipient_name`; the existing letter `To` field is not used for greetings because it may contain an institution or generic addressee.

Phone numbers are normalized to WhatsApp IDs:

- strips spaces, punctuation, and `+`
- `10` digit Indian numbers become `91XXXXXXXXXX`
- already international numbers pass through as digits

## Audit And Logging

Each WhatsApp send records an outbound `whatsapp_message_events` row with:

- `org_id`
- `direction=outbound`
- `recipient_wa_id`
- `intent=send_invoice_document` or `send_letter_document`
- `status=sent` or `failed`
- provider message/media metadata in `raw_payload`

Invoices are marked sent after successful WhatsApp delivery, matching the existing email send semantics.

## Later Upgrade Path

After this works manually:

- add UI buttons beside existing email buttons
- add patient WhatsApp consent/preference fields
- submit approved document-ready templates
- add delivery webhook status tracking
- optionally move from direct media sends to secure links for sensitive documents
