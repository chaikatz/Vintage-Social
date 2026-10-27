import AVFoundation
import CoreGraphics
import CoreImage
import CoreMedia
import CoreVideo
import ExpoModulesCore
import Foundation
import QuartzCore
import UIKit
import os.log

// MARK: - Tuning

/// The encoder's numbers, in one place so they can be tuned against the
/// quality lab without reading the pipeline. `src/filters/bakeVideo.ts`
/// mirrors them (and `videoBitrateFor` mirrors `Baker.videoBitrate`), and a
/// test holds the two copies to the same values.
///
/// The measure behind them is bits per pixel per frame: bitrate divided by
/// width × height × frames per second. The camera's own H.264 at 1080p30 runs
/// at about 0.28. Streaming services serve 1080p at 0.08 to 0.12, but with
/// slow two-pass encoders; a phone's hardware encoder needs more for the same
/// picture, and film grain is the hardest content there is for motion
/// prediction. 10 Mbps at 1080 × 1920 × 30 is 0.16, which keeps grain and
/// fine detail without spending bytes nobody sees. Below about 0.056
/// (3.5 Mbps at that size) H.264 High starts to smear faces and block on
/// fades, so that is the floor. A 60-second clip under the cap gets about
/// 5.6 Mbps (0.09), which is the price of fitting it in one upload.
enum BakeTuning {
  /// The output must come in under this. Storage refuses past about 50 MB;
  /// 46 MiB (48.2 MB) stays under that whether the limit is counted in
  /// decimal or binary megabytes, with room to spare.
  static let defaultSizeCapBytes: Double = 46 * 1024 * 1024
  /// The ceiling at the reference size and rate below. Smaller or slower
  /// clips get proportionally less, so every clip lands at the same bits per
  /// pixel per frame rather than the same bitrate.
  static let defaultMaxBitrate: Double = 10_000_000
  static let minimumBitrate: Double = 3_500_000
  static let referencePixelRate: Double = 1080 * 1920 * 30
  /// The share of the cap the encoder is aimed at. Average-bitrate control
  /// overshoots by a few percent on busy content, and the MP4 index takes a
  /// little more; aiming at the cap itself would fail the size check about
  /// half the time on a full-length clip.
  static let budgetHeadroom: Double = 0.9
  /// AAC when the sound has to be encoded (it is copied when it already is AAC).
  static let audioBitrate: Int = 160_000
  /// Sources faster than this are developed at 30 frames a second: a 60 fps
  /// clip at a fixed size budget would get half the bits per frame, and the
  /// feed plays at 30 anyway.
  static let highFrameRateThreshold: Double = 31
  static let maxFrameRate: Double = 30
  /// A keyframe at least every two seconds, so playback can start (and seek)
  /// quickly in a progressive download.
  static let keyFrameIntervalSeconds: Double = 2
  /// How far the developed clip's length may drift from the source's before
  /// it is treated as cut short.
  static let durationTolerance: Double = 0.25
  /// The lowest bitrate a size-correcting second pass will use.
  static let lowestRetryBitrate: Int = 1_000_000
  /// A second pass aims this much under what the first pass's overshoot
  /// suggests, since rate control overshoots in proportion.
  static let retryMargin: Double = 0.95
  /// The export-session fallback has no progress callback, so it is read on
  /// a timer this often.
  static let exportProgressInterval: Double = 0.25
}

/// The grain's numbers. Named so the integrator can tune them against the
/// quality lab; the look is otherwise the shader's.
enum GrainTuning {
  /// A new grain pattern 15 times a second, so each one is held for two
  /// frames of a 30 fps clip. Projected film shows each frame twice too, and
  /// noise that changes every frame is the hardest thing an encoder can be
  /// given: under a size cap it boils into blocks.
  static let refreshHz: Double = 15
  /// Keeps a tick that lands exactly on a frame (2/30 s × 15 = 1) from being
  /// read as 0.999… and holding one pattern for three frames.
  static let tickEpsilon: Double = 0.001
  /// The shader's grain cells are about two pixels across at this size.
  static let cellSize: CGFloat = 2
  /// The generator is fixed in space, so each new pattern is a jump to a
  /// different part of it, wrapped inside this many pixels.
  static let stepX = 97
  static let stepY = 57
  static let wrap = 1024
  /// The shader's grain strength.
  static let shaderStrength: Double = 0.14
  /// Stands in for the shader's mid-tone weighting, which a lookup-free pass
  /// cannot follow pixel by pixel.
  static let midtoneStandIn: Double = 0.6
}

/// The look to burn in, in the same terms the GL shader takes: the composed
/// 4x5 colour matrix (row-major, last column the offset) and the film
/// artifacts. `src/filters/shader.ts` is the reference for every formula
/// below; a photograph and a video wearing the same film must match.
///
/// The rest is how the clip is written: a name for its progress events and
/// for `cancelBake`, the bitrate ceiling, the size cap, and optionally the
/// part of the clip to develop (seconds; a duration of 0 means to the end).
struct BakeOptions: Record {
  @Field var matrix: [Double] = []
  @Field var fade: Double = 0
  @Field var fadeColor: [Double] = [0.5, 0.5, 0.5]
  @Field var vignette: Double = 0
  @Field var grain: Double = 0
  @Field var maxDimension: Double = 1920
  @Field var jobId: String = ""
  @Field var maxBitrate: Double = BakeTuning.defaultMaxBitrate
  @Field var sizeCapBytes: Double = BakeTuning.defaultSizeCapBytes
  @Field var rangeStart: Double = 0
  @Field var rangeDuration: Double = 0
}

/// Bakes a VINTAGE filter into a video file.
///
/// Photographs are baked by the GL shader at publish time so the filter
/// ends up in the pixels. Video could not be, so it was overlaid at play
/// time — and iOS composites an overlay over an AVPlayer layer unreliably,
/// which is why a clip could look filtered in one place and untouched in
/// another. This does for video what the shader does for stills: the same
/// colour matrix and fade, as an exact 3D lookup table; the same vignette,
/// rendered once as a mask; the same luminance grain, moving the way grain
/// on film does.
///
/// The clip is read and written by hand (AVAssetReader into AVAssetWriter)
/// rather than by an export session, because an export session has no
/// bitrate setting: the old one capped the file length instead, which Apple
/// documents as cutting the clip short, and long clips came out truncated
/// or starved of bits. Here the H.264 bitrate is chosen from the clip's
/// length so the file fits the cap, the frame rate is held to 30, AAC sound
/// is copied as it was, and the file is written with its index at the front
/// so playback starts before the whole thing has downloaded. The result is
/// checked before it is handed back: its length against the source's, its
/// size against the cap.
public class VintageVideoModule: Module {
  fileprivate static let cubeDimension = 32
  fileprivate static let queue = DispatchQueue(label: "club.vintage.video.bake", qos: .userInitiated)
  /// Reading a file's tracks blocks; it is kept off the bake queue so a
  /// diagnostic never waits behind a bake's setup.
  private static let inspectQueue = DispatchQueue(label: "club.vintage.video.inspect", qos: .userInitiated)
  private let jobs = BakeJobs()

  public func definition() -> ModuleDefinition {
    Name("VintageVideo")

    Events("onBakeProgress")

    AsyncFunction("bake") { (uri: String, options: BakeOptions, promise: Promise) in
      let jobId = options.jobId.isEmpty ? UUID().uuidString : options.jobId
      let job = BakeJob(id: jobId, promise: promise, registry: self.jobs)
      // A second bake under the same name replaces the first, which is
      // stopped: only the newest could be reached by cancelBake.
      self.jobs.add(job)?.stop(.cancelled)
      let report: (Double) -> Void = { [weak self] progress in
        self?.sendEvent("onBakeProgress", ["jobId": jobId, "progress": progress])
      }
      // The background task and the app-state check are UIKit's and belong
      // on the main thread; the work itself goes to the bake queue after.
      DispatchQueue.main.async {
        job.holdBackgroundTime()
        Self.queue.async {
          Baker(uri: uri, options: options, job: job, report: report).run()
        }
      }
    }

    // Synchronous, so a STOP is never queued behind other modules' async
    // work. It only raises a flag; the bake notices it between frames and
    // rejects its own promise once the reader and writer are torn down.
    Function("cancelBake") { (jobId: String) -> Bool in
      guard let job = self.jobs.find(jobId) else {
        return false
      }
      job.stop(.cancelled)
      return true
    }

    AsyncFunction("inspect") { (uri: String, promise: Promise) in
      Self.inspectQueue.async {
        Inspector.inspect(uri: uri, promise: promise)
      }
    }

    AsyncFunction("brand") { (uri: String, options: BrandOptions, promise: Promise) in
      // Core Animation exports must not start on the main thread.
      Self.queue.async {
        Brander(uri: uri, options: options).run(promise: promise)
      }
    }
  }
}

// MARK: - The print around a film

/// A rectangle in output pixels, y down from the top — `exportLayout` in JS.
struct BrandRect: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
}

struct BrandTextBox: Record {
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var width: Double = 0
  @Field var height: Double = 0
  @Field var size: Double = 12
  @Field var spacing: Double = 0
}

