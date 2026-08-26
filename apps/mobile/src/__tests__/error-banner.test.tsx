import { render, screen } from '@testing-library/react-native';

import { ErrorBanner } from '@/components/ui/error-banner';

test('renders the error message', async () => {
  await render(<ErrorBanner message="Could not load companies." />);

  expect(screen.getByText('Could not load companies.')).toBeTruthy();
});
