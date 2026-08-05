import ExpoModulesCore
import WidgetKit

/**
 * Bridge between the RN app and the NovaMe home-screen widget.
 *
 * `syncLatestFriendReflect(payloadJson)` receives
 *   { name, createdAt, items: [{ src?, emoji }] }   (items already capped at 6)
 * where `src` is a local file URI (release / expo-asset) or a Metro http URL
 * (dev). Each image is copied into the App Group container, the rewritten
 * payload is stored in shared UserDefaults, and WidgetKit reloads.
 */
public class WidgetSyncModule: Module {
  private let appGroup = "group.com.novame.app"
  private let payloadKey = "widget.latestFriendReflect"

  public func definition() -> ModuleDefinition {
    Name("WidgetSync")

    AsyncFunction("syncLatestFriendReflect") { (payloadJson: String) -> Bool in
      guard
        let data = payloadJson.data(using: .utf8),
        let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let items = obj["items"] as? [[String: Any]],
        let container = FileManager.default
          .containerURL(forSecurityApplicationGroupIdentifier: self.appGroup)
      else { return false }

      let dir = container.appendingPathComponent("friend-widget", isDirectory: true)
      try? FileManager.default.removeItem(at: dir)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

      var outItems: [[String: Any]] = []
      for (i, item) in items.prefix(6).enumerated() {
        var record: [String: Any] = ["emoji": (item["emoji"] as? String) ?? "✨"]
        if let src = item["src"] as? String, let url = URL(string: src) {
          let name = "friend-widget/item-\(i)"
          let dest = container.appendingPathComponent(name)
          if url.isFileURL {
            if (try? FileManager.default.copyItem(at: url, to: dest)) != nil {
              record["file"] = name
            }
          } else if let bytes = try? Data(contentsOf: url) { // dev: Metro asset URL
            if (try? bytes.write(to: dest)) != nil {
              record["file"] = name
            }
          }
        }
        outItems.append(record)
      }

      let out: [String: Any] = [
        "name": obj["name"] ?? "",
        "createdAt": obj["createdAt"] ?? "",
        "items": outItems,
      ]
      guard
        let outData = try? JSONSerialization.data(withJSONObject: out),
        let outJson = String(data: outData, encoding: .utf8),
        let defaults = UserDefaults(suiteName: self.appGroup)
      else { return false }

      defaults.set(outJson, forKey: self.payloadKey)
      WidgetCenter.shared.reloadAllTimelines()
      return true
    }
  }
}
