import { useCallback } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { appAlert } from '@/components/ui/app-dialog';

export function useReflectExitGuard(blocked: boolean, message = 'Use Done on the results screen to finish reviewing your memories and privacy settings.') {
  usePreventRemove(blocked, useCallback(() => {
    appAlert('Finish your journal', message);
  }, [message]));
}