/// Everything the print needs, measured by `src/utils/exportLayout.ts` so
/// the still and the film are the same object. Colours are `#rrggbb`.
struct BrandOptions: Record {
  @Field var width: Double = 1080
  @Field var height: Double = 1350
  @Field var photo: BrandRect = BrandRect()
  @Field var rule: BrandRect = BrandRect()
  @Field var wordmark: BrandTextBox = BrandTextBox()
  @Field var tagline: BrandTextBox = BrandTextBox()
  @Field var place: BrandTextBox = BrandTextBox()
  @Field var byline: BrandTextBox = BrandTextBox()
  @Field var credit: BrandTextBox = BrandTextBox()
  @Field var stamp: BrandTextBox = BrandTextBox()
  @Field var icon: BrandRect = BrandRect()
  @Field var iconUri: String = ""
  @Field var paper: String = "#FAF6EF"
  @Field var well: String = "#F3EDE2"
  @Field var ink: String = "#2B2620"
  @Field var inkSoft: String = "#6E655A"
  @Field var inkFaint: String = "#9C927F"
  @Field var ruleColor: String = "#D5CBB8"
  @Field var wordmarkText: String = "VINTAGE"
  @Field var taglineText: String = ""
  @Field var placeText: String = ""
  @Field var bylineText: String = ""
  @Field var creditText: String = ""
  @Field var stampText: String = ""
}

/// Writes a copy of a film as a VINTAGE print: paper around it, the label
/// beneath — wordmark, place and date, the member — and the amber stamp
/// where the feed shows it. The film is scaled to cover its frame and
/// clipped to it, the way the feed crops; the sound comes through as is.
private final class Brander {
  private let uri: String
  private let options: BrandOptions

  init(uri: String, options: BrandOptions) {
    self.uri = uri
    self.options = options
  }

  func run(promise: Promise) {
    guard let url = Baker.fileURL(from: uri) else {
      promise.reject("E_BRAND_INPUT", "The film could not be found at \(uri)")
      return
    }
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
      promise.reject("E_BRAND_INPUT", "The file has no video track")
      return
    }

    let W = Brander.even(options.width)
    let H = Brander.even(options.height)
    guard W > 0, H > 0, options.photo.width > 0, options.photo.height > 0 else {
      promise.reject("E_BRAND_INPUT", "The print has no size")
      return
    }
    let renderSize = CGSize(width: W, height: H)
    let photo = Brander.rect(options.photo)

    // The film, upright, scaled to cover its frame and centred in it.
    let natural = track.naturalSize.applying(track.preferredTransform)
    let uprightWidth = abs(natural.width)
    let uprightHeight = abs(natural.height)
    guard uprightWidth > 0, uprightHeight > 0 else {
      promise.reject("E_BRAND_INPUT", "The film reports no size")
      return
    }
    let scale = max(photo.width / uprightWidth, photo.height / uprightHeight)
    let offsetX = photo.minX + (photo.width - uprightWidth * scale) / 2
    let offsetY = photo.minY + (photo.height - uprightHeight * scale) / 2
    let transform = track.preferredTransform
      .concatenating(CGAffineTransform(scaleX: scale, y: scale))
      .concatenating(CGAffineTransform(translationX: offsetX, y: offsetY))

    let range = CMTimeRange(start: .zero, duration: asset.duration)
    let instruction = AVMutableVideoCompositionInstruction()
    instruction.timeRange = range
    instruction.backgroundColor = Brander.color(options.well)
    let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layerInstruction.setTransform(transform, at: .zero)
    instruction.layerInstructions = [layerInstruction]

    let composition = AVMutableVideoComposition()
    composition.renderSize = renderSize
    let fps = track.nominalFrameRate > 1 ? Int32(track.nominalFrameRate.rounded()) : 30
    composition.frameDuration = CMTime(value: 1, timescale: fps)
    composition.instructions = [instruction]
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

    // Core Animation's origin is the bottom-left, so every rectangle from
    // the layout is flipped once here and nowhere else.
    let parent = CALayer()
    parent.frame = CGRect(origin: .zero, size: renderSize)
    parent.backgroundColor = Brander.color(options.paper)
    parent.isGeometryFlipped = false

    // The frame the film shows through: the rendered frame is full-size
    // and clipped to the photograph's rectangle.
    let clip = CALayer()
    clip.frame = Brander.flip(photo, in: H)
    clip.masksToBounds = true
    clip.backgroundColor = Brander.color(options.well)
    let videoLayer = CALayer()
    videoLayer.frame = CGRect(x: -clip.frame.minX, y: -clip.frame.minY, width: W, height: H)
    clip.addSublayer(videoLayer)
    parent.addSublayer(clip)

    let rule = CALayer()
    rule.frame = Brander.flip(Brander.rect(options.rule), in: H)
    rule.backgroundColor = Brander.color(options.ruleColor)
    parent.addSublayer(rule)

    if !options.wordmarkText.isEmpty {
      parent.addSublayer(Brander.text(
        options.wordmarkText, box: options.wordmark, in: H,
        font: Brander.font("Georgia", size: options.wordmark.size),
        color: options.ink, alignment: .left
      ))
    }
    if !options.taglineText.isEmpty && options.tagline.height > 0 {
      // Faint and italic, left-aligned under the wordmark.
      parent.addSublayer(Brander.text(
        options.taglineText, box: options.tagline, in: H,
        font: Brander.font("Georgia-Italic", size: options.tagline.size),
        color: options.inkFaint, alignment: .left
      ))
    }
    if !options.placeText.isEmpty && options.place.height > 0 {
      // A long place runs to a second line rather than being cut off.
      parent.addSublayer(Brander.text(
        options.placeText, box: options.place, in: H,
        font: Brander.font("CourierNewPSMT", size: options.place.size),
        color: options.inkSoft, alignment: .right, wrap: true
      ))
    }
    if !options.bylineText.isEmpty {
      parent.addSublayer(Brander.text(
        options.bylineText, box: options.byline, in: H,
        font: Brander.font("CourierNewPSMT", size: options.byline.size),
        color: options.inkSoft, alignment: .right
      ))
    }
    if !options.creditText.isEmpty {
      parent.addSublayer(Brander.text(
        options.creditText, box: options.credit, in: H,
        font: Brander.font("CourierNewPSMT", size: options.credit.size),
        color: options.inkFaint, alignment: .right
      ))
    }
    if !options.stampText.isEmpty {
      let stamp = Brander.text(
        options.stampText, box: options.stamp, in: H,
        font: Brander.font("CourierNewPS-BoldMT", size: options.stamp.size),
        color: "#FFB03A", alignment: .right
      )
      stamp.opacity = 0.92
      stamp.shadowColor = UIColor(red: 1, green: 150.0 / 255.0, blue: 40.0 / 255.0, alpha: 1).cgColor
      stamp.shadowOpacity = 0.55
      stamp.shadowRadius = CGFloat(options.stamp.size * 0.4)
      stamp.shadowOffset = .zero
      parent.addSublayer(stamp)
    }

    // The app icon, small, in the bottom-left corner — the same file the
    // on-screen card shows, rounded as iOS rounds it.
    if options.icon.width > 0, options.icon.height > 0,
       let iconURL = Baker.fileURL(from: options.iconUri),
       let image = UIImage(contentsOfFile: iconURL.path)?.cgImage {
      // A faint shadow around it, so it reads as an app icon and not a
      // square of paper: the shadow on an outer layer, the rounding and
      // clipping on the inner one, since a layer that clips cannot cast.
      let frame = Brander.flip(Brander.rect(options.icon), in: H)
      let shadow = CALayer()
      shadow.frame = frame
      shadow.shadowColor = UIColor.black.cgColor
      shadow.shadowOpacity = 0.22
      shadow.shadowRadius = CGFloat(options.icon.width * 0.14)
      shadow.shadowOffset = CGSize(width: 0, height: 1)
      shadow.shadowPath = UIBezierPath(roundedRect: shadow.bounds, cornerRadius: CGFloat(options.icon.width * 0.22)).cgPath
      let icon = CALayer()
      icon.frame = shadow.bounds
      icon.contents = image
      icon.contentsGravity = .resizeAspectFill
      icon.cornerRadius = CGFloat(options.icon.width * 0.22)
      icon.masksToBounds = true
      shadow.addSublayer(icon)
      parent.addSublayer(shadow)
    }

