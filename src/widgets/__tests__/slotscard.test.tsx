// @vitest-environment jsdom
/**
 * /slots rendering rules.
 *
 * Upstream serializes the task block from `task ? task : task_prev`
 * (server-context.cpp `server_slot::to_json`), so an idle slot echoes the
 * previous task's prompt counters and a never-used slot omits them
 * entirely. The card must not present either as current state.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SlotsCard } from '../SlotsCard';
import type { SlotInfo, SlotParams } from '../../lib/api';

const PARAMS = { temperature: 0.7, top_k: 40, seed: 1 } as unknown as SlotParams;

const slot = (over: Partial<SlotInfo>): SlotInfo => ({
  id: 0,
  n_ctx: 4096,
  speculative: false,
  is_processing: false,
  ...over,
});

// vitest runs without `globals`, so RTL's auto-cleanup is not registered
afterEach(cleanup);

describe('SlotsCard', () => {
  it('labels an idle slot\'s prompt counters as the last task, not current', () => {
    render(
      <SlotsCard
        slots={[
          slot({
            is_processing: false,
            n_prompt_tokens: 52084,
            n_prompt_tokens_processed: 0,
            n_prompt_tokens_cache: 400,
          }),
        ]}
        fmt="raw"
      />,
    );
    expect(screen.getByText(/idle/)).toBeTruthy();
    // the old card rendered "prompt 52,084 (processed 0)", which reads as a
    // 52k prompt currently pending on an idle slot
    expect(screen.getByText(/last task: prompt 52,084/)).toBeTruthy();
    expect(screen.queryByText(/processed 0/)).toBeNull();
  });

  it('shows live progress while the slot is processing', () => {
    render(
      <SlotsCard
        slots={[
          slot({
            is_processing: true,
            n_prompt_tokens: 1000,
            n_prompt_tokens_processed: 250,
            n_prompt_tokens_cache: 0,
          }),
        ]}
        fmt="raw"
      />,
    );
    expect(screen.getByText(/prompt 1,000 · processed 250/)).toBeTruthy();
    expect(screen.queryByText(/last task/)).toBeNull();
  });

  it('handles a slot that has never run a task (fresh server)', () => {
    // upstream returns only {id, n_ctx, speculative, is_processing} here;
    // expanding such a row used to dereference the absent params object
    render(<SlotsCard slots={[slot({})]} fmt="human" />);
    expect(screen.getByText(/no task yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText(/no sampling params reported yet/)).toBeTruthy();
  });

  it('marks an expanded idle slot\'s sampling params as historical', () => {
    render(<SlotsCard slots={[slot({ n_prompt_tokens: 10, params: PARAMS })]} fmt="human" />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('params of the last task')).toBeTruthy();
    expect(screen.getByText('temperature')).toBeTruthy();
  });
});
