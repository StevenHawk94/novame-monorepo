import ExpoModulesCore
import TikTokBusinessSDK

private enum TikTokEventsConfiguration {
  static let appIdKey = "BurrowTikTokAppId"
  static let tiktokAppIdKey = "BurrowTikTokBusinessAppId"
  static let accessTokenKey = "BurrowTikTokAccessToken"

  static func value(_ key: String) -> String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String else {
      return nil
    }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}

public class TikTokEventsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TikTokEvents")

    AsyncFunction("initialize") { (debug: Bool, promise: Promise) in
      if TikTokBusiness.isInitialized() {
        TikTokBusiness.setTrackingEnabled(true)
        promise.resolve(true)
        return
      }

      guard
        let appId = TikTokEventsConfiguration.value(TikTokEventsConfiguration.appIdKey),
        let tiktokAppId = TikTokEventsConfiguration.value(TikTokEventsConfiguration.tiktokAppIdKey),
        let accessToken = TikTokEventsConfiguration.value(TikTokEventsConfiguration.accessTokenKey),
        let config = TikTokConfig(
          accessToken: accessToken,
          appId: appId,
          tiktokAppId: tiktokAppId
        )
      else {
        promise.resolve(false)
        return
      }

      // Burrow reports deliberate funnel events only. Enhanced data postback
      // can inspect page/view metadata, and automatic payment logging can
      // double-count our verified StoreKit events, so both remain disabled.
      config.disableAutoEnhancedDataPostbackEvent()
      config.disablePaymentTracking()
      config.setLogLevel(debug ? TikTokLogLevelDebug : TikTokLogLevelSuppress)
      if debug {
        config.enableDebugMode()
      }

      // TikTok SDK 1.7.x never opens ATT itself. Burrow intentionally does not
      // request ATT, so IDFA stays unavailable while SKAdNetwork remains on.
      TikTokBusiness.initializeSdk(config) { success, error in
        if success {
          promise.resolve(true)
        } else {
          promise.reject(
            "ERR_TIKTOK_INITIALIZATION",
            error?.localizedDescription ?? "TikTok SDK initialization failed"
          )
        }
      }
    }

    Function("track") { (
      eventName: String,
      properties: [String: Any],
      eventId: String?
    ) in
      guard TikTokBusiness.isInitialized(), TikTokBusiness.isTrackingEnabled() else {
        return
      }
      let event = TikTokBaseEvent(
        eventName: eventName,
        properties: properties,
        eventId: eventId
      )
      TikTokBusiness.trackTTEvent(event)
    }

    Function("flush") {
      guard TikTokBusiness.isInitialized() else { return }
      TikTokBusiness.explicitlyFlush()
    }

    Function("disable") {
      guard TikTokBusiness.isInitialized() else { return }
      TikTokBusiness.setTrackingEnabled(false)
    }

    Function("getTestEventCode") { () -> String? in
      guard TikTokBusiness.isInitialized(), TikTokBusiness.isDebugMode() else {
        return nil
      }
      return TikTokBusiness.getTestEventCode()
    }
  }
}
