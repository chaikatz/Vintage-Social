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
public class VintagePlacesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VintagePlaces")

    AsyncFunction("search") { (query: String, promise: Promise) in
      let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
      if trimmed.count < 2 {
        promise.resolve([[String: Any]]())
        return
      }
      let request = MKLocalSearch.Request()
      request.naturalLanguageQuery = trimmed
      request.resultTypes = [.pointOfInterest, .address]
      // The whole world, so "Bar Pitti" is found from anywhere. Apple
      // ranks by relevance to the words, not by distance, when no region
      // is given — which is what a place written on a photograph wants.
      let search = MKLocalSearch(request: request)
      search.start { response, error in
        if let error = error {
          // "No results" arrives as an error on some OS versions; an empty
          // list is the honest answer to that, not a failure.
          let code = (error as NSError).code
          if code == MKError.placemarkNotFound.rawValue {
            promise.resolve([[String: Any]]())
          } else {
            promise.reject("E_PLACES", error.localizedDescription)
          }
          return
        }
        let items = response?.mapItems ?? []
        let results: [[String: Any]] = items.prefix(20).compactMap { item in
          VintagePlacesModule.describe(item)
        }
        promise.resolve(results)
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