    composition.animationTool = AVVideoCompositionCoreAnimationTool(
      postProcessingAsVideoLayer: videoLayer, in: parent
    )

    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
      promise.reject("E_BRAND_EXPORT", "This film cannot be exported")
      return
    }
    let outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("vintage-print-\(UUID().uuidString).mp4")
    export.videoComposition = composition
    export.outputURL = outputURL
    export.outputFileType = .mp4
    export.shouldOptimizeForNetworkUse = true

    export.exportAsynchronously {
      switch export.status {
      case .completed:
        let result: [String: Any] = [
          "uri": outputURL.absoluteString,
          "width": Int(W),
          "height": Int(H)
        ]
        promise.resolve(result)
      case .cancelled:
        promise.reject("E_BRAND_CANCELLED", "The export was cancelled")
      default:
        let reason = export.error?.localizedDescription ?? "unknown error"
        promise.reject("E_BRAND_EXPORT", "The print could not be made: \(reason)")
      }
    }
  }

  // MARK: - Helpers

  static func even(_ value: Double) -> CGFloat {
    return CGFloat(max(2, Int((value / 2).rounded()) * 2))
  }

  static func rect(_ r: BrandRect) -> CGRect {
    return CGRect(x: r.x, y: r.y, width: r.width, height: r.height)
  }

  static func rect(_ b: BrandTextBox) -> CGRect {
    return CGRect(x: b.x, y: b.y, width: b.width, height: b.height)
  }

  /// Top-down layout to bottom-up Core Animation.
  static func flip(_ r: CGRect, in height: CGFloat) -> CGRect {
    return CGRect(x: r.minX, y: height - r.minY - r.height, width: r.width, height: r.height)
  }

  static func color(_ hex: String) -> CGColor {
    var s = hex.trimmingCharacters(in: .whitespacesAndNewlines)
    if s.hasPrefix("#") { s.removeFirst() }
    guard s.count == 6, let v = UInt32(s, radix: 16) else {
      return UIColor.white.cgColor
    }
    return UIColor(
      red: CGFloat((v >> 16) & 0xff) / 255,
      green: CGFloat((v >> 8) & 0xff) / 255,
      blue: CGFloat(v & 0xff) / 255,
      alpha: 1
    ).cgColor
  }

  static func font(_ name: String, size: Double) -> UIFont {
    let points = CGFloat(max(1, size))
    if let named = UIFont(name: name, size: points) {
      return named
    }
    if name.hasPrefix("Courier") {
      return UIFont.monospacedSystemFont(ofSize: points, weight: name.contains("Bold") ? .bold : .regular)
    }
    return UIFont.systemFont(ofSize: points)
  }

  static func text(
    _ string: String, box: BrandTextBox, in height: CGFloat,
    font: UIFont, color: String, alignment: CATextLayerAlignmentMode, wrap: Bool = false
  ) -> CATextLayer {
    let layer = CATextLayer()
    let attributes: [NSAttributedString.Key: Any] = [
      .font: font,
      .foregroundColor: UIColor(cgColor: Brander.color(color)),
      .kern: CGFloat(box.spacing)
    ]
    layer.string = NSAttributedString(string: string, attributes: attributes)
    layer.frame = Brander.flip(Brander.rect(box), in: height)
    layer.alignmentMode = alignment
    layer.truncationMode = .end
    layer.isWrapped = wrap
    // Units are already pixels; nothing here is scaled for a screen.
    layer.contentsScale = 1
    return layer
  }
}

// MARK: - A bake in flight

/// Why a bake stopped before it finished.
private enum StopReason {
  /// `cancelBake`, or a newer bake under the same name.
  case cancelled
  /// The app left the foreground, or iOS ended its background time.
  case interrupted
}

/// One bake in flight. A STOP comes in on the JS thread, the app's going to
/// the background on the main thread, frames on the reader's queues and the
/// end on the bake queue, so everything that decides how the bake ends is
/// behind one lock, and only the first ending counts.
///
/// It also holds the bake's background time. The GPU and the hardware
/// encoder are foreground-only on iOS: once the app is in the background,
/// Core Image cannot render and the encoder session is invalidated, so a
/// bake cannot usefully carry on there. Going to the background therefore
/// stops it at once, as `E_BAKE_INTERRUPTED`, and the JS side develops it
/// again when the app is active. The background task is what lets that stop
/// finish properly: the reader and writer are torn down, the partial file
/// deleted and the promise settled before iOS suspends the app, instead of
/// leaving all three hanging until it comes back. Should iOS end the time
/// first, the expiry settles the promise the same way.
private final class BakeJob {
  let id: String
  private let promise: Promise
  private weak var registry: BakeJobs?
  private let lock = NSLock()
  private var settled = false
  private var reason: StopReason?
  private var onStop: (() -> Void)?
  private var reported: Double = -1
  private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
  private var observer: NSObjectProtocol?

  init(id: String, promise: Promise, registry: BakeJobs) {
    self.id = id
    self.promise = promise
    self.registry = registry
  }

  /// Why the bake was stopped, or nil while it may carry on.
  var stopped: StopReason? {
    lock.lock()
    defer { lock.unlock() }
    return reason
  }

  /// Stops the bake. The first reason given is the one it ends with.
  func stop(_ why: StopReason) {
    lock.lock()
    if reason == nil {
      reason = why
    }
    let handler = onStop
    lock.unlock()
    handler?()
  }

  /// Sets what stops the work in hand (a reader and writer, or an export).
  /// A stop that came first is passed straight on.
  func whenStopped(_ handler: @escaping () -> Void) {
    lock.lock()
    onStop = handler
    let already = reason != nil
    lock.unlock()
    if already {
      handler()
    }
  }

  /// Progress worth a word to JS: a step of at least a hundredth, or the end.
  func shouldReport(_ progress: Double) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if settled || reason != nil || !progress.isFinite || progress <= reported {
      return false
    }
    if progress < 1 && progress - reported < 0.01 {
      return false
    }
    reported = progress
    return true
  }

  /// A second pass reports its own progress from the start.
  func restartProgress() {
    lock.lock()
    reported = -1
    lock.unlock()
  }

  /// Main thread. Asks iOS for time to finish if the app leaves the
  /// foreground, and listens for that happening. A bake asked for while the
  /// app is already in the background is stopped before it begins.
  func holdBackgroundTime() {
    let app = UIApplication.shared
    let task = app.beginBackgroundTask(withName: "VINTAGE develop") { [weak self] in
      self?.expire()
    }
    let observer = NotificationCenter.default.addObserver(
      forName: UIApplication.didEnterBackgroundNotification,
      object: nil,
      queue: nil
    ) { [weak self] _ in
      self?.stop(.interrupted)
    }
    lock.lock()
    let done = settled
    if !done {
      backgroundTask = task
      self.observer = observer
    }
    lock.unlock()
    if done {
      NotificationCenter.default.removeObserver(observer)
      if task != .invalid {
        app.endBackgroundTask(task)
      }
      return
    }
    if app.applicationState == .background {
      stop(.interrupted)
    }
  }

  /// Main thread: iOS is about to suspend the app. The promise is settled
  /// now and the task ended now, as iOS requires; the teardown finishes when
  /// the app next runs, and its own settle is then a no-op.
  private func expire() {
    stop(.interrupted)
    rejectStopped(.interrupted)
    release()
  }

  @discardableResult
  func resolve(_ result: [String: Any]) -> Bool {
    guard claim() else {
      return false
    }
    promise.resolve(result)
    release()
    return true
  }

  @discardableResult
  func reject(_ code: String, _ message: String) -> Bool {
    guard claim() else {
      return false
    }
    promise.reject(code, message)
    release()
    return true
  }

  func rejectStopped(_ why: StopReason) {
    switch why {
    case .cancelled:
      reject("E_BAKE_CANCELLED", "The bake was cancelled")
    case .interrupted:
      reject("E_BAKE_INTERRUPTED", "The bake stopped because VINTAGE left the foreground; it can start again when the app is open")
    }
  }

  private func claim() -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if settled {
      return false
    }
    settled = true
    return true
  }

  /// Lets go of the background time and the observer, and of the work in
  /// hand, whose stop handler would otherwise keep it alive.
  private func release() {
    lock.lock()
    let task = backgroundTask
    backgroundTask = .invalid
    let observer = self.observer
    self.observer = nil
    onStop = nil
    lock.unlock()
    registry?.remove(self)
    if let observer = observer {
      NotificationCenter.default.removeObserver(observer)
    }
    if task != .invalid {
      if Thread.isMainThread {
        UIApplication.shared.endBackgroundTask(task)
      } else {
        DispatchQueue.main.async {
          UIApplication.shared.endBackgroundTask(task)
        }
      }
    }
  }
}

/// The bakes in flight, by the name JS gave each.
private final class BakeJobs {
  private let lock = NSLock()
  private var inFlight: [String: BakeJob] = [:]

  /// Adds a bake, and returns the one it replaced under the same name.
  func add(_ job: BakeJob) -> BakeJob? {
    lock.lock()
    defer { lock.unlock() }
    let previous = inFlight[job.id]
    inFlight[job.id] = job
    return previous === job ? nil : previous
  }

  func find(_ id: String) -> BakeJob? {
    lock.lock()
    defer { lock.unlock() }
    return inFlight[id]
  }

  func remove(_ job: BakeJob) {
    lock.lock()
    defer { lock.unlock() }
    if inFlight[job.id] === job {
      inFlight.removeValue(forKey: job.id)
    }
  }
}

// MARK: - The bake

/// The sound, and how it will be written.
private struct AudioPlan {
  let track: AVAssetTrack
  /// Already AAC in one or two channels: the packets are copied as they
  /// are, not decoded and encoded a second time.
  let passthrough: Bool
  let formatHint: CMFormatDescription?
  /// Bits per second the sound will take, for the size budget.
  let bitrate: Double
  /// For the encoder, when the sound has to be encoded.
  let sampleRate: Double
}

/// Everything about a clip that does not change between passes.
private struct BakePlan {
  let asset: AVAsset
  let videoTracks: [AVAssetTrack]
  let renderSize: CGSize
  let range: CMTimeRange
  let composition: AVVideoComposition
  let audio: AudioPlan?
  let sourceFrameRate: Double
  let frameRate: Double
  let hdrSource: Bool
  let sizeCapBytes: Double
  let maxBitrate: Double
}

/// Which way the clip was written: by hand (and in which pass), or by the
/// export session the bake falls back to.
private enum BakePath {
  case writer(videoBitrate: Int, pass: Int, audio: String)
  case export
}

