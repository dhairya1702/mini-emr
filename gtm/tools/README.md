# Lead Finder

This is a zero-paid-API lead collector for public clinic leads. It searches the
public web, opens result pages, extracts visible phone numbers/emails, and writes
a CSV.

## Run

Interactive mode:

```bash
python3 gtm/tools/lead_finder.py --interactive
```

The script will ask for:

```text
city
localities
clinic specialties/search terms
results per query
delay
output CSV path
```

Common Bangalore shorthand is expanded automatically:

```text
HSR -> HSR Layout
JP -> JP Nagar
BTM -> BTM Layout
MG -> MG Road
```

Broad Bangalore clinic search without prompts:

```bash
python3 gtm/tools/lead_finder.py
```

Smaller test run:

```bash
python3 gtm/tools/lead_finder.py \
  --locality Indiranagar \
  --locality Koramangala \
  --results-per-query 5
```

Specific clinic types:

```bash
python3 gtm/tools/lead_finder.py \
  --term "dental clinic" \
  --term "skin clinic" \
  --term "physiotherapy clinic"
```

Output defaults to:

```text
gtm/batches/bangalore_clinics_raw.csv
```

## CSV Fields

```text
clinic_name, city, area, phone, email, website, location, source_url, source_type, search_term
```

## Notes

- This uses public pages only and does not bypass login, paywalls, or blocks.
- Free search data is noisy; expect duplicates and some weak rows.
- If one search source returns nothing, the script tries another public search source.
- Use small runs first, then increase `--results-per-query`.
- Do not send automated bulk messages from this output without manual review.
