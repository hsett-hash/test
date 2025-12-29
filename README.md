# EMS Website (Employee Management System)

A simple, modern **Employee Management System** web app with:

- **Database**: SQLite (schema + seed)
- **Backend**: Node.js + Express
- **UI**: Server-rendered EJS templates + Tailwind (CDN)
- **Features**: Login, Dashboard, CRUD for Employees / Departments / Roles

## Quick start

```bash
cd /workspace
cp .env.example .env
npm install
npm run db:init
npm run dev
```

Open `http://localhost:3000`.

## Default login

- **Username**: `admin`
- **Password**: `admin123`

Change this immediately for real deployments (see `.env` and the seed script).

## Database design (ERD)

- **users**
  - `id` (PK)
  - `username` (unique)
  - `password_hash`
  - `display_name`
  - `created_at`
- **departments**
  - `id` (PK)
  - `name` (unique)
  - `description`
  - `created_at`
- **roles**
  - `id` (PK)
  - `name` (unique)
  - `description`
  - `created_at`
- **employees**
  - `id` (PK)
  - `first_name`, `last_name`
  - `email` (unique), `phone`
  - `department_id` (FK → departments.id)
  - `role_id` (FK → roles.id)
  - `status` (`Active`/`Inactive`)
  - `hire_date`
  - `notes`
  - `created_at`, `updated_at`

## Useful commands

- `npm run db:init`: creates `data/ems.sqlite` and seeds default data
- `npm run dev`: starts the server

