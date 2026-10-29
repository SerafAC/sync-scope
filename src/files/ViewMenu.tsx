import React from 'react';

import { ChoiceMenu, type ChoiceOption } from './ChoiceMenu';
import { VIEW_LABEL, viewMenuLabel } from './a11y';
import type { FilesView } from './useFiles';

const VIEW_OPTIONS: readonly ChoiceOption<FilesView>[] = [
  { value: 'GALLERY', text: VIEW_LABEL.GALLERY },
  { value: 'LIST', text: VIEW_LABEL.LIST },
  { value: 'TREE', text: VIEW_LABEL.TREE },
];

const VIEW_ICON: Readonly<Record<FilesView, string>> = {
  GALLERY: 'view-grid-outline',
  LIST: 'format-list-bulleted',
  TREE: 'file-tree-outline',
};

/**
 * The view-mode drop-down (FR-001): shows the current view, labelled
 * `View: Gallery`, `View: List` or `View: Tree`, and opens the three views
 * with the current one marked. Tree is the third choice (009 FR-001).
 */
export function ViewMenu({
  view,
  onChange,
}: {
  view: FilesView;
  onChange: (view: FilesView) => void;
}): React.JSX.Element {
  return (
    <ChoiceMenu
      buttonLabel={viewMenuLabel(view)}
      buttonText={VIEW_LABEL[view]}
      icon={VIEW_ICON[view]}
      onChange={onChange}
      options={VIEW_OPTIONS}
      testID="files-view"
      value={view}
    />
  );
}
