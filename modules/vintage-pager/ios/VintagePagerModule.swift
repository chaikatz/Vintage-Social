import ExpoModulesCore
import UIKit

/// Keeps the tab pager to one finger.
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
}
