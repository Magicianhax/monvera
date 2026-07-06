# Monvera — web app

The Next.js PWA for Monvera. **See the full project README at [`../README.md`](../README.md)**
for what Monvera is, the accountable-AI on-chain loop, deployed contract addresses, and architecture.

## Run

```bash
npm install
cp .env.example .env.local   # per-variable comments inside
npm run dev                  # http://localhost:3000
```

## Deploy (Cloudflare)

```bash
npm run preview   # build + run on the workerd runtime locally
npm run deploy    # build + deploy via OpenNext
```
