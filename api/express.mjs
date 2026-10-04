// Vercel serverless shim: delegates to the prebuilt Express bundle produced by
// `pnpm --filter @workspace/api-server run build` (dist/vercel.mjs).
export { default } from '../artifacts/api-server/dist/vercel.mjs';

