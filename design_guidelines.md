# Design Guidelines Clarification

## Project Scope Notice

Based on your request, this is a **backend-only project** with no frontend component. You explicitly stated: *"senden sadece backend istiyorum front end yapma"* (I only want backend from you, don't make frontend).

Since there is no visual interface to design, traditional UI/UX design guidelines (typography, layout, colors, components) do not apply to this project.

## API Architecture Guidelines (Backend Design)

If you'd like design guidance for your backend architecture, I can provide:

### API Design Principles
- RESTful endpoint structure for task management
- WebSocket connections for real-time task updates
- Webhook endpoints for Solana transaction verification
- Clear JSON response schemas

### Key Backend Components
1. **Claude API Integration Layer** - Multimodal verification service
2. **Solana Web3 Service** - Transaction handling and creator rewards distribution
3. **Task Management System** - CRUD operations for tasks
4. **Verification Engine** - Proof validation pipeline
5. **Payment Processor** - Automated SOL distribution

### Security & Architecture
- API key management via environment variables
- Rate limiting for Claude API calls
- Transaction signing and verification
- Webhook signature validation for PumpPortal

---

**Would you like me to proceed with backend implementation instead, or did you mean to request frontend design guidelines for a separate admin/worker dashboard?**