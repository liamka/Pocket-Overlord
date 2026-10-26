import { paintOceanChunk } from './ocean-texture';

self.onmessage = ({ data }: MessageEvent<{ id: number; x: number; y: number; stride: number; seed: number }>) => {
  const canvas = new OffscreenCanvas(256, 256);
  paintOceanChunk(canvas.getContext('2d', { alpha: false })!, data.x, data.y, data.stride, data.seed);
  const bitmap = canvas.transferToImageBitmap();
  self.postMessage({ id: data.id, bitmap }, { transfer: [bitmap] });
};
