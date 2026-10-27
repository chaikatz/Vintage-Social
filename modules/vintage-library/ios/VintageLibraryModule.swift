import CoreGraphics
import ExpoModulesCore
import ImageIO
import Photos
import UIKit
import UniformTypeIdentifiers

/// What `developImage` is asked for: the long side to fit, whether iCloud
/// may be asked for the original, and the name JS gave the request so its
/// progress and a STOP can find it.
struct DevelopOptions: Record {
  @Field var maxSide: Double = 2048
  @Field var allowNetwork: Bool = false
  @Field var requestId: String = ""
}

/// What `prepareImage` is asked for: the long side to fit and the JPEG
/// quality, and optionally a thumbnail's long side and quality. A thumbnail
/// side of 0 means no thumbnail.
struct PrepareOptions: Record {
  @Field var maxSide: Double = 1440
  @Field var quality: Double = 0.9
  @Field var thumbSide: Double = 0
  @Field var thumbQuality: Double = 0.8
}

/// Develops one photograph from the member's library for the editor.
///
/// The editor needs an ordinary JPEG: upright, a sensible size, and nothing
/// of the original file carried over. Reading the photograph's own file to
/// make one meant decoding the full original (48 MP on a recent phone, next
/// to the GL editor), bringing it down from iCloud without asking, and, for
/// a Live Photo, writing its video out too. Photos can do better than that
/// itself: asked for a rendition of a given size, it decodes no more than it
/// needs, and it says plainly when the original is only in iCloud.
///
/// So the photograph is asked for once, at 2048 pixels on the long side, in
/// its current version (the member's own crops and edits kept), the still
/// only. The first ask never touches the network: an original that lives
/// only in iCloud comes back as `inCloud`, and the Darkroom asks the member
/// before it asks again with the network allowed. While it comes down,
/// progress goes to JS as `onDevelopProgress`. The rendition is drawn upright
/// into a fresh bitmap and written as a JPEG into `Caches/darkroom`, so no
/// place, camera or date from the original goes with it. Nothing here reads
/// a location or a Live Photo's video.
///
/// Every develop resolves exactly once: with what Photos gave, or as
/// `failed` the moment `cancelDevelop` stops it. A copy that is finished
/// after a stop is deleted rather than handed back.
///
/// The module also prepares a photograph already on the phone for posting
/// (`prepareImage`): see `Preparer` below.
public class VintageLibraryModule: Module {
  /// Fetching, drawing and writing happen here: off the main thread, and off
  /// the queue every module's async functions share.
  private static let work = DispatchQueue(label: "club.vintage.library.develop", qos: .userInitiated)
  /// Preparing a photograph to post has a queue of its own, so it never
  /// waits behind a develop that is bringing an original down from iCloud.
  /// One at a time: each holds a decoded image in memory.
  private static let preparing = DispatchQueue(label: "club.vintage.library.prepare", qos: .userInitiated)
  private let developments = Developments()

  public func definition() -> ModuleDefinition {
    Name("VintageLibrary")

    Events("onDevelopProgress")

    AsyncFunction("developImage") { (id: String, options: DevelopOptions, promise: Promise) in
      let requestId = options.requestId.isEmpty ? UUID().uuidString : options.requestId
      let job = Development(requestId: requestId, promise: promise, registry: self.developments)
      let alone = self.developments.add(job)
      Self.work.async {
        // Copies from earlier develops have been posted or put back by now:
        // the editor they were made for has closed. They are not kept.
        if alone {
          Self.sweep()
        }
        self.develop(id: id, options: options, job: job)
      }
    }

    AsyncFunction("cancelDevelop") { (requestId: String, promise: Promise) in
      guard let job = self.developments.take(requestId) else {
        promise.resolve("failed")
        return
      }
      let request = job.cancel()
      if request != PHInvalidImageRequestID {
        PHImageManager.default().cancelImageRequest(request)
      }
      promise.resolve(job.settle(Development.failed) ? "cancelled" : "failed")
    }

    AsyncFunction("existing") { (ids: [String], promise: Promise) in
      Self.work.async {
        // Without access every identifier would seem to be gone; that is
        // not an answer to give a caller who might tidy up on it.
        guard Self.mayRead() else {
          promise.reject("E_LIBRARY_ACCESS", "The photo library cannot be read")
          return
        }
        if ids.isEmpty {
          promise.resolve([String]())
          return
        }
        let found = PHAsset.fetchAssets(withLocalIdentifiers: ids, options: nil)
        var present = Set<String>()
        for index in 0..<found.count {
          present.insert(found.object(at: index).localIdentifier)
        }
        promise.resolve(ids.filter { present.contains($0) })
      }
    }

    AsyncFunction("prepareImage") { (uri: String, options: PrepareOptions, promise: Promise) in
      Self.preparing.async {
        // One answer, whichever way it goes.
        switch Preparer.prepare(uri: uri, options: options) {
        case .success(let result):
          promise.resolve(result)
        case .failure(let failure):
          promise.reject(failure.code, failure.message)
        }
      }
    }
  }

