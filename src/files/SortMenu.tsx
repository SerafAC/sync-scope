import React from 'react';

import { FILE_SORTS, type FileSort } from '../native/CloudSyncContracts';
import { ChoiceMenu, type ChoiceOption } from './ChoiceMenu';
import { sortMenuLabel, sortOptionText } from './a11y';

const SORT_OPTIONS: readonly ChoiceOption<FileSort>[] = FILE_SORTS.map(
  sort => ({ value: sort, text: sortOptionText(sort) }),
);

/**
 * The sort drop-down (FR-001, FR-002): shows the current sort, for example
 * `Date (newest first)`, labelled `Sort: Date, newest first`, and opens the
 * six sorts with the current one marked.
 */
export function SortMenu({
  sort,
  onChange,
}: {
  sort: FileSort;
  onChange: (sort: FileSort) => void;
}): React.JSX.Element {
  return (
    <ChoiceMenu
      buttonLabel={sortMenuLabel(sort)}
      buttonText={sortOptionText(sort)}
      icon="sort"
      onChange={onChange}
      options={SORT_OPTIONS}
      testID="files-sort"
      value={sort}
    />
  );
}
