import AVFoundation
import CoreGraphics
import CoreImage
import ExpoModulesCore
import Foundation
import QuartzCore
import UIKit

/// The look to burn in, in the same terms the GL shader takes: the composed
/// 4x5 colour matrix (row-major, last column the offset) and the film
/// artifacts. `src/filters/shader.ts` is the reference for every formula
/// below; a photograph and a video wearing the same film must match.
struct BakeOptions: Record {
  @Field var matrix: [Double] = []
  @Field var fade: Double = 0
  @Field var fadeColor: [Double] = [0.5, 0.5, 0.5]
  @Field var vignette: Double = 0
  @Field var grain: Double = 0
  @Field var maxDimension: Double = 1920
}

/// Bakes a VINTAGE filter into a video file.
///
/// Photographs are baked by the GL shader at publish time so the filter
/// ends up in the pixels. Video could not be, so it was overlaid at play
/// time — and iOS composites an overlay over an AVPlayer layer unreliably,
/// which is why a clip could look filtered in one place and untouched in
/// another. This does for video what the shader does for stills: the same
/// colour matrix and fade, as an exact 3D lookup table; the same vignette,
/// rendered once as a mask; the same luminance grain, moving frame to
/// frame the way grain on film does. The audio track comes through as it
/// was, and the file is written with its index at the front so playback
/// starts before the whole thing has downloaded.
public class VintageVideoModule: Module {
  fileprivate static let cubeDimension = 32
  private static let queue = DispatchQueue(label: "club.vintage.video.bake", qos: .userInitiated)

  public func definition() -> ModuleDefinition {
    Name("VintageVideo")

    AsyncFunction("bake") { (uri: String, options: BakeOptions, promise: Promise) in
      Self.queue.async {
        Baker(uri: uri, options: options).run(promise: promise)
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
  @Field var byline: BrandTextBox = BrandTextBox()
  @Field var credit: BrandTextBox = BrandTextBox()
  @Field var stamp: BrandTextBox = BrandTextBox()
  @Field var paper: String = "#FAF6EF"
  @Field var well: String = "#F3EDE2"
  @Field var ink: String = "#2B2620"
  @Field var inkSoft: String = "#6E655A"
  @Field var inkFaint: String = "#9C927F"
  @Field var ruleColor: String = "#D5CBB8"
  @Field var wordmarkText: String = "VINTAGE"
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
    font: UIFont, color: String, alignment: CATextLayerAlignmentMode
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
    layer.isWrapped = false
    // Units are already pixels; nothing here is scaled for a screen.
    layer.contentsScale = 1
    return layer
  }
}

private final class Baker {
  private let uri: String
  private let options: BakeOptions

  init(uri: String, options: BakeOptions) {
    self.uri = uri
    self.options = options
  }

  func run(promise: Promise) {
    guard let url = Baker.fileURL(from: uri) else {
      promise.reject("E_BAKE_INPUT", "The video could not be found at \(uri)")
      return
    }
    let asset = AVURLAsset(url: url)
    guard let track = asset.tracks(withMediaType: .video).first else {
      promise.reject("E_BAKE_INPUT", "The file has no video track")
      return
    }

    let renderSize = Baker.renderSize(for: track, maxDimension: options.maxDimension)
    guard renderSize.width > 0, renderSize.height > 0 else {
      promise.reject("E_BAKE_INPUT", "The video reports no size")
      return
    }

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

    let composition = AVMutableVideoComposition(asset: asset, applyingCIFiltersWithHandler: { request in
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

      // 4. Grain: luminance noise, nudged each frame so it moves like film.
      //    The noise is added as a positive amount and the frame is then
      //    pulled back down by its mean, so the grain is centred on zero
      //    whatever the compositor does with negative values.
      if grain > 0.001, let noise = Baker.makeGrain(strength: grain, time: request.compositionTime.seconds, frame: frame),
        let add = CIFilter(name: "CIAdditionCompositing", parameters: [
          kCIInputImageKey: noise,
          kCIInputBackgroundImageKey: image
        ]), let added = add.outputImage,
        let recentre = CIFilter(name: "CIColorMatrix", parameters: [
          kCIInputImageKey: added,
          "inputBiasVector": CIVector(x: -grainMean, y: -grainMean, z: -grainMean, w: 0)
        ]), let output = recentre.outputImage {
        image = output
      }

      request.finish(with: image.cropped(to: frame), context: context)
    })
    composition.renderSize = renderSize
    // HDR footage from a recent iPhone is brought to standard range here;
    // without this an HLG clip comes out washed and grey.
    composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_709_2
    composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_709_2
    composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_709_2

    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHighestQuality) else {
      promise.reject("E_BAKE_EXPORT", "This video cannot be exported")
      return
    }
    let outputURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("vintage-\(UUID().uuidString).mp4")
    export.videoComposition = composition
    export.outputURL = outputURL
    export.outputFileType = .mp4
    export.shouldOptimizeForNetworkUse = true
    // Storage refuses anything past ~50 MB, which is what "too long to
    // post" was. The exporter lowers the bitrate to fit under this; a
    // short clip is untouched, a full-length one is spent evenly.
    export.fileLengthLimit = 40 * 1024 * 1024

    export.exportAsynchronously {
      switch export.status {
      case .completed:
        let result: [String: Any] = [
          "uri": outputURL.absoluteString,
          "width": Int(renderSize.width),
          "height": Int(renderSize.height)
        ]
        promise.resolve(result)
      case .cancelled:
        promise.reject("E_BAKE_CANCELLED", "The export was cancelled")
      default:
        let reason = export.error?.localizedDescription ?? "unknown error"
        promise.reject("E_BAKE_EXPORT", "The filter could not be applied: \(reason)")
      }
    }
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

  /// Step 4: monochrome noise centred on zero, to be added to the frame.
  /// The generator is fixed in space, so it is slid a little every frame.
  static func makeGrain(strength: Double, time: Double, frame: CGRect) -> CIImage? {
    guard let generator = CIFilter(name: "CIRandomGenerator"), let random = generator.outputImage else {
      return nil
    }
    let tick = Int((time.isFinite ? time : 0) * 30)
    let dx = CGFloat((tick * 97) % 1024)
    let dy = CGFloat((tick * 57) % 1024)
    // The shader's grain cells are about two pixels across at this size.
    let moved = random
      .transformed(by: CGAffineTransform(scaleX: 2, y: 2))
      .transformed(by: CGAffineTransform(translationX: dx, y: dy))
    let k = CGFloat(grainStrength(strength))
    guard let toned = CIFilter(name: "CIColorMatrix", parameters: [
      kCIInputImageKey: moved,
      "inputRVector": CIVector(x: k * 0.299, y: k * 0.587, z: k * 0.114, w: 0),
      "inputGVector": CIVector(x: k * 0.299, y: k * 0.587, z: k * 0.114, w: 0),
      "inputBVector": CIVector(x: k * 0.299, y: k * 0.587, z: k * 0.114, w: 0),
      "inputAVector": CIVector(x: 0, y: 0, z: 0, w: 1),
      "inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 0)
    ]), let output = toned.outputImage else {
      return nil
    }
    return output.cropped(to: frame)
  }

  /// 0.14 is the shader's grain strength; 0.6 stands in for its mid-tone
  /// weighting, which a lookup-free pass cannot follow pixel by pixel.
  static func grainStrength(_ strength: Double) -> Double {
    return strength * 0.14 * 0.6
  }
}
