import { NextResponse } from 'next/server';
import { clearLlmProbeCache } from '@/lib/llm';

// Force a re-probe of all CLI providers on the next request to /api/llm/providers.
// Use when the user has installed a new CLI tool or WSL distro and wants
// the front-end to pick it up without restarting the dev server.
export const dynamic = 'force-dynamic';
export async function POST() {
  clearLlmProbeCache();
  return NextResponse.json({ ok: true, message: 'Probe cache cleared — next /api/llm/providers call will re-probe' });
}
export async function GET() {
  return POST();
}
