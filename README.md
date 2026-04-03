# Clinic EMR MVP

Minimal EMR MVP for queue management and AI note generation.

## Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS
- Backend: FastAPI
- Database: Supabase PostgreSQL
- AI: Anthropic Claude

## Structure

```text
web/      Next.js frontend
backend/  FastAPI API
supabase/ SQL schema
```

## Frontend setup

```bash
cd web
npm install
cp .env.example .env.local
npm run dev
```

## Backend setup

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

## Environment

Frontend:

- `NEXT_PUBLIC_API_BASE_URL=http://127.0.0.1:8001`

Backend:

- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `ANTHROPIC_API_KEY=...`
- `ANTHROPIC_MODEL=claude-3-5-sonnet-20241022`
- `APP_ORIGIN=http://127.0.0.1:3000`

## Architecture

- The frontend only talks to the FastAPI backend over HTTP.
- All database access and AI provider access live in the backend.
- Supabase credentials and Anthropic credentials are only used by the backend.

## Database

Run the SQL in `supabase/schema.sql` in your Supabase project.

## Notes

- `POST /generate-note` uses Claude when `ANTHROPIC_API_KEY` is set.
- `POST /generate-note-pdf` renders the final note into an in-memory PDF for preview/download.
- If no Anthropic key is configured, the backend returns a deterministic SOAP note fallback so the flow still works during setup.
- `POST /send-note` is a mock endpoint prepared for later WhatsApp integration.
