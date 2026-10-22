import ExpoModulesCore
import UIKit

/// Keeps the tab pager, and the Darkroom's page turner, to one finger.
///
/// The five tabs live in a pager — a native scroll view that is swiped
/// between pages. By default such a scroll view follows any number of
/// fingers, so the moment two fingers landed on a photograph or the
/// timeline to pinch it, the pager read their average movement as a swipe
/// and dragged the whole screen sideways under the pinch, now and then
/// landing on the next tab. JavaScript hears about the pinch only after the
/// pager has already started, so it cannot stop it in time; the pager has to
/// be told beforehand, and it is told here: a pan on the pager takes exactly
/// one finger. Two fingers are left to whatever is under them. One finger
/// still swipes the tabs as it always did.
///
/// The pager is found under the view the tabs are drawn in, by the class the
/// pager library gives its view and the scroll view it keeps inside; the
/// rule is set on that one scroll view only, never on the lists in the pages.
///
/// The Darkroom turns its pages with a horizontal list, and a pinch on a
/// print zooms it inside its plate, so the list needs the same rule. Its own
/// scroll view is found from the list's tag and told the same thing.
public class VintagePagerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VintagePager")

    AsyncFunction("keepToOneFinger") { (viewTag: Int, promise: Promise) in
      DispatchQueue.main.async {
        var roots: [UIView] = []
        if let tagged = self.appContext?.findView(withTag: viewTag, ofType: UIView.self) {
          roots.append(tagged)
        } else if let window = Self.keyWindow() {
          // The tag could not be resolved; the pager is the only one in the
          // app, so the window will do.
          roots.append(window)
        }
        var told = false
        for root in roots {
          for pager in Self.pagers(under: root) {
            if let scroll = Self.firstScrollView(under: pager) {
              scroll.panGestureRecognizer.maximumNumberOfTouches = 1
              told = true
            }
          }
        }
        promise.resolve(told)
      }
    }

    AsyncFunction("keepScrollToOneFinger") { (viewTag: Int, promise: Promise) in
      DispatchQueue.main.async {
        Self.releaseRecycled()
        guard let host = self.reactView(withTag: viewTag), let scroll = Self.ownScrollView(of: host) else {
          promise.resolve(false)
          return
        }
        Self.remember(scroll: scroll, host: host)
        scroll.panGestureRecognizer.maximumNumberOfTouches = 1
        promise.resolve(true)
      }
    }
  }

  /// Every pager view below `root`: the library names its view RNCPagerView
  /// on the old architecture and RNCPagerViewComponentView on the new.
  static func pagers(under root: UIView) -> [UIView] {
    var found: [UIView] = []
    var queue: [UIView] = [root]
    while !queue.isEmpty {
      let view = queue.removeFirst()
      if NSStringFromClass(type(of: view)).hasPrefix("RNCPagerView") {
        found.append(view)
        continue
      }
      queue.append(contentsOf: view.subviews)
    }
    return found
  }

  /// The pager's own scroll view: the shallowest one beneath it, which is the
  /// page view controller's. The lists inside the pages sit deeper and are
  /// not descended into once it is found.
  static func firstScrollView(under pager: UIView) -> UIScrollView? {
    var queue: [UIView] = pager.subviews
    while !queue.isEmpty {
      let view = queue.removeFirst()
      if let scroll = view as? UIScrollView {
        return scroll
      }
      queue.append(contentsOf: view.subviews)
    }
    return nil
  }

  static func keyWindow() -> UIWindow? {
    return UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }
  }

  // MARK: - A React scroll view

  /// The native view React drew for `viewTag`. The bridge's view registry
  /// answers on the old architecture (and on the new one, through its
  /// proxy). On the new architecture each component view also carries its
  /// React tag as its UIKit tag, which is the way in when the registry has
  /// no answer; only React's own views are taken, so a UIKit view that
  /// happens to use the same number is never mistaken for it.
  private func reactView(withTag viewTag: Int) -> UIView? {
    if let view = appContext?.findView(withTag: viewTag, ofType: UIView.self) {
      return view
    }
    guard viewTag != 0, let window = Self.keyWindow() else {
      return nil
    }
    if let quick = window.viewWithTag(viewTag), Self.isReactView(quick) {
      return quick
    }
    var queue: [UIView] = [window]
    while !queue.isEmpty {
      let view = queue.removeFirst()
      if view.tag == viewTag && Self.isReactView(view) {
        return view
      }
      queue.append(contentsOf: view.subviews)
    }
    return nil
  }

  static func isReactView(_ view: UIView) -> Bool {
    return NSStringFromClass(type(of: view)).hasPrefix("RCT")
  }

  /// The UIScrollView a React scroll view keeps: the view itself, or the one
  /// directly inside it (RCTScrollView on the old architecture,
  /// RCTScrollViewComponentView on the new). Nothing deeper is taken, so a
  /// zoomable plate inside a page is never the one told.
  static func ownScrollView(of host: UIView) -> UIScrollView? {
    if let scroll = host as? UIScrollView {
      return scroll
    }
    for view in host.subviews {
      if let scroll = view as? UIScrollView {
        return scroll
      }
    }
    return nil
  }

  // MARK: - Recycled scroll views

  /// A scroll view that was told to keep to one finger, and how many touches
  /// it followed before.
  private final class OneFinger {
    weak var scroll: UIScrollView?
    weak var host: UIView?
    let tag: Int
    let touches: Int

    init(scroll: UIScrollView, host: UIView) {
      self.scroll = scroll
      self.host = host
      self.tag = host.tag
      self.touches = scroll.panGestureRecognizer.maximumNumberOfTouches
    }
  }

  /// Touched on the main thread only.
  private static var oneFinger: [OneFinger] = []

  private static func remember(scroll: UIScrollView, host: UIView) {
    if oneFinger.contains(where: { $0.scroll === scroll }) {
      return
    }
    oneFinger.append(OneFinger(scroll: scroll, host: host))
  }

  /// The new architecture keeps an unmounted scroll view and hands it to the
  /// next scroll view mounted anywhere, rule and all; it clears the view's
  /// tag when it puts it away and gives it a new one when it is reused. A
  /// list told to keep to one finger whose tag has changed is no longer the
  /// Darkroom's, so it gets back the touches it followed before. A list that
  /// picks up the rule in between still scrolls with one finger, which is
  /// all a list asks of a pan.
  private static func releaseRecycled() {
    oneFinger.removeAll { entry in
      guard let scroll = entry.scroll, let host = entry.host else {
        return true
      }
      if host.tag != entry.tag {
        scroll.panGestureRecognizer.maximumNumberOfTouches = entry.touches
        return true
      }
      return false
    }
  }
}
