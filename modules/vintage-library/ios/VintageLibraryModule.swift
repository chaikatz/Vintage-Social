import ExpoModulesCore
import Photos
import UIKit

/// What `developImage` is asked for: the long side to fit, whether iCloud
/// may be asked for the original, and the name JS gave the request so its
/// progress and a STOP can find it.
struct DevelopOptions: Record {
  @Field var maxSide: Double = 2048
  @Field var allowNetwork: Bool = false
  @Field var requestId: String = ""
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
public class VintageLibraryModule: Module {
  /// Fetching, drawing and writing happen here: off the main thread, and off
  /// the queue every module's async functions share.
  private static let work = DispatchQueue(label: "club.vintage.library.develop", qos: .userInitiated)
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
