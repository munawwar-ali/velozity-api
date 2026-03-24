# Velozity Global Solutions — Multi-Tenant REST API

A production-grade backend API for a B2B SaaS platform featuring multi-tenant isolation, intelligent rate limiting, queue-based email engine, and tamper-evident audit trail.

---

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Runtime | Node.js v24 | Async I/O, excellent ecosystem |
| Language | TypeScript (strict) | Type safety, catches bugs at compile time |
| Framework | Express.js | Mature, simple middleware chain, easier debugging than Fastify |
| Database | PostgreSQL 16 | ACID compliance, trigger support for append-only audit |
| ORM | Prisma | Type-safe queries, migration management, no hidden query structure |
| Cache/Queue | Redis 7 | Atomic operations for rate limiting, Bull queue backend |
| Queue Library | Bull | Battle-tested, Redis-backed, native DLQ support, excellent TypeScript types. Chosen over BullMQ (newer but less stable) and Bee-Queue (no DLQ support) |
| Hashing | Argon2 | More secure than bcrypt against GPU attacks |
| Email | Nodemailer + Ethereal | Free test SMTP, auto-generates preview URLs |
| Validation | Zod | Runtime type validation with TypeScript inference |
| Logging | Winston | Structured JSON logs, configurable levels |
| Testing | Jest + Supertest | Integration tests for rate limiter and audit chain |

---

## Local Setup

### Prerequisites

- Node.js 18+
- Docker Desktop
- Git

### Steps

**1. Clone the repository**
```bash
git clone https://github.com/munawwar-ali/velozity-api.git
cd velozity-api
```

**2. Install dependencies**
```bash
npm install
```

**3. Create environment file**
```bash
cp .env.example .env
```

**4. Start PostgreSQL and Redis**
```bash
docker compose up -d
```

**5. Run database migrations**
```bash
npx prisma migrate deploy
```

**6. Apply append-only trigger**
```bash
npx prisma db execute --file prisma/migrations/20260323110110_audit_append_only/migration.sql --schema prisma/schema.prisma
```

**7. Seed the database**
```bash
npm run seed
```
> Copy the API keys printed — they are shown only once.

**8. Start the server**
```bash
npm run dev
```

