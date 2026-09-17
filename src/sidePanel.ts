import { browser } from 'wxt/browser';

/** Clicking the toolbar icon opens the side panel instead of a popup (SPEC §4). */
export async function openSidePanelOnActionClick(): Promise<void> {
  await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
