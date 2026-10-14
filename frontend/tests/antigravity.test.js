import { expect, test } from 'bun:test';
import { particleTarget, advanceParticle } from '../src/Antigravity.js';

const particle = () => ({ t: 0, speed: .01, mx: 2, my: 0, mz: 1, cx: 2, cy: 0, cz: 1, randomRadiusOffset: 0 });
const settings = { magnetRadius: 6, ringRadius: 7, waveSpeed: .4, waveAmplitude: 0, lerpSpeed: .05, rotationSpeed: 0, depthFactor: 1, fieldStrength: 10 };

test('nearby particles form the ring; distant particles return to their own positions', () => {
  expect(particleTarget(particle(), 0, 0, 0, settings)).toEqual({ x: 7, y: 0, z: 1 });
  expect(particleTarget(particle(), 30, 30, 0, settings)).toEqual({ x: 2, y: 0, z: 1 });
});

test('particle movement has the same timing at 30 and 60 fps', () => {
  const a = particle(), b = particle();
  const target = { x: 7, y: 0, z: 1 };
  for (let i = 0; i < 60; i++) advanceParticle(a, target, 1 / 60, settings.lerpSpeed);
  for (let i = 0; i < 30; i++) advanceParticle(b, target, 1 / 30, settings.lerpSpeed);
  expect(a.cx).toBeCloseTo(b.cx, 10);
  expect(a.t).toBeCloseTo(b.t, 10);
});
