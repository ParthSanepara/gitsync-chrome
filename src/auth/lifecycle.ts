import { browser } from 'wxt/browser';
import { clearCredentials } from './store';

/**
 * Sign out when the extension itself changes. Removing or reinstalling the extension already deletes its
 * storage, so only an in-place update needs handling here (DECISIONS 0014).
 */
export function signOutOnExtensionUpdate(): void {
  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'update') void clearCredentials();
  });
}
