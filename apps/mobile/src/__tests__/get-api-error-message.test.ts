import { ApiException } from '@pako/shared';

import { getApiErrorMessage } from '@/api/client';

test('extracts a plain-text ApiException response', () => {
  const err = new ApiException('An unexpected server error occurred.', 400, 'Journal entry is unbalanced.', {}, undefined);
  expect(getApiErrorMessage(err)).toBe('Journal entry is unbalanced.');
});

test('extracts a JSON-string ApiException response', () => {
  const err = new ApiException('An unexpected server error occurred.', 400, JSON.stringify('Invalid customer/vendor partner for this company.'), {}, undefined);
  expect(getApiErrorMessage(err)).toBe('Invalid customer/vendor partner for this company.');
});

test('falls back to a generic message for a plain Error', () => {
  expect(getApiErrorMessage(new Error('Network request failed'))).toBe('Network request failed');
});

test('falls back to the provided default for an unknown error', () => {
  expect(getApiErrorMessage('oops', 'Something went wrong.')).toBe('Something went wrong.');
});
