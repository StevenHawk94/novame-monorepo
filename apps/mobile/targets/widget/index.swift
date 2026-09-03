import WidgetKit
import SwiftUI

// Burrow Paired widget — distinguishes unpaired, paired-but-empty, and the
// latest shared moment. The app writes JSON + copied images into the shared
// App Group whenever pairing/feed state changes; the widget only renders it.
// Timeline entries every 15 minutes keep the "Xm ago" label honest.

private let appGroup = "group.com.novame.app"
private let payloadKey = "widget.latestFriendReflect"

// MARK: - Payload

struct FriendItem: Decodable {
  let file: String?
  let emoji: String
}

struct FriendPayload: Decodable {
  let state: String?
  let name: String?
  let createdAt: String?
  let avatar: String?
  let items: [FriendItem]?
  let totalItems: Int?
}

enum FriendWidgetState: String {
  case unpaired
  case empty
  case latest
}

struct FriendReflect {
  let state: FriendWidgetState
  let name: String
  let date: Date?
  let avatar: UIImage?
  let tiles: [(image: UIImage?, emoji: String)]
  let totalItems: Int
}

func loadLatestReflect() -> FriendReflect {
  guard let defaults = UserDefaults(suiteName: appGroup),
        let raw = defaults.string(forKey: payloadKey),
        let data = raw.data(using: .utf8),
        let payload = try? JSONDecoder().decode(FriendPayload.self, from: data)
  else {
    return FriendReflect(
      state: .unpaired, name: "", date: nil, avatar: nil, tiles: [], totalItems: 0
    )
  }

  let withFraction = ISO8601DateFormatter()
  withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  let createdAt = payload.createdAt ?? ""
  let date = withFraction.date(from: createdAt)
    ?? ISO8601DateFormatter().date(from: createdAt)

  let container = FileManager.default
    .containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  let payloadItems = payload.items ?? []
  let tiles = payloadItems.prefix(6).map { item -> (UIImage?, String) in
    guard let file = item.file, let container else { return (nil, item.emoji) }
    let image = UIImage(contentsOfFile: container.appendingPathComponent(file).path)
    return (image, item.emoji)
  }
  var avatar: UIImage? = nil
  if let file = payload.avatar, let container {
    avatar = UIImage(contentsOfFile: container.appendingPathComponent(file).path)
  }
  let inferredState: FriendWidgetState = createdAt.isEmpty ? .unpaired : .latest
  let state = FriendWidgetState(rawValue: payload.state ?? "") ?? inferredState
  return FriendReflect(
    state: state,
    name: payload.name ?? "",
    date: date,
    avatar: avatar,
    tiles: Array(tiles),
    totalItems: max(payload.totalItems ?? payloadItems.count, payloadItems.count)
  )
}

func sampleReflect(now: Date) -> FriendReflect {
  FriendReflect(
    state: .latest,
    name: "Mochi",
    date: now.addingTimeInterval(-15 * 60),
    avatar: nil,
    tiles: ["☕", "📖", "🍜", "🌇", "🐱", "🎂"].map { (nil, $0) },
    totalItems: 8
  )
}

// MARK: - Timeline

struct ReflectEntry: TimelineEntry {
  let date: Date
  let reflect: FriendReflect
}

struct Provider: TimelineProvider {
  func placeholder(in context: Context) -> ReflectEntry {
    ReflectEntry(date: Date(), reflect: sampleReflect(now: Date()))
  }

  func getSnapshot(in context: Context, completion: @escaping (ReflectEntry) -> Void) {
    let now = Date()
    let reflect = context.isPreview ? sampleReflect(now: now) : loadLatestReflect()
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
private let mutedText = Color(red: 0.37, green: 0.27, blue: 0.20)
private let avatarFill = Color(red: 0.957, green: 0.945, blue: 0.973)
private let gridBase = Color(red: 0.976, green: 0.863, blue: 0.722) // #F9DCB8
private let gridLine = Color(red: 1.0, green: 0.925, blue: 0.784)   // #FFECC8

struct PairedGridBackground: View {
  private let cell: CGFloat = 25

  var body: some View {
    Canvas { context, size in
      context.fill(Path(CGRect(origin: .zero, size: size)), with: .color(gridBase))
      var grid = Path()
      for x in stride(from: CGFloat.zero, through: size.width + cell, by: cell) {
        grid.move(to: CGPoint(x: x, y: 0))
        grid.addLine(to: CGPoint(x: x, y: size.height))
      }
      for y in stride(from: CGFloat.zero, through: size.height + cell, by: cell) {
        grid.move(to: CGPoint(x: 0, y: y))
        grid.addLine(to: CGPoint(x: size.width, y: y))
      }
      context.stroke(grid, with: .color(gridLine), lineWidth: 2)
    }
  }
}

struct EmptyWidgetView: View {
  let title: String
  let message: String

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title)
        .font(.system(size: 17, weight: .heavy))
        .foregroundColor(cardText)
        .lineLimit(1)
      Text(message)
        .font(.system(size: 13, weight: .medium))
        .foregroundColor(mutedText)
        .multilineTextAlignment(.leading)
        .lineLimit(3)
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
  }
}

