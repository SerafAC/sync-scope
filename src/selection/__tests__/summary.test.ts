import {selectionSummary, type SelectionItem} from '../summary';

function items(
  entries: Array<[string, SelectionItem]>,
): ReadonlyMap<string, SelectionItem> {
  return new Map(entries);
}

const syncedImage: SelectionItem = {sizeBytes: 70, status: 'SYNCED', isImage: true};
const unsyncedImage: SelectionItem = {sizeBytes: 30, status: 'UNSYNCED', isImage: true};
const unknownImage: SelectionItem = {sizeBytes: null, status: 'UNKNOWN', isImage: true};
const syncedText: SelectionItem = {sizeBytes: 5, status: 'SYNCED', isImage: false};

describe('selectionSummary', () => {
  it('is all zero for an empty selection', () => {
    expect(selectionSummary(new Map(), 'GALLERY', 'ALL')).toEqual({
      count: 0,
      knownBytes: 0,
      unknownSizeCount: 0,
      hiddenByFilterCount: 0,
    });
  });

  it('counts every item and sums only the known sizes', () => {
    const selection = items([
      ['a', syncedImage],
      ['b', unsyncedImage],
      ['c', unknownImage],
      ['d', {sizeBytes: 0, status: 'SYNCED', isImage: true}],
    ]);

    expect(selectionSummary(selection, 'LIST', 'ALL')).toEqual({
      count: 4,
      knownBytes: 100,
      unknownSizeCount: 1,
      hiddenByFilterCount: 0,
    });
  });

  it.each([
    ['ALL', 0],
    ['SYNCED', 2],
    ['UNSYNCED', 3],
    ['ISSUES_UNKNOWN', 3],
  ] as const)(
    'counts items whose status is not in the %s filter as hidden',
    (filter, hidden) => {
      const selection = items([
        ['a', syncedImage],
        ['b', unsyncedImage],
        ['c', unknownImage],
        ['d', syncedText],
      ]);

      const summary = selectionSummary(selection, 'LIST', filter);

      expect(summary.hiddenByFilterCount).toBe(hidden);
      // Hidden items still count and still add up.
      expect(summary.count).toBe(4);
      expect(summary.knownBytes).toBe(105);
    },
  );

  it('counts a non-image as hidden in gallery view only', () => {
    const selection = items([
      ['a', syncedImage],
      ['d', syncedText],
    ]);

    expect(selectionSummary(selection, 'GALLERY', 'ALL').hiddenByFilterCount).toBe(1);
    expect(selectionSummary(selection, 'LIST', 'ALL').hiddenByFilterCount).toBe(0);
  });

  it('counts an item hidden by both rules once', () => {
    const selection = items([['d', {...syncedText, status: 'UNSYNCED'}]]);

    expect(
      selectionSummary(selection, 'GALLERY', 'SYNCED').hiddenByFilterCount,
    ).toBe(1);
  });
});
