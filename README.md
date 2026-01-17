# Employer by Claude

[![Website](https://img.shields.io/badge/Website-employerai.dev-blue)](https://employerai.dev)
[![X Community](https://img.shields.io/badge/X-Community-black)](https://x.com/i/communities/2012609389505744957/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

> **"You don't hire AI. AI hires you."**

An autonomous AI-powered task management and payment system where Claude acts as the employer. Humans execute tasks and receive automatic SOL payments upon AI-verified completion.

**Website:** [employerai.dev](https://employerai.dev)  
**Community:** [Join us on X](https://x.com/i/communities/2012609389505744957/)

## Overview

Employer by Claude flips the traditional AI assistant model. Instead of humans directing AI, Claude autonomously:

- **Generates tasks** based on available budget and platform needs
- **Publishes work** for human workers to claim
- **Verifies submissions** using multimodal AI analysis
- **Processes payments** automatically via Solana blockchain
- **Manages payroll** from PumpPortal creator rewards

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    AUTONOMOUS LOOP                          │
├─────────────────────────────────────────────────────────────┤
│  1. Creator rewards accumulate in PumpPortal wallet         │
│  2. Claude reads the payroll budget                         │
│  3. Claude generates and publishes tasks                    │
│  4. Workers claim tasks and submit proof                    │
│  5. Claude verifies submissions using multimodal AI         │
│  6. Automatic SOL payment upon approval                     │
└─────────────────────────────────────────────────────────────┘
```

## Features

### AI-Powered Task Generation
Claude analyzes the budget and generates appropriate tasks:
- Code contributions (GitHub PRs, bug fixes)
- Social media campaigns (tweets, threads)
- Marketing efforts (community building, IRL promotion)
- Design work (graphics, memes)

### Multimodal Verification
Claude verifies work submissions using:
- **Image analysis** - Screenshots, photos of IRL work
- **URL verification** - Tweet links, GitHub PRs, deployed sites
- **Text analysis** - Written content, documentation

### Automatic Payments
- Direct SOL transfers to worker wallets
- Transaction confirmation before marking complete
- Payment history and verification
- 10 SOL cap per transaction for safety

## Quick Start

### Prerequisites
- Node.js 18+
- Anthropic API key (Claude)
- Solana wallet (optional, for payments)

### Installation

```bash
# Clone the repository
git clone https://github.com/EmployerAI/Employer.git
cd Employer

# Install dependencies
npm install

# Set environment variables
export ANTHROPIC_API_KEY="your-claude-api-key"
export ADMIN_API_KEY="your-admin-secret-key"
export EMPLOYER_WALLET_PRIVATE_KEY="base58-encoded-private-key"  # Optional

# Start the server
npm run dev
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Claude API key for AI verification |
| `ADMIN_API_KEY` | Yes | Secret key for admin endpoints |
| `EMPLOYER_WALLET_PRIVATE_KEY` | No | Solana wallet for payments (base58) |
| `SESSION_SECRET` | No | Session encryption key |

## API Reference

### Public Endpoints

```bash
# Health check
GET /api/health

# Platform statistics
GET /api/stats

# List all tasks
GET /api/tasks

# List open tasks
GET /api/tasks/open

# Get task details
GET /api/tasks/:id
```

### Worker Endpoints

```bash
# Register as worker
POST /api/users
{
  "username": "alice",
  "password": "secure-password",
  "walletAddress": "SolanaWalletAddress..."
}

# Login
POST /api/users/login
{
  "username": "alice",
  "password": "secure-password"
}

# Claim a task
POST /api/tasks/:id/claim
{
  "workerId": "worker-uuid"
}

# Submit proof of work
POST /api/submissions
{
  "taskId": "task-uuid",
  "workerId": "worker-uuid",
  "proofType": "url",
  "proofData": "https://twitter.com/user/status/123"
}
```

### Admin Endpoints (requires X-API-Key header)

```bash
# AI generates tasks based on budget
POST /api/tasks/generate
{
  "count": 5,
  "budgetSol": "1.0"
}

# Create task manually
POST /api/tasks
{
  "title": "Tweet about $EMPLOYER",
  "description": "Create a viral tweet",
  "taskType": "social",
  "rewardSol": "0.05",
  "verificationCriteria": "Must have 10+ likes"
}

# AI verify submission
POST /api/submissions/:id/verify

# Batch verify all pending
POST /api/verify/batch

# Process payment
POST /api/payments/:id/process

# Process all pending payments
POST /api/payments/process-all

# Get budget status
GET /api/budget

# Claim PumpPortal rewards
POST /api/budget/claim-rewards

# AI budget analysis
GET /api/budget/analyze
```

## Task Types

| Type | Description | Example |
|------|-------------|---------|
| `code` | GitHub contributions | Fix bug #123, add feature X |
| `social` | Social media content | Tweet thread, community post |
| `marketing` | Promotion & outreach | IRL event, partnership |
| `design` | Visual content | Meme, infographic, logo |
| `other` | Miscellaneous | Documentation, testing |

## Security

- **Password Hashing**: bcrypt with salt rounds
- **Admin Authentication**: API key via X-API-Key header
- **Payment Limits**: 10 SOL maximum per transaction
- **Wallet Validation**: Address format verification
- **Transaction Confirmation**: Wait for blockchain confirmation

## Architecture

```
server/
├── index.ts              # Express server entry
├── routes.ts             # API route handlers
├── storage.ts            # In-memory data storage
└── services/
    ├── claude.ts         # AI verification service
    ├── solana.ts         # Blockchain payment service
    └── pumpportal.ts     # Creator rewards service

shared/
└── schema.ts             # TypeScript types & Zod schemas
```

## Verification Flow

```
Worker submits proof
        │
        ▼
┌───────────────────┐
│  Claude analyzes  │
│  proof against    │
│  task criteria    │
└───────────────────┘
        │
        ▼
┌───────────────────┐
│  Returns score    │
│  (0-100) and      │
│  approval status  │
└───────────────────┘
        │
        ▼
   Approved?
   /      \
  Yes      No
   │        │
   ▼        ▼
Payment   Rejection
queued    with feedback
```

## Example Usage

```bash
# 1. Register a worker
curl -X POST http://localhost:5000/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "alice",
    "password": "mypassword",
    "walletAddress": "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU"
  }'

# 2. AI generates tasks (admin)
curl -X POST http://localhost:5000/api/tasks/generate \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-admin-key" \
  -d '{"count": 3, "budgetSol": "0.5"}'

# 3. Worker claims a task
curl -X POST http://localhost:5000/api/tasks/{taskId}/claim \
  -H "Content-Type: application/json" \
  -d '{"workerId": "worker-uuid"}'

# 4. Worker submits proof
curl -X POST http://localhost:5000/api/submissions \
  -H "Content-Type: application/json" \
  -d '{
    "taskId": "task-uuid",
    "workerId": "worker-uuid",
    "proofType": "url",
    "proofData": "https://twitter.com/alice/status/123456"
  }'

# 5. AI verifies submission (admin)
curl -X POST http://localhost:5000/api/submissions/{submissionId}/verify \
  -H "X-API-Key: your-admin-key"

# 6. Process payment (admin)
curl -X POST http://localhost:5000/api/payments/{paymentId}/process \
  -H "X-API-Key: your-admin-key"
```

## Roadmap

- [ ] Worker session authentication (JWT tokens)
- [ ] Rate limiting on admin endpoints
- [ ] External service monitoring & alerts
- [ ] PostgreSQL database support
- [ ] Task deadline enforcement
- [ ] Worker reputation system
- [ ] Multi-signature payments

## Community

Join our growing community of AI-employed workers:

- **Website:** [employerai.dev](https://employerai.dev)
- **X Community:** [EmployerAI Community](https://x.com/i/communities/2012609389505744957/)
- **GitHub:** [EmployerAI/Employer](https://github.com/EmployerAI/Employer)

## Contributing

We welcome contributions! Please see our contributing guidelines and join the community discussion.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT

---

**Built with Claude** | Powered by Solana | [employerai.dev](https://employerai.dev)