private final class Baker {
  static let osLog = OSLog(subsystem: "club.vintage.video", category: "bake")
  static let stoppedError = NSError(
    domain: "club.vintage.video",
    code: 1,
    userInfo: [NSLocalizedDescriptionKey: "The bake was stopped"]
  )

  private let uri: String
  private let options: BakeOptions
  private let job: BakeJob
  private let report: (Double) -> Void
  private let began = Date()
  /// The export fallback's progress is read on this; touched only on the bake queue.
  private var exportTimer: DispatchSourceTimer?

  init(uri: String, options: BakeOptions, job: BakeJob, report: @escaping (Double) -> Void) {
    self.uri = uri
    self.options = options
    self.job = job
    self.report = report
  }

  /// Bake queue.
  func run() {
    if let why = job.stopped {
      job.rejectStopped(why)
      return
    }
    guard let url = Baker.fileURL(from: uri) else {
      job.reject("E_BAKE_INPUT", "The video could not be found at \(uri)")
      return
    }
    // Precise timing, so the length check after the bake compares like with like.
    let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let videoTracks = asset.tracks(withMediaType: .video)
    guard let track = videoTracks.first(where: { $0.isEnabled }) ?? videoTracks.first else {
      job.reject("E_BAKE_INPUT", "The file has no video track")
      return
    }

    let renderSize = Baker.renderSize(for: track, maxDimension: options.maxDimension)
    guard renderSize.width > 0, renderSize.height > 0 else {
      job.reject("E_BAKE_INPUT", "The video reports no size")
      return
    }
    guard let range = Baker.timeRange(of: asset, start: options.rangeStart, duration: options.rangeDuration) else {
      job.reject("E_BAKE_INPUT", "The video reports no length")
      return
    }

    let sourceFrameRate = Double(track.nominalFrameRate)
    let capsFrameRate = sourceFrameRate > BakeTuning.highFrameRateThreshold
    let frameRate = (capsFrameRate || sourceFrameRate < 1) ? BakeTuning.maxFrameRate : sourceFrameRate
    let plan = BakePlan(
      asset: asset,
      videoTracks: videoTracks,
      renderSize: renderSize,
      range: range,
      composition: makeComposition(asset: asset, renderSize: renderSize, capsFrameRate: capsFrameRate),
      audio: Baker.audioPlan(for: asset),
      sourceFrameRate: sourceFrameRate,
      frameRate: frameRate,
      hdrSource: Baker.isHDR(track),
      sizeCapBytes: options.sizeCapBytes > 0 ? options.sizeCapBytes : BakeTuning.defaultSizeCapBytes,
      maxBitrate: options.maxBitrate > 0 ? options.maxBitrate : BakeTuning.defaultMaxBitrate
    )
    let videoBitrate = Baker.videoBitrate(
      duration: CMTimeGetSeconds(range.duration),
      width: Double(renderSize.width),
      height: Double(renderSize.height),
      frameRate: frameRate,
      audioBitrate: plan.audio?.bitrate ?? 0,
      maxBitrate: plan.maxBitrate,
      sizeCapBytes: plan.sizeCapBytes
    )
    let sound: String
    if let audio = plan.audio {
      sound = audio.passthrough ? "copy" : "aac"
    } else {
      sound = "none"
    }
    os_log(
      "bake %{public}@: %ldx%ld, %.2f s, source %.2f fps -> %.0f fps, video %ld bps, audio %{public}@, hdr %ld",
      log: Baker.osLog, type: .info,
      job.id as NSString, Int(renderSize.width), Int(renderSize.height),
      CMTimeGetSeconds(range.duration), sourceFrameRate, frameRate, videoBitrate,
      sound as NSString, plan.hdrSource ? 1 : 0
    )
    encode(plan, videoBitrate: videoBitrate, pass: 1)
  }

  // MARK: Passes

  private func encode(_ plan: BakePlan, videoBitrate: Int, pass: Int) {
    let writerPass = WriterPass(plan: plan, videoBitrate: videoBitrate, job: job, report: report)
    job.whenStopped { [weak writerPass] in
      writerPass?.stop()
    }
    writerPass.start { outcome in
      VintageVideoModule.queue.async {
        self.handle(outcome, plan: plan, videoBitrate: videoBitrate, pass: pass)
      }
    }
  }

  /// Bake queue.
  private func handle(_ outcome: WriterPass.Outcome, plan: BakePlan, videoBitrate: Int, pass: Int) {
    switch outcome {
    case .finished(let url, let audio):
      verify(url: url, plan: plan, path: .writer(videoBitrate: videoBitrate, pass: pass, audio: audio))
    case .stopped(let why):
      job.rejectStopped(why)
    case .failed(let code, let message):
      job.reject(code, message)
    case .unstartable(let reason):
      if pass == 1 {
        exportFallback(plan, reason: reason)
      } else {
        job.reject("E_BAKE_EXPORT", "The clip could not be developed again: \(reason)")
      }
    }
  }

  /// Bake queue. The clip is only handed back once it is known to be whole
  /// and small enough to post. A clip over the cap from the first pass is
  /// developed once more at a bitrate scaled down by how far it went over.
  private func verify(url: URL, plan: BakePlan, path: BakePath) {
    if let why = job.stopped {
      Baker.remove(url)
      job.rejectStopped(why)
      return
    }
    let output = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let duration = CMTimeGetSeconds(output.duration)
    let expected = CMTimeGetSeconds(plan.range.duration)
    let bytes = Baker.fileSize(url)

    guard duration.isFinite, duration > 0, abs(duration - expected) <= BakeTuning.durationTolerance else {
      Baker.remove(url)
      job.reject(
        "E_BAKE_VERIFY",
        String(format: "The developed clip runs %.2f s where the source runs %.2f s", duration.isFinite ? duration : 0, expected)
      )
      return
    }
    guard bytes > 0 else {
      Baker.remove(url)
      job.reject("E_BAKE_VERIFY", "The developed clip is empty")
      return
    }
    if Double(bytes) > plan.sizeCapBytes {
      Baker.remove(url)
      if case .writer(let videoBitrate, 1, _) = path {
        let scale = plan.sizeCapBytes * BakeTuning.budgetHeadroom / Double(bytes)
        let next = max(BakeTuning.lowestRetryBitrate, Int((Double(videoBitrate) * scale * BakeTuning.retryMargin).rounded()))
        os_log(
          "bake %{public}@: %ld bytes is over the cap, developing again at %ld bps",
          log: Baker.osLog, type: .info, job.id as NSString, bytes, next
        )
        job.restartProgress()
        encode(plan, videoBitrate: next, pass: 2)
        return
      }
      job.reject(
        "E_BAKE_TOO_LARGE",
        String(format: "The developed clip is %.1f MB, over the %.1f MB that can be posted", Double(bytes) / 1_000_000, plan.sizeCapBytes / 1_000_000)
      )
      return
    }

    var width = Int(plan.renderSize.width)
    var height = Int(plan.renderSize.height)
    var debug: [String: Any] = [
      "hdrSource": plan.hdrSource,
      "sourceFrameRate": plan.sourceFrameRate,
      "frameRate": plan.frameRate,
      "seconds": Date().timeIntervalSince(began)
    ]
    switch path {
    case .writer(let videoBitrate, let pass, let audio):
      debug["path"] = "writer"
      debug["targetVideoBitrate"] = videoBitrate
      debug["passes"] = pass
      debug["audio"] = audio
    case .export:
      debug["path"] = "export"
      debug["passes"] = 1
      debug["audio"] = plan.audio == nil ? "none" : "aac"
      // The preset may have scaled the frame; report what was written.
      if let track = output.tracks(withMediaType: .video).first {
        let size = track.naturalSize.applying(track.preferredTransform)
        width = Int(abs(size.width).rounded())
        height = Int(abs(size.height).rounded())
      }
    }
    let bitrate = Double(bytes) * 8 / duration
    let result: [String: Any] = [
      "uri": url.absoluteString,
      "width": width,
      "height": height,
      "duration": duration,
      "bytes": bytes,
      "bitrate": bitrate,
      "debug": debug
    ]
    os_log(
      "bake %{public}@: done, %ld bytes, %.2f s, %.0f bps overall",
      log: Baker.osLog, type: .info, job.id as NSString, bytes, duration, bitrate
    )
    if !job.resolve(result) {
      // Settled already (the app's background time ran out): not handed back, not kept.
      Baker.remove(url)
    }
  }

  // MARK: Fallback

  /// The old way, kept for a source the reader or writer will not start on:
  /// an export session with the same composition. It has no bitrate setting,
  /// so it is given the 1080p preset, whose rate is predictable, and no file
  /// length limit (which cut clips short); the size is checked afterwards and
  /// a clip over the cap is refused rather than posted. Source metadata (a
  /// place among it) is not carried over.
  private func exportFallback(_ plan: BakePlan, reason: String) {
    os_log(
      "bake %{public}@: falling back to the export session: %{public}@",
      log: Baker.osLog, type: .info, job.id as NSString, reason as NSString
    )
    if let why = job.stopped {
      job.rejectStopped(why)
      return
    }
    guard let export = AVAssetExportSession(asset: plan.asset, presetName: AVAssetExportPreset1920x1080) else {
      job.reject("E_BAKE_EXPORT", "This video cannot be exported: \(reason)")
      return
    }
    let url = Baker.outputURL()
    export.videoComposition = plan.composition
    export.outputURL = url
    export.outputFileType = .mp4
    export.shouldOptimizeForNetworkUse = true
    export.timeRange = plan.range
    // An empty list, not nil: nil copies the source's metadata (its place among it).
    export.metadata = []
    job.whenStopped { [weak export] in
      export?.cancelExport()
    }

    let timer = DispatchSource.makeTimerSource(queue: VintageVideoModule.queue)
    timer.schedule(
      deadline: .now() + BakeTuning.exportProgressInterval,
      repeating: BakeTuning.exportProgressInterval
    )
    timer.setEventHandler { [weak self, weak export] in
      guard let self = self, let export = export else {
        return
      }
      let progress = Double(export.progress)
      if self.job.shouldReport(progress) {
        self.report(progress)
      }
    }
    exportTimer = timer
    timer.resume()

    export.exportAsynchronously {
      VintageVideoModule.queue.async {
        self.finishExport(export, url: url, plan: plan)
      }
    }
  }

