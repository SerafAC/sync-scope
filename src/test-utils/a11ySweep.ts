import type {RenderResult} from '@testing-library/react-native';
import type {ReactTestInstance} from 'react-test-renderer';

/** Roles that make an element an interactive control the user must be able to name. */
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'checkbox',
  'togglebutton',
  'tab',
]);

function isInteractive(node: ReactTestInstance): boolean {
  const {onPress, accessibilityRole, role} = node.props;
  return (
    typeof onPress === 'function' ||
    INTERACTIVE_ROLES.has(accessibilityRole) ||
    INTERACTIVE_ROLES.has(role)
  );
}

function labelOf(node: ReactTestInstance): string {
  const label = node.props.accessibilityLabel ?? node.props['aria-label'];
  return typeof label === 'string' ? label.trim() : '';
}

/** The first host (native) element at or below `node`, which is what a screen reader sees. */
function hostOf(node: ReactTestInstance): ReactTestInstance | null {
  if (typeof node.type === 'string') {
    return node;
  }
  for (const child of node.children) {
    if (typeof child !== 'string') {
      const host = hostOf(child);
      if (host != null) {
        return host;
      }
    }
  }
  return null;
}

function textOf(node: ReactTestInstance): string {
  return node.children
    .map(child => (typeof child === 'string' ? child : textOf(child)))
    .join('');
}

/**
 * Fails when any interactive element in a rendered tree has no accessibility
 * label (FR-004, SC-003): every node with `onPress`, or with a button, link,
 * checkbox, togglebutton or tab role, must carry a non-empty
 * `accessibilityLabel`, either itself or on the native element it renders
 * (so wrapper components that forward the label pass). The error names each
 * offending node by its text.
 */
export function a11ySweep(result: Pick<RenderResult, 'UNSAFE_root'>): void {
  const offenders = new Set<ReactTestInstance>();
  for (const node of result.UNSAFE_root.findAll(isInteractive)) {
    const host = hostOf(node);
    if (labelOf(node) === '' && (host == null || labelOf(host) === '')) {
      offenders.add(host ?? node);
    }
  }
  if (offenders.size > 0) {
    const names = [...offenders].map(node => {
      const text = textOf(node).trim();
      return `  - ${
        text === '' ? `<${String(node.type)} without text>` : `"${text}"`
      }`;
    });
    throw new Error(
      `Interactive elements without an accessibilityLabel:\n${names.join(
        '\n',
      )}`,
    );
  }
}
