import { defineBackground } from 'wxt/utils/define-background';
import { signOutOnExtensionUpdate } from '@/src/auth/lifecycle';
import { openSidePanelOnActionClick } from '@/src/sidePanel';

export default defineBackground(() => {
  void openSidePanelOnActionClick();
  signOutOnExtensionUpdate();
});
