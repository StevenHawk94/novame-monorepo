import { useLocalSearchParams, useRouter } from 'expo-router';

import { ItemSheet, type ItemSheetScope } from '@/components/main/item-sheet';

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export default function ItemSheetScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    itemId?: string | string[];
    scope?: string | string[];
    expectedOwnerUserId?: string | string[];
  }>();
  const itemId = firstParam(params.itemId);
  const rawScope = firstParam(params.scope);
  const scope: ItemSheetScope = rawScope === 'their' || rawScope === 'ours' ? rawScope : 'mine';
  const expectedOwnerUserId = firstParam(params.expectedOwnerUserId) || undefined;

  return (
    <ItemSheet
      itemId={itemId}
      scope={scope}
      expectedOwnerUserId={expectedOwnerUserId}
      onClose={() => router.back()}
      onOpenReflect={(reflectId) => {
        router.push({ pathname: '/(main)/reflect-detail', params: { reflectId } });
      }}
    />
  );
}