Server runs on `http://localhost:3000`

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NODE_ENV` | development / production |
| `PORT` | Server port (default 3000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `INTERNAL_API_KEY` | Key for /health and /metrics endpoints |
| `SMTP_HOST` | SMTP host (optional, uses Ethereal if blank) |
| `SMTP_PORT` | SMTP port (optional) |
| `SMTP_USER` | SMTP user (optional) |
| `SMTP_PASS` | SMTP password (optional) |

---

## API Endpoints

### Authentication

All endpoints (except /health and /metrics) require:
```
Authorization: Bearer <api_key>
```

Health and metrics require:
```
x-internal-key: <internal_api_key>
```

### Endpoint Reference

| Method | Path | Role | Description |
|--------|------|------|-------------|
| GET | /health | Internal | System health check |
| GET | /metrics | Internal | Per-tenant usage stats |
| GET | /tenants/me | Any | Get current tenant info |
| PATCH | /tenants/me | Owner | Update tenant name |
| GET | /users | Any | List users in tenant |
| GET | /users/:id | Any | Get single user |
| POST | /users | Owner | Invite user to tenant |
| PATCH | /users/:id | Owner | Update user |
| DELETE | /users/:id | Owner | Delete user |
| GET | /auth/keys | Owner | List API keys |
| POST | /auth/keys | Owner | Create API key |
| POST | /auth/rotate | Owner | Rotate current API key |
| DELETE | /auth/keys/:id | Owner | Revoke API key |
| GET | /audit | Any | Query audit logs |
| GET | /audit/verify | Any | Verify audit chain integrity |

---

## Architectural Decisions

### Multi-Tenant Isolation

Tenant isolation is enforced at **two levels**:

**1. Middleware level** — every request extracts the tenant from the API key hash, never from a user-submitted field. The raw key is hashed with Argon2 and compared against stored hashes.

**2. Query level** — every Prisma query includes `where: { tenantId: req.tenant.id }`. This means even if middleware were bypassed, a direct DB query would still scope to the correct tenant. A user from Tenant A physically cannot retrieve Tenant B's data because the SQL WHERE clause prevents it.

API keys are hashed with Argon2 before storage. The raw key is returned once at creation and never stored. Key rotation sets a 15-minute expiry on the old key via an `expiresAt` timestamp, allowing graceful transition.

---

### Sliding Window Rate Limiter

Three independent tiers run on every authenticated request:

- **Tier 1 — Global:** 1000 req/min per tenant
- **Tier 2 — Endpoint:** configurable per route per tenant
- **Tier 3 — Burst:** 50 req per 5 seconds per API key

Each tier uses a **sliding window algorithm** implemented with Redis sorted sets:
```
1. ZREMRANGEBYSCORE key -inf (now - windowMs)  → remove expired entries
2. ZCARD key                                    → count current window
3. ZADD key now uniqueId                        → add current request
4. EXPIRE key windowSeconds                     → auto-cleanup
```

The difference from a fixed window: a fixed window resets hard at boundaries making it exploitable by bursting at window edges. A sliding window always looks at the last N seconds from NOW — no boundaries to exploit.

All counters are stored in Redis with atomic multi/exec pipelines to prevent race conditions.

When 80% of the global limit is reached, a warning email is queued with a 1-hour Redis lock to prevent duplicates.

---

### Audit Chain Mechanism

Every write operation creates an audit log entry forming a cryptographic chain:
```
Entry 1: hash = SHA256(deepSortedStringify(entry1) + GENESIS_HASH)
Entry 2: hash = SHA256(deepSortedStringify(entry2) + entry1.hash)
Entry 3: hash = SHA256(deepSortedStringify(entry3) + entry2.hash)
```

Key implementation details:

- `deepSortedStringify` recursively sorts all object keys before hashing — ensures JSON key ordering differences do not break the chain
- GENESIS_HASH is 64 zeros — the anchor for the first entry
- Each tenant has its own independent chain

The `GET /audit/verify` endpoint recomputes the entire chain from genesis and compares each stored hash. If any entry was modified the chain breaks at that entry and its ID is returned.

The audit table is protected by a PostgreSQL trigger that raises an exception on any UPDATE or DELETE — enforced at the database engine level, not application level.

---

### Queue-Based Email Engine

All emails go through a Bull queue backed by Redis. No synchronous email sending exists anywhere in the codebase.

**Flow:**
```
Action occurs → EmailLog created (PENDING) → Job added to Bull queue
→ Worker picks up job → Sends via Nodemailer → Updates EmailLog (SENT)
                      → On failure → Exponential backoff (2s, 4s, 8s)
                      → After 3 failures → Job moves to DLQ
                      → EmailLog updated (FAILED)
```

Templates are defined as pure functions in `src/modules/email/templates.ts` — completely separate from the sending logic.

---

## Running Tests
```bash
npm test
```

**Rate Limiter Tests** — sliding window allows/blocks correctly, boundary behavior, key isolation

**Audit Chain Tests** — builds valid chain, verifies intact chain, detects tampering at any position

---

## Known Limitations

1. **API key lookup is O(n)** — all active keys are loaded and hashed to find a match. Production should use a prefix index for pre-filtering.
2. **Email worker is in-process** — runs in the same process as the API. Production should use a separate worker process.
3. **Metrics use audit logs as proxy** — high-volume production systems should use a time-series store.
4. **No session system** — API-key only authentication, appropriate for B2B machine-to-machine calls.
5. **Single Redis instance** — rate limiting and job queue share one Redis. Production should use separate instances.

---

## Explanation

**Hardest problem:** The tamper-evident audit chain. The core challenge was ensuring the hash computed at write time exactly matched the hash recomputed at verify time after a PostgreSQL round-trip. JSON key ordering is not guaranteed — PostgreSQL returns JSON object keys in storage order which differs from insertion order. The fix was implementing `deepSortedStringify` which recursively sorts all object keys before hashing, making the hash deterministic regardless of key order.

**Tenant isolation at query level:** Every Prisma query that touches tenant-scoped data includes an explicit `where: { tenantId: req.tenant.id }` clause. The tenant ID comes exclusively from the resolved API key — never from request body or query params. This means isolation is enforced in SQL, not just middleware. A Member from Tenant A cannot access Tenant B's users even by guessing UUIDs because the WHERE clause physically excludes them.

**One thing I'd do differently:** The API key lookup hashes every active key on each request to find a match. I would store a short non-secret prefix in a separate indexed column, use it to pre-filter candidates to 1-2 rows, then verify only those hashes — reducing lookup from O(n) to O(1).