  // MARK: - Developing

  private func develop(id: String, options: DevelopOptions, job: Development) {
    guard Self.mayRead() else {
      job.settle(Development.failed)
      return
    }
    guard let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject else {
      job.settle(["status": "missing"])
      return
    }
    if job.isCancelled {
      job.settle(Development.failed)
      return
    }

    let maxSide = options.maxSide >= 1 ? min(options.maxSide, 8192) : 2048
    let allowNetwork = options.allowNetwork
    let request = PHImageRequestOptions()
    request.deliveryMode = .highQualityFormat
    request.version = .current
    request.resizeMode = .exact
    request.isNetworkAccessAllowed = allowNetwork
    request.isSynchronous = false
    let requestId = job.requestId
    request.progressHandler = { [weak self] progress, _, _, _ in
      let clamped = min(1, max(0, progress))
      guard job.shouldReport(clamped) else { return }
      self?.sendEvent("onDevelopProgress", [
        "requestId": requestId,
        "progress": clamped
      ])
    }

    let target = Self.targetSize(width: asset.pixelWidth, height: asset.pixelHeight, maxSide: maxSide)
    let imageRequest = PHImageManager.default().requestImage(
      for: asset,
      targetSize: target,
      contentMode: .aspectFit,
      options: request
    ) { image, info in
      Self.received(image: image, info: info, allowNetwork: allowNetwork, maxSide: maxSide, job: job)
    }
    job.started(imageRequest)
  }

  /// Photos' answer. With the high-quality delivery mode it answers once; a
  /// degraded image, should one come anyway, is a preview and not the answer.
  private static func received(
    image: UIImage?,
    info: [AnyHashable: Any]?,
    allowNetwork: Bool,
    maxSide: Double,
    job: Development
  ) {
    let info = info ?? [:]
    if Self.flag(info, PHImageCancelledKey) || job.isCancelled {
      job.settle(Development.failed)
      return
    }
    guard let image = image else {
      if !allowNetwork && Self.flag(info, PHImageResultIsInCloudKey) {
        job.settle(["status": "inCloud"])
      } else {
        job.settle(Development.failed)
      }
      return
    }
    if Self.flag(info, PHImageResultIsDegradedKey) {
      return
    }

    Self.work.async {
      if job.isCancelled {
        job.settle(Development.failed)
        return
      }
      guard let written = Self.writeUpright(image, maxSide: maxSide) else {
        job.settle(Development.failed)
        return
      }
      let result: [String: Any] = [
        "status": "ok",
        "uri": written.url.absoluteString,
        "width": written.width,
        "height": written.height
      ]
      if job.isCancelled || !job.settle(result) {
        // Stopped while it was being written: the copy is not kept.
        try? FileManager.default.removeItem(at: written.url)
        job.settle(Development.failed)
      }
    }
  }

  /// The asset's own size fitted inside `maxSide` on its long side, never
  /// larger than the asset. Photos fits the rendition inside this box.
  static func targetSize(width: Int, height: Int, maxSide: Double) -> CGSize {
    guard width > 0, height > 0 else {
      return CGSize(width: maxSide, height: maxSide)
    }
    let w = Double(width)
    let h = Double(height)
    let fit = min(1, maxSide / max(w, h))
    return CGSize(width: max(1, (w * fit).rounded()), height: max(1, (h * fit).rounded()))
  }

