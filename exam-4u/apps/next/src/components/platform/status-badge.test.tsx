// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { system } from '@/components/theme/system';
import { StatusBadge } from './status-badge';

/** Wraps every render in the real Chakra `system` — a bare React render without a `ChakraProvider`
 * throws (Chakra v3 components read theme context internally), matching how every real page in this
 * app is actually rendered (`components/ui/provider.tsx`). */
function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}

describe('StatusBadge', () => {
  it.each([
    ['Provisioning' as const],
    ['Active' as const],
    ['Suspended' as const],
    ['Failed' as const],
  ])('renders the %s status as a visible text label, not color alone (WCAG 2.2 AA)', (status) => {
    renderWithChakra(<StatusBadge status={status} />);
    expect(screen.getByText(status)).toBeInTheDocument();
  });

  it('renders a distinct badge element per status (never the same markup for two different statuses)', () => {
    const { unmount } = renderWithChakra(<StatusBadge status="Active" />);
    expect(screen.getByTestId('status-badge').textContent).toContain('Active');
    unmount();

    renderWithChakra(<StatusBadge status="Failed" />);
    expect(screen.getByTestId('status-badge').textContent).toContain('Failed');
  });
});
