import { act, fireEvent, render, screen } from '@testing-library/react';
import { useStore } from '../../store';
import { ToastContainer } from './ToastContainer';

describe('ToastContainer', () => {
  beforeEach(() => {
    useStore.setState({ toasts: [] });
  });

  test('renders and dismisses a toast', () => {
    render(<ToastContainer />);

    act(() => {
      useStore
        .getState()
        .addToast({ type: 'error', title: 'Error', message: 'Something broke.' });
    });

    expect(screen.getByTestId('toast')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('toast-close'));
    expect(screen.queryByTestId('toast')).not.toBeInTheDocument();
  });
});