  /// Bake queue.
  private func finishExport(_ export: AVAssetExportSession, url: URL, plan: BakePlan) {
    exportTimer?.cancel()
    exportTimer = nil
    if export.status == .completed {
      verify(url: url, plan: plan, path: .export)
      return
    }
    Baker.remove(url)
    if let why = job.stopped {
      job.rejectStopped(why)
    } else if export.status == .cancelled {
      job.rejectStopped(.cancelled)
    } else if Baker.isInterruption(export.error) {
      job.rejectStopped(.interrupted)
    } else {
      job.reject("E_BAKE_EXPORT", "The filter could not be applied: \(export.error?.localizedDescription ?? "unknown error")")
    }
  }

  // MARK: The composition

  /// The film, as a Core Image handler AVFoundation calls once per frame.
  private func makeComposition(asset: AVAsset, renderSize: CGSize, capsFrameRate: Bool) -> AVMutableVideoComposition {
    // Everything that does not change from frame to frame is built once.
    let cubeData = Baker.makeCube(
      matrix: options.matrix,
      fade: options.fade,
      fadeColor: options.fadeColor,
      dimension: VintageVideoModule.cubeDimension
    )
    let cubeDimension = VintageVideoModule.cubeDimension
    let vignetteMask = options.vignette > 0.001
      ? Baker.makeVignetteMask(size: renderSize, strength: options.vignette)
      : nil
    let grain = options.grain
    let grainMean = CGFloat(Baker.grainStrength(grain) * 0.5)
    let srgb = CGColorSpace(name: CGColorSpace.sRGB)
    // The shader works on the encoded values it was handed, so the
    // Core Image pipeline is told to do the same rather than linearise.
    var contextOptions: [CIContextOption: Any] = [.cacheIntermediates: false]
    if let srgb = srgb {
      contextOptions[.workingColorSpace] = srgb
      contextOptions[.outputColorSpace] = srgb
    }
    let context = CIContext(options: contextOptions)
    let frame = CGRect(origin: .zero, size: renderSize)
    let job = self.job
    let stoppedError = Baker.stoppedError

    let composition = AVMutableVideoComposition(asset: asset, applyingCIFiltersWithHandler: { [weak job] request in
      // A stopped bake renders nothing more: no GPU work is started once
      // the app has left the foreground, and a cancelled bake ends sooner.
      if job?.stopped != nil {
        request.finish(with: stoppedError)
        return
      }
      var image = request.sourceImage
      let extent = image.extent
      // Fit the frame without ever changing its shape: one scale for both
      // axes, centred. A frame that already matches passes straight through.
      if extent.width > 0, extent.height > 0,
        abs(extent.width - renderSize.width) > 0.5 || abs(extent.height - renderSize.height) > 0.5 {
        let scale = min(renderSize.width / extent.width, renderSize.height / extent.height)
        let dx = (renderSize.width - extent.width * scale) / 2 - extent.origin.x * scale
        let dy = (renderSize.height - extent.height * scale) / 2 - extent.origin.y * scale
        image = image.transformed(by: CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: dx, ty: dy))
      }
      image = image.cropped(to: frame)

      // 1 + 2. Colour matrix and fade, folded into one exact lookup.
      if let cube = CIFilter(name: "CIColorCube", parameters: [
        "inputCubeDimension": cubeDimension,
        "inputCubeData": cubeData,
        kCIInputImageKey: image
      ]), let output = cube.outputImage {
        image = output
      }

      // 3. Vignette: the frame multiplied by the falloff mask.
      if let mask = vignetteMask,
        let multiply = CIFilter(name: "CIMultiplyCompositing", parameters: [
          kCIInputImageKey: image,
          kCIInputBackgroundImageKey: mask
        ]), let output = multiply.outputImage {
        image = output
      }

      // 4. Grain: opaque luminance noise with a mean of zero. The frame is
      //    lowered by the noise's mean first, and the noise is then added
      //    with a linear-dodge blend. Every image in the chain is opaque, so
      //    no step divides or multiplies by an alpha. (The noise used to
      //    carry the generator's random alpha into an addition, which
      //    darkened the frame by about a quarter of the grain's strength and
      //    made the grain noisier than the shader's.)
      if grain > 0.001,
        let noise = Baker.makeGrain(strength: grain, time: request.compositionTime.seconds, frame: frame),
        let blend = CIFilter(name: "CILinearDodgeBlendMode", parameters: [
          kCIInputImageKey: noise,
          kCIInputBackgroundImageKey: image.applyingFilter("CIColorMatrix", parameters: [
            "inputBiasVector": CIVector(x: -grainMean, y: -grainMean, z: -grainMean, w: 0)
          ])
        ]), let output = blend.outputImage {
        image = output
      }

      request.finish(with: image.cropped(to: frame), context: context)
    })
    composition.renderSize = renderSize
    if capsFrameRate {
      // Frames are made on a 30 fps clock of the composition's own rather
      // than on the source's: a 60 fps clip is developed at 30, which
      // halves the work and doubles the bits each frame gets.
      composition.frameDuration = CMTime(value: 1, timescale: 30)
      composition.sourceTrackIDForFrameTiming = kCMPersistentTrackID_Invalid
    }
    // HDR. An HLG or Dolby Vision clip from a recent iPhone is developed to
    // standard range, on purpose: the post must play the same in a browser
    // from the share page, and H.264 there is SDR. These colour properties
    // are SDR (BT.709), and AVFoundation converts HDR source frames to them
    // before the handler sees them, tone-mapping as it goes. Without them an
    // HLG clip comes out washed and grey. `debug.hdrSource` says when this
    // happened. To check on a device with an HLG clip shot outdoors: clouds
    // and lamps keep their detail rather than clipping to flat white; mid-
    // tones are no dimmer than the same scene shot with HDR video off; skin
    // matches the Photos app with HDR display turned off.
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2
    return composition
  }

  // MARK: - Encoder settings

  /// H.264 High, on purpose: a shared film is also played in browsers from
  /// the share page, and HEVC does not play in all of them. B-frames are on
  /// (frame reordering); they are where most of H.264's efficiency on
  /// steady phone footage comes from.
  static func videoSettings(size: CGSize, bitrate: Int, frameRate: Double) -> [String: Any] {
    let compression: [String: Any] = [
      AVVideoAverageBitRateKey: bitrate,
      AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      AVVideoH264EntropyModeKey: AVVideoH264EntropyModeCABAC,
      AVVideoMaxKeyFrameIntervalDurationKey: BakeTuning.keyFrameIntervalSeconds,
      AVVideoExpectedSourceFrameRateKey: Int(frameRate.rounded()),
      AVVideoAllowFrameReorderingKey: true
    ]
    let color: [String: Any] = [
      AVVideoColorPrimariesKey: AVVideoColorPrimaries_ITU_R_709_2,
      AVVideoTransferFunctionKey: AVVideoTransferFunction_ITU_R_709_2,
      AVVideoYCbCrMatrixKey: AVVideoYCbCrMatrix_ITU_R_709_2
    ]
    return [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: Int(size.width),
      AVVideoHeightKey: Int(size.height),
      AVVideoColorPropertiesKey: color,
      AVVideoCompressionPropertiesKey: compression
    ]
  }

  static func aacSettings(sampleRate: Double) -> [String: Any] {
    return [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVNumberOfChannelsKey: 2,
      AVSampleRateKey: sampleRate,
      AVEncoderBitRateKey: BakeTuning.audioBitrate,
      AVChannelLayoutKey: stereoLayout()
    ]
  }

  /// What the reader decodes sound to when it has to be encoded: 16-bit
  /// stereo, mixed down (or up) from whatever the source has.
  static func pcmSettings(sampleRate: Double) -> [String: Any] {
    return [
      AVFormatIDKey: kAudioFormatLinearPCM,
      AVSampleRateKey: sampleRate,
      AVNumberOfChannelsKey: 2,
      AVChannelLayoutKey: stereoLayout(),
      AVLinearPCMBitDepthKey: 16,
      AVLinearPCMIsFloatKey: false,
      AVLinearPCMIsBigEndianKey: false,
      AVLinearPCMIsNonInterleaved: false
    ]
  }

  static func stereoLayout() -> Data {
    var layout = AudioChannelLayout()
    layout.mChannelLayoutTag = kAudioChannelLayoutTag_Stereo
    return Data(bytes: &layout, count: MemoryLayout<AudioChannelLayout>.size)
  }

  /// The bitrate for the picture: enough for the clip to fit the cap with
  /// its sound, never above the ceiling (scaled to this clip's size and
  /// rate), never below the floor. `videoBitrateFor` in bakeVideo.ts is the
  /// same function, and tests pin its numbers.
  static func videoBitrate(
    duration: Double,
    width: Double,
    height: Double,
    frameRate: Double,
    audioBitrate: Double,
    maxBitrate: Double,
    sizeCapBytes: Double
  ) -> Int {
    let w = width > 0 && width.isFinite ? width : 1080
    let h = height > 0 && height.isFinite ? height : 1920
    let fps = frameRate > 0 && frameRate.isFinite ? frameRate : BakeTuning.maxFrameRate
    let scale = min(1, (w * h * fps) / BakeTuning.referencePixelRate)
    let ceiling = (maxBitrate > 0 ? maxBitrate : BakeTuning.defaultMaxBitrate) * scale
    let floor = min(BakeTuning.minimumBitrate, ceiling)
    guard duration > 0, duration.isFinite else {
      return Int(ceiling.rounded())
    }
    let cap = sizeCapBytes > 0 ? sizeCapBytes : BakeTuning.defaultSizeCapBytes
    let sound = audioBitrate > 0 && audioBitrate.isFinite ? audioBitrate : 0
    let budget = cap * 8 * BakeTuning.budgetHeadroom / duration - sound
    return Int(min(ceiling, max(floor, budget)).rounded())
  }

  // MARK: - Reading the source

  /// The part of the clip to develop: all of it, or the range asked for,
  /// within the clip. Nil when the clip reports no usable length.
  static func timeRange(of asset: AVAsset, start: Double, duration: Double) -> CMTimeRange? {
    let total = asset.duration
    let totalSeconds = CMTimeGetSeconds(total)
    guard total.isNumeric, totalSeconds.isFinite, totalSeconds > 0 else {
      return nil
    }
    let from = start.isFinite ? min(max(0, start), totalSeconds) : 0
    let wanted = duration.isFinite && duration > 0 ? duration : totalSeconds
    let length = min(wanted, totalSeconds - from)
    guard length > 0.05 else {
      return nil
    }
    if from == 0 && length >= totalSeconds {
      return CMTimeRange(start: .zero, duration: total)
    }
    let timescale: CMTimeScale = 600
    return CMTimeRange(
      start: CMTime(seconds: from, preferredTimescale: timescale),
      duration: CMTime(seconds: length, preferredTimescale: timescale)
    )
  }

  /// Which sound to keep, and whether it can be copied. A recent iPhone may
  /// write a spatial-audio track beside the stereo one; the first enabled
  /// AAC track in one or two channels is copied, and otherwise the first
  /// track is decoded and encoded as stereo AAC.
  static func audioPlan(for asset: AVAsset) -> AudioPlan? {
    let all = asset.tracks(withMediaType: .audio)
    let enabled = all.filter { $0.isEnabled }
    let candidates = enabled.isEmpty ? all : enabled
    guard let first = candidates.first else {
      return nil
    }
    for track in candidates {
      let formats = formatDescriptions(of: track)
      guard formats.count == 1,
        let description = CMAudioFormatDescriptionGetStreamBasicDescription(formats[0])?.pointee
      else {
        continue
      }
      if description.mFormatID == kAudioFormatMPEG4AAC,
        description.mChannelsPerFrame >= 1, description.mChannelsPerFrame <= 2 {
        let rate = track.estimatedDataRate > 0 ? Double(track.estimatedDataRate) : Double(BakeTuning.audioBitrate)
        return AudioPlan(
          track: track,
          passthrough: true,
          formatHint: formats[0],
          bitrate: rate,
          sampleRate: encoderSampleRate(description.mSampleRate)
        )
      }
    }
    var sourceRate: Double = 0
    if let format = formatDescriptions(of: first).first,
      let description = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee {
      sourceRate = description.mSampleRate
    }
    return AudioPlan(
      track: first,
      passthrough: false,
      formatHint: nil,
      bitrate: Double(BakeTuning.audioBitrate),
      sampleRate: encoderSampleRate(sourceRate)
    )
  }

  /// AAC at 44.1 kHz stays there; anything else is encoded at 48 kHz.
  static func encoderSampleRate(_ rate: Double) -> Double {
    return rate == 44_100 ? 44_100 : 48_000
  }

  /// HDR by the track's own say-so, or by the transfer function its format
  /// carries (HLG or PQ), for files that do not declare the characteristic.
  static func isHDR(_ track: AVAssetTrack) -> Bool {
    if track.hasMediaCharacteristic(.containsHDRVideo) {
      return true
    }
    let hlg = kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG as String
    let pq = kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ as String
    for format in formatDescriptions(of: track) {
      let transfer = CMFormatDescriptionGetExtension(format, extensionKey: kCMFormatDescriptionExtension_TransferFunction) as? String
      if transfer == hlg || transfer == pq {
        return true
      }
    }
    return false
  }

  static func formatDescriptions(of track: AVAssetTrack) -> [CMFormatDescription] {
    // AVFoundation documents this array as holding format descriptions only.
    return track.formatDescriptions.map { $0 as! CMFormatDescription }
  }

  /// A media subtype as its four characters, "avc1" or "hvc1".
  static func fourCC(_ code: FourCharCode) -> String {
    let bytes = [24, 16, 8, 0].map { UInt8((code >> UInt32($0)) & 0xff) }
    let characters = bytes.map { (32...126).contains($0) ? Character(UnicodeScalar($0)) : Character("?") }
    return String(characters).trimmingCharacters(in: .whitespaces)
  }

  /// The app being sent to the background mid-export, or the media daemon
  /// restarting: worth trying again, not a fault in the clip.
  static func isInterruption(_ error: Error?) -> Bool {
    guard let error = error as NSError? else {
      return false
    }
    if error.domain == AVFoundationErrorDomain,
      error.code == AVError.Code.operationInterrupted.rawValue
        || error.code == AVError.Code.mediaServicesWereReset.rawValue {
      return true
    }
    // kVTInvalidSessionErr: the hardware encoder was taken away in the background.
    if error.domain == NSOSStatusErrorDomain, error.code == -12903 {
      return true
    }
    if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError {
      return isInterruption(underlying)
    }
    return false
  }

  // MARK: - Files

  static func outputURL() -> URL {
    return FileManager.default.temporaryDirectory
      .appendingPathComponent("vintage-\(UUID().uuidString).mp4")
  }

  static func remove(_ url: URL) {
    try? FileManager.default.removeItem(at: url)
  }

  static func fileSize(_ url: URL) -> Int {
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
      let size = attributes[.size] as? NSNumber
    else {
      return 0
    }
    return size.intValue
  }

  // MARK: - Geometry

  static func fileURL(from uri: String) -> URL? {
    if let url = URL(string: uri), url.scheme != nil {
      return url
    }
    return URL(fileURLWithPath: uri)
  }

  /// The upright size of the track, capped on its longest side and rounded
  /// to even numbers, which H.264 insists on.
  static func renderSize(for track: AVAssetTrack, maxDimension: Double) -> CGSize {
    let natural = track.naturalSize.applying(track.preferredTransform)
    let width = abs(Double(natural.width))
    let height = abs(Double(natural.height))
    let longest = max(width, height)
    let cap = maxDimension > 0 ? maxDimension : longest
    let scale = longest > cap ? cap / longest : 1.0
    let even = { (value: Double) -> CGFloat in CGFloat(max(2, Int((value * scale / 2).rounded()) * 2)) }
    return CGSize(width: even(width), height: even(height))
  }

  // MARK: - The look

  /// The colour matrix and the fade, evaluated over a lattice of every
  /// colour so Core Image can look the answer up per pixel. Same maths as
  /// steps 1 and 2 of the fragment shader.
  static func makeCube(matrix: [Double], fade: Double, fadeColor: [Double], dimension n: Int) -> Data {
    let m: [Double] = matrix.count == 20 ? matrix : [
      1, 0, 0, 0, 0,
      0, 1, 0, 0, 0,
      0, 0, 1, 0, 0,
      0, 0, 0, 1, 0
    ]
    let paper: [Double] = fadeColor.count == 3 ? fadeColor : [0.5, 0.5, 0.5]
    let lift = fade * 0.38
    var data = [Float](repeating: 0, count: n * n * n * 4)
    var index = 0
    let steps = Double(n - 1)
    for b in 0..<n {
      for g in 0..<n {
        for r in 0..<n {
          let input = [Double(r) / steps, Double(g) / steps, Double(b) / steps, 1.0]
          var out = [0.0, 0.0, 0.0]
          for row in 0..<3 {
            let base = row * 5
            let value = m[base] * input[0] + m[base + 1] * input[1] + m[base + 2] * input[2]
              + m[base + 3] * input[3] + m[base + 4]
            out[row] = min(1, max(0, value))
          }
          for channel in 0..<3 {
            let c = out[channel]
            // mix(c, paper, lift * (1 - c))
            let mixed = c + (paper[channel] - c) * lift * (1 - c)
            out[channel] = min(1, max(0, mixed))
          }
          data[index] = Float(out[0])
          data[index + 1] = Float(out[1])
          data[index + 2] = Float(out[2])
          data[index + 3] = 1
          index += 4
        }
      }
    }
    return data.withUnsafeBufferPointer { Data(buffer: $0) }
  }

  /// Step 3 of the shader, drawn once as a grey plate the frame is
  /// multiplied by. Computed in the shader's normalised coordinates, so it
  /// is the same ellipse on a portrait clip as on a still.
  static func makeVignetteMask(size: CGSize, strength: Double) -> CIImage? {
    let width = Int(size.width)
    let height = Int(size.height)
    guard width > 0, height > 0 else { return nil }
    var pixels = [UInt8](repeating: 255, count: width * height)
    for y in 0..<height {
      let v = (Double(y) + 0.5) / Double(height) - 0.5
      for x in 0..<width {
        let u = (Double(x) + 0.5) / Double(width) - 0.5
        let distance = (u * u + v * v).squareRoot() * 1.35
        let t = min(1.0, max(0.0, (distance - 0.35) / (0.95 - 0.35)))
        let smooth = t * t * (3 - 2 * t)
        let factor = 1 - smooth * strength * 0.55
        pixels[y * width + x] = UInt8(max(0, min(255, (factor * 255).rounded())))
      }
    }
    guard let provider = CGDataProvider(data: Data(pixels) as CFData),
      let cgImage = CGImage(
        width: width,
        height: height,
        bitsPerComponent: 8,
        bitsPerPixel: 8,
        bytesPerRow: width,
        space: CGColorSpaceCreateDeviceGray(),
        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
        provider: provider,
        decode: nil,
        shouldInterpolate: true,
        intent: .defaultIntent
      )
    else { return nil }
    // No colour matching: the plate holds factors, not colours.
    return CIImage(cgImage: cgImage, options: [.colorSpace: NSNull()])
  }

  /// Step 4: opaque monochrome noise, to be added to a frame that has been
  /// lowered by its mean. The generator is fixed in space, so it is slid to
  /// a new place for each new pattern, and a pattern is held for two frames.
  static func makeGrain(strength: Double, time: Double, frame: CGRect) -> CIImage? {
    guard let generator = CIFilter(name: "CIRandomGenerator"), let random = generator.outputImage else {
      return nil
    }
    let tick = grainTick(time)
    let dx = CGFloat((tick * GrainTuning.stepX) % GrainTuning.wrap)
    let dy = CGFloat((tick * GrainTuning.stepY) % GrainTuning.wrap)
    // Made opaque before it is toned: the generator's fourth channel is
    // random too, and a colour matrix that unpremultiplies would divide the
    // noise by it.
    let moved = random
      .transformed(by: CGAffineTransform(scaleX: GrainTuning.cellSize, y: GrainTuning.cellSize))
      .transformed(by: CGAffineTransform(translationX: dx, y: dy))
      .cropped(to: frame)
      .settingAlphaOne(in: frame)
    let k = CGFloat(grainStrength(strength))
    guard let toned = CIFilter(name: "CIColorMatrix", parameters: [
      kCIInputImageKey: moved,
      "inputRVector": CIVector(x: k * 0.299, y: k * 0.587, z: k * 0.114, w: 0),
      "inputGVector": CIVector(x: k * 0.299, y: k * 0.587, z: k * 0.114, w: 0),
      "inputBVector": CIVector(x: k * 0.299, y: k * 0.587, z: k * 0.114, w: 0),
      // Alpha is set to one rather than passed through, so adding the noise
      // changes the frame's colour by luminance noise and nothing else.
      "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0),
      "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 1)
    ]), let output = toned.outputImage else {
      return nil
    }
    return output.cropped(to: frame)
  }

  /// Which grain pattern a frame at this time wears: a new one every
  /// 1/15 s, so a 30 fps clip shows each for two frames.
  static func grainTick(_ time: Double) -> Int {
    let seconds = time.isFinite ? max(0, time) : 0
    return Int((seconds * GrainTuning.refreshHz + GrainTuning.tickEpsilon).rounded(.down))
  }

  /// The noise's full range, before it is centred: the shader's strength,
  /// with a fixed stand-in for its mid-tone weighting.
  static func grainStrength(_ strength: Double) -> Double {
    return strength * GrainTuning.shaderStrength * GrainTuning.midtoneStandIn
  }
}

