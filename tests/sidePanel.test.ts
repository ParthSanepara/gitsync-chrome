import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { openSidePanelOnActionClick } from '@/src/sidePanel';

describe('openSidePanelOnActionClick', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('makes the toolbar action open the side panel', async () => {
    const setPanelBehavior = vi.spyOn(fakeBrowser.sidePanel, 'setPanelBehavior').mockResolvedValue(undefined);

    await openSidePanelOnActionClick();

    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });
});
