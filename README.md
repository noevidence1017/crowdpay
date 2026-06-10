# CrowdPay

[![CI](https://github.com/Savitura/crowdpay/actions/workflows/ci.yml/badge.svg)](https://github.com/Savitura/crowdpay/actions/workflows/ci.yml)

**Global funding infrastructure built on Stellar.**

CrowdPay is a crowdfunding platform where each campaign gets its own Stellar multisig account. Contributors can fund campaigns in any Stellar asset — path payments handle conversion automatically. Funds are held in cryptographic escrow until both the creator and platform co-sign withdrawals.

---

## Quick start with Docker

```bash
cp backend/.env.example backend/.env
docker compose up
```

| Service  | URL                        |
|----------|----------------------------|
| Frontend | http://localhost:5173      |
| Backend  | http://localhost:3001      |
| Postgres | localhost:5432             |

The database schema is applied automatically on first start. Hot-reload is enabled for both backend (nodemon) and frontend (Vite HMR).

---

## Features

- **Campaign management** — create, edit, feature, soft-delete, categorize campaigns
- **Stellar multisig wallets** — per-campaign on-chain accounts with 2-of-2 escrow
- **Cross-currency contributions** — path payments auto-convert any Stellar asset
- **Fiat on-ramp** — SEP-24 anchor deposits (MoneyGram, custom anchors)
- **Milestone-based releases** — release funds in tranches as milestones are met
- **Platform fee** — configurable basis-point fee on each contribution
- **Admin moderation** — suspend/restore campaigns, ban/unban users
- **Webhook notifications** — event-based HTTP callbacks for third-party integrations
- **Developer API keys** — scoped API keys for external apps
- **Campaign embedding** — embeddable widget and iframe for external sites
- **Dispute resolution** — contributors can dispute withdrawals
- **KYC/identity verification** — Persona integration, configurable per environment
- **Notifications** — in-app notification dropdown
- **Internationalization** — English and French (i18next)
- **Campaign updates** — creators can post updates to backers
- **Soroban smart contracts** — Rust contracts for escrow and milestone logic
- **Error tracking** — Sentry integration
- **Rate limiting** — per-endpoint and global rate limiting
- **Ledger monitoring** — real-time Horizon streaming for incoming payments
- **Reconciliation** — periodic on-chain vs. database balance checks

---

## Project Structure

```
crowdpay/
├── backend/                  # Node.js Express API
│   ├── src/
│   │   ├── config/           # DB, Stellar, env, logger, constants
│   │   ├── routes/           # REST route handlers (23 files)
│   │   ├── services/         # Stellar SDK, ledger monitor, wallet, webhooks, KYC, etc.
│   │   ├── middleware/       # Auth, validation, error handler, request ID, logging
│   │   ├── utils/            # Async handler, cache
│   │   ├── scripts/          # Wallet secret rotation
│   │   └── index.js          # Express app entry point
│   ├── db/
│   │   ├── schema.sql        # PostgreSQL schema
│   │   ├── migrate.js        # Migration runner
│   │   └── migrations/       # Date-prefixed SQL migrations
│   ├── docs/                 # Data model, webhook integration, operations docs
│   └── API.md                # Interactive Swagger / REST API reference
├── frontend/                 # React (Vite) SPA
│   └── src/
│       ├── pages/            # 18 page components
│       ├── components/       # 20 reusable components
│       ├── context/          # Auth, theme, toast
│       ├── services/         # API client
│       ├── hooks/            # Custom hooks
│       ├── lib/              # Utility modules
│       ├── locales/          # i18n JSON (en, fr)
│       └── config/           # Stellar client config
├── contracts/
│   ├── stellar/              # Stellar transaction helpers (JS)
│   └── soroban/              # Soroban smart contracts (Rust)
└── e2e/                      # Playwright end-to-end tests
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Stellar (testnet/mainnet) + Soroban smart contracts |
| Backend | Node.js, Express |
| Database | PostgreSQL |
| Frontend | React, Vite, React Router |
| Stellar SDK | `@stellar/stellar-sdk`, `@stellar/freighter-api` |
| Auth | JWT (bcrypt, cookie-parser) |
| Logging | Winston, Sentry |
| i18n | i18next, react-i18next |
| Testing | Node test runner, Vitest, Playwright, Supertest |
| CI/CD | GitHub Actions |
| Object storage | S3-compatible (campaign covers) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+
- Docker (optional — for running the stack without manual setup)

### Manual setup

```bash
# Clone and install
cd backend && npm install
cd ../frontend && npm install

# Configure environment
cd ../backend
cp .env.example .env
# Edit .env — add Stellar platform keypair, DB credentials, etc.

# Create database and apply migrations
npm run migrate:fresh

# Fund your platform testnet account
node contracts/stellar/campaignWallet.js --setup-platform

# Start (two terminals)
cd backend && npm run dev
cd frontend && npm run dev
```

Backend: http://localhost:3001  
Frontend: http://localhost:5173  
API docs: http://localhost:3001/api/docs

### Testing

```bash
# Backend
cd backend && npm test

# Frontend
cd frontend && npm test

# End-to-end (Playwright)
npm run test:e2e
```

---

## Contributing

See **[CONTRIBUTING.md](CONTRIBUTING.md)** for setup, branch naming, commit format, and PR checklist.