  /// Draws the image upright into a new bitmap at one pixel per point, in
  /// standard sRGB (the editor's GL texture reads no colour profile), and
  /// writes it as a JPEG. Drawing through UIKit applies the orientation;
  /// encoding a fresh bitmap carries none of the original's metadata.
  private static func writeUpright(_ image: UIImage, maxSide: Double) -> (url: URL, width: Int, height: Int)? {
    let naturalWidth = Double(image.size.width * image.scale)
    let naturalHeight = Double(image.size.height * image.scale)
    guard naturalWidth >= 1, naturalHeight >= 1, let folder = developedFolder() else {
      return nil
    }
    let fit = min(1, maxSide / max(naturalWidth, naturalHeight))
    let width = max(1, (naturalWidth * fit).rounded())
    let height = max(1, (naturalHeight * fit).rounded())
    let size = CGSize(width: width, height: height)

    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    format.preferredRange = .standard
    let data: Data = autoreleasepool {
      UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.95) { _ in
        image.draw(in: CGRect(origin: .zero, size: size))
      }
    }

    let url = folder.appendingPathComponent(UUID().uuidString).appendingPathExtension("jpg")
    do {
      try data.write(to: url, options: .atomic)
    } catch {
      return nil
    }
    return (url, Int(width), Int(height))
  }

  /// `Caches/darkroom`: never backed up, and cleared by iOS when it needs room.
  private static func developedFolder() -> URL? {
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      return nil
    }
    let folder = caches.appendingPathComponent("darkroom", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: nil)
    } catch {
      return nil
    }
    return folder
  }

  /// Removes every copy left in `Caches/darkroom`. Called only when no other
  /// develop is in flight, so nothing being made or handed over is touched.
  private static func sweep() {
    guard let folder = developedFolder(),
      let left = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
    else {
      return
    }
    for url in left {
      try? FileManager.default.removeItem(at: url)
    }
  }

  private static func mayRead() -> Bool {
    let status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    return status == .authorized || status == .limited
  }

  private static func flag(_ info: [AnyHashable: Any], _ key: String) -> Bool {
    return (info[key] as? NSNumber)?.boolValue ?? false
  }
}

/// One develop in flight. Photos answers on a queue of its own, a STOP comes
/// in on the module's queue, and the copy is written on the work queue, so
/// everything that decides how the develop ends is behind one lock, and only
/// the first ending counts.
private final class Development {
  static let failed: [String: Any] = ["status": "failed"]

  let requestId: String
  private let promise: Promise
  private weak var registry: Developments?
  private let lock = NSLock()
  private var settled = false
  private var cancelled = false
  private var imageRequest: PHImageRequestID = PHInvalidImageRequestID
  private var reported: Double = -1

  init(requestId: String, promise: Promise, registry: Developments) {
    self.requestId = requestId
    self.promise = promise
    self.registry = registry
  }

  var isCancelled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return cancelled
  }

  /// Records the Photos request so a STOP can reach it. A STOP that came
  /// first is passed straight on.
  func started(_ request: PHImageRequestID) {
    lock.lock()
    imageRequest = request
    let stopNow = cancelled
    lock.unlock()
    if stopNow && request != PHInvalidImageRequestID {
      PHImageManager.default().cancelImageRequest(request)
    }
  }

  /// Marks the develop stopped; returns the Photos request to cancel, if one
  /// has started.
  func cancel() -> PHImageRequestID {
    lock.lock()
    defer { lock.unlock() }
    cancelled = true
    return imageRequest
  }

  /// Progress worth a word to JS: a step of at least a hundredth, or the end.
  func shouldReport(_ progress: Double) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if settled || cancelled || progress <= reported {
      return false
    }
    if progress < 1 && progress - reported < 0.01 {
      return false
    }
    reported = progress
    return true
  }

  /// Resolves the develop's promise if nothing has yet. True when this call
  /// was the one that did.
  @discardableResult
  func settle(_ result: [String: Any]) -> Bool {
    lock.lock()
    if settled {
      lock.unlock()
      return false
    }
    settled = true
    lock.unlock()
    registry?.remove(self)
    promise.resolve(result)
    return true
  }
}

/// The develops in flight, by the name JS gave each.
private final class Developments {
  private let lock = NSLock()
  private var inFlight: [String: Development] = [:]

