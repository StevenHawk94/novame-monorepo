import { requireOptionalNativeModule } from 'expo';

export type TikTokEventProperties = Record<
  string,
  string | number | boolean | null
>;

type TikTokEventsNative = {
  initialize(debug: boolean): Promise<boolean>;
  track(
    eventName: string,
    properties: TikTokEventProperties,
    eventId: string | null,
  ): void;
  flush(): void;
  disable(): void;
  getTestEventCode(): string | null;
};

const TikTokEvents =
  requireOptionalNativeModule<TikTokEventsNative>('TikTokEvents');

export async function nativeInitializeTikTokEvents(
  debug: boolean,
): Promise<boolean> {
  if (!TikTokEvents) return false;
  return TikTokEvents.initialize(debug);
}

export function nativeTrackTikTokEvent(
  eventName: string,
  properties: TikTokEventProperties = {},
  eventId: string | null = null,
): void {
  TikTokEvents?.track(eventName, properties, eventId);
}

export function nativeFlushTikTokEvents(): void {
  TikTokEvents?.flush();
}

export function nativeDisableTikTokEvents(): void {
  TikTokEvents?.disable();
}

export function nativeTikTokTestEventCode(): string | null {
  return TikTokEvents?.getTestEventCode() ?? null;
}
