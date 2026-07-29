import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthSidePanel from './AuthSidePanel';
import { supabase } from '../lib/supabase';

vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}));

describe('AuthSidePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('setInterval', vi.fn(() => 1));
    vi.stubGlobal('clearInterval', vi.fn());
  });

  it('shows a fallback recruiter count when the live count request fails', async () => {
    vi.mocked(supabase.rpc).mockRejectedValueOnce(new Error('boom'));

    render(
      <MemoryRouter>
        <AuthSidePanel />
      </MemoryRouter>
    );

    expect(await screen.findByText(/500\+/i)).toBeInTheDocument();
  });
});