  /// Adds a develop. True when no other was in flight.
  func add(_ job: Development) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    let alone = inFlight.isEmpty
    inFlight[job.requestId] = job
    return alone
  }

  /// Removes and returns the develop with this name, if it is still in flight.
  func take(_ requestId: String) -> Development? {
    lock.lock()
    defer { lock.unlock() }
    return inFlight.removeValue(forKey: requestId)
  }

  func remove(_ job: Development) {
    lock.lock()
    defer { lock.unlock() }
    if inFlight[job.requestId] === job {
      inFlight.removeValue(forKey: job.requestId)
    }
  }
}

// MARK: - Preparing a photograph to post

/// Makes the JPEG a post uploads, and optionally its thumbnail, from a
/// photograph already on the phone.
///
/// The image manipulator this replaces decoded the whole original (48 MB of
/// pixels for a 12 MP photograph, and the same again for its orientation
/// fix) at background priority, which iOS starves in Low Power Mode, and it
/// kept a Display P3 photograph in P3, which the GL renderer then read as
/// sRGB, muting its colours. Here ImageIO decodes straight to the size
/// wanted (a HEIC in hardware, at the reduced size) with the EXIF
/// orientation applied in the same step. The pixels are drawn into an sRGB
/// bitmap, which converts wide-gamut colours to their nearest sRGB ones
/// rather than relabelling them, and the JPEG is written from that bitmap
/// alone, so nothing of the original file (place, camera, date) goes with
/// it. The thumbnail is drawn from the prepared pixels, not decoded again.
///
/// Files go to `Caches/prepared`, which is never backed up. Copies older
/// than three days, left by a post that never finished, are swept at the
/// first prepare after launch.
private enum Preparer {
  struct Failure: Error {
    let code: String
    let message: String
  }

  /// Touched only on the prepare queue.
  private static var swept = false
  private static let staleAfter: TimeInterval = 3 * 24 * 60 * 60

  static func prepare(uri: String, options: PrepareOptions) -> Result<[String: Any], Failure> {
    // The decoded bitmaps are released as soon as the files are written,
    // not whenever the queue's thread next drains its pool.
    return autoreleasepool {
      make(uri: uri, options: options)
    }
  }

  private static func make(uri: String, options: PrepareOptions) -> Result<[String: Any], Failure> {
    guard let url = fileURL(from: uri) else {
      return .failure(Failure(code: "E_PREPARE_INPUT", message: "Only a photograph stored on this iPhone can be prepared"))
    }
    guard let folder = preparedFolder() else {
      return .failure(Failure(code: "E_PREPARE_WRITE", message: "There is nowhere to write the prepared copy"))
    }
    sweepOnce(folder)

    guard let source = CGImageSourceCreateWithURL(url as CFURL, [kCGImageSourceShouldCache: false] as CFDictionary),
      CGImageSourceGetCount(source) > 0
    else {
      return .failure(Failure(code: "E_PREPARE_DECODE", message: "The photograph could not be read"))
    }
    let requested = options.maxSide >= 1 ? min(options.maxSide, 8192) : 1440
    let longest = longestSide(of: source)
    // ImageIO never enlarges; the cap only matters for a larger original.
    let side = longest > 0 ? min(requested, longest) : requested
    let decodeOptions: [CFString: Any] = [
      kCGImageSourceCreateThumbnailFromImageAlways: true,
      kCGImageSourceCreateThumbnailWithTransform: true,
      kCGImageSourceThumbnailMaxPixelSize: Int(side.rounded()),
      kCGImageSourceShouldCacheImmediately: true
    ]
    guard let decoded = CGImageSourceCreateThumbnailAtIndex(source, 0, decodeOptions as CFDictionary),
      let prepared = drawInSRGB(decoded, width: decoded.width, height: decoded.height)
    else {
      return .failure(Failure(code: "E_PREPARE_DECODE", message: "The photograph could not be decoded"))
    }

    let name = UUID().uuidString
    let mainURL = folder.appendingPathComponent(name).appendingPathExtension("jpg")
    guard writeJPEG(prepared, to: mainURL, quality: clampQuality(options.quality, fallback: 0.9)) else {
      return .failure(Failure(code: "E_PREPARE_WRITE", message: "The prepared copy could not be written"))
    }
    var result: [String: Any] = [
      "uri": mainURL.absoluteString,
      "width": prepared.width,
      "height": prepared.height
    ]

    if options.thumbSide >= 1 {
      let long = Double(max(prepared.width, prepared.height))
      let scale = min(1, options.thumbSide / long)
      let width = max(1, Int((Double(prepared.width) * scale).rounded()))
      let height = max(1, Int((Double(prepared.height) * scale).rounded()))
      let thumbURL = folder.appendingPathComponent("\(name)-thumb").appendingPathExtension("jpg")
      guard let thumb = drawInSRGB(prepared, width: width, height: height),
        writeJPEG(thumb, to: thumbURL, quality: clampQuality(options.thumbQuality, fallback: 0.8))
      else {
        try? FileManager.default.removeItem(at: mainURL)
        return .failure(Failure(code: "E_PREPARE_WRITE", message: "The thumbnail could not be made"))
      }
      result["thumb"] = [
        "uri": thumbURL.absoluteString,
        "width": width,
        "height": height
      ]
    }
    return .success(result)
  }