struct ItemTile: View {
  let image: UIImage?
  let emoji: String
  let size: CGFloat

  var body: some View {
    ZStack {
      if let image {
        Image(uiImage: image)
          .resizable()
          .scaledToFit()
          .frame(width: size, height: size)
      } else {
        Text(emoji).font(.system(size: size * 0.55))
      }
    }
    .frame(width: size, height: size)
  }
}

struct OverflowTile: View {
  let count: Int
  let size: CGFloat

  var body: some View {
    ZStack {
      Text("+\(count)")
        .font(.system(size: max(15, size * 0.34), weight: .bold))
        .foregroundColor(cardText)
    }
    .frame(width: size, height: size)
    .accessibilityLabel("\(count) more items")
  }
}

struct LatestReflectView: View {
  let reflect: FriendReflect
  let now: Date

  private let maxSlots = 6

  private var visibleTileCount: Int {
    let limit = reflect.totalItems > maxSlots ? maxSlots - 1 : maxSlots
    return min(reflect.tiles.count, limit)
  }

  private var overflowCount: Int {
    max(0, reflect.totalItems - visibleTileCount)
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 10) {
        ZStack {
          Circle().fill(avatarFill)
          if let avatar = reflect.avatar {
            Image(uiImage: avatar)
              .resizable()
              .scaledToFill()
              .frame(width: 42, height: 42)
              .clipShape(Circle())
          } else {
            Text("🐰").font(.system(size: 21))
          }
        }
        .frame(width: 42, height: 42)
        Text(reflect.name)
          .font(.system(size: 17, weight: .bold))
          .foregroundColor(cardText)
          .lineLimit(1)
        Spacer(minLength: 6)
        Text(relativeLabel(reflect.date, now: now))
          .font(.system(size: 11, weight: .medium))
          .foregroundColor(mutedText)
      }
      GeometryReader { geometry in
        let spacing: CGFloat = 8
        let tileSize = max(1, (geometry.size.width - spacing * CGFloat(maxSlots - 1)) / CGFloat(maxSlots))
        HStack(spacing: spacing) {
          ForEach(0..<maxSlots, id: \.self) { slot in
            if slot < visibleTileCount {
              ItemTile(
                image: reflect.tiles[slot].image,
                emoji: reflect.tiles[slot].emoji,
                size: tileSize
              )
            } else if slot == visibleTileCount && overflowCount > 0 {
              OverflowTile(count: overflowCount, size: tileSize)
            } else {
              Color.clear
                .frame(width: tileSize, height: tileSize)
                .accessibilityHidden(true)
            }
          }
        }
        .frame(width: geometry.size.width, alignment: .leading)
      }
      .frame(minHeight: 44, maxHeight: 54)
    }
  }
}

struct FriendReflectView: View {
  var entry: ReflectEntry

  var body: some View {
    Group {
      switch entry.reflect.state {
      case .unpaired:
        EmptyWidgetView(
          title: "A PLACE FOR TWO",
          message: "Your Burrow is waiting for someone you want to keep close."
        )
      case .empty:
        EmptyWidgetView(
          title: "\(entry.reflect.name.uppercased())’S DAY",
          message: "No shared moments from \(entry.reflect.name) yet."
        )
      case .latest:
        LatestReflectView(reflect: entry.reflect, now: entry.date)
      }
    }
    .widgetURL(URL(string: "novame://friends"))
    .containerBackground(for: .widget) {
      PairedGridBackground()
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
