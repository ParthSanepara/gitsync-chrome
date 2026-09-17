import { defineBackground } from 'wxt/utils/define-background';
import { openSidePanelOnActionClick } from '@/src/sidePanel';

export default defineBackground(() => {
  void openSidePanelOnActionClick();
});
