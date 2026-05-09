import { ORCHESTRATORS, getOrchestratorsByTier, getOrchestratorByName } from '../src/orchestrators/registry';

test('getOrchestratorsByTier(1) includes orch', () => {
  expect(getOrchestratorsByTier(1).map(o => o.name)).toContain('orch');
});

test('getOrchestratorsByTier(2) is empty', () => {
  expect(getOrchestratorsByTier(2)).toHaveLength(0);
});

test('getOrchestratorByName orch is defined', () => {
  expect(getOrchestratorByName('orch')).toBeDefined();
});

test('getOrchestratorByName unknown returns undefined', () => {
  expect(getOrchestratorByName('nope')).toBeUndefined();
});

test('orch buildArgs returns path + prompt', () => {
  const orch = getOrchestratorByName('orch')!;
  const args = orch.buildArgs('my prompt');
  expect(args[args.length - 1]).toBe('my prompt');
});

test('orch bin is process.execPath', () => {
  expect(getOrchestratorByName('orch')!.bin()).toBe(process.execPath);
});