// MARK: - Reading and writing

/// One pass of the clip through the film: an AVAssetReader whose video
/// output renders every frame through the composition, into an
/// AVAssetWriter that encodes H.264 at the bitrate given. Picture and sound
/// are each pumped on a queue of their own whenever the writer wants more,
/// and the pass ends when both are done, through a dispatch group.
///
/// Apple says a reader must not be cancelled while a sample is being
/// copied from it, nor a writer while one is being appended, so a stop is
/// never forced: each channel notices it between samples and ends itself,
/// and the reader and writer are cancelled only after both have.
private final class WriterPass {
  enum Outcome {
    /// The file, and how its sound was written: "copied", "aac" or "none".
    case finished(URL, String)
    case stopped(StopReason)
    case failed(String, String)
    /// The reader or the writer would not start on this source, or not a
    /// single frame came through: the caller may try the export session.
    case unstartable(String)
  }

  private let plan: BakePlan
  private let videoBitrate: Int
  private let job: BakeJob
  private let report: (Double) -> Void
  private let outputURL = Baker.outputURL()
  private let group = DispatchGroup()
  /// The channels are made on the bake queue and may be stopped from any thread.
  private let lock = NSLock()
  private var reader: AVAssetReader?
  private var writer: AVAssetWriter?
  private var video: Channel?
  private var audio: Channel?
  private var audioMode = "none"

