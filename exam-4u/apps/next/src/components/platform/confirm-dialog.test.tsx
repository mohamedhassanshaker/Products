// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChakraProvider } from '@chakra-ui/react';
import { system } from '@/components/theme/system';
import { ConfirmDialog } from './confirm-dialog';

function renderWithChakra(ui: React.ReactElement) {
  return render(<ChakraProvider value={system}>{ui}</ChakraProvider>);
}

describe('ConfirmDialog', () => {
  it('renders nothing interactive when closed', () => {
    renderWithChakra(
      <ConfirmDialog open={false} title="t" message="m" confirmLabel="Go" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByTestId('confirm-dialog-confirm')).not.toBeInTheDocument();
  });

  it('calls onConfirm when the confirm button is clicked and no typed confirmation is required', () => {
    const onConfirm = vi.fn();
    renderWithChakra(
      <ConfirmDialog open title="Suspend 'Acme'?" message="Users will be signed out." confirmLabel="Suspend" onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('confirm-dialog-confirm'));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it(
    'requireTypedConfirmation: keeps the confirm button disabled until the admin types the exact required string ' +
      '(this dispatch\'s own stronger-confirmation-for-soft-delete judgment call)',
    () => {
      const onConfirm = vi.fn();
      renderWithChakra(
        <ConfirmDialog
          open
          title="Delete 'Acme'?"
          message="This is far harder to undo than a suspension."
          confirmLabel="Delete tenant"
          tone="danger"
          requireTypedConfirmation="Acme"
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      );

      const confirmButton = screen.getByTestId('confirm-dialog-confirm');
      expect(confirmButton).toBeDisabled();

      const input = screen.getByTestId('confirm-dialog-typed-input');
      fireEvent.change(input, { target: { value: 'Acm' } });
      expect(confirmButton).toBeDisabled();

      fireEvent.change(input, { target: { value: 'Acme' } });
      expect(confirmButton).not.toBeDisabled();

      fireEvent.click(confirmButton);
      expect(onConfirm).toHaveBeenCalledOnce();
    },
  );

  it('calls onCancel when the cancel button is clicked', () => {
    const onCancel = vi.fn();
    renderWithChakra(<ConfirmDialog open title="t" message="m" confirmLabel="Go" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
