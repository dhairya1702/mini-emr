# Find Batch Prompt

Use this prompt when asking Codex to create the next lead batch.

```text
Find 25 public business leads for optometry, eye-care, optical, contact-lens, vision-therapy, and myopia-management clinics in Chennai.

Prefer:
- small and mid-sized clinics
- clinics with public business phone/email/website
- clinics that mention appointments, contact lenses, optical dispensing, myopia management, pediatric optometry, or vision therapy

Avoid as first-priority:
- very large hospital chains
- academic-only institutions
- duplicate branches of the same chain unless clearly separate operating units

For each lead, produce CSV rows matching gtm/batches/optometry_chennai_001.csv.

Do not send messages.
Set status to researched or drafted depending on completeness.
Set approval_status to pending.
Leave phone/email blank if not found on public pages.
Include source_url for every lead.
```
