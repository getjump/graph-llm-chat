import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function ProblemChild() {
  throw new Error('Boom');
}

describe('ErrorBoundary', () => {
  test('renders fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ProblemChild />
      </ErrorBoundary>
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Boom')).toBeInTheDocument();
  });
});
