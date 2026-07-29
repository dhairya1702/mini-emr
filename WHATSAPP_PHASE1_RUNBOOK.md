# WhatsApp Owner Assistant Phase 1

Phase 1 is owner/admin Q&A only. One shared pilot WhatsApp Cloud API number receives owner messages, maps the sender `wa_id` to a clinic org, answers from EMR data, and logs inbound/outbound events.

## Environment

Set these on the backend:

```bash
WHATSAPP_ENABLED=true
WHATSAPP_VERIFY_TOKEN=choose-a-long-random-verify-token
WHATSAPP_APP_SECRET=meta-app-secret
WHATSAPP_ACCESS_TOKEN=meta-whatsapp-access-token
WHATSAPP_PHONE_NUMBER_ID=meta-phone-number-id
WHATSAPP_GRAPH_API_VERSION=v23.0
WHATSAPP_DOCUMENT_TEMPLATE_NAME=
WHATSAPP_DOCUMENT_TEMPLATE_LANGUAGE=en
WHATSAPP_FOLLOW_UP_TEMPLATE_NAME=
WHATSAPP_FOLLOW_UP_TEMPLATE_LANGUAGE=en
```

`INTERNAL_SCHEDULER_TOKEN` is also required for the temporary binding seed endpoint.

## Meta Webhook

Configure Meta's WhatsApp webhook URL:

```text
https://<backend-host>/webhooks/whatsapp
```

Subscribe to message events. Use the same `WHATSAPP_VERIFY_TOKEN` in Meta.

For production deployment, set `WHATSAPP_ENABLED=true` and configure the four
`WHATSAPP_*_SECRET_NAME` variables in `.env.deploy` with existing Secret Manager
secret names. Set `WHATSAPP_DOCUMENT_TEMPLATE_NAME` after Meta approves the
utility template with a document header. The deploy script never reads or prints
the secret values.

## Follow-Up Booking Invitation

When a clinic creates a follow-up, the backend can send one proactive WhatsApp
utility-template message to the patient's phone. Updates, reminder jobs,
bookings, reschedules, and cancellations do not send additional WhatsApp
messages.

Create and approve a Meta utility template with:

```text
Name: follow_up_booking_invitation
Body:
Hi {{1}}, {{2}} would like you to book your follow-up appointment for {{3}}.
Use the button below to book, reschedule, or cancel.

URL button label: Manage appointment
URL: https://<web-host>/follow-up?token={{1}}
```

The body variables are patient first name, clinic name, and follow-up reason.
The URL-button variable is the signed booking token. Set the approved template
name in `WHATSAPP_FOLLOW_UP_TEMPLATE_NAME`; the language defaults to `en`.
The link remains valid for 400 days and manages the same linked appointment
through booking, rescheduling, cancellation, and rebooking.

For local testing, run the repo dev script:

```bash
./dev.sh
```

The local dev webhook proxy is ngrok with this fixed domain:

```text
https://terrell-unrightful-belinda.ngrok-free.dev
```

Use this callback URL in Meta:

```text
https://terrell-unrightful-belinda.ngrok-free.dev/webhooks/whatsapp
```

`dev.sh` starts the backend on `127.0.0.1:8001`, starts ngrok against that backend port, and prints the WhatsApp webhook URL on launch.

To keep backend/frontend/proxy logs in the original terminal and open only ngrok in a new macOS Terminal tab:

```bash
NGROK_SEPARATE_TERMINAL=1 ./dev.sh
```

For direct database access during local testing, the Cloud SQL proxy target is:

```text
project-e8d0eb79-8682-4bd9-b31:asia-south1:clinic-emr-prod
```

The local proxy port used so far is:

```text
127.0.0.1:5433
```

## Seed An Owner Binding

Create a mapping from your WhatsApp sender `wa_id` to a clinic org:

```bash
curl -X POST "https://<backend-host>/internal/whatsapp/owner-bindings" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Scheduler-Token: $INTERNAL_SCHEDULER_TOKEN" \
  -d '{
    "org_id": "<clinic-org-id>",
    "wa_id": "919999999999",
    "phone": "+919999999999",
    "display_name": "Owner",
    "role": "owner"
  }'
```

Meta webhook payloads usually provide `messages[].from` as the `wa_id`.

## Supported Messages

```text
today summary
revenue today
patients today
today appointments
tomorrow appointments
pending payments
followups due
help
```

The owner assistant does not send proactive digests. Patient document sends and
the one-time follow-up booking invitation are separate, explicitly triggered
workflows.