  init(plan: BakePlan, videoBitrate: Int, job: BakeJob, report: @escaping (Double) -> Void) {
    self.plan = plan
    self.videoBitrate = videoBitrate
    self.job = job
    self.report = report
  }

  /// Any thread. Asks both channels to end at their next sample.
  func stop() {
    lock.lock()
    let channels = [video, audio]
    lock.unlock()
    for channel in channels {
      channel?.cancel()
    }
  }

  /// Bake queue. Calls back exactly once, from any queue.
  func start(completion: @escaping (Outcome) -> Void) {
    if let why = job.stopped {
      completion(.stopped(why))
      return
    }
    if let reason = prepare() {
      Baker.remove(outputURL)
      completion(.unstartable(reason))
      return
    }
    lock.lock()
    let reader = self.reader
    let writer = self.writer
    let video = self.video
    let audio = self.audio
    lock.unlock()
    guard let reader = reader, let writer = writer, let video = video else {
      Baker.remove(outputURL)
      completion(.unstartable("The reader and writer were not set up"))
      return
    }

    let start = plan.range.start
    let length = CMTimeGetSeconds(plan.range.duration)
    let job = self.job
    let shouldStop: () -> Bool = { [weak job] in
      job?.stopped != nil
    }
    // When one channel ends badly the other is told to end too, or it could
    // wait for ever on a writer that will never want more.
    video.run(
      writer: writer,
      reader: reader,
      shouldStop: shouldStop,
      appended: { [weak self] time in
        self?.progress(at: time, start: start, length: length)
      },
      endedEarly: { [weak self] in
        self?.stop()
      }
    )
    audio?.run(
      writer: writer,
      reader: reader,
      shouldStop: shouldStop,
      appended: nil,
      endedEarly: { [weak self] in
        self?.stop()
      }
    )
    group.notify(queue: VintageVideoModule.queue) {
      self.finish(reader: reader, writer: writer, video: video, audio: audio, completion: completion)
    }
    // A stop that came in while the channels were being made reaches them now.
    if job.stopped != nil {
      stop()
    }
  }

  /// Makes the writer and the reader and starts both. Returns why it could
  /// not, or nil when the pass is ready to run.
  private func prepare() -> String? {
    let writer: AVAssetWriter
    do {
      writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
    } catch {
      return "The writer could not be made: \(error.localizedDescription)"
    }
    // The index goes at the front, so playback starts while the file is
    // still downloading.
    writer.shouldOptimizeForNetworkUse = true

    let videoSettings = Baker.videoSettings(size: plan.renderSize, bitrate: videoBitrate, frameRate: plan.frameRate)
    // An input made with settings the writer cannot take raises an
    // Objective-C exception, which Swift cannot catch, so every input is
    // checked before it is made.
    guard writer.canApply(outputSettings: videoSettings, forMediaType: .video) else {
      return "The writer cannot take these H.264 settings"
    }
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    videoInput.expectsMediaDataInRealTime = false
    guard writer.canAdd(videoInput) else {
      return "The writer cannot take a video input"
    }
    writer.add(videoInput)

    var audioInput: AVAssetWriterInput?
    var copying = false
    if let audio = plan.audio {
      if audio.passthrough, writer.canApply(outputSettings: nil, forMediaType: .audio) {
        // No settings: the AAC packets are written as they come, described
        // by the source's own format.
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: nil, sourceFormatHint: audio.formatHint)
        if writer.canAdd(input) {
          audioInput = input
          copying = true
        }
      }
      if audioInput == nil {
        let settings = Baker.aacSettings(sampleRate: audio.sampleRate)
        guard writer.canApply(outputSettings: settings, forMediaType: .audio) else {
          return "The writer cannot take the AAC settings"
        }
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
        guard writer.canAdd(input) else {
          return "The writer cannot take an audio input"
        }
        audioInput = input
      }
      if let input = audioInput {
        input.expectsMediaDataInRealTime = false
        writer.add(input)
      }
    }

    let reader: AVAssetReader
    do {
      reader = try AVAssetReader(asset: plan.asset)
    } catch {
      return "The reader could not be made: \(error.localizedDescription)"
    }
    reader.timeRange = plan.range

