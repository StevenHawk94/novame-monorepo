import ExpoModulesCore
import WidgetKit

/**
 * Bridge between the RN app and the NovaMe home-screen widget.
 *
 * `syncLatestFriendReflect(payloadJson)` receives
 *   { state, name, createdAt, avatar?: { src },
 *     items: [{ src?, emoji }], totalItems }
 *   (items already capped at 6)
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

      // Shared copier: local file URI (release / expo-asset) or an http URL
      // (dev Metro assets, uploaded-avatar URLs).
      func copyIn(_ src: String, as name: String) -> String? {
        guard let url = URL(string: src) else { return nil }
        let dest = container.appendingPathComponent(name)
        if url.isFileURL {
          return (try? FileManager.default.copyItem(at: url, to: dest)) != nil ? name : nil
        }
        if let bytes = try? Data(contentsOf: url) {
          return (try? bytes.write(to: dest)) != nil ? name : nil
        }
        return nil
      }

      var outAvatar: String? = nil
      if let avatar = obj["avatar"] as? [String: Any], let src = avatar["src"] as? String {
        outAvatar = copyIn(src, as: "friend-widget/avatar")
      }

      var outItems: [[String: Any]] = []
      for (i, item) in items.prefix(6).enumerated() {
        var record: [String: Any] = ["emoji": (item["emoji"] as? String) ?? "✨"]
        if let src = item["src"] as? String,
           let name = copyIn(src, as: "friend-widget/item-\(i)") {
          record["file"] = name
        }
        outItems.append(record)
      }

      var out: [String: Any] = [
        "state": obj["state"] ?? "latest",
        "name": obj["name"] ?? "",
        "createdAt": obj["createdAt"] ?? "",
        "items": outItems,
        "totalItems": obj["totalItems"] ?? outItems.count,
      ]
      if let outAvatar { out["avatar"] = outAvatar }
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
