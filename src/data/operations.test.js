import { describe, expect, it } from 'vitest';
import { moveOperation } from './operations';
const leaf = (name) => ({ source: name, type: 'info' });
describe('ordered group editing', () => {
  it('moves forward and backward within a list without dropping items', () => {
    const files = [leaf('a'), leaf('b'), leaf('c')];
    expect(moveOperation(files, [0], [], 1).map((item) => item.source)).toEqual(
      ['b', 'a', 'c']
    );
    expect(moveOperation(files, [2], [], 0).map((item) => item.source)).toEqual(
      ['c', 'a', 'b']
    );
    expect(files[0].source).toBe('a');
  });
  it('moves into later sibling groups and back to the root', () => {
    const files = [leaf('a'), { Group: [leaf('b')] }];
    const moved = moveOperation(files, [0], [1]);
    expect(moved).toEqual([{ Group: [leaf('b'), leaf('a')] }]);
    expect(moveOperation(moved, [0, 1], [])).toEqual([
      { Group: [leaf('b')] },
      leaf('a'),
    ]);
  });
  it('prevents moving a group into itself or its descendants', () => {
    const files = [{ Group: [{ Nested: [] }] }];
    expect(() => moveOperation(files, [0], [0])).toThrow();
    expect(() => moveOperation(files, [0], [0, 0])).toThrow();
  });
  it('rejects an incomplete operation as a move destination', () => {
    const files = [leaf('a'), { source: 'unfinished.txt' }];
    expect(() => moveOperation(files, [0], [1])).toThrow('Select a group.');
    expect(files).toEqual([leaf('a'), { source: 'unfinished.txt' }]);
  });
});
