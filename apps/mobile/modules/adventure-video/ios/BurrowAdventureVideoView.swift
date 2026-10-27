import AVFoundation
import ExpoModulesCore
import UIKit

/// No EOF observer/seek, JS progress event, second surface, or transition timer.
final class BurrowAdventureVideoView: ExpoView {
  let onFirstFrame = EventDispatcher()
  let onError = EventDispatcher()
  private let videoLayer = AVPlayerLayer()
  private var player: AVQueuePlayer?
  // A strong reference is essential: releasing the looper stops queue replenishment.
  private var looper: AVPlayerLooper?
  private var loading: Task<Void, Never>?
  private var frameObservation: NSKeyValueObservation?
  private var queueObservation: NSKeyValueObservation?
  private var statusObservation: NSKeyValueObservation?
  private var notifications: [NSObjectProtocol] = []
  private var source = ""
  private var revision = 0
  private var active = false
  private var foreground = UIApplication.shared.applicationState == .active
  private var frameDelivered = false
  private var failed = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
    backgroundColor = UIColor(red: 43 / 255, green: 16 / 255, blue: 8 / 255, alpha: 1)
    videoLayer.videoGravity = .resizeAspectFill
    layer.addSublayer(videoLayer)
    notifications = [
      NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
        self?.foreground = false
        self?.updatePlayback()
      },
      NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
        self?.foreground = true
        self?.updatePlayback()
      }
    ]
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    videoLayer.frame = bounds
    CATransaction.commit()
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updatePlayback()
  }

  func setActive(_ value: Bool) {
    active = value
    updatePlayback()
  }

  private func updatePlayback() {
    guard let player else { return }
    if active && foreground && window != nil && !failed {
      player.playImmediately(atRate: 1)
    } else {
      player.pause()
    }
  }

  func setSource(_ value: String) {
    guard source != value else { return }
    source = value
    revision += 1
    let ticket = revision
    releaseSource()
    frameDelivered = false
    failed = false
    guard let url = URL(string: value), url.isFileURL else {
      fail("Adventure video must be a downloaded local file.")
      return
    }
    let asset = AVURLAsset(url: url)
    loading = Task { @MainActor [weak self] in
      do {
        // Never block the UI thread while AVPlayerLooper loads the template.
        let duration = try await asset.load(.duration)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        guard let track = tracks.first else { throw VideoError.noVideoTrack }
        let range = try await track.load(.timeRange)
        let transform = try await track.load(.preferredTransform)
        guard !Task.isCancelled, let self, self.revision == ticket else { return }
        let loopRange = CMTimeRangeGetIntersection(CMTimeRange(start: .zero, duration: duration), otherRange: range)
        guard loopRange.duration.isNumeric, CMTimeCompare(loopRange.duration, .zero) > 0 else {
          self.fail("Adventure video has no playable duration.")
          return
        }
        // This decorative video is silent. Omit the AAC track entirely so it
        // cannot introduce audio padding or take over the room music session.
        let videoOnly = AVMutableComposition()
        guard let videoTrack = videoOnly.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
          throw VideoError.noVideoTrack
        }
        try videoTrack.insertTimeRange(loopRange, of: track, at: .zero)
        videoTrack.preferredTransform = transform
        self.install(asset: videoOnly, range: CMTimeRange(start: .zero, duration: loopRange.duration), ticket: ticket)
      } catch {
        guard !Task.isCancelled, let self, self.revision == ticket else { return }
        self.fail("Adventure video could not be loaded.")
      }
    }
  }

  private func install(asset: AVAsset, range: CMTimeRange, ticket: Int) {
    let queue = AVQueuePlayer()
    queue.isMuted = true
    queue.automaticallyWaitsToMinimizeStalling = false
    let item = AVPlayerItem(asset: asset)
    player = queue
    // Restrict the loop to the video track, not container/audio padding.
    looper = AVPlayerLooper(player: queue, templateItem: item, timeRange: range)
    videoLayer.player = queue
    frameObservation = videoLayer.observe(\.isReadyForDisplay, options: [.initial, .new]) { [weak self] layer, _ in
      let ready = layer.isReadyForDisplay
      DispatchQueue.main.async { [weak self] in
        guard let self, self.revision == ticket, ready, !self.frameDelivered else { return }
        self.frameDelivered = true
        self.onFirstFrame([:])
      }
    }
    queueObservation = queue.observe(\.currentItem, options: [.initial, .new]) { [weak self] queue, _ in
      let item = queue.currentItem
      DispatchQueue.main.async { [weak self] in
        guard let self, self.revision == ticket else { return }
        self.statusObservation = item?.observe(\.status, options: [.initial, .new]) { [weak self] item, _ in
          guard item.status == .failed else { return }
          DispatchQueue.main.async { [weak self] in
            guard let self, self.revision == ticket else { return }
            self.fail("Adventure video playback failed.")
          }
        }
      }
    }
    updatePlayback()
  }

  private func fail(_ message: String) {
    guard !failed else { return }
    failed = true
    player?.pause()
    onError(["message": message])
  }

  private func releaseSource() {
    loading?.cancel()
    loading = nil
    frameObservation?.invalidate()
    queueObservation?.invalidate()
    statusObservation?.invalidate()
    frameObservation = nil
    queueObservation = nil
    statusObservation = nil
    player?.pause()
    looper?.disableLooping()
    player?.removeAllItems()
    videoLayer.player = nil
    looper = nil
    player = nil
  }

  deinit {
    loading?.cancel()
    frameObservation?.invalidate()
    queueObservation?.invalidate()
    statusObservation?.invalidate()
    player?.pause()
    looper?.disableLooping()
    player?.removeAllItems()
    notifications.forEach(NotificationCenter.default.removeObserver)
  }

  private enum VideoError: Error { case noVideoTrack }
}