    // BGRA, the format the export session rendered the film into, so the
    // look is unchanged: Core Image writes RGB, and the conversion to the
    // encoder's 4:2:0 happens once, in the encoder, with the BT.709 matrix
    // the writer is told to tag. Asking for 4:2:0 here would save memory
    // bandwidth but leave Core Image to pick the matrix and range itself.
    let videoOutput = AVAssetReaderVideoCompositionOutput(
      videoTracks: plan.videoTracks,
      videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
    )
    videoOutput.videoComposition = plan.composition
    videoOutput.alwaysCopiesSampleData = false
    guard reader.canAdd(videoOutput) else {
      return "The reader cannot render this video through the film"
    }
    reader.add(videoOutput)

    var audioOutput: AVAssetReaderOutput?
    if let audio = plan.audio, audioInput != nil {
      let output: AVAssetReaderOutput
      if copying {
        output = AVAssetReaderTrackOutput(track: audio.track, outputSettings: nil)
      } else {
        output = AVAssetReaderAudioMixOutput(
          audioTracks: [audio.track],
          audioSettings: Baker.pcmSettings(sampleRate: audio.sampleRate)
        )
      }
      output.alwaysCopiesSampleData = false
      guard reader.canAdd(output) else {
        return "The reader cannot read this sound"
      }
      reader.add(output)
      audioOutput = output
    }

    guard reader.startReading() else {
      return "The reader would not start: \(reader.error?.localizedDescription ?? "unknown error")"
    }
    guard writer.startWriting() else {
      reader.cancelReading()
      return "The writer would not start: \(writer.error?.localizedDescription ?? "unknown error")"
    }
    // Picture and sound are read over the same range, so starting the
    // session at its start (the first frame's time, zero for a whole clip)
    // keeps the sound where it was against the picture. Anything read from
    // before it, such as the AAC encoder's priming, is trimmed by the writer.
    writer.startSession(atSourceTime: plan.range.start)

    let videoChannel = Channel(label: "frames", input: videoInput, output: videoOutput, group: group)
    var audioChannel: Channel?
    if let input = audioInput, let output = audioOutput {
      audioChannel = Channel(label: "sound", input: input, output: output, group: group)
    }
    lock.lock()
    self.reader = reader
    self.writer = writer
    self.video = videoChannel
    self.audio = audioChannel
    audioMode = audioChannel == nil ? "none" : (copying ? "copied" : "aac")
    lock.unlock()
    return nil
  }

  /// Bake queue, once both channels have ended.
  private func finish(
    reader: AVAssetReader,
    writer: AVAssetWriter,
    video: Channel,
    audio: Channel?,
    completion: @escaping (Outcome) -> Void
  ) {
    if let why = job.stopped {
      teardown(reader, writer)
      completion(.stopped(why))
      return
    }
    let readerFailed = reader.status == .failed
    let writerFailed = writer.status == .failed
    let endedEarly = video.endedEarly || (audio?.endedEarly ?? false)
    let framesWritten = video.frames
    if readerFailed || writerFailed || endedEarly || writer.status != .writing {
      let error = writerFailed ? writer.error : reader.error
      teardown(reader, writer)
      if Baker.isInterruption(error) {
        completion(.stopped(.interrupted))
      } else if framesWritten == 0 {
        completion(.unstartable("No frame came through: \(error?.localizedDescription ?? "unknown error")"))
      } else {
        completion(.failed("E_BAKE_EXPORT", "The filter could not be applied: \(error?.localizedDescription ?? "the clip stopped early")"))
      }
      return
    }
    if framesWritten == 0 {
      teardown(reader, writer)
      completion(.unstartable("No frame came through the film"))
      return
    }
    if job.shouldReport(1) {
      report(1)
    }
    let outputURL = self.outputURL
    let audioMode = self.audioMode
    let job = self.job
    writer.finishWriting {
      if writer.status == .completed {
        completion(.finished(outputURL, audioMode))
        return
      }
      let error = writer.error
      Baker.remove(outputURL)
      if let why = job.stopped {
        completion(.stopped(why))
      } else if Baker.isInterruption(error) {
        completion(.stopped(.interrupted))
      } else {
        completion(.failed("E_BAKE_EXPORT", "The clip could not be finished: \(error?.localizedDescription ?? "unknown error")"))
      }
    }
  }

  /// Only once both channels have ended, so nothing is being copied or
  /// appended while the reader and writer are cancelled.
  private func teardown(_ reader: AVAssetReader, _ writer: AVAssetWriter) {
    if reader.status == .reading {
      reader.cancelReading()
    }
    if writer.status == .writing {
      writer.cancelWriting()
    }
    Baker.remove(outputURL)
  }

  /// Frames queue. How far through the range this frame is.
  private func progress(at time: CMTime, start: CMTime, length: Double) {
    guard length > 0 else {
      return
    }
    let elapsed = CMTimeGetSeconds(CMTimeSubtract(time, start))
    guard elapsed.isFinite else {
      return
    }
    let fraction = min(1, max(0, elapsed / length))
    if job.shouldReport(fraction) {
      report(fraction)
    }
  }
}

/// One track's samples, copied from the reader and appended to the writer
/// on a queue of its own whenever the writer wants more. It ends exactly
/// once, leaving the pass's group: when its samples run out, when an append
/// fails, when it notices a stop, or when it is cancelled.
private final class Channel {
  private let input: AVAssetWriterInput
  private let output: AVAssetReaderOutput
  private let queue: DispatchQueue
  private let group: DispatchGroup
  private weak var writer: AVAssetWriter?
  // Touched only on `queue`, and read by the pass after the group is done.
  private var done = false
  private(set) var frames = 0
  private(set) var endedEarly = false

  init(label: String, input: AVAssetWriterInput, output: AVAssetReaderOutput, group: DispatchGroup) {
    self.input = input
    self.output = output
    self.queue = DispatchQueue(label: "club.vintage.video.bake.\(label)", qos: .userInitiated)
    self.group = group
    group.enter()
  }

  /// Starts asking for samples. Registered on the channel's own queue, so a
  /// cancel that came first wins and no request is made for a finished input.
  func run(
    writer: AVAssetWriter,
    reader: AVAssetReader,
    shouldStop: @escaping () -> Bool,
    appended: ((CMTime) -> Void)?,
    endedEarly early: @escaping () -> Void
  ) {
    queue.async {
      self.writer = writer
      if self.done {
        return
      }
      self.input.requestMediaDataWhenReady(on: self.queue) { [weak self, weak writer, weak reader] in
        self?.pump(writer: writer, reader: reader, shouldStop: shouldStop, appended: appended, early: early)
      }
    }
  }

  /// Any thread.
  func cancel() {
    queue.async {
      self.end(early: true)
    }
  }

  /// Channel queue: as many samples as the writer will take right now.
  private func pump(
    writer: AVAssetWriter?,
    reader: AVAssetReader?,
    shouldStop: () -> Bool,
    appended: ((CMTime) -> Void)?,
    early: () -> Void
  ) {
    if done {
      return
    }
    guard let writer = writer, let reader = reader else {
      end(early: true)
      return
    }
    while input.isReadyForMoreMediaData {
      if shouldStop() || writer.status != .writing {
        end(early: true)
        early()
        return
      }
      guard let sample = output.copyNextSampleBuffer() else {
        // The end of the range, or the reader failed; the pass tells which.
        let failed = reader.status == .failed
        end(early: failed)
        if failed {
          early()
        }
        return
      }
      let time = CMSampleBufferGetPresentationTimeStamp(sample)
      guard input.append(sample) else {
        end(early: true)
        early()
        return
      }
      frames += 1
      appended?(time)
    }
  }

  /// Channel queue.
  private func end(early: Bool) {
    if done {
      return
    }
    done = true
    endedEarly = early
    if writer?.status == .writing {
      input.markAsFinished()
    }
    group.leave()
  }
}

// MARK: - Inspecting a clip

/// What a file is, for dev diagnostics and the job's sanity checks: its
/// upright size, length, frame rate, the video track's estimated bitrate,
/// its codec, whether it is HDR, and its size on disk.
private enum Inspector {
  static func inspect(uri: String, promise: Promise) {
    guard let url = Baker.fileURL(from: uri) else {
      promise.reject("E_INSPECT_INPUT", "The video could not be found at \(uri)")
      return
    }
    let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
    let tracks = asset.tracks(withMediaType: .video)
    guard let track = tracks.first(where: { $0.isEnabled }) ?? tracks.first else {
      promise.reject("E_INSPECT_INPUT", "The file has no video track")
      return
    }
    let upright = track.naturalSize.applying(track.preferredTransform)
    let duration = CMTimeGetSeconds(asset.duration)
    let codec = Baker.formatDescriptions(of: track).first.map {
      Baker.fourCC(CMFormatDescriptionGetMediaSubType($0))
    } ?? ""
    let result: [String: Any] = [
      "width": Int(abs(upright.width).rounded()),
      "height": Int(abs(upright.height).rounded()),
      "duration": duration.isFinite ? duration : 0,
      "frameRate": Double(track.nominalFrameRate),
      "bitrate": Double(track.estimatedDataRate),
      "codec": codec,
      "hdr": Baker.isHDR(track),
      "bytes": url.isFileURL ? Baker.fileSize(url) : 0
    ]
    promise.resolve(result)
  }
}