  /// A local file only: a `ph://` or remote address is not this function's
  /// to fetch, and JS sends those to the image manipulator instead.
  private static func fileURL(from uri: String) -> URL? {
    if uri.hasPrefix("/") {
      return URL(fileURLWithPath: uri)
    }
    guard let url = URL(string: uri), url.isFileURL else {
      return nil
    }
    return url
  }

  private static func longestSide(of source: CGImageSource) -> Double {
    guard let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [String: Any] else {
      return 0
    }
    let width = (properties[kCGImagePropertyPixelWidth as String] as? NSNumber)?.doubleValue ?? 0
    let height = (properties[kCGImagePropertyPixelHeight as String] as? NSNumber)?.doubleValue ?? 0
    return max(width, height)
  }

  /// Draws the image into a new 8-bit sRGB bitmap of the given size. Core
  /// Graphics colour-matches as it draws, so the GL renderer, which reads
  /// no colour profile, is handed the colours the photograph shows on
  /// screen. Anything transparent lands on white.
  private static func drawInSRGB(_ image: CGImage, width: Int, height: Int) -> CGImage? {
    guard width > 0, height > 0,
      let srgb = CGColorSpace(name: CGColorSpace.sRGB),
      let context = CGContext(
        data: nil,
        width: width,
        height: height,
        bitsPerComponent: 8,
        bytesPerRow: 0,
        space: srgb,
        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
      )
    else {
      return nil
    }
    let rect = CGRect(x: 0, y: 0, width: width, height: height)
    context.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
    context.fill(rect)
    context.interpolationQuality = .high
    context.draw(image, in: rect)
    return context.makeImage()
  }

  /// Encodes in memory and writes the file in one go, so nothing ever reads
  /// half a JPEG. Only the compression is given: no properties from the
  /// original, so the file says nothing about where or how it was taken.
  private static func writeJPEG(_ image: CGImage, to url: URL, quality: Double) -> Bool {
    let data = NSMutableData()
    guard let destination = CGImageDestinationCreateWithData(
      data as CFMutableData,
      UTType.jpeg.identifier as CFString,
      1,
      nil
    ) else {
      return false
    }
    CGImageDestinationAddImage(destination, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    guard CGImageDestinationFinalize(destination) else {
      return false
    }
    do {
      try (data as Data).write(to: url, options: .atomic)
    } catch {
      return false
    }
    return true
  }

  private static func clampQuality(_ value: Double, fallback: Double) -> Double {
    guard value.isFinite, value > 0 else {
      return fallback
    }
    return min(1, max(0.1, value))
  }

  /// `Caches/prepared`: never backed up, and cleared by iOS when it needs room.
  private static func preparedFolder() -> URL? {
    guard let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first else {
      return nil
    }
    let folder = caches.appendingPathComponent("prepared", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true, attributes: nil)
    } catch {
      return nil
    }
    return folder
  }

  /// Once per launch: copies a post never came back for. Anything younger
  /// than three days may still belong to a post waiting to upload.
  private static func sweepOnce(_ folder: URL) {
    if swept {
      return
    }
    swept = true
    guard let left = try? FileManager.default.contentsOfDirectory(
      at: folder,
      includingPropertiesForKeys: [.contentModificationDateKey],
      options: []
    ) else {
      return
    }
    let cutoff = Date().addingTimeInterval(-staleAfter)
    for url in left {
      let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate
      if let modified = modified, modified < cutoff {
        try? FileManager.default.removeItem(at: url)
      }
    }
  }
}
