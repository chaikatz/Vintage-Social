import ExpoModulesCore
import Foundation
import MapKit

/// Finds the place a post names.
///
/// Apple Maps already draws the map a profile is read on, so its search is
/// the natural source for the places a member picks from: restaurants,
/// hotels, landmarks, neighbourhoods, towns. Each result carries enough of
/// its address to tell it from another of the same name, and a point that
/// is the place's own — never the phone's location, which is not asked for.
/// No key, no account, no quota beyond the system's own.
///
/// Two searches run for every query. The completer is what Maps itself
/// types ahead with: it matches the first letters of a name, so "bar pi"
/// already offers Bar Pitti. The full search ranks by relevance to whole
/// words. Their answers are merged, completions first, with the same place
/// never listed twice — so a member sees what they mean as they type it,
/// not only once they have spelled it exactly.
public class VintagePlacesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VintagePlaces")

    AsyncFunction("search") { (query: String, promise: Promise) in
      let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.count < 2 {
        promise.resolve([[String: Any]]())
        return
      }
      DispatchQueue.main.async {
        PlaceFinder(query: trimmed).run { results in promise.resolve(results) }
      }
    }
  }

  /// One result, in the shape the picker draws.
  static func describe(_ item: MKMapItem) -> [String: Any]? {
    let placemark = item.placemark
    let coordinate = placemark.coordinate
    guard CLLocationCoordinate2DIsValid(coordinate) else { return nil }
    let name = item.name ?? placemark.name ?? ""
    if name.isEmpty { return nil }

    // A short address: the locality and country are what tell two places
    // of the same name apart; the street when it is the whole story.
    var parts: [String] = []
    if let street = placemark.thoroughfare, !street.isEmpty, item.pointOfInterestCategory != nil {
      parts.append(street)
    }
    if let locality = placemark.locality, !locality.isEmpty, locality != name {
      parts.append(locality)
    } else if let area = placemark.subAdministrativeArea, !area.isEmpty, area != name {
      parts.append(area)
    }
    if let region = placemark.administrativeArea, !region.isEmpty, region != name, !parts.contains(region) {
      parts.append(region)
    }
    if let country = placemark.country, !country.isEmpty, country != name {
      parts.append(country)
    }
    let subtitle = parts.joined(separator: ", ")

    // Apple hands out a stable identifier from iOS 18; earlier systems get
    // a key derived from the point and the name, which is stable enough
    // for "the same place on another post".
    var identifier = String(format: "apple:%.5f,%.5f:%@", coordinate.latitude, coordinate.longitude, name)
    if #available(iOS 18.0, *) {
      if let id = item.identifier?.rawValue, !id.isEmpty {
        identifier = "apple:" + id
      }
    }

    return [
      "id": String(identifier.prefix(200)),
      "name": name,
      "subtitle": subtitle,
      "lat": coordinate.latitude,
      "lng": coordinate.longitude,
      "category": item.pointOfInterestCategory?.rawValue ?? ""
    ]
  }
}

/// One query's two searches, merged. Lives on the main thread (the
/// completer's delegate requires it) and keeps itself alive until done.
private final class PlaceFinder: NSObject, MKLocalSearchCompleterDelegate {
  private let query: String
  private let completer = MKLocalSearchCompleter()
  private var completions: [MKMapItem] = []
  private var fullSearch: [MKMapItem] = []
  private var completionsDone = false
  private var fullSearchDone = false
  private var finished = false
  private var done: (([[String: Any]]) -> Void)?
  private var keepAlive: PlaceFinder?

  /// How many type-ahead completions are resolved to real places.
  private static let completionsResolved = 6

  init(query: String) {
    self.query = query
    super.init()
    keepAlive = self
  }

  func run(_ done: @escaping ([[String: Any]]) -> Void) {
    self.done = done

    // The whole world, so "Bar Pitti" is found from anywhere. Apple ranks
    // by relevance to the words, not by distance, when no region is given
    // — which is what a place written on a photograph wants.
    let request = MKLocalSearch.Request()
    request.naturalLanguageQuery = query
    request.resultTypes = [.pointOfInterest, .address]
    MKLocalSearch(request: request).start { [weak self] response, _ in
      // "No results" arrives as an error on some systems; an empty list is
      // the honest answer to that, not a failure.
      self?.fullSearch = response?.mapItems ?? []
      self?.fullSearchDone = true
      self?.finishIfReady()
    }

    completer.delegate = self
    completer.resultTypes = [.pointOfInterest, .address, .query]
    completer.queryFragment = query

    // Neither search may hold the picker for long; whatever has arrived by
    // then is the answer.
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.0) { [weak self] in
      self?.completionsDone = true
      self?.fullSearchDone = true
      self?.finishIfReady()
    }
  }

  func completerDidUpdateResults(_ completer: MKLocalSearchCompleter) {
    resolve(Array(completer.results.prefix(PlaceFinder.completionsResolved)))
  }

  func completer(_ completer: MKLocalSearchCompleter, didFailWithError error: Error) {
    completionsDone = true
    finishIfReady()
  }

  /// Each completion is a suggestion, not yet a place: ask Maps for the
  /// place behind it, keeping the order the completer gave.
  private func resolve(_ results: [MKLocalSearchCompletion]) {
    if results.isEmpty {
      completionsDone = true
      finishIfReady()
      return
    }
    var slots = [MKMapItem?](repeating: nil, count: results.count)
    let group = DispatchGroup()
    for (i, completion) in results.enumerated() {
      group.enter()
      MKLocalSearch(request: MKLocalSearch.Request(completion: completion)).start { response, _ in
        slots[i] = response?.mapItems.first
        group.leave()
      }
    }
    group.notify(queue: .main) { [weak self] in
      self?.completions = slots.compactMap { $0 }
      self?.completionsDone = true
      self?.finishIfReady()
    }
  }

  private func finishIfReady() {
    guard !finished, completionsDone, fullSearchDone else { return }
    finished = true
    var seen = Set<String>()
    var out: [[String: Any]] = []
    for item in completions + fullSearch {
      guard let described = VintagePlacesModule.describe(item), let id = described["id"] as? String else { continue }
      // The same place from both searches, or two entries for one spot.
      let key = id + "|" + ((described["name"] as? String) ?? "").lowercased()
      if seen.contains(key) { continue }
      seen.insert(key)
      out.append(described)
      if out.count >= 20 { break }
    }
    done?(out)
    done = nil
    keepAlive = nil
  }
}
