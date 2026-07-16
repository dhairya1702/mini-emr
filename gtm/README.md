# GTM Research Loop

This folder is the lightweight founder-led GTM workspace. The rule for v0 is:
AI researches and drafts; a human approves every outbound message before sending.

## Current ICP

- Segment: optometry and eye-care clinics
- Geography: Chennai
- Buyer: clinic owner, senior optometrist, ophthalmologist, or operations/admin lead
- Primary pain angles:
  - front-desk queue and appointment coordination
  - patient consultation note creation
  - optical/contact-lens inventory and billing
  - follow-up reminders for review visits, myopia management, lenses, and procedures

## Batch Workflow

1. Add public leads to `batches/optometry_chennai_001.csv`.
2. For each lead, collect only public business information.
3. Run the research prompt in `prompts/research_lead.md`.
4. Run the message prompt in `prompts/draft_outreach.md`.
5. Fill the CSV fields.
6. Set `approval_status` to `pending`.
7. Review each row manually.
8. Set `approval_status` to `approved` only when the message is ready to send.
9. After sending manually, set `status` to `contacted` and add `last_contacted_at`.

## Status Values

- `new`
- `researched`
- `drafted`
- `approved`
- `contacted`
- `replied`
- `demo_booked`
- `trial_started`
- `won`
- `lost`
- `do_not_contact`

## Approval Values

- `pending`
- `approved`
- `rejected`
- `needs_edit`

## Compliance Notes

- Do not scrape private personal data.
- Do not send bulk WhatsApp/SMS campaigns from personal numbers.
- Use public business contact channels only.
- Keep outreach truthful and specific.
- Include an opt-out line in email outreach.
- If someone asks not to be contacted, set `status` to `do_not_contact`.
