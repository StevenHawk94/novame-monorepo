import WidgetKit
import SwiftUI

// NovaMe "Friend Reflect" widget — shows the latest friend feed entry:
// avatar circle, friend name, up to 6 memory-item icons and a relative
// timestamp. The app writes the payload (JSON + copied item images) into
// the shared App Group container on every friend-feed fetch; the widget
// only re-renders it. Timeline entries every 15 minutes keep the
// "Xm ago" label honest between app launches.

private let appGroup = "group.com.novame.app"
private let payloadKey = "widget.latestFriendReflect"

// MARK: - Payload

struct FriendItem: Decodable {
  let file: String?
  let emoji: String
}

struct FriendPayload: Decodable {
  let name: String
  let createdAt: String
  let items: [FriendItem]
}

struct FriendReflect {
  let name: String
  let date: Date?
  let tiles: [(image: UIImage?, emoji: String)]
}

func loadLatestReflect() -> FriendReflect? {
  guard let defaults = UserDefaults(suiteName: appGroup),
        let raw = defaults.string(forKey: payloadKey),
        let data = raw.data(using: .utf8),
        let payload = try? JSONDecoder().decode(FriendPayload.self, from: data)
  else { return nil }

  let withFraction = ISO8601DateFormatter()
  withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let date = withFraction.date(from: payload.createdAt)
    ?? ISO8601DateFormatter().date(from: payload.createdAt)

  let container = FileManager.default
    .containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  let tiles = payload.items.prefix(6).map { item -> (UIImage?, String) in
    guard let file = item.file, let container else { return (nil, item.emoji) }
    let image = UIImage(contentsOfFile: container.appendingPathComponent(file).path)
    return (image, item.emoji)
  }
  return FriendReflect(name: payload.name, date: date, tiles: Array(tiles))
}

func sampleReflect(now: Date) -> FriendReflect {
  FriendReflect(
    name: "Mochi",
    date: now.addingTimeInterval(-15 * 60),
    tiles: ["☕", "📖", "🍜", "🌇", "🐱", "🎂"].map { (nil, $0) }
  )
}

// MARK: - Timeline

struct ReflectEntry: TimelineEntry {
  let date: Date
  let reflect: FriendReflect?
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> ReflectEntry {
    ReflectEntry(date: Date(), reflect: sampleReflect(now: Date()))
  }

  func getSnapshot(in context: Context, completion: @escaping (ReflectEntry) -> Void) {
    let now = Date()
    let reflect = context.isPreview ? (loadLatestReflect() ?? sampleReflect(now: now)) : loadLatestReflect()
    completion(ReflectEntry(date: now, reflect: reflect))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<ReflectEntry>) -> Void) {
    let now = Date()
    let reflect = loadLatestReflect()
    // Re-render every 15 minutes so the relative time stays fresh.
    let entries = (0..<16).map { step in
      ReflectEntry(date: now.addingTimeInterval(Double(step) * 15 * 60), reflect: reflect)
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }
}

// MARK: - View

func relativeLabel(_ date: Date?, now: Date) -> String {
  guard let date else { return "" }
  let mins = max(0, Int(now.timeIntervalSince(date) / 60))
  if mins < 1 { return "now" }
  if mins < 60 { return "\(mins)m ago" }
  let hours = mins / 60
  if hours < 24 { return "\(hours)h ago" }
  return "\(hours / 24)d ago"
}

private let cardText = Color(red: 0.16, green: 0.16, blue: 0.16)
private let mutedText = Color(red: 0.58, green: 0.52, blue: 0.44)
private let tileFill = Color(red: 0.965, green: 0.933, blue: 0.875) // #F6EEDF
private let avatarFill = Color(red: 0.957, green: 0.945, blue: 0.973)

struct FriendReflectView: View {
  var entry: ReflectEntry

  var body: some View {
    Group {
      if let reflect = entry.reflect {
        VStack(alignment: .leading, spacing: 14) {
          HStack(spacing: 10) {
            ZStack {
              Circle().fill(avatarFill)
              Text("🐰").font(.system(size: 21))
            }
            .frame(width: 42, height: 42)
            Text(reflect.name)
              .font(.system(size: 17, weight: .bold))
              .foregroundColor(cardText)
              .lineLimit(1)
            Spacer(minLength: 6)
            Text(relativeLabel(reflect.date, now: entry.date))
              .font(.system(size: 11, weight: .medium))
              .foregroundColor(mutedText)
          }
          HStack(spacing: 8) {
            ForEach(0..<min(reflect.tiles.count, 6), id: \.self) { i in
              ZStack {
                RoundedRectangle(cornerRadius: 12, style: .continuous).fill(tileFill)
                if let image = reflect.tiles[i].image {
                  Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                } else {
                  Text(reflect.tiles[i].emoji).font(.system(size: 24))
                }
              }
              .frame(width: 44, height: 44)
            }
            Spacer(minLength: 0)
          }
        }
      } else {
        VStack(spacing: 8) {
          Text("🐰").font(.system(size: 30))
          Text("No friend reflects yet")
            .font(.system(size: 14, weight: .bold))
            .foregroundColor(cardText)
          Text("Pair with a friend in NovaMe to see their latest memories here.")
            .font(.system(size: 11))
            .foregroundColor(mutedText)
            .multilineTextAlignment(.center)
        }
      }
    }
    .containerBackground(for: .widget) {
      Color(red: 1.0, green: 0.973, blue: 0.933) // #FFF8EE
    }
  }
}

// MARK: - Widget

struct FriendReflectWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "NovaMeFriendReflect", provider: Provider()) { entry in
      FriendReflectView(entry: entry)
    }
    .configurationDisplayName("Friend Reflects")
    .description("The latest memory drop from your friend.")
    .supportedFamilies([.systemMedium])
  }
}

@main
struct NovaMeWidgetBundle: WidgetBundle {
  var body: some Widget {
    FriendReflectWidget()
  }
}
