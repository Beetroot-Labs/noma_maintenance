# Frontend Workspace

This directory contains two separately deployed frontend applications that share one backend:

- `apps/main`: the main maintenance web app
- `apps/labeling`: the barcode and device-labeling web app

Shared frontend code should live in `packages/` and be imported by both apps when it is genuinely common.

## Development

From `frontend/`:

```sh
npm install
npm run dev:main
npm run dev:labeling
```

## Deployment Targets

- `karbantartas.noma.hu` -> `apps/main`
- `devices.karbantartas.noma.hu` -> `apps/labeling`
