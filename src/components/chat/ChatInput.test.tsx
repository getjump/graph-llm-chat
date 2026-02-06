import { fireEvent, render, screen } from '@testing-library/react';
import { ChatInput } from './ChatInput';
import type { PendingAttachment } from '../../types';

describe('ChatInput', () => {
  test('submits attachments without fallback text', () => {
    const onSubmit = vi.fn();
    const attachment: PendingAttachment = {
      id: 'att-1',
      name: 'notes.txt',
      size: 12,
      type: 'text/plain',
      lastModified: 1,
      source: 'memory',
      file: new File(['hello world'], 'notes.txt', { type: 'text/plain' }),
    };

    render(<ChatInput onSubmit={onSubmit} initialAttachments={[attachment]} />);

    fireEvent.click(screen.getByTestId('send-message'));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('', [attachment]);
  });
});
