import React from 'react';

import { ChoiceMenu, type ChoiceOption } from './ChoiceMenu';
import { VIEW_LABEL, viewMenuLabel } from './a11y';
import type { FilesView } from './useFiles';

const VIEW_OPTIONS: readonly ChoiceOption<FilesView>[] = [
  { value: 'GALLERY', text: VIEW_LABEL.GALLERY },
  { value: 'LIST', text: VIEW_LABEL.LIST },
];

const VIEW_ICON: Readonly<Record<FilesView, string>> = {
  GALLERY: 'view-grid-outline',
  LIST: 'format-list-bulleted',
};

/**
 * The view-mode drop-down (FR-001): shows the current view, labelled
 * `View: Gallery` or `View: List`, and opens both views with the current one
 * marked. Feature 008 adds the tree view here.
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
