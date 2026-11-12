import { expect, it } from 'vitest';
import { app } from './app.js';
it('does not expose removed analysis products or model credential writes', async () => {
  for (const path of ['/api/backtests/', '/api/wyckoff-ai-backtests/', '/api/recommend/run']) {
    const response = await app.request(path, {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    expect(response.status, path).toBe(404);
  }
});
