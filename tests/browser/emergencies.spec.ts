import { expect, test } from '@playwright/test';

test('responders visibly use buckets and bandages, and water throws animate', async ({ page }) => {
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/response-fixture', route => route.fulfill({ contentType: 'text/html', body: '<canvas width="128" height="128"></canvas>' }));
  await page.goto('/response-fixture');
  const result = await page.evaluate(async () => {
    const path = '/src/render/residents.ts', { drawResidentSprite } = await import(path);
    const canvas = document.querySelector('canvas')!, ctx = canvas.getContext('2d')!;
    const draw = (action: string, tool?: string, work = 0) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, 128, 128); ctx.translate(48, 70);
      drawResidentSprite(ctx, { action, tool, work, heading: 0 }); return canvas.toDataURL();
    };
    const idle = draw('idle'), bucket = draw('walk', 'bucket'), bandage = draw('aid', 'bandage');
    const frames = new Set<string>(); let drops = 0;
    for (let i = 0; i < 20; i++) {
      frames.add(draw('extinguish', 'bucket', i / 20));
      const data = ctx.getImageData(58, 45, 35, 30).data;
      for (let n = 0; n < data.length; n += 4) if (data[n + 2] > data[n] && data[n + 1] > 150 && data[n + 3]) drops++;
    }
    return { distinct: new Set([idle, bucket, bandage]).size, frames: frames.size, drops };
  });
  expect(result.distinct).toBe(3); expect(result.frames).toBeGreaterThan(12); expect(result.drops).toBeGreaterThan(20);
});
